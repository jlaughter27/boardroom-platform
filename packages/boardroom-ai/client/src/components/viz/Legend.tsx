import { cn } from '../../lib/cn';

export type LegendShape = 'rect' | 'line' | 'dot' | 'ring';

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  /** Mirrors the mark: rect for bars/areas, line for lines, dot for markers. */
  shape?: LegendShape;
  /** Optional trailing value (e.g. a total or a Brier score). */
  value?: string;
  /** Dimmed (filtered out / zero). */
  muted?: boolean;
}

export interface LegendProps {
  items: LegendItem[];
  className?: string;
  /** Called with the hovered/focused item id (or null) so the chart can emphasise it. */
  onHover?: (id: string | null) => void;
  'aria-label'?: string;
}

function Swatch({ color, shape }: { color: string; shape: LegendShape }) {
  if (shape === 'line') return <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />;
  if (shape === 'dot') return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: '0 0 0 2px var(--color-card)' }} />;
  if (shape === 'ring') return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: color }} />;
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />;
}

/**
 * Always present for ≥ 2 series (identity is never colour-alone). Text wears
 * text tokens; the swatch beside it carries the colour.
 */
export function Legend({ items, className, onHover, ...rest }: LegendProps) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs', className)} aria-label={rest['aria-label'] ?? 'Series'} data-viz-legend>
      {items.map((it) => (
        <li
          key={it.id}
          className={cn('inline-flex items-center gap-1.5 text-foreground', it.muted && 'opacity-50')}
          onMouseEnter={onHover ? () => onHover(it.id) : undefined}
          onMouseLeave={onHover ? () => onHover(null) : undefined}
          onFocus={onHover ? () => onHover(it.id) : undefined}
          onBlur={onHover ? () => onHover(null) : undefined}
          tabIndex={onHover ? 0 : undefined}
        >
          <Swatch color={it.color} shape={it.shape ?? 'rect'} />
          <span>{it.label}</span>
          {it.value !== undefined && <span className="text-muted-foreground tabular-nums">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}
