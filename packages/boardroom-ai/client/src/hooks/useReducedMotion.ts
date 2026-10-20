import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function read(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY)?.matches ?? false;
}

/**
 * `prefers-reduced-motion`, kept in sync with the OS setting (the media query
 * is re-subscribed, so flipping the preference while a page is open takes
 * effect without a reload).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setReduced(e.matches);
    setReduced(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14
    const legacy = mql as unknown as { addListener?: (cb: (e: MediaQueryListEvent) => void) => void; removeListener?: (cb: (e: MediaQueryListEvent) => void) => void };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);
  return reduced;
}
