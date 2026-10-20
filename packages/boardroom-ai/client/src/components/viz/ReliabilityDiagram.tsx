import { useId, useMemo, useState } from 'react';
import type { CalibrationBin } from '@boardroom/shared';
import { useChartTheme, useReducedMotionPref } from './hooks';
import { linePath, bubbleRadius } from './scales';
import { ChartTooltip, TooltipRow, TooltipTitle } from './Tooltip';
import { DataTable } from './ChartFrame';

export interface ReliabilitySeries {
  id: string;
  label: string;
  color: string;
  brier: number | null;
  count: number;
  bins: CalibrationBin[];
}

export interface ReliabilityDiagramProps {
  series: ReliabilitySeries[];
  /** Square size in viewBox px. */
  size?: number;
  name?: string;
  /** Series id to emphasise (others fade). */
  emphasis?: string | null;
  /** Show the Brier badge for `series[0]` (the user). Default true. */
  brierBadge?: boolean;
  className?: string;
  'data-testid'?: string;
}

interface Mark { s: ReliabilitySeries; b: CalibrationBin; x: number; y: number; r: number }

const PAD = { t: 14, r: 14, b: 36, l: 40 };
const TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const pct = (v: number) => `${Math.round(v * 100)} %`;
export const binLabel = (b: CalibrationBin) => `${Math.round(b.lower * 100)}–${Math.round(b.upper * 100)} %`;

/** Plain-English read of a Brier score (lower is better; 0.25 is a coin flip). */
export function brierVerdict(brier: number | null): string {
  if (brier === null || !Number.isFinite(brier)) return 'no score yet';
  if (brier <= 0.1) return 'sharp';
  if (brier <= 0.2) return 'well calibrated';
  if (brier <= 0.25) return 'near coin-flip';
  return 'worse than chance';
}

/**
 * Reliability diagram: mean forecast per bin (x) against observed success
 * rate (y). The diagonal is perfect calibration; bubble area is the bin count,
 * so a confident-looking point backed by two decisions reads as tentative.
 */
