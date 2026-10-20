import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

interface EmptyStateProps {
  /** A Lucide icon element (preferred) or a short glyph string. */
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <span
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-capsule border border-dashed border-border text-muted-foreground [&>svg]:size-6"
          aria-hidden="true"
        >
          {typeof icon === 'string' ? <span className="text-2xl">{icon}</span> : icon}
        </span>
      )}
      <h3 className="text-lg font-medium text-muted-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-muted-foreground text-sm max-w-sm mb-6">{description}</p>
      )}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
