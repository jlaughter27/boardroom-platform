import { useState, useEffect } from 'react';
import type { Transition } from 'motion/react';

/**
 * Motion foundation — the numbers behind "feels like a native app".
 *
 * Rules (docs/02-reference/UI-FOUNDATION.md):
 *  - Enter/exit use `EASE_OUT`; on-screen movement uses `EASE_IN_OUT`; sheets
 *    use `EASE_SHEET`. Nothing on the UI layer eases in.
 *  - UI durations stay under 300 ms. Keyboard-driven and very frequent actions
 *    get no animation at all.
 *  - Entrances never start below scale 0.9; `scaleIn` is 0.96 → 1 with no overshoot.
 *  - Springs are critically damped (bounce 0) except `snappy` (0.08) and drag
 *    release, which passes the gesture velocity to `springs.gesture`.
 */

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

/** `cubic-bezier(0.23, 1, 0.32, 1)` — enter / exit. Mirrors `--ease-out`. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** `cubic-bezier(0.77, 0, 0.175, 1)` — reorder / resize while on screen. Mirrors `--ease-in-out`. */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
/** `cubic-bezier(0.32, 0.72, 0, 1)` — drawers and sheets. Mirrors `--ease-sheet`. */
export const EASE_SHEET = [0.32, 0.72, 0, 1] as const;

/** Seconds, matching the `--duration-*` tokens. */
export const DURATION = {
  instant: 0,
  fast: 0.12,
  normal: 0.18,
  slow: 0.24,
  sheet: 0.32,
} as const;

/** Apple's spring parameters expressed in Motion's own terms. */
export const springs = {
  /** The platform default: response 0.55 s, critically damped. */
  default: { type: 'spring', visualDuration: 0.55, bounce: 0 },
  /** Menus, popovers, toasts, segmented indicators. */
  snappy: { type: 'spring', visualDuration: 0.28, bounce: 0.08 },
  /** Sheets and drawers (pairs with `--ease-sheet` on CSS-only paths). */
  sheet: { type: 'spring', visualDuration: 0.42, bounce: 0 },
  /** Drag release only — pass `velocity` from the gesture. */
  gesture: { type: 'spring', stiffness: 400, damping: 36, mass: 1 },
} as const satisfies Record<string, Transition>;

/** A transition that does nothing — for keyboard-driven changes. */
export const instant = { duration: 0 } as const satisfies Transition;

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.normal, ease: EASE_OUT },
};

export const slideUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: DURATION.normal, ease: EASE_OUT },
};

export const slideIn = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 8 },
  transition: { duration: DURATION.normal, ease: EASE_OUT },
};

/** 0.96 → 1, no overshoot. Exit stays close to rest so it never "shrinks away". */
export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: { duration: DURATION.normal, ease: EASE_OUT },
};

export const staggerContainer = {
  animate: { transition: { staggerChildren: 0.05 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

/** Route change: 180 ms ease-out, 4 px travel. */
export const pageTransition = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: DURATION.normal, ease: EASE_OUT },
};
