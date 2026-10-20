import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cn } from '../../lib/cn';

interface SliderProps {
  value: number;
  onChange?: (value: number) => void;
  /** Fires once per gesture, on release / key-up — for persisting. */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  /** Arrow-key step (default 0.01); Page Up/Down and Shift+arrow move `largeStep`. */
  step?: number;
  largeStep?: number;
  disabled?: boolean;
  /** Formats the value for the drag bubble and `aria-valuetext`. */
  format?: (value: number) => string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  name?: string;
  className?: string;
}

/**
 * Single-thumb slider on Base UI: pointer drag, arrow / Page / Home / End
 * keys, a native hidden input. The track fills gold up to the thumb; a value
 * bubble appears above the thumb only while dragging (120 ms ease-out), so
 * the row stays quiet at rest and the numeric readout next to it (`tnum`)
 * remains the source of truth.
 */
export function Slider({
  value, onChange, onCommit, min = 0, max = 1, step = 0.01, largeStep, disabled, format,
  id, name, className, ...aria
}: SliderProps) {
  const fmt = format ?? ((v: number) => String(v));
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(next) => onChange?.(next as number)}
      onValueCommitted={(next) => onCommit?.(next as number)}
      min={min}
      max={max}
      step={step}
      largeStep={largeStep ?? step * 10}
      disabled={disabled}
      name={name}
      className={cn('group relative flex w-full touch-none select-none items-center py-2', className)}
    >
      <BaseSlider.Control className="flex h-5 w-full items-center">
        <BaseSlider.Track className="relative h-1.5 w-full rounded-capsule bg-muted shadow-[inset_0_1px_1px_hsl(var(--shadow-color)/0.08)]">
          <BaseSlider.Indicator className="absolute inset-y-0 rounded-capsule bg-primary" />
          <BaseSlider.Thumb
            id={id}
            aria-label={aria['aria-label']}
            aria-labelledby={aria['aria-labelledby']}
            getAriaValueText={(_formatted, v) => fmt(v)}
            className={cn(
              'relative block h-5 w-5 rounded-capsule bg-card shadow-md ring-1 ring-hairline-strong',
              'transition-[transform,box-shadow] duration-fast ease-out',
              'data-[dragging]:scale-110 data-[dragging]:shadow-lg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'data-[disabled]:opacity-50',
            )}
          >
            {/* Value bubble: only while the thumb is being dragged. */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-control bg-surface-3 px-2 py-0.5',
                'text-xs tnum text-foreground shadow-md ring-1 ring-hairline',
                'opacity-0 scale-95 transition-[opacity,transform] duration-fast ease-out',
                'group-data-[dragging]:opacity-100 group-data-[dragging]:scale-100',
              )}
            >
              {fmt(value)}
            </span>
          </BaseSlider.Thumb>
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
