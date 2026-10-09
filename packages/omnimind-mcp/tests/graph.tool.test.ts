import { describe, it, expect, vi } from 'vitest';
import { graphNeighborhoodTool, walkNeighborhood, GRAPH_NODE_CAP } from '../src/tools/graph.tool';
import { ScopeDeniedError, McpValidationError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'ag', agentName: 'ag', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1.0 };

function node(id: string) {
  const [type, refId] = id.split(':');
  return { id, type, refId, label: id, domain: null, status: null, importance: null, createdAt: '2026-01-01T00:00:00Z', meta: {} };
}
function edge(source: string, target: string) {
  return { id: `goal_project:${source}->${target}`, source, target, type: 'goal_project', label: null };
}

/** Star graph: root → n1..nK; each n_i → leaf_i. */
function makeClient(fanout: number, leaves = true): OmniMindClient {
  const getBacklinks = vi.fn().mockImplementation(async (id: string) => {
    if (id === 'goal:root') {
      return { node: node(id), backlinks: Array.from({ length: fanout }, (_, i) => ({ node: node(`project:n${i}`), edge: edge('goal:root', `project:n${i}`) })) };
    }
    if (id.startsWith('project:n') && leaves) {
      const i = id.slice('project:n'.length);
      return { node: node(id), backlinks: [{ node: node(`task:leaf${i}`), edge: edge(id, `task:leaf${i}`) }, { node: node('goal:root'), edge: edge('goal:root', id) }] };
    }
    return { node: node(id), backlinks: [] };
  });
  return { getBacklinks, logAudit: vi.fn().mockResolvedValue(undefined) } as unknown as OmniMindClient;
}

describe('graph_neighborhood (Phase 6)', () => {
  it('hops=1 returns the root + direct neighbours and their edges', async () => {
    const client = makeClient(3);
    const result = await graphNeighborhoodTool(client, ctx).execute({ nodeId: 'goal:root', userId: 'u' });
    expect(result.hops).toBe(1);
    expect(result.nodes.map(n => n.id).sort()).toEqual(['goal:root', 'project:n0', 'project:n1', 'project:n2']);
    expect(result.edges).toHaveLength(3);
    expect(result.truncated).toBe(false);
    expect(client.getBacklinks).toHaveBeenCalledTimes(1);
    expect(client.getBacklinks).toHaveBeenCalledWith('goal:root', 'u');
    expect(client.logAudit).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'graph_neighborhood' }));
  });

  it('hops=2 walks one more ring, deduplicates nodes/edges and never re-fetches visited nodes', async () => {
    const client = makeClient(2);
    const result = await walkNeighborhood(client, 'u', 'goal:root', 2);
    expect(result.nodes.map(n => n.id).sort()).toEqual(['goal:root', 'project:n0', 'project:n1', 'task:leaf0', 'task:leaf1']);
    expect(result.edges).toHaveLength(4);
    expect(client.getBacklinks).toHaveBeenCalledTimes(3); // root + 2 projects; leaves are not expanded at hops=2
  });

  it('caps the walk at 60 nodes and flags truncation; edges to dropped nodes are removed', async () => {
    const client = makeClient(100, false);
    const result = await walkNeighborhood(client, 'u', 'goal:root', 2);
    expect(result.nodes).toHaveLength(GRAPH_NODE_CAP);
    expect(result.truncated).toBe(true);
    const ids = new Set(result.nodes.map(n => n.id));
    for (const e of result.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
  });

  it('validates nodeId shape / hops and enforces memory:read', async () => {
    const client = makeClient(1);
    await expect(graphNeighborhoodTool(client, ctx).execute({ nodeId: 'root', userId: 'u' })).rejects.toBeInstanceOf(McpValidationError);
    await expect(graphNeighborhoodTool(client, ctx).execute({ nodeId: 'goal:root', hops: 3, userId: 'u' })).rejects.toBeInstanceOf(McpValidationError);
    await expect(graphNeighborhoodTool(client, { ...ctx, scopes: [] }).execute({ nodeId: 'goal:root', userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });
});
