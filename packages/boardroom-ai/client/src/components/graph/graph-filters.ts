import type { KnowledgeGraphEdge, KnowledgeGraphEdgeType, KnowledgeGraphNode } from '@boardroom/shared';

/**
 * Edge-type filter + neighbour grouping. Pure helpers over the wire types.
 * The ten edge types mirror `KnowledgeGraphEdgeTypeSchema` in shared.
 */

export const EDGE_TYPES: KnowledgeGraphEdgeType[] = [
  'goal_hierarchy',
  'goal_project',
  'project_task',
  'project_person',
  'decision_project',
  'task_dependency',
  'commitment_person',
  'commitment_project',
  'commitment_entity',
  'memory_entity',
];

export const EDGE_TYPE_LABEL: Record<KnowledgeGraphEdgeType, string> = {
  goal_hierarchy: 'Sub-goal',
  goal_project: 'Goal → project',
  project_task: 'Project → task',
  project_person: 'Project → person',
  decision_project: 'Decision → project',
  task_dependency: 'Depends on',
  commitment_person: 'Commitment → person',
  commitment_project: 'Commitment → project',
  commitment_entity: 'Commitment → entity',
  memory_entity: 'Memory → entity',
};

export interface EdgeFilterResult {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  /** Node ids dropped because the filter removed their last edge */
  orphaned: string[];
}

/**
 * Keep only edges whose type is allowed, then drop nodes that *became*
 * orphans because of it (had ≥1 edge before, none after). Nodes that were
 * already orphans are left alone — the Orphans toggle owns those — and ids
 * in `keep` (the selected / focused node) always survive.
 */
export function filterByEdgeTypes(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
  allowed: ReadonlySet<KnowledgeGraphEdgeType>,
  keep: ReadonlySet<string> = new Set(),
): EdgeFilterResult {
  if (EDGE_TYPES.every((t) => allowed.has(t))) return { nodes: [...nodes], edges: [...edges], orphaned: [] };
  const before = new Set<string>();
  for (const e of edges) { before.add(e.source); before.add(e.target); }
  const kept = edges.filter((e) => allowed.has(e.type));
  const after = new Set<string>();
  for (const e of kept) { after.add(e.source); after.add(e.target); }
  const orphaned: string[] = [];
  const outNodes = nodes.filter((n) => {
    if (keep.has(n.id)) return true;
    if (!before.has(n.id)) return true; // was an orphan already
    if (after.has(n.id)) return true;
    orphaned.push(n.id);
    return false;
  });
  return { nodes: outNodes, edges: kept, orphaned };
}

export interface NeighbourItem {
  node: KnowledgeGraphNode;
  edge: KnowledgeGraphEdge;
  /** 'out' when the focus node is the edge source */
  direction: 'out' | 'in';
}

export interface NeighbourGroup {
  type: KnowledgeGraphEdgeType;
  label: string;
  items: NeighbourItem[];
}

/**
 * Neighbours of `nodeId` grouped by edge type (schema order), each group
 * sorted by label. Edges to nodes missing from `nodesById` are skipped.
 */
export function groupNeighboursByEdgeType(
  nodeId: string,
  edges: readonly KnowledgeGraphEdge[],
  nodesById: ReadonlyMap<string, KnowledgeGraphNode>,
): NeighbourGroup[] {
  const byType = new Map<KnowledgeGraphEdgeType, NeighbourItem[]>();
  const seen = new Set<string>();
  for (const e of edges) {
    let otherId: string | null = null;
    let direction: 'out' | 'in' = 'out';
    if (e.source === nodeId) otherId = e.target;
    else if (e.target === nodeId) { otherId = e.source; direction = 'in'; }
    if (!otherId) continue;
    const node = nodesById.get(otherId);
    if (!node) continue;
    const k = `${e.id}|${otherId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push({ node, edge: e, direction });
  }
  for (const list of byType.values()) list.sort((a, b) => a.node.label.localeCompare(b.node.label));
  return EDGE_TYPES.filter((t) => byType.has(t)).map((t) => ({ type: t, label: EDGE_TYPE_LABEL[t], items: byType.get(t)! }));
}
