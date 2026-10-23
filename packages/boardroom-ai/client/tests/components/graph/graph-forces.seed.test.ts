import { describe, it, expect } from 'vitest';
import { cooldownTicksFor, seedNewNodes } from '../../../src/components/graph/graph-forces';

// RD-6 — nodes that join a settled layout ("Show more") start where they belong.
describe('seedNewNodes', () => {
  const settled = () => [
    { id: 'p1', x: 100, y: 100 },
    { id: 'p2', x: -200, y: 50 },
    { id: 'g', x: 0, y: -300 },
  ];

  it('places a newcomer beside the mean of its positioned neighbours and leaves settled nodes alone', () => {
    const nodes: Array<{ id: string; x?: number; y?: number; vx?: number; vy?: number }> = [...settled(), { id: 'm1' }];
    const n = seedNewNodes(nodes, [{ source: 'm1', target: 'p1' }, { source: { id: 'p2' }, target: 'm1' }], null, 10);
    expect(n).toBe(1);
    const m = nodes[3];
    expect(Math.hypot(m.x! - -50, m.y! - 75)).toBeLessThanOrEqual(10); // mean of p1 + p2, within the jitter radius
    expect(m.vx).toBe(0);
    expect(nodes.slice(0, 3)).toEqual(settled());
  });

  it('chains through a newcomer neighbour, then falls back to the community centroid', () => {
    const nodes: Array<{ id: string; x?: number; y?: number }> = [...settled(), { id: 'a' }, { id: 'b' }, { id: 'lonely' }];
    const communityOf = new Map([['p1', 0], ['p2', 0], ['g', 1], ['lonely', 1]]);
    const n = seedNewNodes(nodes, [{ source: 'a', target: 'g' }, { source: 'b', target: 'a' }], communityOf, 10);
    expect(n).toBe(3);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    expect(Math.hypot(byId.get('a')!.x! - 0, byId.get('a')!.y! - -300)).toBeLessThanOrEqual(10);
    expect(Math.hypot(byId.get('b')!.x! - byId.get('a')!.x!, byId.get('b')!.y! - byId.get('a')!.y!)).toBeLessThanOrEqual(10);
    expect(Math.hypot(byId.get('lonely')!.x! - 0, byId.get('lonely')!.y! - -300)).toBeLessThanOrEqual(10); // community 1 = g
  });

  it('first layout (nothing positioned) and nothing new are no-ops; siblings do not stack', () => {
    const cold = [{ id: 'a' }, { id: 'b' }];
    expect(seedNewNodes(cold, [{ source: 'a', target: 'b' }], null)).toBe(0);
    expect(cold[0]).toEqual({ id: 'a' });
    expect(seedNewNodes(settled(), [], null)).toBe(0);

    const nodes: Array<{ id: string; x?: number; y?: number }> = [{ id: 'hub', x: 0, y: 0 }, { id: 's1' }, { id: 's2' }];
    seedNewNodes(nodes, [{ source: 's1', target: 'hub' }, { source: 's2', target: 'hub' }], null);
    expect(nodes[1].x === nodes[2].x && nodes[1].y === nodes[2].y).toBe(false);
  });

  it('a newcomer with no positioned neighbour and no community is left for d3 to place', () => {
    const nodes: Array<{ id: string; x?: number; y?: number }> = [...settled(), { id: 'island' }];
    expect(seedNewNodes(nodes, [], null)).toBe(0);
    expect(nodes[3].x).toBeUndefined();
  });
});

describe('cooldownTicksFor', () => {
  it('keeps the 220-tick budget for ordinary graphs and trims it past ~700 nodes', () => {
    expect(cooldownTicksFor(380)).toBe(220);
    expect(cooldownTicksFor(700)).toBe(220);
    expect(cooldownTicksFor(1180)).toBe(160);
  });
});
