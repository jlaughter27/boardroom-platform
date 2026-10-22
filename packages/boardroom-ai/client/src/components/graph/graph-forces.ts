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
