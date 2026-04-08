import type { ReactNode } from 'react';
import { motion } from 'motion/react';
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

function Illustration({ variant }: { variant: EmptyVariant }) {
  const color = 'var(--color-accent-primary)';
  const muted = 'var(--color-border-default)';

  const illustrations: Record<EmptyVariant, ReactNode> = {
    'no-decisions': (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="40" r="28" stroke={muted} strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M40 18C40 18 30 30 30 40c0 5.523 4.477 10 10 10s10-4.477 10-10c0-10-10-22-10-22z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="40" cy="40" r="3" fill={color} opacity="0.3" />
        <line x1="40" y1="54" x2="40" y2="62" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="36" y1="60" x2="44" y2="60" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    'no-memories': (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="20" y="22" width="40" height="36" rx="4" stroke={muted} strokeWidth="1.5" strokeDasharray="4 3" />
        <ellipse cx="40" cy="22" rx="20" ry="5" stroke={muted} strokeWidth="1.5" />
        <ellipse cx="40" cy="40" rx="20" ry="5" stroke={color} strokeWidth="1.5" opacity="0.4" />
        <circle cx="40" cy="35" r="6" stroke={color} strokeWidth="1.5" />
        <path d="M37 35h6M40 32v6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    'no-people': (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="30" r="8" stroke={color} strokeWidth="1.5" />
        <path d="M26 54c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="58" cy="32" r="5" stroke={muted} strokeWidth="1.5" strokeDasharray="3 2" />
        <circle cx="22" cy="32" r="5" stroke={muted} strokeWidth="1.5" strokeDasharray="3 2" />
        <line x1="46" y1="30" x2="53" y2="32" stroke={muted} strokeWidth="1" strokeDasharray="2 2" />
        <line x1="34" y1="30" x2="27" y2="32" stroke={muted} strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    ),
    'no-goals': (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="40" r="24" stroke={muted} strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx="40" cy="40" r="16" stroke={muted} strokeWidth="1.5" strokeDasharray="3 2" />
        <circle cx="40" cy="40" r="8" stroke={color} strokeWidth="1.5" />
        <circle cx="40" cy="40" r="2.5" fill={color} />
        <path d="M52 28l-12 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M52 28v7m0-7h-7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    'no-data': (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="18" y="24" width="44" height="32" rx="3" stroke={muted} strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M28 44h8M28 38h16M28 32h12" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        <circle cx="52" cy="36" r="3" stroke={color} strokeWidth="1.5" />
        <path d="M54.5 38.5L58 42" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    'search-empty': (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <circle cx="36" cy="36" r="14" stroke={color} strokeWidth="1.5" />
        <line x1="46" y1="46" x2="58" y2="58" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <path d="M30 36h12" stroke={muted} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="36" cy="36" r="5" stroke={muted} strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    ),
  };

  return <>{illustrations[variant]}</>;
}

export function EmptyState({ variant = 'no-data', title, description, action, className }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('flex flex-col items-center justify-center py-16 text-center', className)}
    >
      <div className="mb-5">
        <Illustration variant={variant} />
      </div>
      <h3 className="text-base font-medium text-text-primary mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-text-tertiary max-w-sm mb-6">{description}</p>
      )}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </motion.div>
  );
}
