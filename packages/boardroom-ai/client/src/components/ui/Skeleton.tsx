import { cn } from '../../lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-md skeleton-shimmer', className)}
      aria-hidden="true"
    />
  );
}
