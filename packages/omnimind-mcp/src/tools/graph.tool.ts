import { z } from 'zod';
import { McpGraphNeighborhoodOutputSchema } from '@boardroom/shared';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import type { OmniMindClient } from '../lib/client';
import { READ_ONLY_ANNOTATIONS } from '../types';
import type { AgentContext, McpTool } from '../types';

/** Hard cap on nodes returned by one `graph_neighborhood` call (and the resource). */
export const GRAPH_NODE_CAP = 60;

const NODE_ID_RE = /^(goal|project|task|person|decision|commitment|memory):[^\s]+$/;

const GraphNeighborhoodInput = z.object({
  nodeId: z.string().regex(NODE_ID_RE, 'nodeId must look like `<type>:<refId>` (goal|project|task|person|decision|commitment|memory)')
    .describe('Namespaced node id, e.g. `project:ckx…` or `memory:ckx…`'),
  hops: z.union([z.literal(1), z.literal(2)]).default(1).describe('Breadth of the walk: 1 (direct links) or 2'),
  userId: z.string().describe('User ID'),
});

export interface GraphNeighborhood {
  root: string;
  hops: 1 | 2;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

/**
 * BFS over `GET /graph/backlinks/:nodeId`, capped at GRAPH_NODE_CAP nodes.
 * Shared by the `graph_neighborhood` tool and the `omnimind://{tenant}/graph/{nodeId}` resource.
 */
export async function walkNeighborhood(
  client: OmniMindClient,
  userId: string,
  rootId: string,
  hops: 1 | 2
): Promise<GraphNeighborhood> {
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();
  let truncated = false;

  let frontier = [rootId];
  const visited = new Set<string>();

  for (let depth = 0; depth < hops && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const { node, backlinks } = await client.getBacklinks(id, userId);
      if (node && !nodes.has(node.id)) nodes.set(node.id, node);
      for (const { node: neighbour, edge } of backlinks) {
        if (!nodes.has(neighbour.id)) {
          if (nodes.size >= GRAPH_NODE_CAP) { truncated = true; continue; }
          nodes.set(neighbour.id, neighbour);
        }
        if (edge && !edges.has(edge.id)) edges.set(edge.id, edge);
        if (!visited.has(neighbour.id)) next.push(neighbour.id);
      }
      if (truncated) break;
    }
    if (truncated) break;
    frontier = next;
  }

  // Keep only edges whose endpoints both made it into the (possibly capped) node set.
  const kept = Array.from(edges.values()).filter(e => nodes.has(e.source) && nodes.has(e.target));
  return { root: rootId, hops, nodes: Array.from(nodes.values()), edges: kept, truncated };
}

export function graphNeighborhoodTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'graph_neighborhood',
    title: 'Graph neighbourhood',
    description: 'Walk the knowledge graph (goals, projects, tasks, people, decisions, commitments, memories) 1 or 2 hops out from a node and return the connected nodes + edges (max 60 nodes).',
    inputSchema: GraphNeighborhoodInput,
    outputSchema: McpGraphNeighborhoodOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(GraphNeighborhoodInput, raw);
      return withAudit(client, ctx, 'graph_neighborhood', input, () =>
        walkNeighborhood(client, input.userId, input.nodeId, input.hops)
      );
    },
  } satisfies McpTool;
}
