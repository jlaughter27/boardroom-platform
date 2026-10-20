import type { ReactElement, ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { cn } from '../../lib/cn';
import { POPUP_MOTION, POPUP_SURFACE } from './popup-motion';

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';

interface PopoverProps {
  /** The element that opens the popover; it receives the trigger props and ref (e.g. a `<Button>`). */
  trigger: ReactElement;
  children: ReactNode;
  /** Optional heading, wired to `aria-labelledby`. */
  title?: ReactNode;
  side?: PopoverSide;
  align?: PopoverAlign;
  sideOffset?: number;
  className?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Anchored, origin-aware popover on Base UI. Focus moves in on open and back
 * to the trigger on close; Escape and outside press dismiss. Same 140 ms
 * ease-out recipe as tooltips and menus.
 */
export function Popover({ trigger, children, title, side = 'bottom', align = 'center', sideOffset = 6, className, open, defaultOpen, onOpenChange }: PopoverProps) {
  return (
    <BasePopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={(next) => onOpenChange?.(next)}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-dropdown">
          <BasePopover.Popup className={cn(POPUP_MOTION, POPUP_SURFACE, 'w-72 max-w-[calc(100vw-2rem)] p-4', className)}>
            {title && (
              <BasePopover.Title className="mb-1.5 text-sm font-semibold tracking-title text-foreground">{title}</BasePopover.Title>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
