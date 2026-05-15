import { useEffect, useRef } from 'react';
import { useMotionValue, useTransform, animate } from 'motion/react';
import { cn } from '../../lib/cn';

interface AnimatedCountProps {
  value: number;
  className?: string;
  duration?: number;
}

/**
 * AnimatedCount — counts up to `value` over `duration` seconds.
 * Numeric output uses `tabular-nums` so digit widths stay constant as values
 * cross 1->10->100->1000 (audit ID top-10 #7).
 */
export function AnimatedCount({ value, className, duration = 0.5 }: AnimatedCountProps) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, { duration });
    return () => controls.stop();
  }, [value, motionValue, duration]);

  useEffect(() => {
    const unsubscribe = rounded.on('change', (v) => {
      if (ref.current) ref.current.textContent = String(v);
    });
    return unsubscribe;
  }, [rounded]);

  return <span ref={ref} className={cn('tabular-nums', className)}>{Math.round(value)}</span>;
}