export function ReliabilityDiagram({ series, size = 320, name = 'Calibration', emphasis: emphasisProp = null, brierBadge = true, className, ...rest }: ReliabilityDiagramProps) {
  const theme = useChartTheme();
  const reduced = useReducedMotionPref();
  const id = useId();
  const [active, setActive] = useState<Mark | null>(null);
  const emphasis = emphasisProp ?? active?.s.id ?? null;

  const W = size; const H = size;
  const PW = W - PAD.l - PAD.r; const PH = H - PAD.t - PAD.b;
  const sx = (v: number) => PAD.l + v * PW;
  const sy = (v: number) => PAD.t + (1 - v) * PH;

  const maxCount = useMemo(() => Math.max(1, ...series.flatMap((s) => s.bins.map((b) => b.count))), [series]);
  const marks = useMemo<Mark[]>(() => {
    const out: Mark[] = [];
    for (const s of series) for (const b of s.bins) if (b.count > 0) out.push({ s, b, x: sx(b.meanForecast), y: sy(b.observedRate), r: bubbleRadius(b.count, maxCount, 4, 13) });
    // Draw big bubbles first so small ones stay on top / hittable
    return out.sort((a, b) => b.r - a.r);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, maxCount, size]);

  const paths = useMemo(() => series.map((s) => {
    const pts = s.bins.filter((b) => b.count > 0).sort((a, b) => a.meanForecast - b.meanForecast).map((b) => ({ x: sx(b.meanForecast), y: sy(b.observedRate) }));
    return { id: s.id, color: s.color, d: linePath(pts) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [series, size]);

  const transition = reduced ? undefined : 'opacity 150ms ease';
  const fade = (sid: string) => (emphasis && emphasis !== sid ? 0.25 : 1);
  const primary = series[0];
  const bins = primary?.bins ?? [];

  return (
    <div className={`relative ${className ?? ''}`} data-testid={rest['data-testid']} data-viz="reliability">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={id} onMouseLeave={() => setActive(null)} style={{ fontFamily: theme.font }}>
        <title id={id}>{name}: mean forecast per bin against observed success rate, with the perfect-calibration diagonal. Bubble size is the number of decisions in the bin.</title>
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + PH} stroke={theme.grid} strokeWidth={1} />
            <line x1={PAD.l} x2={PAD.l + PW} y1={sy(t)} y2={sy(t)} stroke={theme.grid} strokeWidth={1} />
            <text x={sx(t)} y={PAD.t + PH + 14} textAnchor="middle" fontSize={10} fill={theme.textMuted} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(t * 100)}</text>
            <text x={PAD.l - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10} fill={theme.textMuted} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(t * 100)}</text>
          </g>
        ))}
        {/* Under-/over-confident halves — a whisper of tint, so the diagonal reads as a boundary */}
        <path d={`M${sx(0)},${sy(0)} L${sx(1)},${sy(1)} L${sx(0)},${sy(1)} Z`} fill={theme.text} fillOpacity={0.025} />
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke={theme.textMuted} strokeWidth={1} strokeOpacity={0.7} />
        <text x={sx(0.97)} y={sy(0.97) + 12} textAnchor="end" fontSize={9} fill={theme.textMuted}>perfect</text>
        <text x={sx(0.05)} y={sy(0.8)} fontSize={9} fill={theme.textMuted}>under-confident</text>
        <text x={sx(0.94)} y={sy(0.06)} textAnchor="end" fontSize={9} fill={theme.textMuted}>over-confident</text>
        <text x={PAD.l + PW / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={theme.text}>Mean forecast (%)</text>
        <text transform={`translate(11 ${PAD.t + PH / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill={theme.text}>Observed rate (%)</text>

        {paths.map((p) => p.d && (
          <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: fade(p.id), transition }} />
        ))}
        {marks.map((m) => {
          const isActive = active?.s.id === m.s.id && active.b.lower === m.b.lower;
          return (
            <g
              key={`${m.s.id}-${m.b.lower}`}
              tabIndex={0}
              role="img"
              aria-label={`${m.s.label}: forecast ${pct(m.b.meanForecast)}, observed ${pct(m.b.observedRate)}, ${m.b.count} decision${m.b.count === 1 ? '' : 's'}`}
              onMouseEnter={() => setActive(m)}
              onFocus={() => setActive(m)}
              onBlur={() => setActive(null)}
              style={{ opacity: fade(m.s.id), transition, outline: 'none', cursor: 'default' }}
              data-bin={m.b.lower}
              data-series={m.s.id}
            >
              <circle cx={m.x} cy={m.y} r={Math.max(12, m.r + 6)} fill="transparent" />
              <circle cx={m.x} cy={m.y} r={isActive ? m.r + 1.5 : m.r} fill={m.s.color} fillOpacity={0.85} stroke={theme.surface} strokeWidth={2} />
            </g>
          );
        })}
      </svg>

      {brierBadge && primary && (
        <div className="absolute left-12 top-2 rounded-md border border-border bg-card px-2 py-1 text-[11px] shadow-sm" data-viz="brier-badge">
          <span className="text-muted-foreground">Brier </span>
          <span className="font-semibold tabular-nums text-foreground">{primary.brier === null ? '—' : primary.brier.toFixed(3)}</span>
          <span className="text-muted-foreground"> · {brierVerdict(primary.brier)}</span>
        </div>
      )}

      {active && (
        <ChartTooltip fx={active.x / W} fy={active.y / H}>
          <TooltipTitle>{active.s.label} · bin {binLabel(active.b)}</TooltipTitle>
          <TooltipRow color={active.s.color} shape="dot" value={pct(active.b.observedRate)} label="observed" />
          <TooltipRow value={pct(active.b.meanForecast)} label="mean forecast" />
          <TooltipRow value={active.b.count} label={active.b.count === 1 ? 'decision' : 'decisions'} />
        </ChartTooltip>
      )}

      <DataTable
        caption={`${name}: observed success rate per forecast bin, by series`}
        columns={['Forecast bin', ...series.map((s) => `${s.label} observed`), ...series.map((s) => `${s.label} n`)]}
        rows={bins.map((b, i) => [
          binLabel(b),
          ...series.map((s) => { const sb = s.bins[i]; return sb && sb.count > 0 ? pct(sb.observedRate) : '—'; }),
          ...series.map((s) => s.bins[i]?.count ?? 0),
        ])}
      />
    </div>
  );
}
