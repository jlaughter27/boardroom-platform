import { describe, it, expect } from 'vitest';
import { KnowledgeGraphQuerySchema, KnowledgeGraphSchema } from '../validation/graph.schema';
import { KNOWLEDGE_GRAPH_MEMORY_LIMIT } from '../constants/graph-config';

// RD-6 — the memory cap is a validated request parameter and the response says how many exist.
describe('knowledge graph memory cap (RD-6)', () => {
  it('limits: default 200, step 200, max 1000 — the max is a whole number of steps', () => {
    expect(KNOWLEDGE_GRAPH_MEMORY_LIMIT).toEqual({ DEFAULT: 200, MAX: 1000, STEP: 200 });
    expect(KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX % KNOWLEDGE_GRAPH_MEMORY_LIMIT.STEP).toBe(0);
  });

  it('query: coerces the URL string, accepts 0..MAX, rejects anything else', () => {
    expect(KnowledgeGraphQuerySchema.parse({ memoryLimit: '1000' }).memoryLimit).toBe(1000);
    expect(KnowledgeGraphQuerySchema.parse({ memoryLimit: '0' }).memoryLimit).toBe(0);
    expect(KnowledgeGraphQuerySchema.parse({}).memoryLimit).toBeUndefined();
    for (const bad of ['1001', '-1', '2.5', 'many']) {
      expect(KnowledgeGraphQuerySchema.safeParse({ memoryLimit: bad }).success).toBe(false);
    }
  });

  it('response: stats.memoryTotal is required and non-negative', () => {
    const base = {
      nodes: [], edges: [], generatedAt: '2026-10-23T00:00:00.000Z',
      stats: { nodeCounts: { goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0 }, edgeCount: 0, isolatedNodes: 0, memoryLimitHit: false },
    };
    expect(KnowledgeGraphSchema.safeParse(base).success).toBe(false);
    expect(KnowledgeGraphSchema.safeParse({ ...base, stats: { ...base.stats, memoryTotal: 640 } }).success).toBe(true);
    expect(KnowledgeGraphSchema.safeParse({ ...base, stats: { ...base.stats, memoryTotal: -1 } }).success).toBe(false);
  });
});
