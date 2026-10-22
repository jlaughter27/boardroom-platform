import type { ComponentType } from 'react';
import { Database, Inbox, Scale, SearchX, Target, Users, type LucideProps } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/cn';

type EmptyVariant = 'no-decisions' | 'no-memories' | 'no-people' | 'no-goals' | 'no-data' | 'search-empty';

interface EmptyStateProps {
  variant?: EmptyVariant;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

const GLYPH: Record<EmptyVariant, ComponentType<LucideProps>> = {
  'no-decisions': Scale,
  'no-memories': Database,
  'no-people': Users,
  'no-goals': Target,
  'no-data': Inbox,
  'search-empty': SearchX,
};

/**
 * A quiet stage for an empty collection: a dashed ring (CSS, no inline SVG)
 * with one Lucide glyph at the same stroke weight as the rest of the app, and
 * a faint brand halo so the page never feels like an error.
 */
function Illustration({ variant }: { variant: EmptyVariant }) {
  const Glyph = GLYPH[variant];
  return (
    <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden="true">
      <span className="absolute inset-0 rounded-capsule border border-dashed border-border" />
      <span className="absolute inset-3 rounded-capsule bg-primary/[0.06]" />
      <Glyph size={28} strokeWidth={1.5} className="relative text-primary" />
    </div>
  );
}

export function EmptyState({ variant = 'no-data', title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center py-16 text-center animate-fade-in', className)}
    >
      <div className="mb-5">
        <Illustration variant={variant} />
      </div>
      <h3 className="text-base font-medium text-foreground mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      )}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
