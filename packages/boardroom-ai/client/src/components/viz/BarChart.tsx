import { useId, useMemo, useState } from 'react';
import { useChartTheme, useReducedMotionPref } from './hooks';
import { linearScale, roundedBarPath, formatCompact, niceMax } from './scales';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip, TooltipRow, TooltipTitle } from './Tooltip';
import { Legend } from './Legend';

export interface BarSegment {
  id: string;
  label: string;
  value: number;
  color: string;
  /** Extra line in the tooltip ("42 % cached"). */
  note?: string;
}

export interface BarRow {
  id: string;
  label: string;
  segments: BarSegment[];
  /** Optional trailing annotation after the value label. */
  note?: string;
}

export interface BarChartProps {
  rows: BarRow[];
  name: string;
  valueFormat?: (v: number) => string;
  /** Bar thickness in px (≤ 24 per the mark spec). */
  thickness?: number;
  /** Row pitch in px. */
  rowHeight?: number;
  /** Label column width in px. */
  labelWidth?: number;
  /** Legend of the segment series (for stacked rows). Auto when ≥ 2 distinct segment ids. */
  legend?: boolean;
  /** Share mode: every row is scaled to 100 % of its own total. */
  normalize?: boolean;
  className?: string;
  'data-testid'?: string;
}

const GAP = 2;
const RIGHT_PAD = 56;

/**
 * Horizontal bars (optionally stacked). ≤ 24px thick, 4px rounded data-end,
 * square at the baseline, 2px surface gap between segments, value at the tip.
 */
