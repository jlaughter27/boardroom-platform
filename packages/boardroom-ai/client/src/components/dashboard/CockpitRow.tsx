import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Commitment, Decision, LlmUsageSummary, Memory, OutcomeReviewNudge } from '@boardroom/shared';
import { isDelegation } from '@boardroom/shared';
import { useVizSlice } from '../../stores/viz.store';
import { useEntitiesStore } from '../../stores/entities.store';
import { StatTile, type StatDelta } from '../viz/StatTile';
import { countByWeek, dueWithin, horizon, monthToDate, periodDelta, toTime, type DateLike } from '../viz/aggregate';
import { formatUsd } from '../viz/scales';

const TREND_WEEKS = 8;
const DUE_DAYS = 7;

// RD-12: delegations never count toward the user's own commitments tile.
const isOpenCommitment = (c: Commitment) => c.status === 'OPEN' && !isDelegation(c);
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

/**
 * Decisions whose outcome review is due: an open review nudge, or a committed
 * decision whose `reviewAt` has passed with no outcome recorded (the nudge job
 * may not have run for it yet). One entry per decision. With nothing due the
 * hint says "none due" — not "all outcomes reviewed", which a future review
 * date (or a nudge that was never scheduled) would make untrue.
 */
export function reviewsTile(nudges: OutcomeReviewNudge[], now: DateLike = Date.now(), decisions: Decision[] = []): TileModel {
  const t = toTime(now) ?? Date.now();
  const due = new Map<string, number | null>();
  const note = (key: string, at: number | null) => {
    const prev = due.get(key);
    due.set(key, prev === undefined || prev === null ? at : at === null ? prev : Math.min(prev, at));
  };
  for (const n of nudges) {
    if (n.status === 'pending' || n.status === 'sent') note(n.decisionId ? `d:${n.decisionId}` : `n:${n.id}`, toTime(n.scheduledFor));
  }
  for (const d of decisions) {
    if (String(d.status) !== 'DECIDED' || d.outcome) continue;
    const at = toTime(d.reviewAt);
    if (at !== null && at <= t) note(`d:${d.id}`, at);
  }
  const oldest = [...due.values()].reduce<number | null>((acc, s) => (s === null ? acc : acc === null ? s : Math.min(acc, s)), null);
  const days = oldest === null ? 0 : Math.max(0, Math.floor((t - oldest) / 86_400_000));
  const count = due.size;
  return {
    value: String(count),
    numeric: count,
    hint: count === 0 ? 'none due' : days > 0 ? `oldest waiting ${days} d` : 'due today',
    tone: count === 0 ? 'success' : days >= 7 ? 'danger' : 'warning',
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
  // Already loaded by the shell (Layout fetches decisions on mount): no extra request.
  const knownDecisions = useEntitiesStore((s) => s.decisions);
  const usage = useVizSlice('usage', isAdmin);
  const decisions = useVizSlice('decisions', !isAdmin || usage.error !== null);

  const t = now ?? Date.now();
  const mem = useMemo(() => (memories.data ? memoriesTile(memories.data, t) : null), [memories.data, t]);
  const com = useMemo(() => (commitments.data ? commitmentsTile(commitments.data, t) : null), [commitments.data, t]);
  const rev = useMemo(() => (reviews.data ? reviewsTile(reviews.data, t, knownDecisions) : null), [reviews.data, t, knownDecisions]);
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
