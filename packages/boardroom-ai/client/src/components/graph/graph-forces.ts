/**
 * Community cluster force for d3-force: every node is pulled gently toward
 * the centroid of its community, so Louvain communities settle into distinct
 * regions and their hulls stop overlapping. Pure d3 force contract
 * (`force(alpha)`, `force.initialize(nodes)`) with no d3 import, so it is
 * trivially unit-testable.
 */

export interface ClusterNode { id: string; x?: number; y?: number; vx?: number; vy?: number }

export interface ClusterForce<N extends ClusterNode = ClusterNode> {
  (alpha: number): void;
  initialize(nodes: N[]): void;
  strength(): number;
  strength(s: number): ClusterForce<N>;
  /** Community centroids after the last tick (for tests / debugging). */
  centroids(): Map<number, { x: number; y: number; n: number }>;
}

export const DEFAULT_CLUSTER_STRENGTH = 0.08;

export function clusterForce<N extends ClusterNode>(communityOf: ReadonlyMap<string, number>, initialStrength = DEFAULT_CLUSTER_STRENGTH): ClusterForce<N> {
  let nodes: N[] = [];
  let strength = initialStrength;
  let centroids = new Map<number, { x: number; y: number; n: number }>();

  const force = ((alpha: number) => {
    centroids = new Map();
    for (const n of nodes) {
      const c = communityOf.get(n.id);
      if (c === undefined || n.x === undefined || n.y === undefined) continue;
      const acc = centroids.get(c) ?? { x: 0, y: 0, n: 0 };
      acc.x += n.x; acc.y += n.y; acc.n += 1;
      centroids.set(c, acc);
    }
    for (const acc of centroids.values()) { acc.x /= acc.n; acc.y /= acc.n; }
    const k = strength * alpha;
    for (const n of nodes) {
      const c = communityOf.get(n.id);
      if (c === undefined || n.x === undefined || n.y === undefined) continue;
      const acc = centroids.get(c)!;
      if (acc.n < 2) continue; // a singleton has nothing to gather around
      n.vx = (n.vx ?? 0) + (acc.x - n.x) * k;
      n.vy = (n.vy ?? 0) + (acc.y - n.y) * k;
    }
  }) as ClusterForce<N>;

  force.initialize = (ns: N[]) => { nodes = ns; };
  force.strength = ((s?: number) => {
    if (s === undefined) return strength;
    strength = s;
    return force;
  }) as ClusterForce<N>['strength'];
  force.centroids = () => centroids;
  return force;
}

// ── RD-6: scale — cooled start for nodes that join a settled layout ─────────

interface SeedNode { id: string; x?: number; y?: number; vx?: number; vy?: number }
interface SeedLink { source: string | { id: string | number }; target: string | { id: string | number } }

const linkEnd = (v: SeedLink['source']): string => (typeof v === 'string' ? v : String(v.id));
const positioned = (n: SeedNode | undefined): n is SeedNode & { x: number; y: number } =>
  !!n && typeof n.x === 'number' && typeof n.y === 'number' && !Number.isNaN(n.x) && !Number.isNaN(n.y);

/** Deterministic small offset per id, so seeded siblings do not stack on one point. */
function jitter(id: string, radius: number): { dx: number; dy: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = (((h >>> 0) % 3600) / 3600) * Math.PI * 2;
  const r = radius * (0.5 + (((h >>> 12) % 1000) / 1000) * 0.5);
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

/**
 * Give every node WITHOUT a position (it just joined — "Show more", a lazy
 * neighbourhood merge) a start next to where it belongs instead of d3's
 * phyllotaxis spiral around the origin: the mean of its positioned neighbours,
 * else its community's centroid. Existing nodes are untouched, so the layout
 * the user was looking at stays put and the newcomers only relax locally.
 * Returns how many were seeded; on the first layout (nothing positioned yet)
 * it does nothing.
 */
export function seedNewNodes(nodes: SeedNode[], links: SeedLink[], communityOf: ReadonlyMap<string, number> | null, radius = 14): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fresh = nodes.filter((n) => !positioned(n));
  if (fresh.length === 0 || fresh.length === nodes.length) return 0;

  const centroids = new Map<number, { x: number; y: number; n: number }>();
  if (communityOf) {
    for (const n of nodes) {
      if (!positioned(n)) continue;
      const c = communityOf.get(n.id);
      if (c === undefined) continue;
      const acc = centroids.get(c) ?? { x: 0, y: 0, n: 0 };
      acc.x += n.x; acc.y += n.y; acc.n += 1;
      centroids.set(c, acc);
    }
  }
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
  for (const l of links) { const s = linkEnd(l.source); const t = linkEnd(l.target); add(s, t); add(t, s); }

  let seeded = 0;
  // Pass 1: next to positioned neighbours. Pass 2: next to neighbours seeded in pass 1, else the community centroid.
  for (let pass = 0; pass < 2; pass++) {
    for (const n of fresh) {
      if (positioned(n)) continue;
      let sx = 0; let sy = 0; let k = 0;
      for (const id of adj.get(n.id) ?? []) {
        const nb = byId.get(id);
        if (positioned(nb)) { sx += nb.x; sy += nb.y; k += 1; }
      }
      let base: { x: number; y: number } | null = k > 0 ? { x: sx / k, y: sy / k } : null;
      if (!base && pass === 1 && communityOf) {
        const c = communityOf.get(n.id);
        const acc = c === undefined ? undefined : centroids.get(c);
        if (acc && acc.n > 0) base = { x: acc.x / acc.n, y: acc.y / acc.n };
      }
      if (!base) continue;
      const { dx, dy } = jitter(n.id, radius);
      n.x = base.x + dx; n.y = base.y + dy; n.vx = 0; n.vy = 0;
      seeded += 1;
    }
  }
  return seeded;
}

/**
 * Simulation tick budget (force-graph `cooldownTicks`, one tick per frame).
 * 220 ticks is ~3.7 s at 60 fps; past ~700 nodes a frame costs more (hulls,
 * labels, 2k+ edges), so the big layouts stop earlier — with alphaDecay 0.03
 * alpha is already < 0.01 by tick 160 (RD-6).
 */
export function cooldownTicksFor(nodeCount: number): number {
  return nodeCount > 700 ? 160 : 220;
}
