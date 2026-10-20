import { describe, it, expect } from 'vitest';
import {
  startOfUtcDay, startOfUtcWeek, dayKey, weekBuckets, weekIndex, countByWeek, countByWeekAndKey, isPartialWeek,
  dayGrid, monthLabels, periodDelta, monthToDate, horizon, dueWithin, shortDate,
} from '../../../src/components/viz/aggregate';

// Tuesday 2026-10-20 12:00Z
const NOW = Date.parse('2026-10-20T12:00:00.000Z');

describe('UTC day / week boundaries', () => {
  it('startOfUtcDay and dayKey ignore the local zone', () => {
    expect(startOfUtcDay('2026-10-20T23:59:59Z').toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(dayKey(NOW)).toBe('2026-10-20');
  });
  it('weeks start on Monday 00:00Z', () => {
    expect(startOfUtcWeek(NOW).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    // Sunday belongs to the week that started the previous Monday
    expect(startOfUtcWeek('2026-10-18T05:00:00Z').toISOString()).toBe('2026-10-12T00:00:00.000Z');
    // Monday 00:00:00Z is its own week start
    expect(startOfUtcWeek('2026-10-19T00:00:00Z').toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });
  it('shortDate is month + day in UTC', () => {
    expect(shortDate('2026-10-01T00:30:00Z')).toBe('Oct 1');
  });
});

describe('weekBuckets / weekIndex', () => {
  it('returns N weeks oldest first ending with the current week', () => {
    const b = weekBuckets(12, NOW);
    expect(b).toHaveLength(12);
    expect(b[11].key).toBe('2026-10-19');
    expect(b[0].key).toBe('2026-08-03');
    expect(b[0].label).toBe('Aug 3');
  });
  it('flags only the in-progress last bucket as partial (its end is in the future)', () => {
    const b = weekBuckets(4, NOW);
    expect(b.map((x) => x.partial)).toEqual([false, false, false, true]);
    // A week whose Sunday 23:59Z has passed is complete; the week that starts right now is partial
    expect(isPartialWeek(new Date('2026-10-12T00:00:00Z'), NOW)).toBe(false);
    expect(isPartialWeek(new Date('2026-10-19T00:00:00Z'), NOW)).toBe(true);
    expect(isPartialWeek(new Date('2026-10-12T00:00:00Z'), '2026-10-18T23:59:59Z')).toBe(true);
    expect(isPartialWeek(new Date('2026-10-12T00:00:00Z'), '2026-10-19T00:00:00Z')).toBe(false);
  });
  it('indexes instants into buckets and rejects the outside', () => {
    const b = weekBuckets(12, NOW);
    expect(weekIndex(b, NOW)).toBe(11);
    expect(weekIndex(b, '2026-08-09T23:59:59Z')).toBe(0);
    expect(weekIndex(b, '2026-08-02T23:59:59Z')).toBe(-1);
    expect(weekIndex(b, '2026-10-26T00:00:00Z')).toBe(-1);
    expect(weekIndex(b, 'nope')).toBe(-1);
  });
});

describe('countByWeek / countByWeekAndKey', () => {
  const items = [
    { at: '2026-10-19T01:00:00Z', k: 'business' },
    { at: '2026-10-20T01:00:00Z', k: 'business' },
    { at: '2026-10-13T01:00:00Z', k: 'personal' },
    { at: '2026-07-01T01:00:00Z', k: 'personal' }, // outside
    { at: null, k: 'business' }, // unparseable
  ];
  it('counts per week', () => {
    const { counts } = countByWeek(items, (i) => i.at, 4, NOW);
    expect(counts).toEqual([0, 0, 1, 2]);
  });
  it('splits by key in a pinned order and folds the tail into other', () => {
    const r = countByWeekAndKey(items, (i) => i.at, (i) => i.k, 4, { now: NOW, keyOrder: ['personal', 'business'] });
    expect(r.keys).toEqual(['personal', 'business']);
    expect(r.series.business).toEqual([0, 0, 0, 2]);
    expect(r.series.personal).toEqual([0, 0, 1, 0]);

    const many = ['a', 'a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ at: NOW, k }));
    const folded = countByWeekAndKey(many, (i) => i.at, (i) => i.k, 1, { now: NOW, maxKeys: 2 });
    expect(folded.keys).toEqual(['a', 'b', 'other']);
    expect(folded.series.a[0]).toBe(2);
    expect(folded.series.other[0]).toBe(4);
  });
});

describe('dayGrid / monthLabels', () => {
  it('lays out weeks × 7 days with per-key breakdowns and marks the future', () => {
    const items = [
      { at: '2026-10-20T08:00:00Z', d: 'business' },
      { at: '2026-10-20T20:00:00Z', d: 'personal' },
      { at: '2026-10-19T00:00:00Z', d: 'business' },
    ];
    const g = dayGrid(items, (i) => i.at, 2, { now: NOW, getKey: (i) => i.d });
    expect(g.cells).toHaveLength(14);
    expect(g.max).toBe(2);
    const today = g.cells.find((c) => c.key === '2026-10-20')!;
    expect(today.total).toBe(2);
    expect(today.byKey).toEqual({ business: 1, personal: 1 });
    expect(today.dow).toBe(1);
    expect(today.week).toBe(1);
    expect(today.future).toBe(false);
    expect(g.cells.find((c) => c.key === '2026-10-21')!.future).toBe(true);
    expect(g.cells.filter((c) => c.future)).toHaveLength(5);
  });
  it('labels the week containing the 1st of each month', () => {
    const b = weekBuckets(12, NOW);
    const labels = monthLabels(b);
    expect(labels[0]).toEqual({ week: 0, label: 'Aug' });
    expect(labels.map((l) => l.label)).toEqual(['Aug', 'Sep', 'Oct']);
    // Sep 1 2026 is a Tuesday in the week of Aug 31 → bucket index 4
    expect(labels[1].week).toBe(4);
  });
});

describe('period deltas', () => {
  it('periodDelta handles a zero previous', () => {
    expect(periodDelta(5, 0)).toEqual({ current: 5, previous: 0, delta: 5, ratio: null });
    expect(periodDelta(6, 4).ratio).toBeCloseTo(0.5);
  });
  it('monthToDate compares the same day span in the previous month', () => {
    const byDay = [
      { date: '2026-10-01', usd: 1 }, { date: '2026-10-20', usd: 2 },
      { date: '2026-09-01', usd: 3 }, { date: '2026-09-20', usd: 4 }, { date: '2026-09-25', usd: 100 },
      { date: '2026-08-15', usd: 50 },
    ];
    const d = monthToDate(byDay, NOW);
    expect(d.current).toBe(3);
    expect(d.previous).toBe(7);
    expect(d.delta).toBe(-4);
  });
});

describe('horizon / dueWithin', () => {
  const c = (id: string, deadline: string | null, status = 'OPEN') => ({ id, deadline, status });
  const items = [
    c('late', '2026-10-15T00:00:00Z'),
    c('today', '2026-10-20T23:00:00Z'),
    c('soon', '2026-10-24T00:00:00Z'),
    c('edge', '2026-11-02T00:00:00Z'), // day 13 → inside a 14-day horizon
    c('later', '2026-11-03T00:00:00Z'), // day 14 → beyond
    c('done', '2026-10-21T00:00:00Z', 'COMPLETED'),
    c('none', null),
  ];
  it('splits overdue / upcoming / beyond on UTC day offsets', () => {
    const h = horizon(items, (i) => i.deadline, (i) => i.status === 'OPEN', 14, NOW);
    expect(h.overdue.map((x) => x.item.id)).toEqual(['late']);
    expect(h.overdue[0].dayOffset).toBe(-5);
    expect(h.upcoming.map((x) => x.item.id)).toEqual(['today', 'soon', 'edge']);
    expect(h.upcoming.map((x) => x.dayOffset)).toEqual([0, 4, 13]);
    expect(h.beyond).toBe(1);
  });
  it('dueWithin is inclusive of the last day and excludes overdue', () => {
    expect(dueWithin(items, (i) => i.deadline, (i) => i.status === 'OPEN', 7, NOW).map((i) => i.id)).toEqual(['today', 'soon']);
    expect(dueWithin(items, (i) => i.deadline, (i) => i.status === 'OPEN', 13, NOW).map((i) => i.id)).toEqual(['today', 'soon', 'edge']);
  });
});
