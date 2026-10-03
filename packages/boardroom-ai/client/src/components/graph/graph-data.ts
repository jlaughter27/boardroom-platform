import type { NodeObject, LinkObject } from 'react-force-graph-2d';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';

/**
 * Stable node / link instances for the force graph.
 *
 * force-graph re-heats the simulation (alpha = 1) every time it receives a new
 * `graphData` object, and d3-force only seeds x/y for nodes that lack them. So
 * the view keeps ONE object per node id (and per edge id) across renders:
 * selection / depth changes mutate `data` / `degree` / `depth` in place and
 * return the previous `graphData` object (no relayout); only a change in the
 * set of ids produces a new object (relayout, with surviving positions).
 */

export interface GraphViewNode extends NodeObject {
  id: string;
  data: KnowledgeGraphNode;
  degree: number;
  /** Distance from the focus node when local-graph mode is on (0 = focus) */
  depth?: number;
}

export interface GraphViewLink extends LinkObject {
  id: string;
  source: string | GraphViewNode;
  target: string | GraphViewNode;
  data: KnowledgeGraphEdge;
}

export interface GraphData {
  nodes: GraphViewNode[];
  links: GraphViewLink[];
}

export interface GraphStore {
  nodeMap: Map<string, GraphViewNode>;
  linkMap: Map<string, GraphViewLink>;
  /** The last `graphData` handed to the library; reused while the id set is unchanged. */
  graphData: GraphData;
}

export interface SyncResult {
  graphData: GraphData;
  /** 1-hop adjacency over the current edges (used for hover / selection emphasis). */
  neighbours: Map<string, Set<string>>;
  /** True when a node or edge id was added or removed since the previous sync. */
  idsChanged: boolean;
}

export function createGraphStore(): GraphStore {
  return { nodeMap: new Map(), linkMap: new Map(), graphData: { nodes: [], links: [] } };
}

/**
 * Reconcile the store with the next nodes / edges. Mutates `store` and the
 * node / link objects it owns; pure with respect to everything else.
 */
export function syncGraphData(
  store: GraphStore,
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  depthById?: Map<string, number>,
): SyncResult {
  const degree = new Map<string, number>();
  const neighbours = new Map<string, Set<string>>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    if (!neighbours.has(e.source)) neighbours.set(e.source, new Set());
    if (!neighbours.has(e.target)) neighbours.set(e.target, new Set());
    neighbours.get(e.source)!.add(e.target);
    neighbours.get(e.target)!.add(e.source);
  }

  let idsChanged = false;

  // ── Nodes: reuse instances, update payload in place ───────────────────────
  const nextNodeIds = new Set<string>();
  const gNodes: GraphViewNode[] = [];
  for (const n of nodes) {
    nextNodeIds.add(n.id);
    let node = store.nodeMap.get(n.id);
    if (!node) {
      node = { id: n.id, data: n, degree: 0 };
      store.nodeMap.set(n.id, node);
      idsChanged = true;
    }
    node.data = n;
    node.degree = degree.get(n.id) ?? 0;
    node.depth = depthById?.get(n.id);
    gNodes.push(node);
  }
  for (const id of [...store.nodeMap.keys()]) {
    if (!nextNodeIds.has(id)) { store.nodeMap.delete(id); idsChanged = true; }
  }

  // ── Links: reuse instances keyed by edge id ───────────────────────────────
  const nextLinkIds = new Set<string>();
  const gLinks: GraphViewLink[] = [];
  for (const e of edges) {
    nextLinkIds.add(e.id);
    let link = store.linkMap.get(e.id);
    if (!link) {
      link = { id: e.id, source: e.source, target: e.target, data: e };
      store.linkMap.set(e.id, link);
      idsChanged = true;
    } else {
      // Endpoints are resolved to node objects by d3; re-seed only if the edge moved.
      if (idOf(link.source) !== e.source) link.source = e.source;
      if (idOf(link.target) !== e.target) link.target = e.target;
    }
    link.data = e;
    gLinks.push(link);
  }
  for (const id of [...store.linkMap.keys()]) {
    if (!nextLinkIds.has(id)) { store.linkMap.delete(id); idsChanged = true; }
  }

  if (idsChanged) store.graphData = { nodes: gNodes, links: gLinks };
  return { graphData: store.graphData, neighbours, idsChanged };
}

export const idOf = (v: string | GraphViewNode | number | undefined): string =>
  typeof v === 'object' && v !== null ? String(v.id) : String(v);
