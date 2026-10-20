import { useEffect, useRef } from 'react';
import { useMotionValue, useTransform, animate } from 'motion/react';
import { springs } from '../../lib/motion';
import { cn } from '../../lib/cn';

interface AnimatedCountProps {
  value: number;
  className?: string;
  /** Tween duration in seconds. When omitted the count rides the default spring. */
  duration?: number;
}

/**
 * A number that counts to its new value. Digits are tabular (`.tnum`) so the
 * readout never jitters sideways while it animates.
 */
export function AnimatedCount({ value, className, duration }: AnimatedCountProps) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, duration === undefined ? springs.default : { duration });
    return () => controls.stop();
  }, [value, motionValue, duration]);

  useEffect(() => {
    const unsubscribe = rounded.on('change', (v) => {
      if (ref.current) ref.current.textContent = String(v);
    });
    return unsubscribe;
  }, [rounded]);

  return <span ref={ref} className={cn('tnum', className)}>{Math.round(value)}</span>;
}
