import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PageHeaderProps {
  title: ReactNode;
  /** One muted line under the title. */
  subtitle?: ReactNode;
  /** Right-hand controls; they share the title's centre line. */
  actions?: ReactNode;
  /** Warm-gold accent bar before the title (the dashboard greeting). */
  accent?: boolean;
  /** Centre the title block (single-purpose pages like "New Decision"). */
  align?: 'start' | 'center';
  /** `h1` for the page title (default); `h2` when the page already has one. */
  as?: 'h1' | 'h2';
  /** Extra props for the title element — e.g. `data-testid`. */
  titleProps?: Record<string, string | undefined>;
  className?: string;
}

/**
 * The one page header: Large-Title weight (`text-3xl`, display tracking,
 * balanced wrapping), a muted subtitle, and 24 px of air before the content.
 * Actions sit on the title row and drop under it on narrow viewports so the
 * title always keeps the full width.
 */
export function PageHeader({ title, subtitle, actions, accent = false, align = 'start', as: Tag = 'h1', titleProps, className }: PageHeaderProps) {
  const centered = align === 'center';
  return (
    <header
      className={cn(
        'mb-6 flex flex-col gap-3',
        centered ? 'items-center text-center' : 'sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-3', centered && 'justify-center')}>
        {accent && (
          <span className="h-10 w-1 shrink-0 rounded-capsule bg-gradient-to-b from-primary to-primary-warm" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <Tag className="text-balance text-3xl font-semibold tracking-display text-foreground" {...titleProps}>
            {title}
          </Tag>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className={cn('flex shrink-0 items-center gap-2', centered ? 'justify-center' : 'self-start sm:self-auto')}>{actions}</div>}
    </header>
  );
}
