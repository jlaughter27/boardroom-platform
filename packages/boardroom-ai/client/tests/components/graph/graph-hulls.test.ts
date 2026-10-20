import { describe, it, expect } from 'vitest';
import { centroid, convexHull, hullOutline, labelAnchor, outlineExtent, padPolygon, pointInOutline, polygonArea, roundedPath, traceHull } from '../../../src/components/graph/graph-hulls';
import { fakeCtx } from './fixtures';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('graph-hulls', () => {
  it('convexHull drops interior and collinear points and ignores NaN', () => {
    const hull = convexHull([...square, { x: 5, y: 5 }, { x: 5, y: 0 }, { x: NaN, y: 1 }]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBe(100);
    expect(convexHull([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });

  it('padPolygon grows a convex polygon outward by the pad on every side', () => {
    const padded = padPolygon(square, 5);
    expect(padded).toHaveLength(4);
    expect(polygonArea(padded)).toBeCloseTo(400, 5); // 20 × 20
    const c = centroid(padded);
    expect(c.x).toBeCloseTo(5); expect(c.y).toBeCloseTo(5);
    for (const p of padded) expect(Math.min(Math.abs(p.x - 5), Math.abs(p.y - 5))).toBeCloseTo(10);
  });

  it('roundedPath yields one quadratic segment per vertex, starting at an edge midpoint', () => {
    const path = roundedPath(square)!;
    expect(path.start).toEqual({ x: 5, y: 0 });
    expect(path.segments).toHaveLength(4);
    expect(path.segments[0]).toEqual({ cx: 10, cy: 0, x: 10, y: 5 });
    expect(roundedPath(square.slice(0, 2))).toBeNull();
  });

  it('hullOutline: one member → disc, two → capsule containing both, many → padded smooth hull', () => {
    const one = hullOutline([{ x: 3, y: 4 }], 6)!;
    expect(one).toEqual({ kind: 'circle', cx: 3, cy: 4, r: 6 });
    const two = hullOutline([{ x: 0, y: 0 }, { x: 40, y: 0 }], 6)!;
    expect(two.kind).toBe('path');
    if (two.kind === 'path') {
      expect(pointInOutline(two, { x: 0, y: 0 })).toBe(true);
      expect(pointInOutline(two, { x: 40, y: 0 })).toBe(true);
      expect(pointInOutline(two, { x: 20, y: 0 })).toBe(true);
      expect(pointInOutline(two, { x: 20, y: 30 })).toBe(false);
    }
    const many = hullOutline([...square, { x: 5, y: 5 }], 4)!;
    expect(many.kind).toBe('path');
    if (many.kind === 'path') {
      expect(polygonArea(many.polygon)).toBeGreaterThan(100);
      for (const p of square) expect(pointInOutline(many, p)).toBe(true);
    }
    expect(hullOutline([], 4)).toBeNull();
    expect(hullOutline([{ x: NaN, y: 1 }], 4)).toBeNull();
  });

  it('outlineExtent measures the rendered curve (inside the control polygon), and labelAnchor hangs from its top edge', () => {
    // a diamond: its top is a VERTEX, so the smoothed curve (through edge midpoints) sits below the control polygon's top
    const diamond = [{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }];
    const out = hullOutline(diamond, 2)!;
    if (out.kind !== 'path') throw new Error('expected a path');
    const e = outlineExtent(out);
    const polyTop = Math.min(...out.polygon.map((p) => p.y));
    expect(polyTop).toBeLessThan(-11);
    expect(e.minY).toBeGreaterThan(polyTop + 2);
    expect(e.minY).toBeLessThan(-5);
    expect(e.cx).toBeCloseTo(0, 1);
    expect(e.cy).toBeCloseTo(0, 1);
    const a = labelAnchor(out);
    expect(a.x).toBeCloseTo(e.cx);
    expect(a.y).toBeCloseTo(e.minY);
    expect(outlineExtent({ kind: 'circle', cx: 1, cy: 2, r: 3 })).toEqual({ minX: -2, maxX: 4, minY: -1, maxY: 5, cx: 1, cy: 2 });
    const ctx = fakeCtx();
    traceHull(ctx, out);
    expect(ctx.calls[0]).toBe('beginPath()');
    expect(ctx.calls.filter((c) => c.startsWith('quadraticCurveTo(')).length).toBe(4);
    expect(ctx.calls.at(-1)).toBe('closePath()');
    const disc = fakeCtx();
    traceHull(disc, { kind: 'circle', cx: 1, cy: 2, r: 3 });
    expect(disc.calls.some((c) => c.startsWith('arc(1.00,2.00,3.00'))).toBe(true);
  });
});
