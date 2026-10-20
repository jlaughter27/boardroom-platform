import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { KnowledgeGraphEdge, KnowledgeGraphEdgeType, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';

/**
 * Community detection for the knowledge graph (Louvain over the loaded graph)
 * with STABLE ids: the result is deterministic for a given graph (seeded rng,
 * sorted insertion), and when a previous partition is supplied each new
 * community takes the id of the previous community it overlaps most, so a
 * refetch or a lazy merge never swaps hull colours under the user.
 */

export interface Community {
  id: number;
  members: string[];
  size: number;
  /** Auto label: the top hub's name, plus a second when it is nearly as central */
  label: string;
  /** Top-degree entities (non-memory preferred), best first */
  hubIds: string[];
}

export interface CommunityResult {
  communityOf: Map<string, number>;
  communities: Community[];
}

export interface DetectOptions {
  /** Louvain resolution; > 1 splits more, < 1 merges more (default 1) */
  resolution?: number;
  /** Seed for the deterministic rng (default 7) */
  seed?: number;
  /** Communities smaller than this are merged into their best-connected neighbour community (default 3) */
  minSize?: number;
}

/** Entity edges weigh more than memory links so the entity backbone shapes the communities. */
const EDGE_WEIGHT: Record<KnowledgeGraphEdgeType, number> = {
  goal_hierarchy: 2.5,
  goal_project: 2,
  project_task: 1.6,
  project_person: 1.4,
  decision_project: 1.4,
  task_dependency: 1.2,
  commitment_person: 1,
  commitment_project: 1,
  commitment_entity: 1,
  memory_entity: 0.7,
};

const HUB_TYPE_WEIGHT: Record<KnowledgeGraphNodeType, number> = {
  goal: 1.6, project: 1.5, person: 1.1, decision: 0.9, task: 0.7, commitment: 0.7, memory: 0.3,
};

/** mulberry32 — the rng Louvain draws from, so runs are reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function detectCommunities(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
  previous?: ReadonlyMap<string, number> | null,
  options: DetectOptions = {},
): CommunityResult {
  const { resolution = 1, seed = 7, minSize = 3 } = options;
  const ids = [...nodes].map((n) => n.id).sort();
  const idSet = new Set(ids);
  const degree = new Map<string, number>();
  const g = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
  for (const id of ids) g.addNode(id);
  const sortedEdges = [...edges].filter((e) => idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target).sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sortedEdges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    const w = EDGE_WEIGHT[e.type] ?? 1;
    if (g.hasEdge(e.source, e.target)) g.setEdgeAttribute(e.source, e.target, 'weight', g.getEdgeAttribute(e.source, e.target, 'weight') + w);
    else g.addEdge(e.source, e.target, { weight: w });
  }

  let raw: Record<string, number> = {};
  if (ids.length > 0) {
    if (g.size === 0) for (const id of ids) raw[id] = 0; // no edges: one community
    else raw = louvain(g, { resolution, rng: seededRng(seed), getEdgeWeight: 'weight' });
  }

  // ── Group, then fold tiny communities into their best-connected neighbour ─
  let groups = groupBy(raw);
  groups = mergeSmall(groups, sortedEdges, minSize);

  // ── Canonical order: largest first, ties by smallest member id ───────────
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  // ── Stable ids against the previous partition ────────────────────────────
  const assigned = relabel(ordered, previous ?? null);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const communityOf = new Map<string, number>();
  const communities: Community[] = [];
  ordered.forEach((members, i) => {
    const id = assigned[i];
    for (const m of members) communityOf.set(m, id);
    const hubs = [...members]
      .map((m) => ({ m, s: (degree.get(m) ?? 0) * (HUB_TYPE_WEIGHT[nodeById.get(m)?.type ?? 'memory']) }))
      .sort((a, b) => b.s - a.s || a.m.localeCompare(b.m));
    const hubIds = hubs.slice(0, 3).map((h) => h.m);
    communities.push({ id, members: [...members].sort(), size: members.length, label: communityLabel(hubs.map((h) => ({ node: nodeById.get(h.m)!, score: h.s }))), hubIds });
  });
  communities.sort((a, b) => a.id - b.id);
  return { communityOf, communities };
}

function groupBy(mapping: Record<string, number>): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const id of Object.keys(mapping).sort()) {
    const c = mapping[id];
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(id);
  }
  return groups;
}

function mergeSmall(groups: Map<number, string[]>, edges: readonly KnowledgeGraphEdge[], minSize: number): Map<number, string[]> {
  if (minSize <= 1) return groups;
  const of = new Map<string, number>();
  for (const [c, members] of groups) for (const m of members) of.set(m, c);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const [c, members] of [...groups.entries()].sort((a, b) => a[1].length - b[1].length)) {
      if (members.length >= minSize || groups.size === 1) continue;
      // best-connected other community
      const tally = new Map<number, number>();
      for (const e of edges) {
        const a = of.get(e.source); const b = of.get(e.target);
        if (a === c && b !== undefined && b !== c) tally.set(b, (tally.get(b) ?? 0) + 1);
        else if (b === c && a !== undefined && a !== c) tally.set(a, (tally.get(a) ?? 0) + 1);
      }
      let target: number | null = null; let best = -1;
      for (const [other, n] of tally) if (n > best || (n === best && target !== null && other < target)) { best = n; target = other; }
      if (target === null) continue; // isolated tiny community stays its own
      groups.get(target)!.push(...members);
      for (const m of members) of.set(m, target);
      groups.delete(c);
      changed = true;
      break;
    }
  }
  return groups;
}

/**
 * Give each new group the id of the previous community it shares most
 * members with (greedy by overlap, each old id used once); leftovers take
 * fresh ids above the previous maximum. Without a previous partition the
 * ids are 0..n-1 in canonical order.
 */
export function relabel(ordered: readonly (readonly string[])[], previous: ReadonlyMap<string, number> | null): number[] {
  if (!previous || previous.size === 0) return ordered.map((_, i) => i);
  const overlaps: Array<{ gi: number; old: number; n: number }> = [];
  ordered.forEach((members, gi) => {
    const tally = new Map<number, number>();
    for (const m of members) { const p = previous.get(m); if (p !== undefined) tally.set(p, (tally.get(p) ?? 0) + 1); }
    for (const [old, n] of tally) overlaps.push({ gi, old, n });
  });
  overlaps.sort((a, b) => b.n - a.n || a.gi - b.gi || a.old - b.old);
  const out = new Array<number>(ordered.length).fill(-1);
  const usedOld = new Set<number>();
  for (const o of overlaps) {
    if (out[o.gi] !== -1 || usedOld.has(o.old)) continue;
    out[o.gi] = o.old; usedOld.add(o.old);
  }
  let next = Math.max(-1, ...previous.values(), ...usedOld) + 1;
  for (let i = 0; i < out.length; i++) if (out[i] === -1) out[i] = next++;
  return out;
}

/** "Knowledge Graph" or "Knowledge Graph · Maya Chen" when the runner-up is nearly as central. */
export function communityLabel(hubs: ReadonlyArray<{ node: KnowledgeGraphNode; score: number }>): string {
  const named = hubs.filter((h) => h.node && h.node.label);
  if (named.length === 0) return 'Cluster';
  const first = named[0];
  const second = named.find((h) => h !== first && h.node.type !== 'memory' && h.score >= first.score * 0.75);
  const short = (s: string) => (s.length > 28 ? `${s.slice(0, 26)}…` : s);
  return second ? `${short(first.node.label)} · ${short(second.node.label)}` : short(first.node.label);
}

/** Community index → palette slot. The first six get a hue; anything beyond folds to the neutral slot (dataviz rule: never cycle). */
export const COMMUNITY_SLOTS = 6;
export function communitySlot(communityId: number): number | 'neutral' {
  return communityId >= 0 && communityId < COMMUNITY_SLOTS ? communityId : 'neutral';
}
