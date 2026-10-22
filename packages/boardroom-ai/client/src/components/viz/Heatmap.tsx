import { useId, useMemo, useState } from 'react';
import { useChartTheme } from './hooks';
import { rampStep } from './theme';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip, TooltipRow, TooltipTitle } from './Tooltip';
import type { DayCell, WeekBucket } from './aggregate';
import { monthLabels } from './aggregate';

export interface HeatmapProps {
  cells: DayCell[];
  buckets: WeekBucket[];
  max: number;
  name: string;
  /** Noun for the tooltip ("memories"). */
  unit?: string;
  /** Labels + colours for the per-key breakdown shown on hover. */
  keyLabels?: Record<string, string>;
  keyColors?: Record<string, string>;
  /** Override the sequential ramp (defaults to the theme's one-hue ramp). */
  ramp?: readonly string[];
  className?: string;
  'data-testid'?: string;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEFT = 30;
const TOP = 16;
const GAP = 2;

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Calendar heatmap: weeks × 7 days, intensity = count on a one-hue sequential
 * ramp (step 0 = none). Each cell is its own hover / focus target.
 */
export function Heatmap({ cells, buckets, max, name, unit = 'items', keyLabels = {}, keyColors = {}, ramp, className, ...rest }: HeatmapProps) {
  const theme = useChartTheme();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const steps = ramp ?? theme.sequential;
  const weeks = buckets.length;
  const months = useMemo(() => monthLabels(buckets), [buckets]);

  const table = useMemo(() => {
    const rows = buckets.map((b, w) => {
      const week = cells.filter((c) => c.week === w);
      const totals = DOW.map((_, d) => week.find((c) => c.dow === d)?.total ?? 0);
      return [`Week of ${b.label}`, ...totals, totals.reduce((a, c) => a + c, 0)];
    });
    return { caption: `${name} — ${unit} per day`, columns: ['Week', ...DOW, 'Total'], rows };
  }, [buckets, cells, name, unit]);

  const total = cells.reduce((a, c) => a + c.total, 0);

  return (
    <ChartFrame table={table} className={className} data-testid={rest['data-testid']}>
      {(width) => {
        const W = Math.max(240, width);
        const cell = Math.max(8, Math.min(26, Math.floor((W - LEFT) / Math.max(1, weeks)) - GAP));
        const pitch = cell + GAP;
        const gridW = weeks * pitch;
        const height = TOP + 7 * pitch + 4;
        const cx = (w: number) => LEFT + w * pitch;
        const cy = (d: number) => TOP + d * pitch;
        const a = active !== null ? cells[active] : null;

        return (
          <>
            <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-labelledby={id} style={{ fontFamily: theme.font }}>
              <title id={id}>{name}: {total} {unit} over {weeks} weeks, busiest day {max}</title>
              {months.map((m) => (
                <text key={`${m.week}-${m.label}`} x={cx(m.week)} y={10} fontSize={10} fill={theme.textMuted}>{m.label}</text>
              ))}
              {[0, 2, 4].map((d) => (
                <text key={d} x={LEFT - 6} y={cy(d) + cell / 2 + 3.5} textAnchor="end" fontSize={9} fill={theme.textMuted}>{DOW[d]}</text>
              ))}
              {cells.map((c, i) => {
                const step = rampStep(c.total, max, steps.length);
                const isActive = active === i;
                return (
                  <g
                    key={c.key}
                    tabIndex={c.future ? -1 : 0}
                    role="img"
                    aria-label={`${fmtDate(c.date)}: ${c.total} ${unit}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    style={{ outline: 'none' }}
                    data-level={step}
                    data-key={c.key}
                  >
                    <rect
                      x={cx(c.week)}
                      y={cy(c.dow)}
                      width={cell}
                      height={cell}
                      rx={Math.min(3, cell / 4)}
                      fill={c.future ? 'none' : c.total > 0 ? steps[step] : theme.grid}
                      fillOpacity={c.future ? 0 : c.total > 0 ? 1 : 0.55}
                      stroke={isActive ? theme.text : c.future ? theme.grid : 'none'}
                      strokeWidth={isActive ? 1.5 : 1}
                      strokeDasharray={c.future && !isActive ? '2 2' : undefined}
                    />
                  </g>
                );
              })}
            </svg>
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground" aria-hidden>
              <span>Less</span>
              {steps.map((s, i) => <span key={i} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i === 0 ? theme.grid : s, opacity: i === 0 ? 0.55 : 1 }} />)}
              <span>More</span>
            </div>
            {a && !a.future && (
              <ChartTooltip fx={(cx(a.week) + cell / 2) / W} fy={cy(a.dow) / height}>
                <TooltipTitle>{fmtDate(a.date)}</TooltipTitle>
                <div className="text-foreground"><span className="font-semibold tabular-nums">{a.total}</span> <span className="text-muted-foreground">{unit}</span></div>
                {Object.entries(a.byKey).sort((x, y) => y[1] - x[1]).map(([k, v]) => (
                  <TooltipRow key={k} color={keyColors[k] ?? theme.textMuted} shape="dot" value={v} label={keyLabels[k] ?? k} />
                ))}
              </ChartTooltip>
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
