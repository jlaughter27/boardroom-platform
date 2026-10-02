import { useEffect, useId, useMemo, useState } from 'react';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { CalibrationBin, CalibrationReport } from '@boardroom/shared';
import * as api from '../../lib/api';
import { useReducedMotion } from '../../lib/motion';
import { Card, Badge, Progress, Skeleton } from '../ui';
import { cn } from '../../lib/cn';

// ---------------------------------------------------------------------------
// Series + colours
// ---------------------------------------------------------------------------

/** Persona hues as the app already uses them (tailwind `persona.*`); user = brand primary. */
const PERSONA_HEX: Record<string, string> = {
  optimist: '#22c55e',
  critic: '#ef4444',
  alternate: '#a855f7',
  technician: '#3b82f6',
  questionnaire: '#eab308',
  doer: '#f97316',
  ceo: '#06b6d4',
};

const USER_COLOR = 'var(--color-primary)';
/** Fixed series order so a filtered persona never repaints the survivors. */
const SERIES_ORDER = ['user', 'optimist', 'critic', 'alternate', 'technician', 'questionnaire', 'doer', 'ceo'];
const MIN_PERSONA_COUNT = 5;

export interface CalibrationSeries {
  id: string;
  label: string;
  color: string;
  brier: number | null;
  count: number;
  bins: CalibrationBin[];
}

/** Flatten the report into drawable series: user + personas with ≥ MIN_PERSONA_COUNT scored forecasts. */
export function buildSeries(report: CalibrationReport): CalibrationSeries[] {
  const out: CalibrationSeries[] = [{
    id: 'user',
    label: 'You',
    color: USER_COLOR,
    brier: report.user.brier,
    count: report.reviewedDecisions,
    bins: report.user.bins,
  }];
  for (const [pid, p] of Object.entries(report.personas)) {
    if (p.count < MIN_PERSONA_COUNT) continue;
    out.push({
      id: pid,
      label: PERSONA_CONFIGS[pid]?.name?.replace(/^The /, '') ?? pid,
      color: PERSONA_HEX[pid] ?? 'var(--color-muted-foreground)',
      brier: p.brier,
      count: p.count,
      bins: p.bins,
    });
  }
  return out.sort((a, b) => {
    const ia = SERIES_ORDER.indexOf(a.id); const ib = SERIES_ORDER.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.id.localeCompare(b.id);
  });
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const binLabel = (b: CalibrationBin) => `${Math.round(b.lower * 100)}–${Math.round(b.upper * 100)} %`;

// ---------------------------------------------------------------------------
// Reliability diagram (inline SVG)
// ---------------------------------------------------------------------------

interface Mark { series: CalibrationSeries; bin: CalibrationBin; x: number; y: number }

const W = 320, H = 320, PAD = { t: 12, r: 12, b: 36, l: 40 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
const sx = (v: number) => PAD.l + v * PW;
const sy = (v: number) => PAD.t + (1 - v) * PH;
const TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

function ReliabilityDiagram({ series, reducedMotion }: { series: CalibrationSeries[]; reducedMotion: boolean }) {
  const [active, setActive] = useState<Mark | null>(null);
  const titleId = useId();

  const marks = useMemo<Mark[]>(() => {
    const out: Mark[] = [];
    for (const s of series) for (const b of s.bins) if (b.count > 0) out.push({ series: s, bin: b, x: sx(b.meanForecast), y: sy(b.observedRate) });
    return out;
  }, [series]);

  const paths = useMemo(() => series.map((s) => {
    const pts = s.bins.filter((b) => b.count > 0).sort((a, b) => a.meanForecast - b.meanForecast);
    return { id: s.id, color: s.color, d: pts.map((b, i) => `${i === 0 ? 'M' : 'L'}${sx(b.meanForecast).toFixed(1)},${sy(b.observedRate).toFixed(1)}`).join(' ') };
  }), [series]);

  const transition = reducedMotion ? undefined : 'opacity 150ms ease';

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[360px] h-auto"
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setActive(null)}
      >
        <title id={titleId}>Reliability diagram: mean forecast per bin against observed success rate, with the perfect-calibration diagonal.</title>
        {/* Gridlines — hairline, recessive */}
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--color-border)" strokeWidth={1} />
            <line x1={PAD.l} x2={PAD.l + PW} y1={sy(t)} y2={sy(t)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={sx(t)} y={PAD.t + PH + 16} textAnchor="middle" fontSize={10} fill="var(--color-muted-foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(t * 100)}</text>
            <text x={PAD.l - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--color-muted-foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(t * 100)}</text>
          </g>
        ))}
        {/* Diagonal reference = perfect calibration */}
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--color-muted-foreground)" strokeWidth={1} strokeOpacity={0.6} />
        <text x={sx(0.98)} y={sy(0.98) + 12} textAnchor="end" fontSize={9} fill="var(--color-muted-foreground)">perfect</text>
        {/* Axis titles — text tokens, never series colour */}
        <text x={PAD.l + PW / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--color-foreground)">Mean forecast (%)</text>
        <text transform={`translate(10 ${PAD.t + PH / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--color-foreground)">Observed rate (%)</text>

        {/* Series lines — 2px, round joins, faded when another series is hovered */}
        {paths.map((p) => p.d && (
          <path
            key={p.id}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: active && active.series.id !== p.id ? 0.25 : 1, transition }}
          />
        ))}

        {/* Marks — ≥ 8px dot with a 2px surface ring; 24px hit target */}
        {marks.map((m) => {
          const isActive = active?.series.id === m.series.id && active.bin.lower === m.bin.lower;
          const dim = active && active.series.id !== m.series.id;
          return (
            <g
              key={`${m.series.id}-${m.bin.lower}`}
              tabIndex={0}
              role="img"
              aria-label={`${m.series.label}: forecast ${pct(m.bin.meanForecast)}, observed ${pct(m.bin.observedRate)}, ${m.bin.count} decision${m.bin.count === 1 ? '' : 's'}`}
              onMouseEnter={() => setActive(m)}
              onFocus={() => setActive(m)}
              onBlur={() => setActive(null)}
              className="outline-none"
              style={{ opacity: dim ? 0.3 : 1, transition, cursor: 'default' }}
            >
              <circle cx={m.x} cy={m.y} r={12} fill="transparent" />
              <circle cx={m.x} cy={m.y} r={isActive ? 7 : 5} fill={m.series.color} stroke="var(--color-card)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>

      {/* Tooltip — value leads, label follows; keyed by a short line of the series colour */}
      {active && (
        <div
          role="status"
          className="pointer-events-none absolute rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(active.x / W) * 100}%`,
            top: `${(active.y / H) * 100}%`,
            transform: `translate(${active.x > W * 0.6 ? '-110%' : '12px'}, ${active.y < H * 0.3 ? '8px' : '-110%'})`,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: active.series.color }} aria-hidden />
            <span className="font-semibold text-foreground tabular-nums">{pct(active.bin.observedRate)} observed</span>
          </div>
          <div className="text-muted-foreground tabular-nums">{active.series.label} · forecast {pct(active.bin.meanForecast)} · n = {active.bin.count}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table view + Brier table
