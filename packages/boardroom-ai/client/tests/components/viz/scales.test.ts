import { describe, it, expect } from 'vitest';
import {
  linearScale, niceTicks, niceMax, bandScale, linePath, areaPath, baselineAreaPath, stackSeries,
  roundedBarPath, nearestIndex, bubbleRadius, formatCompact, formatUsd, formatPct, formatDelta,
} from '../../../src/components/viz/scales';

describe('linearScale', () => {
  it('maps the domain onto the range and inverts', () => {
    const s = linearScale([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s.invert(25)).toBe(7.5);
  });
  it('collapses a degenerate domain to range[0]', () => {
    const s = linearScale([3, 3], [10, 20]);
    expect(s(3)).toBe(10);
    expect(s(99)).toBe(10);
  });
});

describe('niceTicks / niceMax', () => {
  it('produces round steps that cover the data and include 0', () => {
    expect(niceTicks(0, 7, 4)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0, 0.9, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0, 123, 4)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(0, 0, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it('niceMax is the top tick', () => {
    expect(niceMax(7)).toBe(8);
    expect(niceMax(0)).toBe(1);
  });
  it('handles non-finite input without throwing', () => {
    expect(niceTicks(NaN, 5)).toEqual([0]);
  });
});

describe('bandScale', () => {
  it('splits the range into equal bands with a gap', () => {
    const b = bandScale(4, [0, 100], 2);
    expect(b.step).toBe(25);
    expect(b.bandwidth).toBe(23);
    expect(b(0)).toBe(1);
    expect(b(3)).toBe(76);
  });
});

describe('paths', () => {
  it('builds a polyline and closed areas', () => {
    const pts = [{ x: 0, y: 10 }, { x: 10, y: 0 }];
    expect(linePath(pts)).toBe('M0,10 L10,0');
    expect(baselineAreaPath(pts, 20)).toBe('M0,10 L10,0 L10,20 L0,20 Z');
    expect(areaPath(pts, [{ x: 0, y: 15 }, { x: 10, y: 12 }])).toBe('M0,10 L10,0 L10,12 L0,15 Z');
    expect(linePath([])).toBe('');
  });
  it('rounds the data end only', () => {
    const d = roundedBarPath(0, 0, 40, 16, 'right', 4);
    expect(d.startsWith('M0,0 H36 Q40,0 40,4')).toBe(true);
    expect(d.endsWith('H0 Z')).toBe(true);
    expect(roundedBarPath(0, 0, 0, 16)).toBe('');
    const col = roundedBarPath(0, 0, 16, 40, 'up', 4);
    expect(col.startsWith('M0,40 V4 Q0,0 4,0')).toBe(true);
  });
});

describe('stackSeries', () => {
  it('stacks bottom → top and clamps negatives', () => {
    const st = stackSeries([[1, 2], [3, -1]]);
    expect(st[0]).toEqual([[0, 1], [0, 2]]);
    expect(st[1]).toEqual([[1, 4], [2, 2]]);
    expect(stackSeries([])).toEqual([]);
  });
});

describe('nearestIndex / bubbleRadius', () => {
  it('finds the closest x', () => {
    expect(nearestIndex([0, 10, 20], 12)).toBe(1);
    expect(nearestIndex([0, 10, 20], 16)).toBe(2);
  });
  it('scales bubble radius by sqrt of the share', () => {
    expect(bubbleRadius(0, 10)).toBe(4);
    expect(bubbleRadius(10, 10, 4, 14)).toBe(14);
    expect(bubbleRadius(2.5, 10, 4, 14)).toBe(9);
    expect(bubbleRadius(50, 10, 4, 14)).toBe(14);
  });
});

describe('formatting', () => {
  it('compacts large numbers', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1284)).toBe('1.3K');
    expect(formatCompact(12_900_000)).toBe('12.9M');
    expect(formatCompact(2_000_000_000)).toBe('2B');
    expect(formatCompact(0.5)).toBe('0.5');
  });
  it('formats usd by magnitude', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(12.34)).toBe('$12.3');
    expect(formatUsd(123.4)).toBe('$123');
  });
  it('formats percentages and deltas', () => {
    expect(formatPct(0.256)).toBe('26 %');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-1200, ' %')).toBe('−1.2K %');
  });
});
