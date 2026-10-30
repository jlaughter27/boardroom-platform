import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { KNOWLEDGE_GRAPH_MEMORY_LIMIT } from '@boardroom/shared';
import { getKnowledgeGraph } from '../../../src/services/knowledge-graph.service';

const d = new Date('2026-10-01T00:00:00Z');

function fakePrisma(over: Partial<Record<string, unknown[]>> = {}, memoryCount?: number) {
  const table = (rows: unknown[] = [], count?: number) => ({ findMany: vi.fn(async () => rows), count: vi.fn(async () => count ?? rows.length) });
  return {
    goal: table(over.goal ?? [
      { id: 'g1', title: 'Launch v1', domain: 'Business', status: 'active', level: 1, parentGoalId: null, createdAt: d },
      { id: 'g2', title: 'Ship billing', domain: 'business', status: 'active', level: 2, parentGoalId: 'g1', createdAt: d },
    ]),
    project: table(over.project ?? [
      { id: 'p1', title: 'Stripe integration', domain: 'business', status: 'active', createdAt: d },
    ]),
    task: table(over.task ?? [
      { id: 't1', title: 'Webhook handler', status: 'pending', priority: 2, createdAt: d },
      { id: 't2', title: 'Cancel flow', status: 'pending', priority: 1, createdAt: d },
    ]),
    person: table(over.person ?? [
      { id: 'u1', name: 'Alex', role: 'advisor', domains: ['business'], importance: 0.8, createdAt: d },
    ]),
    decision: table(over.decision ?? [
      { id: 'd1', title: 'Use Stripe', status: 'DECIDED', sessionId: 's1', createdAt: d },
    ]),
    commitment: table(over.commitment ?? [
      { id: 'c1', description: 'Send Alex the pricing deck', status: 'OPEN', stakeholderId: 'u1', linkedProjectId: 'p1', createdAt: d },
    ]),
    memoryEntry: table(over.memoryEntry ?? [
      { id: 'm1', title: 'Pricing call notes', domain: 'business', importance: 0.7, status: 'CONFIRMED', memoryClass: 'EPISODIC', createdAt: d },
      // Lane H (2026-10-30): ministry memories are excluded from the graph now
      // (tests/unit/services/ministry-read-paths.test.ts); this unlinked
      // fixture row is a personal one.
      { id: 'm2', title: 'Weekend plans', domain: 'personal', importance: 0.9, status: 'CONFIRMED', memoryClass: 'SEMANTIC', createdAt: d },
    ], memoryCount),
    goalProjectLink: table(over.goalProjectLink ?? [{ goalId: 'g2', projectId: 'p1' }]),
    projectTaskLink: table(over.projectTaskLink ?? [{ projectId: 'p1', taskId: 't1' }, { projectId: 'p1', taskId: 't2' }]),
    projectPersonLink: table(over.projectPersonLink ?? [{ projectId: 'p1', personId: 'u1', role: 'advisor' }]),
    decisionProjectLink: table(over.decisionProjectLink ?? [{ decisionId: 'd1', projectId: 'p1' }]),
    taskDependency: table(over.taskDependency ?? [{ taskId: 't2', dependsOnTaskId: 't1' }]),
    memoryEntityLink: table(over.memoryEntityLink ?? [
      { memoryId: 'm1', entityType: 'project', entityId: 'p1', linkType: 'relates_to' },
      { memoryId: 'm1', entityType: 'person', entityId: 'ghost', linkType: 'relates_to' }, // dangling → dropped
    ]),
    commitmentLink: table(over.commitmentLink ?? []),
  } as unknown as PrismaClient;
}

