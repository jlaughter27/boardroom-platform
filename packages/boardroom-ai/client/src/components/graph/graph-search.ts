import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  MemoryApiRecord,
} from '@boardroom/shared';
import type { GraphBacklinksResponse } from '../../types/debate';
import { formatDay } from './graph-timeline';

/**
 * Spotlight search helpers: turning hybrid-search rows into graph hits,
 * finding hits the loaded graph does not contain, and merging their 1-hop
 * neighbourhoods back in without disturbing node identity (the view's
 * stable store keys by id, so appending is enough).
 */

export interface SpotlightHit {
  /** Graph node id, `type:refId` */
  nodeId: string;
  refId: string;
  type: KnowledgeGraphNodeType;
  label: string;
  score: number;
  snippet: string;
  /** Retrieval layers that matched, when the server reports them */
  layers: string[];
  status: string | null;
  createdAt: string;
}

/** A hybrid-search row plus the optional scoring extras the server may attach. */
export type HybridSearchRow = MemoryApiRecord & {
  score?: number;
  layers?: string[];
  matchedLayers?: string[];
  sources?: string[];
};

export function memoryNodeId(memoryId: string): string {
  return `memory:${memoryId}`;
}

export function hitLayers(row: HybridSearchRow): string[] {
  const raw = row.layers ?? row.matchedLayers ?? row.sources ?? [];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function memoryRowToHit(row: HybridSearchRow): SpotlightHit {
  const content = typeof row.content === 'string' ? row.content : '';
  return {
    nodeId: memoryNodeId(row.id),
    refId: row.id,
    type: 'memory',
    label: row.title || content.slice(0, 60) || row.id,
    score: typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : 0,
    snippet: content.length > 140 ? `${content.slice(0, 138)}…` : content,
    layers: hitLayers(row),
    status: row.status ?? null,
    createdAt: row.createdAt,
  };
}

export function scoreMap(hits: readonly SpotlightHit[]): Map<string, number> {
  return new Map(hits.map((h) => [h.nodeId, h.score]));
}

export function maxScore(hits: readonly SpotlightHit[]): number {
  let m = 0;
  for (const h of hits) if (h.score > m) m = h.score;
  return m;
}

/** Hits the loaded graph does not contain yet (candidates for a lazy 1-hop fetch). */
export function missingHitIds(hits: readonly SpotlightHit[], nodesById: ReadonlyMap<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (nodesById.has(h.nodeId) || seen.has(h.nodeId)) continue;
    seen.add(h.nodeId);
    out.push(h.nodeId);
  }
  return out;
}

/**
 * Merge backlink neighbourhoods into the graph. Returns the SAME graph object
 * when nothing new arrived, so memoised consumers do not churn. Nodes already
 * present keep their existing row (the view mutates `data` in place anyway).
 */
export function mergeBacklinks(graph: KnowledgeGraph, responses: readonly GraphBacklinksResponse[]): KnowledgeGraph {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const newNodes: KnowledgeGraphNode[] = [];
  const newEdges: KnowledgeGraphEdge[] = [];
  const addNode = (n: KnowledgeGraphNode) => { if (!nodeIds.has(n.id)) { nodeIds.add(n.id); newNodes.push(n); } };
  const addEdge = (e: KnowledgeGraphEdge) => { if (!edgeIds.has(e.id)) { edgeIds.add(e.id); newEdges.push(e); } };
  for (const r of responses) {
    if (!r || !r.node) continue;
    addNode(r.node);
    for (const b of r.backlinks ?? []) { addNode(b.node); addEdge(b.edge); }
  }
  // Drop edges whose endpoints we still do not know about (defensive).
  const safeEdges = newEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  if (newNodes.length === 0 && safeEdges.length === 0) return graph;
  const nodeCounts = { ...graph.stats.nodeCounts };
  for (const n of newNodes) nodeCounts[n.type] = (nodeCounts[n.type] ?? 0) + 1;
  return {
    ...graph,
    nodes: [...graph.nodes, ...newNodes],
    edges: [...graph.edges, ...safeEdges],
    stats: { ...graph.stats, nodeCounts, edgeCount: graph.stats.edgeCount + safeEdges.length },
  };
}

/** `YYYY-MM-DD` → ISO instant at the END of that UTC day (so "as of 12 Aug" includes the 12th). */
export function asOfToIso(day: string | null | undefined): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const ms = Date.parse(`${day}T23:59:59.999Z`);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Chip text: "as of 12 Aug 2026". */
export function formatAsOf(day: string | null | undefined): string | null {
  const iso = asOfToIso(day);
  if (!iso) return null;
  return `as of ${formatDay(Date.parse(iso))}`;
}
