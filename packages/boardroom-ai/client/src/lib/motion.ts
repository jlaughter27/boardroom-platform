import { useState, useEffect } from 'react';

export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
};

/**
 * Motion tokens — mirror the `--motion-duration-*` CSS vars in seconds for
 * Framer Motion's `transition` props. Framer expects seconds-as-number;
 * tokens.css stores ms strings for CSS consumers. Keep these two layers
 * in sync if you change either.
 *
 * `MOTION.reduced` is set automatically by the media query in tokens.css
 * (it zeroes the CSS vars under prefers-reduced-motion), but Framer runs
 * via JS rAF and won't see the CSS-var swap. Components that drive Framer
 * transitions should call `useReducedMotion()` and pass `duration: 0` when
 * reduced is true, OR consume `motionTransition()` below.
 */
export const MOTION = {
  duration: {
    fast: 0.12,
    base: 0.2,
    slow: 0.32,
  },
  ease: {
    standard: [0.4, 0, 0.2, 1] as [number, number, number, number],
    emphasized: [0.2, 0, 0, 1] as [number, number, number, number],
  },
} as const;

/** Build a Framer transition that respects prefers-reduced-motion. */
export function motionTransition(
  speed: keyof typeof MOTION.duration = 'base',
  ease: keyof typeof MOTION.ease = 'standard',
  reducedMotion = false
) {
  return {
    duration: reducedMotion ? 0 : MOTION.duration[speed],
    ease: MOTION.ease[ease],
  };
}

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

export const slideUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

export const slideIn = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
  transition: { duration: 0.2 },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.2, ease: [0.34, 1.56, 0.64, 1] },
};

export const staggerContainer = {
  animate: { transition: { staggerChildren: 0.05 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

export const pageTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.3, ease: [0, 0, 0.2, 1] },
};
