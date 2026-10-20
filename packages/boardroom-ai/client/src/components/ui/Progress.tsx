import { cn } from '../../lib/cn';

interface ProgressProps {
  value: number;
  className?: string;
  /** Render the percentage next to the bar (tabular figures, so it never jitters). */
  showValue?: boolean;
  /** Accessible name for the bar. */
  label?: string;
}

export function Progress({ value, className, showValue = false, label }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const bar = (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn('h-2 w-full rounded-capsule bg-muted overflow-hidden', !showValue && className)}
    >
      <div
        className="h-full rounded-capsule bg-primary transition-[width] duration-slow ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
  if (!showValue) return bar;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {bar}
      <span className="tnum shrink-0 text-xs text-muted-foreground">{Math.round(clamped)}%</span>
    </div>
  );
}
