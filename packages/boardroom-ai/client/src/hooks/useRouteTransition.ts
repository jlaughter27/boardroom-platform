import { addTransitionType, startTransition, useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { useLocation, useNavigate, type NavigateOptions, type To } from 'react-router-dom';

/**
 * Route transitions (React `<ViewTransition>` in `shared/Layout.tsx`).
 *
 * React only animates a `<ViewTransition>` for async updates; react-router v7
 * already wraps every navigation (link, `navigate()`, popstate) in
 * `startTransition`, so the page root animates on its own. What the router
 * cannot know is the *direction*: forward navigation slides the new page in
 * from the right, back navigation reverses. These helpers tag the pending
 * transition with `nav-forward` / `nav-back` (`addTransitionType`); the CSS in
 * `index.css` reads the tag through `:active-view-transition-type()`.
 *
 * Browsers without `document.startViewTransition` ignore the tag and render the
 * route change instantly, exactly as before.
 */

export const NAV_FORWARD = 'nav-forward';
export const NAV_BACK = 'nav-back';
export type NavDirection = typeof NAV_FORWARD | typeof NAV_BACK;

/** react-router keeps its position in the history stack in `history.state.idx`. */
export function historyIndex(state: unknown): number | null {
  const idx = (state as { idx?: unknown } | null | undefined)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/** popstate: a lower index is the back button, a higher one the forward button. Unknown → back (by far the common case). */
export function directionFromIndex(from: number | null, to: number | null): NavDirection {
  if (from === null || to === null) return NAV_BACK;
  return to < from ? NAV_BACK : NAV_FORWARD;
}

/**
 * True for a click the router has already turned into an in-app navigation:
 * a same-origin anchor, no modifier keys, no `target` / `download`, and
 * `preventDefault()` called (react-router's `<Link>` does that for pushes).
 */
export function isRouterLinkClick(e: MouseEvent): boolean {
  if (!e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.target as Element | null;
  const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor || anchor.target || anchor.hasAttribute('download')) return false;
  return anchor.origin === window.location.origin;
}

/**
 * Render once, as a sibling *before* `<BrowserRouter>` (App.tsx), so its
 * popstate listener is registered ahead of the router's.
 *
 * React flushes the first transition it sees during a `popstate` event
 * synchronously (history moves should feel instant), and a synchronous commit
 * never starts a View Transition — so browser back would always be a hard
 * swap. That eager slot is taken once per event. Window listeners fire in
 * registration order, so this one, registered first, spends the slot on a
 * no-op update; the router's own update, scheduled by its listener next,
 * stays asynchronous and animates. If a browser ever orders listeners
 * differently, back simply swaps instantly, exactly as before.
 */
export function RouteTransitionArmer() {
  const [, claimEagerSlot] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    const onPop = () => { startTransition(() => claimEagerSlot()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return null;
}

/**
 * Mount once in the shell. Tags router link clicks as forward and popstate as
 * back / forward. Both listeners run *after* the router has scheduled its
 * transition (bubble phase for clicks; registered after the router's for
 * popstate), so the type lands on that same transition.
 */
export function useRouteTransitionTypes() {
  const location = useLocation();
  const lastIdx = useRef<number | null>(null);

  useEffect(() => {
    lastIdx.current = historyIndex(window.history.state);
  }, [location.key]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      addTransitionType(directionFromIndex(lastIdx.current, historyIndex(e.state)));
    };
    const onClick = (e: MouseEvent) => {
      if (isRouterLinkClick(e)) addTransitionType(NAV_FORWARD);
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);
}

export interface TransitionNavigateOptions extends NavigateOptions {
  /** Defaults to forward; pass `NAV_BACK` for "close" / "up" style navigation. */
  direction?: NavDirection;
}

/**
 * `navigate()` for code paths (⌘K palette, keyboard shortcuts, buttons): the
 * same route transition as a link click, tagged with a direction. A numeric
 * delta is a history move and is tagged by the popstate listener as well.
 */
export function useTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: To | number, options?: TransitionNavigateOptions) => {
      startTransition(() => {
        if (typeof to === 'number') {
          navigate(to);
          addTransitionType(to < 0 ? NAV_BACK : NAV_FORWARD);
          return;
        }
        const { direction = NAV_FORWARD, ...rest } = options ?? {};
        navigate(to, rest);
        addTransitionType(direction);
      });
    },
    [navigate],
  );
}
