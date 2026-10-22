import { describe, it, expect } from 'vitest';
import { clusterForce } from '../../../src/components/graph/graph-forces';

describe('clusterForce', () => {
  const communityOf = new Map([['a', 0], ['b', 0], ['c', 1], ['d', 1], ['lone', 2]]);

  it('pulls each node toward its community centroid, scaled by strength and alpha', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0 }, { id: 'b', x: 10, y: 0, vx: 0, vy: 0 },
      { id: 'c', x: 100, y: 100, vx: 0, vy: 0 }, { id: 'd', x: 100, y: 120, vx: 0, vy: 0 },
      { id: 'lone', x: 50, y: 50, vx: 0, vy: 0 }, { id: 'unknown', x: 7, y: 7, vx: 0, vy: 0 },
    ];
    const f = clusterForce(communityOf, 0.5);
    f.initialize(nodes);
    f(1);
    expect(nodes[0].vx).toBeCloseTo(2.5); // (5 - 0) * 0.5
    expect(nodes[1].vx).toBeCloseTo(-2.5);
    expect(nodes[2].vy).toBeCloseTo(5); // centroid y = 110
    expect(nodes[3].vy).toBeCloseTo(-5);
    expect(nodes[4].vx).toBe(0); // singleton community: untouched
    expect(nodes[5].vx).toBe(0); // not in any community: untouched
    expect(f.centroids().get(0)).toEqual({ x: 5, y: 0, n: 2 });
  });

  it('is a d3 force: strength is a chainable getter/setter and unpositioned nodes are skipped', () => {
    const f = clusterForce(communityOf);
    expect(f.strength()).toBeGreaterThan(0);
    expect(f.strength(0.2)).toBe(f);
    expect(f.strength()).toBe(0.2);
    const nodes = [{ id: 'a' }, { id: 'b', x: 1, y: 1 }];
    f.initialize(nodes);
    expect(() => f(1)).not.toThrow();
    expect(nodes[1]).not.toHaveProperty('vx');
  });
});
