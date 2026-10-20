import { useEffect, useState, type RefObject } from 'react';

/**
 * "Has this scroll container scrolled away from the top?" without a scroll
 * listener: a 1 px sentinel sits at the very top of the container and an
 * `IntersectionObserver` reports when it leaves view. The header uses it to
 * draw its hairline and read the page behind it only once content is
 * underneath (`data-scrolled`), with no per-frame work on the main thread.
 *
 * `root` is the scrolling element; `sentinel` is its first child.
 */
export function useScrolledSentinel(
  root: RefObject<HTMLElement | null>,
  sentinel: RefObject<HTMLElement | null>,
): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry) setScrolled(!entry.isIntersecting); },
      { root: root.current ?? null, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [root, sentinel]);

  return scrolled;
}
