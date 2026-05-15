import { cn } from '../../lib/cn';

interface ProgressProps {
  value: number;
  /** Optional accessible label. Defaults to `Progress`. */
  label?: string;
  /** Optional max — defaults to 100. */
  max?: number;
  className?: string;
}

/**
 * Progress — semantic progress bar with `role="progressbar"` and the trio of
 * aria-valuenow/min/max for SR announcement (audit P0 #17).
 */
export function Progress({ value, label = 'Progress', max = 100, className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(max, value));
  const pct = (clamped / max) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('h-2 w-full rounded-full bg-muted overflow-hidden', className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-all duration-normal"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
