import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getKnowledgeGraph } from '../../../src/services/knowledge-graph.service';

const d = new Date('2026-10-01T00:00:00Z');

function fakePrisma(over: Partial<Record<string, unknown[]>> = {}) {
  const table = (rows: unknown[] = []) => ({ findMany: vi.fn(async () => rows) });
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
      { id: 'm2', title: 'Sermon prep', domain: 'ministry', importance: 0.9, status: 'CONFIRMED', memoryClass: 'SEMANTIC', createdAt: d },
    ]),
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
    // ministry memory with no links is isolated
    expect(g.stats.isolatedNodes).toBe(1);
    // domains normalized
    expect(g.nodes.find((n) => n.id === 'goal:g1')?.domain).toBe('business');
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
    expect(ids.has('memory:m2')).toBe(false);      // ministry memory removed
    expect(ids.has('task:t1')).toBe(true);         // domain-less task kept via project edge
    expect(ids.has('decision:d1')).toBe(true);     // domain-less decision kept via project edge
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it('caps memories and reports memoryLimitHit; passes tenant + archive filters to Prisma', async () => {
    const prisma = fakePrisma();
    const g = await getKnowledgeGraph('user-1', { memoryLimit: 2, tenantId: 'josh-business' }, prisma);
    expect(g.stats.memoryLimitHit).toBe(true);
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
    expect((prisma as unknown as { memoryEntry: { findMany: ReturnType<typeof vi.fn> } }).memoryEntry.findMany).not.toHaveBeenCalled();
  });
});
