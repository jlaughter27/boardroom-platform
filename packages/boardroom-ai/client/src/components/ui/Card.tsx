import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * 0 — flat content card (default; the old look).
 * 1–3 — one step up the elevation ladder each: lighter surface in dark mode,
 * a bigger shadow in light mode. Use 1 for raised tiles, 2 for popovers, 3 for sheets.
 */
export type CardElevation = 0 | 1 | 2 | 3;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  elevation?: CardElevation;
  children: ReactNode;
}

const ELEVATION: Record<CardElevation, string> = {
  0: 'bg-card',
  1: 'bg-surface-1 shadow-sm',
  2: 'bg-surface-2 shadow-md',
  3: 'bg-surface-3 shadow-lg',
};

/** Tailwind `p-*` → rem, so `.concentric` children can derive their radius from ours. */
const PADDING: Record<string, string> = {
  'p-0': '0px', 'p-1': '0.25rem', 'p-2': '0.5rem', 'p-3': '0.75rem', 'p-4': '1rem',
  'p-5': '1.25rem', 'p-6': '1.5rem', 'p-8': '2rem', 'p-10': '2.5rem',
};

function paddingOf(className?: string): string {
  const match = className?.match(/(?:^|\s)(p-(?:0|1|2|3|4|5|6|8|10))(?=\s|$)/);
  return match ? PADDING[match[1]] : '1rem';
}

export function Card({ children, className, hover = false, elevation = 0, style, ...props }: CardProps) {
  // Published for `.concentric` children (see index.css): inner radius = ours − our padding.
  const vars = {
    '--parent-radius': 'var(--radius-xl)',
    '--parent-pad': paddingOf(className),
    ...style,
  } as CSSProperties;
  return (
    <div
      className={cn(
        'rounded-xl border border-border p-4',
        ELEVATION[elevation],
        // Hover is a shadow step and a hairline darken — the card never moves.
        hover && 'cursor-pointer transition-[box-shadow,border-color] duration-normal ease-out hover:border-hairline-strong hover:shadow-md',
        className
      )}
      style={vars}
      {...props}
    >
      {children}
    </div>
  );
}

function CardHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-3 flex items-center justify-between', className)} {...props}>
      {children}
    </div>
  );
}

function CardBody({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('', className)} {...props}>
      {children}
    </div>
  );
}

function CardFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-3 flex items-center gap-2 border-t border-border pt-3', className)} {...props}>
      {children}
    </div>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
