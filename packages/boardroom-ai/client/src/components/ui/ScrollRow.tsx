import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface ScrollRowProps {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** The fade width on an edge that has more content past it. */
const FADE = '2rem';
/** A child counts as "in view" once this much of it shows (sub-pixel layout never reaches exactly 1). */
const FULLY_VISIBLE = 0.98;

/**
 * A single row that scrolls sideways inside itself — never the page. While
 * there is more content past an edge, that edge fades out (a CSS mask, so it
 * works on any background) to say "there is more"; the fade goes away once
 * scrolled to that end. Used for tab and filter rows that do not fit a phone.
 *
 * Edge state comes from an IntersectionObserver on the first and last child
 * (root = the row), not a scroll listener (ui-standards).
 */
export function ScrollRow({ children, className, 'data-testid': testId }: ScrollRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    const first = el?.firstElementChild;
    const last = el?.lastElementChild;
    if (!el || !first || !last || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      setEdges((prev) => {
        let { start, end } = prev;
        for (const e of entries) {
          const hidden = !e.isIntersecting || e.intersectionRatio < FULLY_VISIBLE;
          if (e.target === first) start = hidden;
          if (e.target === last) end = hidden;
        }
        return start === prev.start && end === prev.end ? prev : { start, end };
      });
    }, { root: el, threshold: [0, FULLY_VISIBLE, 1] });
    io.observe(first);
    if (last !== first) io.observe(last);
    return () => io.disconnect();
  }, []);

  const mask = edges.start || edges.end
    ? `linear-gradient(to right, ${edges.start ? `transparent, #000 ${FADE}` : '#000'}, ${edges.end ? `#000 calc(100% - ${FADE}), transparent` : '#000'})`
    : undefined;
  const style: CSSProperties | undefined = mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined;

  return (
    <div
      ref={ref}
      className={cn('flex min-w-0 max-w-full overflow-x-auto overscroll-x-contain scrollbar-thin', className)}
      style={style}
      data-scroll-row
      data-more-start={edges.start || undefined}
      data-more-end={edges.end || undefined}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
