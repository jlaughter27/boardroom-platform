import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface ChartTooltipProps {
  /** Anchor, as a fraction (0..1) of the container's width / height. */
  fx: number;
  fy: number;
  children: ReactNode;
  className?: string;
}

/**
 * DOM tooltip for a chart. Positioned off the anchor, flipping to the left
 * past 60 % of the width and below the anchor in the top 30 %. `role=status`
 * so focus-driven updates are announced; the same content shows on hover and
 * keyboard focus of a mark.
 */
export function ChartTooltip({ fx, fy, children, className }: ChartTooltipProps) {
  const left = Math.max(0, Math.min(1, fx));
  const top = Math.max(0, Math.min(1, fy));
  const flipX = left > 0.6;
  const flipY = top < 0.3;
  return (
    <div
      role="status"
      aria-live="polite"
      data-viz-tooltip
      className={cn(
        'pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md',
        className,
      )}
      style={{
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        transform: `translate(${flipX ? 'calc(-100% - 12px)' : '12px'}, ${flipY ? '8px' : 'calc(-100% - 8px)'})`,
      }}
    >
      {children}
    </div>
  );
}

/** Tooltip row — value leads (strong), label follows; keyed by a short line of the series colour. */
export function TooltipRow({ color, value, label, shape = 'line' }: { color?: string; value: ReactNode; label: ReactNode; shape?: 'line' | 'dot' | 'rect' }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {color && (
        <span
          aria-hidden
          className={cn('inline-block shrink-0', shape === 'line' ? 'h-0.5 w-3 rounded' : shape === 'dot' ? 'h-2 w-2 rounded-full' : 'h-2.5 w-2.5 rounded-sm')}
          style={{ background: color }}
        />
      )}
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function TooltipTitle({ children }: { children: ReactNode }) {
  return <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{children}</div>;
}
