import { useId, useMemo, useState } from 'react';
import { useChartTheme, useReducedMotionPref, svgPoint } from './hooks';
import { linearScale, linePath, areaPath, baselineAreaPath, stackSeries, niceTicks, nearestIndex, formatCompact } from './scales';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip, TooltipRow, TooltipTitle } from './Tooltip';
import { Legend } from './Legend';

export interface AreaSeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

export interface AreaChartProps {
  series: AreaSeries[];
  /** One per index — x-axis + tooltip title. */
  xLabels: string[];
  /** Stack the series (part-to-whole over time). Default false: overlaid lines with a 10 % wash. */
  stacked?: boolean;
  height?: number;
  /** Chart name for the aria label and table caption. */
  name: string;
  valueFormat?: (v: number) => string;
  /** Render the legend (always on for ≥ 2 series unless the caller places its own). */
  legend?: boolean;
  /** Direct-label the latest total at the right edge. Default true. */
  labelLast?: boolean;
  /** Series id to emphasise; others fade. Controlled from a legend hover, for example. */
  emphasis?: string | null;
  /**
   * The last x bucket is still in progress (e.g. the current week). Its band is
   * washed back, the tooltip says so, and the end label moves to the last
   * complete bucket so an incomplete count never reads as a plunge.
   */
  partialLast?: boolean;
  /** Legend note for the partial bucket. Default "last bucket is this week (partial)". */
  partialNote?: string;
  className?: string;
  'data-testid'?: string;
}

const PAD = { t: 14, r: 44, b: 22, l: 34 };

/** Which x labels to show so at most ~6 fit. */
export function pickXLabelIndices(n: number, max = 6): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