export function BarChart({
  rows, name, valueFormat = formatCompact, thickness = 16, rowHeight = 30, labelWidth = 104,
  legend, normalize = false, className, ...rest
}: BarChartProps) {
  const theme = useChartTheme();
  const reduced = useReducedMotionPref();
  const id = useId();
  const [active, setActive] = useState<{ row: number; seg: number } | null>(null);
  const [hoverSeries, setHoverSeries] = useState<string | null>(null);

  const seriesIds = useMemo(() => {
    const seen = new Map<string, BarSegment>();
    for (const r of rows) for (const s of r.segments) if (!seen.has(s.id)) seen.set(s.id, s);
    return [...seen.values()];
  }, [rows]);
  const showLegend = legend ?? seriesIds.length >= 2;
  const totals = rows.map((r) => r.segments.reduce((a, s) => a + Math.max(0, s.value || 0), 0));
  const max = normalize ? 1 : niceMax(Math.max(0, ...totals), 2);
  const height = Math.max(rowHeight, rows.length * rowHeight);

  const table = useMemo(() => ({
    caption: name,
    columns: ['Category', ...(seriesIds.length >= 2 ? seriesIds.map((s) => s.label) : []), 'Total'],
    rows: rows.map((r, i) => [
      r.label,
      ...(seriesIds.length >= 2 ? seriesIds.map((s) => valueFormat(r.segments.find((x) => x.id === s.id)?.value ?? 0)) : []),
      valueFormat(totals[i]),
    ]),
  }), [name, rows, seriesIds, totals, valueFormat]);

  if (rows.length === 0) {
    return <p className={`text-xs text-muted-foreground ${className ?? ''}`} data-viz="bar-empty">Nothing to compare yet.</p>;
  }

  return (
    <div className={className}>
      {showLegend && (
        <Legend className="mb-2" items={seriesIds.map((s) => ({ id: s.id, label: s.label, color: s.color, shape: 'rect', muted: hoverSeries !== null && hoverSeries !== s.id }))} onHover={setHoverSeries} />
      )}
      <ChartFrame table={table} data-testid={rest['data-testid']}>
        {(width) => {
          const W = Math.max(200, width);
          const x0 = labelWidth;
          const x = linearScale([0, max], [x0, W - RIGHT_PAD]);
          const transition = reduced ? undefined : 'opacity 150ms ease';
          const fade = (sid: string) => (hoverSeries && hoverSeries !== sid ? 0.3 : 1);
          // Tooltip anchor from the active segment (recomputed, not captured, so TS keeps the type).
          const tip = (() => {
            if (!active) return null;
            const r = rows[active.row]; const seg = r?.segments[active.seg];
            if (!r || !seg) return null;
            const total = totals[active.row];
            const scale = normalize && total > 0 ? 1 / total : 1;
            let cursor = 0;
            for (let i = 0; i < active.seg; i++) cursor += Math.max(0, r.segments[i].value || 0) * scale;
            const v = Math.max(0, seg.value || 0) * scale;
            const sx = x(cursor); const ex = x(cursor + v);
            return { fx: ((sx + ex) / 2) / W, fy: (active.row * rowHeight + rowHeight / 2 - thickness / 2) / height, row: r, seg };
          })();

          const bars = rows.map((r, ri) => {
            const cy = ri * rowHeight + rowHeight / 2;
            const yTop = cy - thickness / 2;
            const total = totals[ri];
            const scale = normalize && total > 0 ? 1 / total : 1;
            let cursor = 0;
            const segs = r.segments.map((s, si) => {
              const v = Math.max(0, s.value || 0) * scale;
              const sx = x(cursor);
              const ex = x(cursor + v);
              cursor += v;
              const isLast = si === r.segments.length - 1;
              const w = Math.max(0, ex - sx - (isLast ? 0 : GAP));
              const isActive = active?.row === ri && active.seg === si;
              return (
                <g
                  key={s.id}
                  tabIndex={0}
                  role="img"
                  aria-label={`${r.label} — ${s.label}: ${valueFormat(s.value)}${s.note ? `, ${s.note}` : ''}`}
                  onMouseEnter={() => setActive({ row: ri, seg: si })}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive({ row: ri, seg: si })}
                  onBlur={() => setActive(null)}
                  style={{ opacity: fade(s.id), transition, outline: 'none' }}
                >
                  {/* hit target taller than the mark */}
                  <rect x={sx} y={cy - rowHeight / 2} width={Math.max(w, 4)} height={rowHeight} fill="transparent" />
                  <path d={isLast ? roundedBarPath(sx, yTop, w, thickness, 'right') : `M${sx},${yTop} h${w} v${thickness} h${-w} Z`} fill={s.color} style={{ filter: isActive ? 'brightness(1.08)' : undefined }} />
                </g>
              );
            });
            const tipX = x(normalize ? (total > 0 ? 1 : 0) : total);
            return (
              <g key={r.id} data-row={r.id}>
                <text x={x0 - 10} y={cy + 3.5} textAnchor="end" fontSize={11} fill={theme.text}>
                  {r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label}
                </text>
                <line x1={x0} x2={x0} y1={cy - rowHeight / 2} y2={cy + rowHeight / 2} stroke={theme.grid} strokeWidth={1} />
                {segs}
                <text x={tipX + 6} y={cy + 3.5} fontSize={11} fontWeight={600} fill={theme.text} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {valueFormat(total)}{r.note ? <tspan fontWeight={400} fill={theme.textMuted}> {r.note}</tspan> : null}
                </text>
              </g>
            );
          });

          return (
            <>
              <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-labelledby={id} style={{ fontFamily: theme.font, overflow: 'visible' }}>
                <title id={id}>{name}: {rows.length} categor{rows.length === 1 ? 'y' : 'ies'}</title>
                {bars}
              </svg>
              {tip && (
                <ChartTooltip fx={tip.fx} fy={tip.fy}>
                  <TooltipTitle>{tip.row.label}</TooltipTitle>
                  <TooltipRow color={tip.seg.color} shape="rect" value={valueFormat(tip.seg.value)} label={tip.seg.label} />
                  {tip.seg.note && <div className="text-muted-foreground">{tip.seg.note}</div>}
                  {tip.row.segments.length > 1 && (
                    <div className="mt-1 border-t border-border pt-1"><span className="font-semibold tabular-nums text-foreground">{valueFormat(totals[rows.indexOf(tip.row)])}</span> <span className="text-muted-foreground">total</span></div>
                  )}
                </ChartTooltip>
              )}
            </>
          );
        }}
      </ChartFrame>
    </div>
  );
}
