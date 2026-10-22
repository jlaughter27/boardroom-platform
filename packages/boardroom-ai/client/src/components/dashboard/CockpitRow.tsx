import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Commitment, Decision, LlmUsageSummary, Memory, OutcomeReviewNudge } from '@boardroom/shared';
import { useVizSlice } from '../../stores/viz.store';
import { StatTile, type StatDelta } from '../viz/StatTile';
import { countByWeek, dueWithin, horizon, monthToDate, periodDelta, toTime, type DateLike } from '../viz/aggregate';
import { formatUsd } from '../viz/scales';

const TREND_WEEKS = 8;
const DUE_DAYS = 7;

const isOpenCommitment = (c: Commitment) => c.status === 'OPEN';
const roundFormat = (n: number) => String(Math.round(n));

// ---------------------------------------------------------------------------
// Pure tile builders (unit-tested)
// ---------------------------------------------------------------------------

export interface TileModel {
  value: string;
  /** Raw number behind `value`; the tile tweens it on change. */
  numeric?: number;
  format?: (n: number) => string;
  hint?: string;
  delta?: StatDelta | null;
  trend?: number[];
  trendLabels?: string[];
  /** The last trend point is the current (incomplete) week. */
  trendPartialLast?: boolean;
  tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'accent';
}

export function memoriesTile(memories: Memory[], now: DateLike = Date.now()): TileModel {
  const { buckets, counts } = countByWeek(memories, (m) => m.createdAt, TREND_WEEKS, now);
  const cur = counts[counts.length - 1] ?? 0;
  const prev = counts[counts.length - 2] ?? 0;
  return {
    value: String(cur),
    numeric: cur,
    hint: `${counts.reduce((a, b) => a + b, 0)} in ${TREND_WEEKS} weeks`,
    delta: { value: cur - prev, unit: 'count', vs: 'vs last week' },
    trend: counts,
    trendLabels: buckets.map((b) => `Week of ${b.label}`),
    trendPartialLast: buckets[buckets.length - 1]?.partial ?? false,
    tone: 'accent',
  };
}

export function commitmentsTile(commitments: Commitment[], now: DateLike = Date.now()): TileModel {
  const h = horizon(commitments, (c) => c.deadline, isOpenCommitment, DUE_DAYS + 1, now);
  const due = dueWithin(commitments, (c) => c.deadline, isOpenCommitment, DUE_DAYS, now).length;
  const overdue = h.overdue.length;
  return {
    value: String(due),
    numeric: due,
    hint: overdue > 0 ? `${overdue} overdue` : `next ${DUE_DAYS} days`,
    tone: overdue > 0 ? 'danger' : due > 0 ? 'warning' : 'neutral',
  };
}

export function reviewsTile(nudges: OutcomeReviewNudge[], now: DateLike = Date.now()): TileModel {
  const open = nudges.filter((n) => n.status === 'pending' || n.status === 'sent');
  const t = toTime(now) ?? Date.now();
  const oldest = open.reduce<number | null>((acc, n) => {
    const s = toTime(n.scheduledFor);
    return s === null ? acc : acc === null ? s : Math.min(acc, s);
  }, null);
  const days = oldest === null ? 0 : Math.max(0, Math.floor((t - oldest) / 86_400_000));
  return {
    value: String(open.length),
    numeric: open.length,
    hint: open.length === 0 ? 'all outcomes reviewed' : days > 0 ? `oldest waiting ${days} d` : 'due today',
    tone: open.length === 0 ? 'success' : days >= 7 ? 'danger' : 'warning',
  };
}

export function spendTile(usage: LlmUsageSummary, now: DateLike = Date.now()): TileModel {
  const byDay = Array.isArray(usage.byDay) ? usage.byDay : [];
  const mtd = monthToDate(byDay, now);
  const { buckets, counts } = countByWeek(byDay, (d) => `${d.date}T00:00:00Z`, TREND_WEEKS, now);
  // countByWeek counts rows; sum usd per week instead.
  const weekly = new Array<number>(TREND_WEEKS).fill(0);
  for (const row of byDay) {
    const t = toTime(`${row.date.slice(0, 10)}T00:00:00Z`);
    if (t === null) continue;
    const i = Math.floor((t - buckets[0].start.getTime()) / (7 * 86_400_000));
    if (i >= 0 && i < TREND_WEEKS) weekly[i] += row.usd || 0;
  }
  void counts;
  return {
    value: formatUsd(mtd.current),
    numeric: mtd.current,
    format: formatUsd,
    hint: 'month to date',
    delta: { value: mtd.delta, unit: 'usd', vs: 'vs same days last month', upIsGood: false },
    trend: weekly,
    trendLabels: buckets.map((b) => `Week of ${b.label}`),
    trendPartialLast: buckets[buckets.length - 1]?.partial ?? false,
    tone: 'neutral',
  };
}

