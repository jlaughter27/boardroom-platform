import { describe, it, expect } from 'vitest';
import {
  DAY_MS, WEEK_MS, applyTimeline, formatDay, fromDateInputValue, isFullWindow, isHollowAt, nodeTime,
  playbackStep, stepWindow, timeExtent, toDateInputValue, weekHistogram, weekStart,
} from '../../../src/components/graph/graph-timeline';
import { edge, node } from './fixtures';

const at = (iso: string) => Date.parse(iso);

describe('graph-timeline — time of a node', () => {
  it('uses createdAt by default and meta.validAt when present', () => {
    expect(nodeTime(node('project:a', { createdAt: '2026-08-05T10:00:00.000Z' }))).toBe(at('2026-08-05T10:00:00.000Z'));
    expect(nodeTime(node('memory:m', { createdAt: '2026-08-05T10:00:00.000Z', meta: { validAt: '2026-07-01T00:00:00.000Z' } }))).toBe(at('2026-07-01T00:00:00.000Z'));
    expect(nodeTime(node('memory:bad', { createdAt: 'not a date' }))).toBeNull();
  });

  it('computes the extent and ignores undated nodes', () => {
    const ext = timeExtent([
      node('a', { createdAt: '2026-08-10T00:00:00.000Z' }),
      node('b', { createdAt: '2026-08-01T00:00:00.000Z' }),
      node('c', { createdAt: '' }),
    ]);
    expect(ext).toEqual({ min: at('2026-08-01T00:00:00.000Z'), max: at('2026-08-10T00:00:00.000Z') });
    expect(timeExtent([])).toBeNull();
  });
});

describe('graph-timeline — week histogram', () => {
  it('starts weeks on Monday 00:00 UTC', () => {
    // 2026-08-12 is a Wednesday → Monday 2026-08-10
    expect(weekStart(at('2026-08-12T15:30:00.000Z'))).toBe(at('2026-08-10T00:00:00.000Z'));
    expect(weekStart(at('2026-08-10T00:00:00.000Z'))).toBe(at('2026-08-10T00:00:00.000Z'));
    expect(weekStart(at('2026-08-16T23:59:59.000Z'))).toBe(at('2026-08-10T00:00:00.000Z'));
  });

  it('buckets per week, includes empty weeks and is deterministic', () => {
    const nodes = [
      node('a', { createdAt: '2026-08-11T00:00:00.000Z' }),
      node('b', { createdAt: '2026-08-12T00:00:00.000Z' }),
      node('c', { createdAt: '2026-08-26T00:00:00.000Z' }), // two weeks later
    ];
    const h = weekHistogram(nodes);
    expect(h.map((b) => b.count)).toEqual([2, 0, 1]);
    expect(h[0].start).toBe(at('2026-08-10T00:00:00.000Z'));
    expect(h[1].start - h[0].start).toBe(WEEK_MS);
    expect(weekHistogram([])).toEqual([]);
  });
});

describe('graph-timeline — window application', () => {
  const nodes = [
    node('project:p', { createdAt: '2026-08-01T00:00:00.000Z' }),
    node('memory:in', { createdAt: '2026-08-10T00:00:00.000Z' }),
    node('memory:late', { createdAt: '2026-09-10T00:00:00.000Z' }),
    node('memory:gone', { createdAt: '2026-08-05T00:00:00.000Z', meta: { invalidAt: '2026-08-12T00:00:00.000Z' } }),
    node('memory:sup', { createdAt: '2026-08-06T00:00:00.000Z', status: 'SUPERSEDED' }),
  ];
  const edges = [edge('memory:in', 'project:p'), edge('memory:late', 'project:p')];
  const w = { start: at('2026-08-01T00:00:00.000Z'), end: at('2026-08-15T00:00:00.000Z') };

  it('fades nodes outside the window by default and hides them with the toggle', () => {
    const faded = applyTimeline(nodes, edges, w, false);
    expect(faded.nodeVisibility.get('memory:in')).toBe('visible');
    expect(faded.nodeVisibility.get('memory:late')).toBe('faded');
    expect(faded.inWindow).toBe(4);

    const hidden = applyTimeline(nodes, edges, w, true);
    expect(hidden.nodeVisibility.get('memory:late')).toBe('hidden');
    expect(hidden.nodeVisibility.get('project:p')).toBe('visible');
  });

  it('edges follow their endpoints', () => {
    const faded = applyTimeline(nodes, edges, w, false);
    expect(faded.edgeVisibility.get(edges[0].id)).toBe('visible');
    expect(faded.edgeVisibility.get(edges[1].id)).toBe('faded');
    const hidden = applyTimeline(nodes, edges, w, true);
    expect(hidden.edgeVisibility.get(edges[1].id)).toBe('hidden');
  });

  it('marks memories invalidated before the window end as hollow', () => {
    const r = applyTimeline(nodes, edges, w, false);
    expect(r.hollow.has('memory:gone')).toBe(true);     // invalidAt 12 Aug ≤ end 15 Aug
    expect(r.hollow.has('memory:sup')).toBe(true);      // superseded, time unknown
    expect(r.hollow.has('memory:in')).toBe(false);
    expect(r.hollow.has('project:p')).toBe(false);      // only memories go hollow
    // Earlier window end: not yet invalidated
    expect(isHollowAt(nodes[3], at('2026-08-10T00:00:00.000Z'))).toBe(false);
  });

  it('isFullWindow treats null / covering windows as "no filter"', () => {
    const ext = { min: 10, max: 20 };
    expect(isFullWindow(null, ext)).toBe(true);
    expect(isFullWindow({ start: 10, end: 20 }, ext)).toBe(true);
    expect(isFullWindow({ start: 12, end: 20 }, ext)).toBe(false);
  });
});