export function AreaChart({
  series, xLabels, stacked = false, height = 200, name, valueFormat = formatCompact,
  legend = true, labelLast = true, emphasis: emphasisProp = null, partialLast = false,
  partialNote = 'last bucket is this week (partial)', className, ...rest
}: AreaChartProps) {
  const theme = useChartTheme();
  const reduced = useReducedMotionPref();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const [hoverSeries, setHoverSeries] = useState<string | null>(null);
  const emphasis = emphasisProp ?? hoverSeries;
  const n = xLabels.length;
  const empty = series.length === 0 || n === 0 || series.every((s) => s.values.every((v) => !(v > 0)));

  const table = useMemo(() => ({
    caption: name,
    columns: ['Period', ...series.map((s) => s.label), ...(stacked && series.length > 1 ? ['Total'] : [])],
    rows: xLabels.map((l, i) => {
      const vals = series.map((s) => s.values[i] ?? 0);
      const row: Array<string | number> = [l, ...vals.map((v) => valueFormat(v))];
      if (stacked && series.length > 1) row.push(valueFormat(vals.reduce((a, b) => a + b, 0)));
      return row;
    }),
  }), [name, series, xLabels, stacked, valueFormat]);

  return (
    <div className={className}>
      {(legend && series.length >= 2) || partialLast ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {legend && series.length >= 2 ? (
            <Legend
              items={series.map((s) => ({ id: s.id, label: s.label, color: s.color, shape: stacked ? 'rect' : 'line', muted: emphasis !== null && emphasis !== s.id }))}
              onHover={setHoverSeries}
            />
          ) : <span />}
          {partialLast && <span className="text-[11px] text-muted-foreground" data-viz="partial-note">{partialNote}</span>}
        </div>
      ) : null}
      <ChartFrame table={table} data-testid={rest['data-testid']}>
        {(width) => {
          const W = Math.max(160, width);
          const PW = W - PAD.l - PAD.r;
          const PH = height - PAD.t - PAD.b;
          const stacks = stacked ? stackSeries(series.map((s) => s.values)) : null;
          const max = stacks
            ? Math.max(0, ...stacks.flatMap((s) => s.map(([, y1]) => y1)))
            : Math.max(0, ...series.flatMap((s) => s.values));
          const ticks = niceTicks(0, max, 3);
          const yMax = ticks[ticks.length - 1] || 1;
          const x = linearScale([0, Math.max(1, n - 1)], [PAD.l, PAD.l + PW]);
          const y = linearScale([0, yMax], [PAD.t + PH, PAD.t]);
          const xs = Array.from({ length: n }, (_, i) => x(i));
          const base = y(0);
          const paths = series.map((s, si) => {
            const top = xs.map((px, i) => ({ x: px, y: y(stacks ? stacks[si][i][1] : (s.values[i] ?? 0)) }));
            const bottom = stacks ? xs.map((px, i) => ({ x: px, y: y(stacks[si][i][0]) })) : null;
            return { s, top, line: linePath(top), area: bottom ? areaPath(top, bottom) : baselineAreaPath(top, base) };
          });
          const totals = xs.map((_, i) => series.reduce((acc, s) => acc + (s.values[i] ?? 0), 0));
          // Direct label goes on the last COMPLETE bucket; a partial week is never the headline.
          const li = partialLast && n > 1 ? n - 2 : n - 1;
          const topAt = (i: number) => (stacks ? y(stacks[stacks.length - 1]?.[i]?.[1] ?? 0) : y(Math.max(...series.map((s) => s.values[i] ?? 0))));
          const labelValue = stacked ? totals[li] : Math.max(...series.map((s) => s.values[li] ?? 0));
          const labelX = li === n - 1 ? Math.min(xs[li] - 4, PAD.l + PW - 4) : xs[li];
          const labelAnchor: 'end' | 'middle' = li === n - 1 ? 'end' : 'middle';
          const labelY = Math.max(PAD.t + 9, topAt(li) - 7);
          const transition = reduced ? undefined : 'opacity 150ms ease';
          const fade = (sid: string) => (emphasis && emphasis !== sid ? 0.25 : 1);

          const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
            const p = svgPoint(e, W, height);
            setActive(nearestIndex(xs, p.x));
          };
          const a = active;

          return (
            <>
              <svg
                viewBox={`0 0 ${W} ${height}`}
                width="100%"
                height={height}
                role="img"
                aria-labelledby={id}
                onPointerMove={onMove}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(n - 1)}
                onBlur={() => setActive(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((i) => Math.max(0, (i ?? n - 1) - 1)); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); setActive((i) => Math.min(n - 1, (i ?? n - 1) + 1)); }
                }}
                tabIndex={0}
                style={{ outline: 'none', fontFamily: theme.font }}
              >
                <title id={id}>{name}{stacked ? ' (stacked)' : ''}: {series.map((s) => s.label).join(', ')} over {n} periods</title>
                {/* Gridlines — hairline, recessive */}
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={PAD.l} x2={PAD.l + PW} y1={y(t)} y2={y(t)} stroke={theme.grid} strokeWidth={1} />
                    <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={theme.textMuted} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCompact(t)}</text>
                  </g>
                ))}
                {pickXLabelIndices(n).map((i) => (
                  <text key={i} x={xs[i]} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={10} fill={theme.textMuted}>{xLabels[i]}</text>
                ))}

                {empty ? (
                  <text x={PAD.l + PW / 2} y={PAD.t + PH / 2} textAnchor="middle" fontSize={11} fill={theme.textMuted}>No activity in this window yet</text>
                ) : (
                  <>
                    {/* Areas first (bottom to top), then lines so every edge stays crisp */}
                    {paths.map((p) => (
                      <path key={`a-${p.s.id}`} d={p.area} fill={p.s.color} fillOpacity={stacked ? 0.72 : 0.1} style={{ opacity: fade(p.s.id), transition }} />
                    ))}
                    {paths.map((p) => (
                      <path key={`l-${p.s.id}`} d={p.line} fill="none" stroke={stacked ? theme.surface : p.s.color} strokeWidth={stacked ? 2 : 2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: fade(p.s.id), transition }} />
                    ))}
                    {/* In-progress bucket: wash the band back to the surface and mark its start */}
                    {partialLast && n > 1 && (
                      <g data-viz="partial-band">
                        <rect x={xs[n - 2]} y={PAD.t} width={Math.max(0, xs[n - 1] - xs[n - 2])} height={PH} fill={theme.surface} fillOpacity={0.55} />
                        <line x1={xs[n - 2]} x2={xs[n - 2]} y1={PAD.t} y2={PAD.t + PH} stroke={theme.textMuted} strokeWidth={1} strokeDasharray="2 3" />
                      </g>
                    )}
                    {/* Selective direct label: the latest complete total, inside the plot */}
                    {labelLast && n > 0 && (
                      <text x={labelX} y={labelY} textAnchor={labelAnchor} fontSize={11} fontWeight={600} fill={theme.text} style={{ fontVariantNumeric: 'tabular-nums' }} data-viz="end-label">
                        {valueFormat(labelValue)}
                      </text>
                    )}
                    {/* Crosshair snaps to the nearest period */}
                    {a !== null && (
                      <g>
                        <line x1={xs[a]} x2={xs[a]} y1={PAD.t} y2={PAD.t + PH} stroke={theme.textMuted} strokeWidth={1} />
                        {paths.map((p, si) => (
                          <circle key={p.s.id} cx={xs[a]} cy={p.top[a].y} r={4} fill={p.s.color} stroke={theme.surface} strokeWidth={2} style={{ opacity: fade(p.s.id), transition }} data-series={si} />
                        ))}
                      </g>
                    )}
                  </>
                )}
              </svg>
              {a !== null && !empty && (
                <ChartTooltip fx={xs[a] / W} fy={PAD.t / height}>
                  <TooltipTitle>{xLabels[a]}{partialLast && a === n - 1 ? ' · this week (partial)' : ''}</TooltipTitle>
                  {[...series].reverse().map((s) => (
                    <TooltipRow key={s.id} color={s.color} shape={stacked ? 'rect' : 'line'} value={valueFormat(s.values[a] ?? 0)} label={s.label} />
                  ))}
                  {stacked && series.length > 1 && (
                    <div className="mt-1 border-t border-border pt-1 text-foreground"><span className="font-semibold tabular-nums">{valueFormat(totals[a])}</span> <span className="text-muted-foreground">total</span></div>
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