export function decisionsTile(decisions: Decision[], now: DateLike = Date.now()): TileModel {
  const { buckets, counts } = countByWeek(decisions, (d) => d.decidedAt ?? d.createdAt, TREND_WEEKS, now);
  const cur = counts[counts.length - 1] ?? 0;
  const prev = counts[counts.length - 2] ?? 0;
  const d = periodDelta(cur, prev);
  return {
    value: String(counts.reduce((a, b) => a + b, 0)),
    numeric: counts.reduce((a, b) => a + b, 0),
    hint: `committed in ${TREND_WEEKS} weeks`,
    delta: { value: d.delta, unit: 'count', vs: 'this week vs last' },
    trend: counts,
    trendLabels: buckets.map((b) => `Week of ${b.label}`),
    trendPartialLast: buckets[buckets.length - 1]?.partial ?? false,
    tone: 'neutral',
  };
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface CockpitRowProps {
  /** Admins see month-to-date LLM spend; everyone else sees the decisions cadence. */
  isAdmin: boolean;
  now?: number;
}

/**
 * The KPI row the dashboard leads with: four stat tiles, each a number with
 * its context (delta vs a named period, 8-week sparkline). Every tile
 * degrades to a quiet placeholder when its endpoint is unavailable.
 */
export function CockpitRow({ isAdmin, now }: CockpitRowProps) {
  const navigate = useNavigate();
  const memories = useVizSlice('memories');
  const commitments = useVizSlice('commitments');
  const reviews = useVizSlice('pendingReviews');
  const usage = useVizSlice('usage', isAdmin);
  const decisions = useVizSlice('decisions', !isAdmin || usage.error !== null);

  const t = now ?? Date.now();
  const mem = useMemo(() => (memories.data ? memoriesTile(memories.data, t) : null), [memories.data, t]);
  const com = useMemo(() => (commitments.data ? commitmentsTile(commitments.data, t) : null), [commitments.data, t]);
  const rev = useMemo(() => (reviews.data ? reviewsTile(reviews.data, t) : null), [reviews.data, t]);
  const showSpend = isAdmin && usage.error === null;
  const spend = useMemo(() => (showSpend && usage.data ? spendTile(usage.data, t) : null), [showSpend, usage.data, t]);
  const dec = useMemo(() => (!showSpend && decisions.data ? decisionsTile(decisions.data, t) : null), [showSpend, decisions.data, t]);

  const tile = (label: string, m: TileModel | null, slice: { loading: boolean; error: string | null }, onClick?: () => void, testId?: string) => (
    <StatTile
      label={label}
      value={m?.value ?? (slice.error ? '—' : '')}
      numericValue={m?.numeric}
      format={m?.format ?? roundFormat}
      hint={m?.hint ?? (slice.error ? 'unavailable' : undefined)}
      delta={m?.delta ?? null}
      trend={m?.trend}
      trendLabels={m?.trendLabels}
      trendName={`${label} by week`}
      trendPartialLast={m?.trendPartialLast}
      tone={m?.tone ?? 'neutral'}
      loading={!m && !slice.error}
      onClick={onClick}
      data-testid={testId}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="cockpit-row">
      {tile('Memories this week', mem, memories, () => navigate('/memory'), 'tile-memories')}
      {tile(`Commitments due ≤ ${DUE_DAYS} d`, com, commitments, () => document.getElementById('commitment-horizon')?.scrollIntoView({ behavior: 'smooth' }), 'tile-commitments')}
      {tile('Decisions awaiting review', rev, reviews, () => navigate('/decisions'), 'tile-reviews')}
      {showSpend
        ? tile('LLM spend', spend, usage, () => document.getElementById('llm-cost')?.scrollIntoView({ behavior: 'smooth' }), 'tile-spend')
        : tile('Decisions committed', dec, decisions, () => navigate('/decisions'), 'tile-decisions')}
    </div>
  );
}