describe('getKnowledgeGraph', () => {
  it('builds namespaced nodes, every edge type, and drops dangling endpoints', async () => {
    const g = await getKnowledgeGraph('user-1', {}, fakePrisma());

    expect(g.stats.nodeCounts).toEqual({ goal: 2, project: 1, task: 2, person: 1, decision: 1, commitment: 1, memory: 2 });
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has('goal:g1')).toBe(true);
    expect(ids.has('memory:m2')).toBe(true);

    const types = new Set(g.edges.map((e) => e.type));
    expect([...types].sort()).toEqual([
      'commitment_person', 'commitment_project', 'decision_project', 'goal_hierarchy',
      'goal_project', 'memory_entity', 'project_person', 'project_task', 'task_dependency',
    ]);
    // dangling memory→person:ghost link is dropped
    expect(g.edges.find((e) => e.target === 'person:ghost')).toBeUndefined();
    // role carried as label
    expect(g.edges.find((e) => e.type === 'project_person')?.label).toBe('advisor');
    // every edge endpoint exists
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
    // the personal memory with no links is isolated
    expect(g.stats.isolatedNodes).toBe(1);
    // domains normalized
    expect(g.nodes.find((n) => n.id === 'goal:g1')?.domain).toBe('business');
  });

  it('RD-12: a STAKEHOLDER commitment yields a commitment_person edge labelled "owes you"; USER → null', async () => {
    const g = await getKnowledgeGraph('user-1', {}, fakePrisma({
      commitment: [
        { id: 'c1', description: 'Send Alex the pricing deck', status: 'OPEN', stakeholderId: 'u1', linkedProjectId: null, createdAt: d, owedBy: 'USER' },
        { id: 'c2', description: 'Alex sends the signed contract', status: 'OPEN', stakeholderId: 'u1', linkedProjectId: null, createdAt: d, owedBy: 'STAKEHOLDER' },
      ],
    }));
    const edge = (cid: string) => g.edges.find((e) => e.type === 'commitment_person' && e.source === `commitment:${cid}`);
    expect(edge('c1')?.label).toBeNull();
    expect(edge('c2')?.label).toBe('owes you');
  });

  it('respects the types filter and skips unneeded link tables', async () => {
    const prisma = fakePrisma();
    const g = await getKnowledgeGraph('user-1', { types: ['goal', 'project'] }, prisma);
    expect(g.stats.nodeCounts.task).toBe(0);
    expect(g.stats.nodeCounts.memory).toBe(0);
    expect(g.edges.every((e) => e.type === 'goal_project' || e.type === 'goal_hierarchy')).toBe(true);
    expect((prisma as unknown as { task: { findMany: ReturnType<typeof vi.fn> } }).task.findMany).not.toHaveBeenCalled();
    expect((prisma as unknown as { projectTaskLink: { findMany: ReturnType<typeof vi.fn> } }).projectTaskLink.findMany).not.toHaveBeenCalled();
  });

  it('domain filter keeps matching nodes plus their domain-less neighbours only', async () => {
    const g = await getKnowledgeGraph('user-1', { domain: 'Business' }, fakePrisma());
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has('memory:m2')).toBe(false);      // personal memory removed by the domain filter
    expect(ids.has('task:t1')).toBe(true);         // domain-less task kept via project edge
    expect(ids.has('decision:d1')).toBe(true);     // domain-less decision kept via project edge
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it('caps memories and reports memoryLimitHit; passes tenant + archive filters to Prisma', async () => {
    const prisma = fakePrisma({}, 7); // 7 match, 2 come back
    const g = await getKnowledgeGraph('user-1', { memoryLimit: 2, tenantId: 'josh-business' }, prisma);
    expect(g.stats.memoryLimitHit).toBe(true);
    expect(g.stats.memoryTotal).toBe(7);
    const call = (prisma as unknown as { memoryEntry: { findMany: ReturnType<typeof vi.fn> } }).memoryEntry.findMany.mock.calls[0][0];
    expect(call.take).toBe(2);
    expect(call.where.tenantId).toBe('josh-business');
    expect(call.where.status).toEqual({ not: 'ARCHIVED' });
    expect(call.select.content).toBeUndefined(); // never ships memory content
  });

  it('memoryLimit 0 removes the memory layer entirely', async () => {
    const prisma = fakePrisma();
    const g = await getKnowledgeGraph('user-1', { memoryLimit: 0 }, prisma);
    expect(g.stats.nodeCounts.memory).toBe(0);
    expect(g.stats.memoryLimitHit).toBe(false);
    expect(g.stats.memoryTotal).toBe(0);
    expect((prisma as unknown as { memoryEntry: { findMany: ReturnType<typeof vi.fn> } }).memoryEntry.findMany).not.toHaveBeenCalled();
    expect((prisma as unknown as { memoryEntry: { count: ReturnType<typeof vi.fn> } }).memoryEntry.count).not.toHaveBeenCalled();
  });
});