describe('graph-timeline — playback', () => {
  const ext = { min: 0, max: 10 * DAY_MS };

  it('grows the window end by the step and reports done at the extent max', () => {
    const s1 = stepWindow({ start: 0, end: 0 }, ext, 4 * DAY_MS);
    expect(s1.window).toEqual({ start: 0, end: 4 * DAY_MS });
    expect(s1.done).toBe(false);
    const s3 = stepWindow(s1.window, ext, 8 * DAY_MS);
    expect(s3.window.end).toBe(10 * DAY_MS);
    expect(s3.done).toBe(true);
  });

  it('reduced motion steps whole weeks; normal motion sweeps a fraction of the span scaled by speed', () => {
    expect(playbackStep(ext, 1, true)).toBe(WEEK_MS);
    expect(playbackStep(ext, 2, true)).toBe(2 * WEEK_MS);
    const s1 = playbackStep(ext, 1, false);
    expect(playbackStep(ext, 2, false)).toBeCloseTo(s1 * 2);
    expect(s1).toBeLessThan(DAY_MS);
  });

  it('formats days in UTC and round-trips date inputs', () => {
    expect(formatDay(at('2026-08-12T23:30:00.000Z'))).toBe('12 Aug 2026');
    expect(toDateInputValue(at('2026-08-12T23:30:00.000Z'))).toBe('2026-08-12');
    expect(fromDateInputValue('2026-08-12')).toBe(at('2026-08-12T00:00:00.000Z'));
    expect(fromDateInputValue('nope')).toBeNull();
  });
});

describe('graph-timeline — eased playback + area sparkline', () => {
  it('easedWindowEnd decelerates into the extent max and never overshoots', async () => {
    const { easedWindowEnd, easeOutCubic, playbackDuration, PLAYBACK_MS } = await import('../../../src/components/graph/graph-timeline');
    const extent = { min: 0, max: 1000 };
    expect(easedWindowEnd(0, 200, extent)).toBe(200);
    expect(easedWindowEnd(1, 200, extent)).toBe(1000);
    expect(easedWindowEnd(2, 200, extent)).toBe(1000);
    const early = easedWindowEnd(0.25, 200, extent) - 200;
    const late = easedWindowEnd(1, 200, extent) - easedWindowEnd(0.75, 200, extent);
    expect(early).toBeGreaterThan(late); // ease-out: big steps first
    expect(easedWindowEnd(0.5, 0, extent, true)).toBe(500); // reduced motion: linear
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(playbackDuration(1)).toBe(PLAYBACK_MS);
    expect(playbackDuration(2)).toBe(PLAYBACK_MS / 2);
  });

  it('areaPath draws a closed area and an open line through the buckets', async () => {
    const { areaPath } = await import('../../../src/components/graph/graph-timeline');
    const buckets = [{ start: 0, end: 1, count: 2 }, { start: 1, end: 2, count: 0 }, { start: 2, end: 3, count: 4 }];
    const { area, line } = areaPath(buckets, 100, 50);
    expect(line.startsWith('M0.00 ')).toBe(true);
    expect(line.includes(' C')).toBe(true);
    expect(area.endsWith('L100 50 L0 50 Z')).toBe(true);
    // the tallest bucket touches the top (y ≈ 1.5), the empty one the baseline (y = 50)
    expect(line).toMatch(/100\.00 1\.50$/);
    expect(line).toContain('50.00 50.00');
    expect(areaPath([], 100, 50)).toEqual({ area: '', line: '' });
    const one = areaPath([{ start: 0, end: 1, count: 1 }], 100, 50);
    expect(one.line).toBe('M0 1.50 L100 1.50');
  });
});
