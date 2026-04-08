import { motion } from 'motion/react';
import { cn } from '../../lib/cn';

interface ProgressProps {
  value: number;
  className?: string;
}

export function Progress({ value, className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full rounded-full bg-bg-hover overflow-hidden', className)}>
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-secondary"
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        style={{
          boxShadow: clamped > 0 ? '0 0 8px rgba(99, 102, 241, 0.4)' : 'none',
        }}
      />
    </div>
  );
}
