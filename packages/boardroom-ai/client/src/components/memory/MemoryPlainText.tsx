import { Fragment, useMemo } from 'react';
import { softBreakSegments } from '../../lib/markdown';

/**
 * M7 — the guarded fallback for memory content the markdown parser cannot
 * handle in reasonable time (very large, or long runs / dense piles of
 * markdown delimiters; see `markdownRenderGuard`). Plain pre-wrapped text: no
 * parse, no HTML, one text node. MemoryDetail renders it only when the guard
 * says so; everything else goes through MemoryMarkdown.
 *
 * Lane F — a long unbroken token (a pasted 100 KB hex dump) spent ~11 s in
 * Layout: the browser shaped one giant line-break candidate. Each unbroken run
 * gets a `<wbr>` every 200 characters (display only; textContent and copy are
 * unchanged), and `overflow-wrap: anywhere` + `min-w-0` keep the min-content
 * width from forcing the flex / grid parents wide.
 */
export function MemoryPlainText({ content, className }: { content: string; className?: string }) {
  const segments = useMemo(() => softBreakSegments(content), [content]);
  return (
    <div className={className ? `min-w-0 ${className}` : 'min-w-0'} data-testid="memory-plain-content">
      <p className="mb-1 text-xs text-muted-foreground">Shown as plain text (very large or unusual formatting).</p>
      <div
        className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-foreground"
        data-testid="memory-plain-body"
      >
        {segments.length === 1
          ? content
          : segments.map((seg, i) => (
              // Index keys are stable here: the segments are derived from `content` alone.
              <Fragment key={i}>
                {i > 0 && <wbr />}
                {seg}
              </Fragment>
            ))}
      </div>
    </div>
  );
}
