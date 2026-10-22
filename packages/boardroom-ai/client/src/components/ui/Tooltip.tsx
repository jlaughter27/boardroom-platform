import type { ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cn } from '../../lib/cn';
import { POPUP_MOTION } from './popup-motion';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  side?: TooltipSide;
  align?: 'start' | 'center' | 'end';
  /** Hover intent, in ms. */
  delay?: number;
}

/**
 * Mount once near the app root. Tooltips opened within `timeout` ms of another
 * closing skip the open delay, so moving across a toolbar feels instant.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={300} closeDelay={0} timeout={400}>
      {children}
    </BaseTooltip.Provider>
  );
}

/**
 * Hover/focus label. 300 ms open delay, none when moving between siblings;
 * scales 0.96 → 1 in 140 ms from the side it opened on (`--transform-origin`).
 */
export function Tooltip({ content, children, className, side = 'top', align = 'center', delay = 300 }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        delay={delay}
        closeDelay={0}
        render={<span className={cn('inline-flex', className)} />}
      >
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={6} className="z-dropdown">
          <BaseTooltip.Popup
            className={cn(
              POPUP_MOTION,
              'rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md whitespace-nowrap'
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
