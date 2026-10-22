/**
 * Client-side aggregation for the dashboard charts. All bucketing is in UTC
 * (weeks start Monday 00:00Z) so a user's dashboard and the server's
 * `createdAt` timestamps agree regardless of the browser's zone.
 *
 * Pure functions — the viz store calls them on cached entity lists.
 */

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export type DateLike = Date | string | number | null | undefined;

export function toTime(d: DateLike): number | null {
  if (d === null || d === undefined) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Midnight UTC of the given instant. */
export function startOfUtcDay(d: DateLike): Date {
  const t = toTime(d) ?? 0;
  const x = new Date(t);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** Monday 00:00 UTC of the week containing the instant. */
export function startOfUtcWeek(d: DateLike): Date {
  const day = startOfUtcDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(day.getTime() - dow * DAY_MS);
}

/** YYYY-MM-DD in UTC. */
export function dayKey(d: DateLike): string {
  return startOfUtcDay(d).toISOString().slice(0, 10);
}

export interface WeekBucket {
  /** Monday 00:00Z */
  start: Date;
  /** YYYY-MM-DD of the Monday */
  key: string;
  /** Short label, e.g. "Sep 1" */
  label: string;
  /** The bucket has not ended yet (its Sunday 23:59Z is after `now`) — an in-progress, incomplete week. */
  partial: boolean;
}

/** True when a week starting at `start` is still in progress at `now`. */
export function isPartialWeek(start: Date, now: DateLike = Date.now()): boolean {
  const t = toTime(now) ?? Date.now();
  return start.getTime() + WEEK_MS > t;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(d: DateLike): string {
  const t = toTime(d);
  if (t === null) return '';
  const x = new Date(t);
  return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`;
}

/** The last `weeks` ISO-ish weeks ending with the week containing `now`, oldest first. */
export function weekBuckets(weeks: number, now: DateLike = Date.now()): WeekBucket[] {
  const thisWeek = startOfUtcWeek(now);
  const out: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek.getTime() - i * WEEK_MS);
    out.push({ start, key: dayKey(start), label: shortDate(start), partial: isPartialWeek(start, now) });
  }
  return out;
}

/** Index of the week bucket an instant falls into, or -1 when outside the window. */
export function weekIndex(buckets: WeekBucket[], d: DateLike): number {
  const t = toTime(d);
  if (t === null || buckets.length === 0) return -1;
  const first = buckets[0].start.getTime();
  const idx = Math.floor((t - first) / WEEK_MS);
  return idx >= 0 && idx < buckets.length ? idx : -1;
}

/** Count items per week bucket (oldest first). */
export function countByWeek<T>(items: T[], getDate: (t: T) => DateLike, weeks: number, now: DateLike = Date.now()): { buckets: WeekBucket[]; counts: number[] } {
  const buckets = weekBuckets(weeks, now);
  const counts = new Array<number>(weeks).fill(0);
  for (const it of items) {
    const i = weekIndex(buckets, getDate(it));
    if (i >= 0) counts[i] += 1;
  }
  return { buckets, counts };
}

/**
 * Count items per week bucket, split by a key (entity type, domain, …).
 * Keys are returned in first-seen order unless `keyOrder` pins them; keys
 * beyond `maxKeys` fold into "other" (never generate a 9th hue).
 */
export function countByWeekAndKey<T>(
  items: T[],
  getDate: (t: T) => DateLike,
  getKey: (t: T) => string,
  weeks: number,
  opts: { now?: DateLike; keyOrder?: string[]; maxKeys?: number } = {},
): { buckets: WeekBucket[]; keys: string[]; series: Record<string, number[]> } {
  const { now = Date.now(), keyOrder = [], maxKeys = 5 } = opts;
  const buckets = weekBuckets(weeks, now);
  const totals = new Map<string, number>();
  const rows: Array<[number, string]> = [];
  for (const it of items) {
    const i = weekIndex(buckets, getDate(it));
    if (i < 0) continue;
    const k = getKey(it) || 'other';
    rows.push([i, k]);
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  const ordered = [...totals.keys()].sort((a, b) => {
    const ia = keyOrder.indexOf(a); const ib = keyOrder.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b);
  });
  const keep = ordered.slice(0, maxKeys);
  const fold = ordered.length > maxKeys;
  const keys = fold ? [...keep, 'other'] : keep;
  const series: Record<string, number[]> = {};
  for (const k of keys) series[k] = new Array<number>(weeks).fill(0);
  for (const [i, k] of rows) {
    const slot = keep.includes(k) ? k : 'other';
    if (series[slot]) series[slot][i] += 1;
  }
  return { buckets, keys, series };
}

export interface DayCell {
  key: string;
  date: Date;
  /** 0-based column (week), oldest first */
  week: number;
  /** 0 = Monday … 6 = Sunday */
  dow: number;
  /** Days after `now` are rendered as future (no data by definition). */
  future: boolean;
  total: number;
  byKey: Record<string, number>;
}

/**
 * A weeks × 7 calendar grid of daily counts (oldest week first), with an
 * optional split by key for the hover breakdown.
 */
export function dayGrid<T>(
  items: T[],
  getDate: (t: T) => DateLike,
  weeks: number,
  opts: { now?: DateLike; getKey?: (t: T) => string } = {},
): { buckets: WeekBucket[]; cells: DayCell[]; max: number } {
  const now = opts.now ?? Date.now();
  const buckets = weekBuckets(weeks, now);
  const todayKey = dayKey(now);
  const cells: DayCell[] = [];
  const byKey = new Map<string, DayCell>();
  for (let w = 0; w < buckets.length; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(buckets[w].start.getTime() + d * DAY_MS);
      const key = dayKey(date);
      const cell: DayCell = { key, date, week: w, dow: d, future: key > todayKey, total: 0, byKey: {} };
      cells.push(cell);
      byKey.set(key, cell);
    }
  }
  let max = 0;
  for (const it of items) {
    const t = toTime(getDate(it));
    if (t === null) continue;
    const cell = byKey.get(dayKey(t));
    if (!cell) continue;
    cell.total += 1;
    if (opts.getKey) {
      const k = opts.getKey(it) || 'other';
      cell.byKey[k] = (cell.byKey[k] ?? 0) + 1;
    }
    if (cell.total > max) max = cell.total;
  }
  return { buckets, cells, max };
}

/** Month labels for a day grid: the first week whose Monday (or any day) starts a new month. */
export function monthLabels(buckets: WeekBucket[]): Array<{ week: number; label: string }> {
  const out: Array<{ week: number; label: string }> = [];
  let last = -1;
  buckets.forEach((b, i) => {
    // Label the week that contains the 1st of a month (or the first bucket).
    for (let d = 0; d < 7; d++) {
      const x = new Date(b.start.getTime() + d * DAY_MS);
      const m = x.getUTCMonth();
      if (m !== last && (x.getUTCDate() === 1 || i === 0)) {
        last = m;
        out.push({ week: i, label: MONTHS[m] });
        break;
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Period comparisons
// ---------------------------------------------------------------------------

export interface PeriodDelta {
  current: number;
  previous: number;
  /** current − previous */
  delta: number;
  /** (current − previous) / previous, or null when previous is 0 */
  ratio: number | null;
}

export function periodDelta(current: number, previous: number): PeriodDelta {
  return {
    current, previous, delta: current - previous,
    ratio: previous > 0 ? (current - previous) / previous : null,
  };
}

/**
 * Month-to-date versus the same number of days in the previous month,
 * from a per-day `{ date: 'YYYY-MM-DD', usd }` list (UTC).
 */
export function monthToDate(byDay: Array<{ date: string; usd: number }>, now: DateLike = Date.now()): PeriodDelta {
  const n = new Date(toTime(now) ?? 0);
  const y = n.getUTCFullYear(); const m = n.getUTCMonth(); const d = n.getUTCDate();
  const curStart = Date.UTC(y, m, 1);
  const prevStart = Date.UTC(y, m - 1, 1);
  const prevEnd = Math.min(Date.UTC(y, m - 1, d, 23, 59, 59), Date.UTC(y, m, 0, 23, 59, 59)); // same day-of-month, clamped
  let current = 0; let previous = 0;
  for (const row of byDay) {
    const t = toTime(`${row.date.slice(0, 10)}T00:00:00Z`);
    if (t === null) continue;
    if (t >= curStart) current += row.usd || 0;
    else if (t >= prevStart && t <= prevEnd) previous += row.usd || 0;
  }
  return periodDelta(current, previous);
}

// ---------------------------------------------------------------------------
// Commitments horizon
// ---------------------------------------------------------------------------

export interface HorizonItem<T> {
  item: T;
  /** Whole days from today (UTC): negative = overdue. */
  dayOffset: number;
  overdue: boolean;
}

/**
 * Open commitments laid on a `days`-day horizon starting today (UTC), with
 * overdue ones gathered to the left. Items without a deadline are skipped.
 */
export function horizon<T>(
  items: T[],
  getDeadline: (t: T) => DateLike,
  isOpen: (t: T) => boolean,
  days = 14,
  now: DateLike = Date.now(),
): { days: number; today: Date; overdue: HorizonItem<T>[]; upcoming: HorizonItem<T>[]; beyond: number } {
  const today = startOfUtcDay(now);
  const overdue: HorizonItem<T>[] = [];
  const upcoming: HorizonItem<T>[] = [];
  let beyond = 0;
  for (const item of items) {
    if (!isOpen(item)) continue;
    const t = toTime(getDeadline(item));
    if (t === null) continue;
    const dayOffset = Math.floor((startOfUtcDay(t).getTime() - today.getTime()) / DAY_MS);
    if (dayOffset < 0) overdue.push({ item, dayOffset, overdue: true });
    else if (dayOffset < days) upcoming.push({ item, dayOffset, overdue: false });
    else beyond += 1;
  }
  overdue.sort((a, b) => a.dayOffset - b.dayOffset);
  upcoming.sort((a, b) => a.dayOffset - b.dayOffset);
  return { days, today, overdue, upcoming, beyond };
}

/** Items due within `days` days from now (inclusive of today), not overdue. */
export function dueWithin<T>(items: T[], getDeadline: (t: T) => DateLike, isOpen: (t: T) => boolean, days: number, now: DateLike = Date.now()): T[] {
  const h = horizon(items, getDeadline, isOpen, days + 1, now);
  return h.upcoming.filter((x) => x.dayOffset <= days).map((x) => x.item);
}