// RD-6 — the cap is a request parameter with a safe maximum, and the total tells the UI what is hidden.
describe('getKnowledgeGraph — memory cap + total (RD-6)', () => {
  type MemoryMock = { memoryEntry: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> } };
  const mem = (p: PrismaClient) => (p as unknown as MemoryMock).memoryEntry;

  it('defaults to KNOWLEDGE_GRAPH_MEMORY_LIMIT.DEFAULT (200) memories when no limit is asked for', async () => {
    const prisma = fakePrisma();
    await getKnowledgeGraph('user-1', {}, prisma);
    expect(mem(prisma).findMany.mock.calls[0][0].take).toBe(KNOWLEDGE_GRAPH_MEMORY_LIMIT.DEFAULT);
    expect(KNOWLEDGE_GRAPH_MEMORY_LIMIT.DEFAULT).toBe(200);
  });

  it('honours a raised limit and clamps anything above the max (defence in depth behind the route 422)', async () => {
    const prisma = fakePrisma();
    await getKnowledgeGraph('user-1', { memoryLimit: 600 }, prisma);
    expect(mem(prisma).findMany.mock.calls[0][0].take).toBe(600);
    const p2 = fakePrisma();
    await getKnowledgeGraph('user-1', { memoryLimit: 5000 }, p2);
    expect(mem(p2).findMany.mock.calls[0][0].take).toBe(KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX);
    expect(KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX).toBe(1000);
  });

  it('counts with exactly the same filter as the capped read (tenant + archive), never a cap', async () => {
    const prisma = fakePrisma({}, 640);
    await getKnowledgeGraph('user-1', { memoryLimit: 200, tenantId: 'josh-business', includeArchived: true }, prisma);
    const read = mem(prisma).findMany.mock.calls[0][0];
    const count = mem(prisma).count.mock.calls[0][0];
    expect(count.where).toEqual(read.where);
    expect(count.where).toMatchObject({ userId: 'user-1', deletedAt: null, tenantId: 'josh-business' });
    expect(count.where.status).toBeUndefined(); // includeArchived
    expect(count.take).toBeUndefined();
  });

  it('reports memoryTotal and the hidden remainder; exactly-at-the-limit is not "truncated"', async () => {
    const hidden = await getKnowledgeGraph('user-1', { memoryLimit: 2 }, fakePrisma({}, 640));
    expect(hidden.stats.nodeCounts.memory).toBe(2);
    expect(hidden.stats.memoryTotal).toBe(640);
    expect(hidden.stats.memoryLimitHit).toBe(true);

    // 2 rows, limit 2, 2 in the table: the old `length >= limit` check said "capped" here.
    const exact = await getKnowledgeGraph('user-1', { memoryLimit: 2 }, fakePrisma({}, 2));
    expect(exact.stats.memoryTotal).toBe(2);
    expect(exact.stats.memoryLimitHit).toBe(false);
  });

  it('a types filter without memory skips the count and reports 0', async () => {
    const prisma = fakePrisma({}, 99);
    const g = await getKnowledgeGraph('user-1', { types: ['goal'] }, prisma);
    expect(g.stats.memoryTotal).toBe(0);
    expect(g.stats.memoryLimitHit).toBe(false);
    expect(mem(prisma).count).not.toHaveBeenCalled();
  });
});
