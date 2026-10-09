/**
 * Phase 6 (A2) — GET /graph/backlinks/:nodeId service: incident edges (both
 * directions), complete memory backlinks (not capped), tenant scoping for
 * memories, 404 semantics via null.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getBacklinks, parseNodeId } from '../../../src/services/knowledge-graph.service';

const d = new Date('2026-10-01T00:00:00Z');

function fakePrisma(over: Record<string, any> = {}) {
  const table = (rows: unknown[] = []) => ({ findMany: vi.fn(async () => rows) });
  const mem = { id: 'm1', title: 'Pricing call notes', domain: 'business', importance: 0.7, status: 'CONFIRMED', memoryClass: 'EPISODIC', createdAt: d };
  return {
    goal: table([{ id: 'g1', title: 'Launch v1', domain: 'business', status: 'active', level: 1, parentGoalId: null, createdAt: d }]),
    project: table([{ id: 'p1', title: 'Stripe integration', domain: 'business', status: 'active', createdAt: d }]),
    task: table([{ id: 't1', title: 'Webhook handler', status: 'pending', priority: 2, createdAt: d }]),
    person: table([{ id: 'u1', name: 'Alex', role: 'advisor', domains: ['business'], importance: 0.8, createdAt: d }]),
    decision: table([]),
    commitment: table([]),
    goalProjectLink: table([{ goalId: 'g1', projectId: 'p1' }]),
    projectTaskLink: table([{ projectId: 'p1', taskId: 't1' }]),
    projectPersonLink: table([{ projectId: 'p1', personId: 'u1', role: 'advisor' }]),
    decisionProjectLink: table([]),
    taskDependency: table([]),
    commitmentLink: table([]),
    memoryEntityLink: {
      findMany: vi.fn(async () => over.memoryLinks ?? [{ memoryId: 'm1', entityType: 'project', entityId: 'p1', linkType: 'relates_to' }]),
    },
    memoryEntry: {
      findMany: vi.fn(async () => over.memories ?? [mem]),
      findFirst: vi.fn(async () => (over.memoryNode === undefined ? mem : over.memoryNode)),
    },
  } as unknown as PrismaClient & Record<string, any>;
}

describe('parseNodeId', () => {
  it('accepts <type>:<refId> for known types only', () => {
    expect(parseNodeId('project:p1')).toEqual({ type: 'project', refId: 'p1' });
    expect(parseNodeId('memory:ck:with:colons')).toEqual({ type: 'memory', refId: 'ck:with:colons' });
    expect(parseNodeId('widget:p1')).toBeNull();
    expect(parseNodeId('project:')).toBeNull();
    expect(parseNodeId('p1')).toBeNull();
  });
});

describe('getBacklinks', () => {
  it('returns the node and every incident edge in both directions, including memory backlinks read directly from MemoryEntityLink', async () => {
    const prisma = fakePrisma();
    const res = await getBacklinks('user-1', 'project:p1', {}, prisma);
    expect(res).not.toBeNull();
    expect(res!.node.id).toBe('project:p1');
    const byType = Object.fromEntries(res!.backlinks.map(b => [b.edge.type, b]));
    expect(Object.keys(byType).sort()).toEqual(['goal_project', 'memory_entity', 'project_person', 'project_task']);
    expect(byType.goal_project.node.id).toBe('goal:g1');
    expect(byType.goal_project.edge).toMatchObject({ source: 'goal:g1', target: 'project:p1' });
    expect(byType.project_task.node.id).toBe('task:t1');
    expect(byType.project_person.edge.label).toBe('advisor');
    expect(byType.memory_entity.node).toMatchObject({ id: 'memory:m1', type: 'memory', label: 'Pricing call notes' });
    expect(byType.memory_entity.edge).toMatchObject({ source: 'memory:m1', target: 'project:p1', label: 'relates_to' });
    // memory links are looked up for this node, not through the capped graph layer
    // R-O-13: case-insensitive on entity_type so legacy mixed-case rows still match
    expect(prisma.memoryEntityLink.findMany).toHaveBeenCalledWith({
      where: { entityType: { equals: 'project', mode: 'insensitive' }, entityId: 'p1' },
      select: { memoryId: true, linkType: true },
    });
  });

  it('scopes memory backlinks to the agent tenant and hides ARCHIVED memories by default', async () => {
    const prisma = fakePrisma();
    await getBacklinks('user-1', 'project:p1', { tenantId: 'josh-business' }, prisma);
    expect(prisma.memoryEntry.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null, tenantId: 'josh-business', status: { not: 'ARCHIVED' }, id: { in: ['m1'] } },
      select: expect.any(Object),
    });
  });

  it('drops memory links whose memory is not visible (other tenant / archived / deleted)', async () => {
    const prisma = fakePrisma({ memories: [] });
    const res = await getBacklinks('user-1', 'project:p1', {}, prisma);
    expect(res!.backlinks.some(b => b.edge.type === 'memory_entity')).toBe(false);
  });

  it('memory node: resolves the memory (tenant-scoped) and its outgoing entity links', async () => {
    const prisma = fakePrisma();
    const res = await getBacklinks('user-1', 'memory:m1', { tenantId: 'josh-business' }, prisma);
    expect(res!.node).toMatchObject({ id: 'memory:m1', type: 'memory', importance: 0.7 });
    expect(res!.backlinks).toHaveLength(1);
    expect(res!.backlinks[0].node.id).toBe('project:p1');
    expect(res!.backlinks[0].edge).toMatchObject({ type: 'memory_entity', source: 'memory:m1', target: 'project:p1' });
    expect(prisma.memoryEntry.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null, tenantId: 'josh-business', status: { not: 'ARCHIVED' }, id: 'm1' },
      select: expect.any(Object),
    });
  });

  it('null for a malformed id, an unknown entity, or a memory outside scope', async () => {
    expect(await getBacklinks('user-1', 'nope', {}, fakePrisma())).toBeNull();
    expect(await getBacklinks('user-1', 'project:ghost', {}, fakePrisma())).toBeNull();
    expect(await getBacklinks('user-1', 'memory:m1', {}, fakePrisma({ memoryNode: null }))).toBeNull();
  });
});
