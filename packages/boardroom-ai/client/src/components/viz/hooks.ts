import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readChartTheme, isDarkMode, type ChartTheme } from './theme';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The chart theme for the active app theme. Re-reads the tokens whenever the
 * `dark` class on <html> flips (the ui.store toggles it).
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(() => readChartTheme());
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const root = document.documentElement;
    let mode = isDarkMode();
    const obs = new MutationObserver(() => {
      const next = isDarkMode();
      if (next !== mode) { mode = next; setTheme(readChartTheme(next ? 'dark' : 'light')); }
    });
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/**
 * Container width via ResizeObserver. `fallback` is used before the first
 * measurement (and under jsdom, whose ResizeObserver is a stub).
 */
export function useMeasure<T extends HTMLElement = HTMLDivElement>(fallback = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** `prefers-reduced-motion: reduce` — charts drop transitions when true. */
export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(Boolean(mq.matches));
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}

export interface TooltipState<T> {
  /** Anchor in container px */
  x: number;
  y: number;
  data: T;
}

/** Shared hover/focus state for a chart's tooltip. */
export function useTooltip<T>() {
  const [tip, setTip] = useState<TooltipState<T> | null>(null);
  const show = useCallback((x: number, y: number, data: T) => setTip({ x, y, data }), []);
  const hide = useCallback(() => setTip(null), []);
  return useMemo(() => ({ tip, show, hide }), [tip, show, hide]);
}

/** Pointer position inside an SVG, in viewBox units. */
export function svgPoint(e: { clientX: number; clientY: number; currentTarget: SVGSVGElement }, vbWidth: number, vbHeight: number): { x: number; y: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  const sx = rect.width > 0 ? vbWidth / rect.width : 1;
  const sy = rect.height > 0 ? vbHeight / rect.height : 1;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}
