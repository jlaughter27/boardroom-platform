/**
 * M7 — the guarded fallback for memory content the markdown parser cannot
 * handle in reasonable time (very large, or long runs / dense piles of
 * markdown delimiters; see `markdownRenderGuard`). Plain pre-wrapped text: no
 * parse, no HTML, one text node. MemoryDetail renders it only when the guard
 * says so; everything else goes through MemoryMarkdown.
 */
export function MemoryPlainText({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className} data-testid="memory-plain-content">
      <p className="mb-1 text-xs text-muted-foreground">Shown as plain text (very large or unusual formatting).</p>
      <div className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{content}</div>
    </div>
  );
}
