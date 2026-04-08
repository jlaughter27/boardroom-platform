import { useEffect, useRef } from 'react';
import { useMotionValue, useTransform, animate, motion } from 'motion/react';

interface AnimatedCountProps {
  value: number;
  className?: string;
  duration?: number;
}

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

  return <span ref={ref} className={className}>{Math.round(value)}</span>;
}
