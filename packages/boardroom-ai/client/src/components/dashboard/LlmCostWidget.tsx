import { useEffect, useMemo, useState } from 'react';
import * as api from '../../lib/api';
import type { LlmUsageSummary } from '../../types/debate';
import { Card, Skeleton } from '../ui';
import { Sparkline } from '../viz/Sparkline';
import { BarChart, type BarRow } from '../viz/BarChart';
import { useChartTheme } from '../viz/hooks';
import { formatUsd as vizFormatUsd } from '../viz/scales';

const DAYS = 7;

export function formatUsd(v: number): string {
  return vizFormatUsd(v);
}

/** Calls-weighted cache hit rate across purposes (0..1); null when there were no calls. */
export function overallCacheHitRate(byPurpose: LlmUsageSummary['byPurpose']): number | null {
  let calls = 0; let hits = 0;
  for (const p of byPurpose) { calls += p.calls; hits += p.cacheHitRate * p.calls; }
  return calls > 0 ? hits / calls : null;
}

/** Fill the last N days so the sparkline has one point per day even when nothing ran. */
export function fillDays(byDay: LlmUsageSummary['byDay'], days: number, today: Date = new Date()): LlmUsageSummary['byDay'] {
  const map = new Map(byDay.map((d) => [d.date.slice(0, 10), d]));
  const out: LlmUsageSummary['byDay'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { date: key, usd: 0, calls: 0 });
  }
  return out;
}

/** Fixed slot per model so Sonnet is always slot 1 and Haiku slot 2, whatever the spend order. */
export const MODEL_ORDER = ['sonnet', 'haiku'] as const;

/** 'claude-sonnet-5-5' → 'Sonnet 5.5'; unknown ids pass through. */
export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

export function modelSlot(id: string): number {
  const i = MODEL_ORDER.findIndex((k) => id.includes(k));
  return i === -1 ? MODEL_ORDER.length : i;
}

/** One stacked row — spend share by model — with the cache-read share as the row note. */
export function modelShareRow(byModel: LlmUsageSummary['byModel'], palette: readonly string[], cacheRate: number | null): BarRow | null {
  const models = [...byModel].filter((m) => m.usd > 0 || m.calls > 0).sort((a, b) => modelSlot(a.model) - modelSlot(b.model) || b.usd - a.usd);
  if (models.length === 0) return null;
  return {
    id: 'share',
    label: 'By model',
    note: cacheRate === null ? undefined : `· ${Math.round(cacheRate * 100)} % cache reads`,
    segments: models.map((m) => ({
      id: m.model,
      label: modelLabel(m.model),
      value: m.usd,
      color: palette[Math.min(palette.length - 1, modelSlot(m.model))],
      note: `${m.calls.toLocaleString()} calls · ${Math.round((m.inputTokens + m.outputTokens) / 1000)}K tokens`,
    })),
  };
}

/** Admin-only: last 7 days of LLM spend from `GET /usage/llm/summary?days=7`. */
export function LlmCostWidget() {
  const [data, setData] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const theme = useChartTheme();

  useEffect(() => {
    let cancelled = false;
    api.getLlmUsageSummary(DAYS)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Defensive: a partial server payload must not take the dashboard down (R-C-06).
  const byDay = useMemo(() => data?.byDay ?? [], [data]);
  const byPurpose = useMemo(() => data?.byPurpose ?? [], [data]);
  const byModel = useMemo(() => data?.byModel ?? [], [data]);
  const days = useMemo(() => (data ? fillDays(byDay, Math.max(1, data.days || DAYS)) : []), [data, byDay]);
  const topPurposes = useMemo(() => [...byPurpose].sort((a, b) => b.usd - a.usd).slice(0, 4), [byPurpose]);
  const cacheRate = useMemo(() => overallCacheHitRate(byPurpose), [byPurpose]);
  const totalCalls = useMemo(() => byPurpose.reduce((s, p) => s + p.calls, 0), [byPurpose]);
  const shareRow = useMemo(() => modelShareRow(byModel, theme.series, cacheRate), [byModel, theme.series, cacheRate]);
  const anySpend = days.some((d) => d.usd > 0 || d.calls > 0);

  if (failed) return null;
  if (loading || !data) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-8 w-24 mb-3" />
        <Skeleton className="h-14 w-full" />
      </Card>
    );
  }

  const purposeRows: BarRow[] = topPurposes.map((p) => ({
    id: p.purpose,
    label: p.purpose,
    note: `· ${Math.round(p.cacheHitRate * 100)} % cached`,
    segments: [{ id: 'usd', label: 'Spend', value: p.usd, color: theme.series[0], note: `${p.calls.toLocaleString()} calls` }],
  }));

  return (
    <Card className="p-4" data-testid="llm-cost-widget" id="llm-cost">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">LLM cost · last {data.days || DAYS} days</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">admin</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-x-6 gap-y-3 items-end">
        <div>
          <div className="text-3xl font-semibold text-foreground">{formatUsd(data.totalUsd ?? 0)}</div>
          <div className="text-xs text-muted-foreground tabular-nums">{totalCalls.toLocaleString()} calls</div>
        </div>
        <div className="min-w-0">
          {anySpend ? (
            <>
              <Sparkline
                values={days.map((d) => d.usd)}
                labels={days.map((d) => `${new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${d.calls} calls`)}
                name="Daily LLM spend"
                width={320}
                height={56}
                color={theme.series[0]}
                valueFormat={formatUsd}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{days[0] ? new Date(days[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}</span>
                <span>today</span>
              </div>
            </>
          ) : (
            <div className="flex h-14 items-center text-xs text-muted-foreground">No calls in this window yet.</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold text-foreground tabular-nums">{cacheRate === null ? '—' : `${Math.round(cacheRate * 100)} %`}</div>
          <div className="text-xs text-muted-foreground">cache hit rate</div>
        </div>
      </div>

      {shareRow && (
        <div className="mt-4">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Spend by model</div>
          <BarChart rows={[shareRow]} name="LLM spend share by model" valueFormat={formatUsd} rowHeight={28} thickness={18} labelWidth={72} data-testid="llm-model-share" />
        </div>
      )}

      {purposeRows.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Top purposes</div>
          <BarChart rows={purposeRows} name="LLM spend by purpose" valueFormat={formatUsd} rowHeight={26} thickness={12} labelWidth={132} legend={false} data-testid="llm-purposes" />
        </div>
      )}
    </Card>
  );
}
