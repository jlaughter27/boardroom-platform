import { useEffect, useId, useMemo, useState } from 'react';
import * as api from '../../lib/api';
import type { LlmUsageSummary } from '../../types/debate';
import { useReducedMotion } from '../../lib/motion';
import { Card, Skeleton } from '../ui';

const DAYS = 7;

export function formatUsd(v: number): string {
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
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

const W = 240, H = 56, P = 6;

function Sparkline({ points, reducedMotion }: { points: LlmUsageSummary['byDay']; reducedMotion: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(0.0001, ...points.map((p) => p.usd));
  const xs = points.map((_, i) => P + (i / Math.max(1, points.length - 1)) * (W - 2 * P));
  const ys = points.map((p) => H - P - (p.usd / max) * (H - 2 * P));
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `${line} L${xs[xs.length - 1].toFixed(1)},${H - P} L${xs[0].toFixed(1)},${H - P} Z`;
  const last = points.length - 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0; let bd = Infinity;
    xs.forEach((px, i) => { const d = Math.abs(px - x); if (d < bd) { bd = d; best = i; } });
    setActive(best);
  };

  const a = active ?? null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-14 w-full"
        role="img"
        aria-labelledby={id}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
      >
        <title id={id}>Daily LLM spend over the last {points.length} days</title>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="var(--color-border)" strokeWidth={1} />
        <path d={area} fill="var(--color-primary)" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Crosshair snaps to the nearest day */}
        {a !== null && <line x1={xs[a]} x2={xs[a]} y1={P} y2={H - P} stroke="var(--color-muted-foreground)" strokeWidth={1} style={{ transition: reducedMotion ? undefined : 'x1 80ms, x2 80ms' }} />}
        <circle cx={xs[a ?? last]} cy={ys[a ?? last]} r={4} fill="var(--color-primary)" stroke="var(--color-card)" strokeWidth={2} />
      </svg>
      {a !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md"
          style={{ left: `${(xs[a] / W) * 100}%`, transform: xs[a] > W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)' }}
        >
          <span className="font-semibold text-foreground tabular-nums">{formatUsd(points[a].usd)}</span>
          <span className="text-muted-foreground"> · {points[a].calls} calls · {new Date(points[a].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      )}
    </div>
  );
}

/** Admin-only: last 7 days of LLM spend from `GET /usage/llm/summary?days=7`. */
export function LlmCostWidget() {
  const [data, setData] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    api.getLlmUsageSummary(DAYS)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const days = useMemo(() => (data ? fillDays(data.byDay, data.days || DAYS) : []), [data]);
  const topPurposes = useMemo(() => (data ? [...data.byPurpose].sort((a, b) => b.usd - a.usd).slice(0, 4) : []), [data]);
  const cacheRate = useMemo(() => (data ? overallCacheHitRate(data.byPurpose) : null), [data]);
  const totalCalls = useMemo(() => (data ? data.byPurpose.reduce((s, p) => s + p.calls, 0) : 0), [data]);

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

  const maxPurpose = Math.max(0.0001, ...topPurposes.map((p) => p.usd));

  return (
    <Card className="p-4" data-testid="llm-cost-widget">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">LLM cost · last {data.days || DAYS} days</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">admin</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-x-6 gap-y-3 items-end">
        <div>
          <div className="text-3xl font-semibold text-foreground">{formatUsd(data.totalUsd)}</div>
          <div className="text-xs text-muted-foreground tabular-nums">{totalCalls.toLocaleString()} calls</div>
        </div>
        <div className="min-w-0">
          <Sparkline points={days} reducedMotion={reducedMotion} />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{days[0] ? new Date(days[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
            <span>today</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold text-foreground tabular-nums">{cacheRate === null ? '—' : `${Math.round(cacheRate * 100)} %`}</div>
          <div className="text-xs text-muted-foreground">cache hit rate</div>
        </div>
      </div>

      {topPurposes.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Top purposes</div>
          <ul className="space-y-1.5">
            {topPurposes.map((p) => (
              <li key={p.purpose} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center text-xs">
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-foreground">{p.purpose}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{p.calls} calls · {Math.round(p.cacheHitRate * 100)} % cached</span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted overflow-hidden" aria-hidden>
                    <div className="h-full rounded-r-full bg-primary" style={{ width: `${(p.usd / maxPurpose) * 100}%` }} />
                  </div>
                </div>
                <span className="text-foreground tabular-nums font-medium">{formatUsd(p.usd)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