// ---------------------------------------------------------------------------

function CalibrationTable({ series }: { series: CalibrationSeries[] }) {
  const bins = series[0]?.bins ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Observed success rate per forecast bin, by series</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">Forecast bin</th>
            {series.map((s) => (
              <th key={s.id} scope="col" className="py-1.5 px-2 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={b.lower} className="border-t border-border">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground tabular-nums">{binLabel(b)}</th>
              {series.map((s) => {
                const sb = s.bins[i];
                return (
                  <td key={s.id} className="py-1.5 px-2 text-foreground tabular-nums">
                    {sb && sb.count > 0 ? <>{pct(sb.observedRate)} <span className="text-muted-foreground">(n={sb.count})</span></> : <span className="text-muted-foreground">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrierTable({ series }: { series: CalibrationSeries[] }) {
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Brier scores (lower is better)</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1.5 pr-3 font-medium">Forecaster</th>
          <th scope="col" className="py-1.5 px-2 font-medium text-right">Brier</th>
          <th scope="col" className="py-1.5 pl-2 font-medium text-right">n</th>
        </tr>
      </thead>
      <tbody>
        {series.map((s) => (
          <tr key={s.id} className="border-t border-border">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </span>
            </th>
            <td className="py-1.5 px-2 text-right text-foreground tabular-nums">{s.brier === null ? '—' : s.brier.toFixed(3)}</td>
            <td className="py-1.5 pl-2 text-right text-muted-foreground tabular-nums">{s.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Calibration section for the Decisions page. Hidden behind a progress line
 * until `reviewedDecisions >= minimumForSignal`; then a reliability diagram
 * (one series per forecaster), a Brier table and a table-view toggle.
 */
export function CalibrationPanel() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    api.getCalibration()
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const series = useMemo(() => (report ? buildSeries(report) : []), [report]);

  if (failed) return null; // endpoint not available yet — stay out of the way
  if (loading || !report) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-3 w-64" />
      </Card>
    );
  }

  const ready = report.reviewedDecisions >= report.minimumForSignal;
  const remaining = Math.max(0, report.minimumForSignal - report.reviewedDecisions);

  if (!ready) {
    return (
      <Card className="p-4" data-testid="calibration-gate">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Calibration</h2>
          <Badge variant="default">Needs {remaining} more reviewed decision{remaining === 1 ? '' : 's'}</Badge>
        </div>
        <p className="text-sm text-foreground tabular-nums">
          {report.reviewedDecisions} of {report.minimumForSignal} reviewed decisions
        </p>
        <Progress value={(report.reviewedDecisions / report.minimumForSignal) * 100} className="mt-2 h-1.5" />
        <p className="text-xs text-muted-foreground mt-2">
          Commit decisions with a forecast, then review them when nudged. Once {report.minimumForSignal} are scored you will see how well you — and each advisor — are calibrated.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid="calibration-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Calibration</h2>
          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {report.reviewedDecisions} reviewed decisions · success = rating ≥ {report.successThreshold}
          </p>
        </div>
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Calibration view">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn('h-7 rounded px-2.5 text-xs transition-colors', view === v ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              {v === 'chart' ? 'Chart' : 'Table view'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend — always present, mirrors the line+dot mark */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs" aria-label="Series">
        {series.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5 text-foreground">
            <span className="relative inline-flex h-2 w-5 items-center" aria-hidden>
              <span className="absolute inset-x-0 h-0.5 rounded" style={{ background: s.color }} />
              <span className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: s.color, boxShadow: '0 0 0 2px var(--color-card)' }} />
            </span>
            {s.label}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,360px)_1fr] gap-6 items-start">
        <div>
          {view === 'chart' ? <ReliabilityDiagram series={series} reducedMotion={reducedMotion} /> : <CalibrationTable series={series} />}
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Brier score</h3>
          <BrierTable series={series} />
          <p className="text-xs text-muted-foreground mt-2">
            Mean squared gap between forecast and outcome. 0 is perfect; 0.25 is coin-flip. Points above the diagonal are under-confident, below it over-confident.
          </p>
        </div>
      </div>
    </Card>
  );
}
