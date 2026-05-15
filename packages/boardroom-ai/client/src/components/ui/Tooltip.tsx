import { type ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '../../lib/cn';

interface TooltipProps {
  /**
   * Tooltip body. String = single-line (no wrap by default). ReactNode = rich,
   * wrapping content with max-w-xs.
   */
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** Delay before showing in ms. Defaults to 300 (OS convention). */
  delay?: number;
  /**
   * Override max-width when content is rich. Default `16rem` (w-64).
   * Pass `null` to disable wrapping.
   */
  maxWidth?: string | null;
  /** Side of the trigger to render on. Default `top`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Force-disable the tooltip (useful for conditional wrapping). */
  disabled?: boolean;
}

/**
 * Tooltip — Radix-backed wrapper. Preserves our pre-existing API surface
 * (`content`, `delay`, `maxWidth`) on top of Radix Tooltip primitives.
 *
 * Audit refs: top-10 #4, P0 #14 — clipping/positioning was broken in the
 * hand-rolled version. Radix gives us portal, viewport-aware positioning,
 * proper ARIA, keyboard focus, and arrow rendering for free.
 *
 * Wrap your app in `<TooltipProvider>` at the root (re-exported below).
 */
export function Tooltip({
  content,
  children,
  className,
  delay = 300,
  maxWidth,
  side = 'top',
  align = 'center',
  disabled,
}: TooltipProps) {
  if (disabled || content === undefined || content === null || content === '') {
    return <>{children}</>;
  }
  const isRich = typeof content !== 'string';
  const widthStyle =
    maxWidth === null
      ? undefined
      : { maxWidth: maxWidth ?? (isRich ? '16rem' : undefined) };

  return (
    <RadixTooltip.Root delayDuration={delay}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          style={widthStyle}
          className={cn(
            'z-[var(--z-dropdown)]',
            'bg-foreground text-background',
            'text-xs px-2.5 py-1.5 rounded-md shadow-md',
            isRich ? 'text-left leading-snug' : 'whitespace-nowrap',
            className
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-foreground" width={10} height={5} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/**
 * App-level Tooltip provider — wrap once at the root.
 * Re-exported so consumers don't need to import from `@radix-ui/react-tooltip`
 * directly.
 */
export const TooltipProvider = RadixTooltip.Provider;
