import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cn } from '../../lib/cn';

interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Form field name (a hidden input is rendered). */
  name?: string;
  /** Required unless a visible `<label>` points at the switch. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  className?: string;
  /** `sm` is 28 × 16 for dense rows; `md` (default) is 36 × 20. */
  size?: 'sm' | 'md';
}

const TRACK = {
  sm: 'h-4 w-7',
  md: 'h-5 w-9',
} as const;

const THUMB = {
  sm: 'h-3 w-3 data-[checked]:translate-x-3',
  md: 'h-4 w-4 data-[checked]:translate-x-4',
} as const;

/**
 * On/off switch on Base UI (`role="switch"`, Space toggles, native hidden
 * input for forms). The thumb slides in 120 ms on --ease-out — a toggle is a
 * frequent action, so it moves fast and never bounces; the track colour
 * transitions with it.
 */
export function Switch({ checked, defaultChecked, onChange, disabled, name, id, className, size = 'md', ...aria }: SwitchProps) {
  return (
    <BaseSwitch.Root
      id={id}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(next) => onChange?.(next)}
      disabled={disabled}
      name={name}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      className={cn(
        'group relative inline-flex shrink-0 cursor-pointer items-center rounded-capsule p-0.5',
        'bg-muted-foreground/35 shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/0.12)]',
        'transition-[background-color,box-shadow] duration-fast ease-out',
        'data-[checked]:bg-primary data-[checked]:shadow-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        TRACK[size],
        className,
      )}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block rounded-capsule bg-white shadow-sm translate-x-0',
          'transition-transform duration-fast ease-out',
          THUMB[size],
        )}
      />
    </BaseSwitch.Root>
  );
}
