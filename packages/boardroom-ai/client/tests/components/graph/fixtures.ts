import type { KnowledgeGraph, KnowledgeGraphEdge, KnowledgeGraphEdgeType, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';

export function node(
  id: string,
  overrides: Partial<KnowledgeGraphNode> = {},
): KnowledgeGraphNode {
  const [type, refId] = id.includes(':') ? (id.split(':') as [KnowledgeGraphNodeType, string]) : (['project', id] as [KnowledgeGraphNodeType, string]);
  return {
    id,
    type,
    refId,
    label: overrides.label ?? id,
    domain: null,
    status: null,
    importance: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    meta: {},
    ...overrides,
  };
}

export function edge(source: string, target: string, type: KnowledgeGraphEdgeType = 'memory_entity', label: string | null = null): KnowledgeGraphEdge {
  return { id: `${type}:${source}->${target}`, source, target, type, label };
}

export function graphOf(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]): KnowledgeGraph {
  const nodeCounts: Record<KnowledgeGraphNodeType, number> = { goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0 };
  for (const n of nodes) nodeCounts[n.type] += 1;
  return { nodes, edges, stats: { nodeCounts, edgeCount: edges.length, isolatedNodes: 0, memoryLimitHit: false }, generatedAt: '2026-10-18T00:00:00.000Z' };
}

/**
 * A 2D context stand-in that records every property assignment and method
 * call, so painters can be asserted without a real canvas.
 */
export interface FakeCtx extends CanvasRenderingContext2D {
  calls: string[];
  alphas: number[];
}

export function fakeCtx(): FakeCtx {
  const calls: string[] = [];
  const alphas: number[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const target: Record<string, unknown> = { calls, alphas };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop in state) return state[prop];
      return (...args: unknown[]) => { calls.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`); };
    },
    set(_t, prop: string, value: unknown) {
      if (prop === 'globalAlpha' && typeof value === 'number') alphas.push(value);
      state[prop] = value;
      return true;
    },
  }) as unknown as FakeCtx;
}
