import { useEffect, useRef, type ReactNode } from 'react';
import { animate } from 'motion/react';
import { cn } from '../../lib/cn';
import { Sparkline } from './Sparkline';
import { formatDelta } from './scales';
import { useReducedMotionPref } from './hooks';

/** Ease-out curve for value changes (Apple-grade UI standards, 2026-10-20). */
export const VALUE_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
export const VALUE_DURATION_S = 0.25;

/**
 * Renders a formatted number and tweens it only when the value CHANGES —
 * never on first paint (no entrance animation on dashboard load).
 */
export function AnimatedValue({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduced = useReducedMotionPref();
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value || !ref.current) return;
    if (reduced) { ref.current.textContent = format(value); return; }
    const controls = animate(from, value, {
      duration: VALUE_DURATION_S,
      ease: VALUE_EASE,
      onUpdate: (v) => { if (ref.current) ref.current.textContent = format(v); },
      onComplete: () => { if (ref.current) ref.current.textContent = format(value); },
    });
    return () => controls.stop();
  }, [value, format, reduced]);
  return <span ref={ref} className={cn('tabular-nums', className)}>{format(value)}</span>;
}

export interface StatDelta {
  /** Signed change (absolute or ratio — see `unit`). */
  value: number;
  /** 'ratio' renders value×100 with a % sign; 'count' renders the raw signed number. */
  unit?: 'ratio' | 'count' | 'usd';
  /** Compared with what ("vs last week"). */
  vs: string;
  /** Whether an increase is good — picks the status colour. Default true. */
  upIsGood?: boolean;
}

export interface StatTileProps {
  label: string;
  /** Already formatted (auto-compact in the caller: 1,284 / 12.9K / $4.2M). */
  value: string;
  /** When given, the value is rendered from this number and tweens on change (`format` renders it). */
  numericValue?: number;
  format?: (n: number) => string;
  /** Small qualifier under the value ("of 20 reviewed"). */
  hint?: string;
  delta?: StatDelta | null;
  /** 8–12 points; the last one is the current period. */
  trend?: number[];
  trendLabels?: string[];
  trendName?: string;
  trendFormat?: (v: number) => string;
  /** The trend's last point is an in-progress bucket (current week). */
  trendPartialLast?: boolean;
  /** Right-side slot for a ring / icon instead of the sparkline. */
  aside?: ReactNode;
  /** Status tone colours the value's leading rule; neutral by default. */
  tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'accent';
  onClick?: () => void;
  loading?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function deltaText(d: StatDelta): string {
  if (d.unit === 'ratio') return formatDelta(Math.round(d.value * 100), ' %');
  if (d.unit === 'usd') {
    const abs = Math.abs(d.value);
    const n = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
    return d.value === 0 ? '$0' : `${d.value > 0 ? '+' : '−'}$${n}`;
  }
  return formatDelta(d.value);
}

const TONE_RULE: Record<NonNullable<StatTileProps['tone']>, string> = {
  neutral: 'bg-border',
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  accent: 'bg-primary',
};

/**
 * Stat tile: label · value (proportional figures, semibold) · delta vs a
 * named period · 8–12 point sparkline. The number is the chart.
 */
export function StatTile({
  label, value, numericValue, format, hint, delta, trend, trendLabels, trendName, trendFormat, trendPartialLast, aside,
  tone = 'neutral', onClick, loading, className, ...rest
}: StatTileProps) {
  const dir = delta ? (delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat') : 'flat';
  const upIsGood = delta?.upIsGood ?? true;
  const good = dir === 'flat' ? null : (dir === 'up') === upIsGood;
  const deltaClass = good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-danger';
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
  const Comp: 'button' | 'div' = onClick ? 'button' : 'div';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      data-testid={rest['data-testid']}
      data-viz="stat-tile"
      className={cn(
        'relative flex w-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left',
        onClick && 'transition-shadow duration-fast hover:shadow-md',
        loading && 'animate-pulse',
        className,
      )}
      aria-busy={loading || undefined}
    >
      <span className={cn('absolute left-0 top-4 bottom-4 w-0.5 rounded-full', TONE_RULE[tone])} aria-hidden />
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[1.75rem] font-semibold leading-none tracking-tight text-foreground tabular-nums" data-viz="stat-value">
          {loading ? '\u2007' : numericValue !== undefined ? <AnimatedValue value={numericValue} format={format ?? String} /> : value}
        </div>
        {aside ? (
          <div className="shrink-0">{aside}</div>
        ) : trend && trend.length > 1 ? (
          <div className="w-[44%] max-w-[128px] shrink-0 pt-0.5">
            <Sparkline values={trend} labels={trendLabels} name={trendName ?? label} width={128} height={32} valueFormat={trendFormat} partialLast={trendPartialLast} />
          </div>
        ) : null}
      </div>
      {(hint || (delta && !loading)) && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums">
          {hint && <span className="text-muted-foreground">{hint}</span>}
          {delta && !loading && (
            <span className={deltaClass}>
              <span aria-hidden>{arrow} </span>
              <span className="font-medium">{deltaText(delta)}</span>
              <span className="text-muted-foreground"> {delta.vs}</span>
              <span className="sr-only">{dir === 'flat' ? ', unchanged' : good ? ', improving' : ', worsening'}</span>
            </span>
          )}
        </div>
      )}
    </Comp>
  );
}
