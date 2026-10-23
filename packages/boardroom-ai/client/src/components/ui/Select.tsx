import { type ReactNode } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { POPUP_MOTION, POPUP_SURFACE } from './popup-motion';

interface Option {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SelectProps {
  options: Option[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Form field name (a hidden input is rendered). */
  name?: string;
  /** `md` (default) is the 36 px form control; `sm` is a 28 px control for dense rows and toolbars. */
  size?: 'sm' | 'md';
  /** Id on the trigger, so a visible `<label htmlFor>` can point at it. */
  id?: string;
  /** Native tooltip on the trigger (e.g. why a control is disabled). */
  title?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

const TRIGGER_SIZE = {
  sm: 'h-7 px-2 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3 text-sm gap-2 rounded-control',
} as const;

/**
 * Single-value select on Base UI: typeahead, arrow keys, home/end and a
 * native hidden input for forms. The popup opens 0.96 → 1 in 140 ms from the
 * trigger and never overlaps it.
 */
export function Select({
  options, value, onChange, placeholder = 'Select...', className, disabled, name, size = 'md', id, title,
  'aria-label': ariaLabel, 'data-testid': testId,
}: SelectProps) {
  const items = options.map((o) => ({ label: o.label, value: o.value }));
  return (
    <BaseSelect.Root<string | null>
      items={items}
      value={value ?? null}
      onValueChange={(next) => { if (typeof next === 'string') onChange?.(next); }}
      disabled={disabled}
      name={name}
    >
      <BaseSelect.Trigger
        id={id}
        title={title}
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn(
          'group flex w-full items-center justify-between border border-border bg-card text-foreground',
          TRIGGER_SIZE[size],
          'transition-[border-color,box-shadow,background-color] duration-fast ease-out',
          'hover:border-hairline-strong data-[popup-open]:border-primary/40 data-[popup-open]:ring-2 data-[popup-open]:ring-ring',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/40',
          'data-[placeholder]:text-muted-foreground data-[disabled]:opacity-50 data-[disabled]:pointer-events-none',
          className
        )}
      >
        <BaseSelect.Value placeholder={placeholder} className="flex min-w-0 items-center gap-2 truncate">
          {(current: string | null) => {
            const selected = options.find((o) => o.value === current);
            return selected ? <>{selected.icon}<span className="truncate">{selected.label}</span></> : placeholder;
          }}
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown
            size={size === 'sm' ? 14 : 16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="transition-transform duration-fast ease-out group-data-[popup-open]:rotate-180"
          />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-dropdown outline-none">
          <BaseSelect.Popup
            className={cn(
              POPUP_MOTION,
              POPUP_SURFACE,
              'min-w-[var(--anchor-width)] max-h-[min(20rem,var(--available-height))] overflow-y-auto p-1'
            )}
          >
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  className={cn(
                    'flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground outline-none',
                    size === 'sm' && 'py-1 text-xs',
                    'data-[highlighted]:bg-muted data-[selected]:text-primary-text data-[disabled]:opacity-50'
                  )}
                >
                  {option.icon}
                  <BaseSelect.ItemText className="truncate">{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="ml-auto flex shrink-0 text-primary">
                    <Check size={14} strokeWidth={2} aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
