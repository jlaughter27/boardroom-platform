import { useCallback, useState, type FocusEvent, type KeyboardEvent } from 'react';

const STEP: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Roving tabindex for a toolbar / chip group (WAI-ARIA APG "toolbar"): the
 * group is ONE tab stop; Arrow keys (wrapping), Home and End move focus
 * between its items. Put `onKeyDown` on the container (role="toolbar") and
 * spread `itemProps(i)` on each item, in DOM order.
 */
export function useRovingTabIndex(count: number) {
  const [active, setActive] = useState(0);
  const current = count > 0 ? Math.min(active, count - 1) : 0;

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (count === 0) return;
    let next: number | null = null;
    if (e.key in STEP) next = (current + STEP[e.key] + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    // Handled here: an ancestor's key handler (the graph canvas pans on arrows) must not also act.
    e.stopPropagation();
    setActive(next);
    e.currentTarget.querySelectorAll<HTMLElement>('[data-roving-item]')[next]?.focus();
  }, [count, current]);

  const itemProps = useCallback((i: number) => ({
    tabIndex: i === current ? 0 : -1,
    'data-roving-item': '',
    onFocus: (_e: FocusEvent<HTMLElement>) => setActive(i),
  }), [current]);

  return { onKeyDown, itemProps };
}
