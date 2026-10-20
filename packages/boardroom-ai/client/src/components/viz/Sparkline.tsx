import { useId, useMemo, useState } from 'react';
import { useChartTheme, useReducedMotionPref, svgPoint } from './hooks';
import { linearScale, linePath, baselineAreaPath, nearestIndex } from './scales';
import { ChartTooltip, TooltipRow } from './Tooltip';
import { DataTable } from './ChartFrame';

export interface SparklineProps {
  values: number[];
  /** One label per value for the tooltip / table (e.g. week start). */
  labels?: string[];
  width?: number;
  height?: number;
  /** History colour; defaults to the de-emphasis grey. */
  color?: string;
  /** Last point / current period colour; defaults to the accent. */
  accent?: string;
  /** Series name for the aria label and table caption. */
  name: string;
  valueFormat?: (v: number) => string;
  /** Crosshair + tooltip on hover. Default on. */
  interactive?: boolean;
  /** Fill wash under the line (10 % of the colour). */
  area?: boolean;
  /** The last point is an in-progress bucket: dashed final segment, hollow dot, "(partial)" in the tooltip. */
  partialLast?: boolean;
  className?: string;
}

const P = 4;

/** 12-point trend in the de-emphasis hue, current period in the accent. */
export function Sparkline({
  values, labels, width = 120, height = 32, color, accent, name,
  valueFormat = (v) => String(v), interactive = true, area = true, partialLast = false, className,
}: SparklineProps) {
  const theme = useChartTheme();
  const reduced = useReducedMotionPref();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const stroke = color ?? theme.deemphasis;
  const dot = accent ?? theme.accent;

  const { xs, ys, line, areaD } = useMemo(() => {
    const n = values.length;
    const max = Math.max(1, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
    const x = linearScale([0, Math.max(1, n - 1)], [P, width - P]);
    const y = linearScale([0, max], [height - P, P]);
    const xs = values.map((_, i) => x(i));
    const ys = values.map((v) => y(Number.isFinite(v) ? v : 0));
    const pts = xs.map((px, i) => ({ x: px, y: ys[i] }));
    return { xs, ys, line: linePath(pts), areaD: baselineAreaPath(pts, height - P) };
  }, [values, width, height]);

  const n = values.length;
  const last = n - 1;
  const total = values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const label = `${name}: ${n} periods, latest ${valueFormat(values[last] ?? 0)}, total ${valueFormat(total)}`;

  if (n === 0) {
    return <div className={className} style={{ width, height }} aria-hidden data-viz="sparkline-empty" />;
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const { x } = svgPoint(e, width, height);
    setActive(nearestIndex(xs, x));
  };
  const a = active;
  const transition = reduced ? undefined : 'opacity 120ms ease';

  return (
    <div className={`relative ${className ?? ''}`} style={{ width: '100%', maxWidth: width }} data-viz="sparkline">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={id}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => interactive && setActive(last)}
        onBlur={() => setActive(null)}
        tabIndex={interactive ? 0 : undefined}
        style={{ overflow: 'visible', outline: 'none' }}
      >
        <title id={id}>{label}</title>
        {area && n > 1 && <path d={areaD} fill={stroke} fillOpacity={0.12} />}
        {n > 1 && <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {/* Current period */}
        {n > 1 && <path d={linePath([{ x: xs[last - 1], y: ys[last - 1] }, { x: xs[last], y: ys[last] }])} fill="none" stroke={dot} strokeWidth={2} strokeLinecap="round" strokeDasharray={partialLast ? '3 3' : undefined} vectorEffect="non-scaling-stroke" data-viz={partialLast ? 'partial-segment' : undefined} />}
        {a !== null && a !== last && (
          <line x1={xs[a]} x2={xs[a]} y1={P} y2={height - P} stroke={theme.textMuted} strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ transition }} />
        )}
        <circle
          cx={xs[a ?? last]} cy={ys[a ?? last]} r={4}
          fill={a !== null && a !== last ? stroke : partialLast ? theme.surface : dot}
          stroke={a !== null && a !== last ? theme.surface : partialLast ? dot : theme.surface}
          strokeWidth={2} vectorEffect="non-scaling-stroke"
        />
      </svg>
      {a !== null && interactive && (
        <ChartTooltip fx={xs[a] / width} fy={ys[a] / height}>
          <TooltipRow color={a === last ? dot : stroke} value={valueFormat(values[a])} label={`${labels?.[a] ?? `#${a + 1}`}${partialLast && a === last ? ' (partial)' : ''}`} />
        </ChartTooltip>
      )}
      <DataTable
        caption={name}
        columns={['Period', 'Value']}
        rows={values.map((v, i) => [`${labels?.[i] ?? `#${i + 1}`}${partialLast && i === last ? ' (partial)' : ''}`, valueFormat(v)])}
      />
    </div>
  );
}
