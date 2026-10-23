import { createContext, memo, useContext, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/cn';
import { WIKILINK_PROPS, remarkWikilinks, type ResolvedWikilink } from '../../lib/markdown';

interface MemoryMarkdownProps {
  content: string;
  /** Resolves a `[[wikilink]]` target (note name) to a memory, or null when it was not imported. */
  resolve?: (target: string) => ResolvedWikilink | null;
  /** Opens a memory in the explorer (same as clicking its card). */
  onOpen?: (memoryId: string) => void;
  className?: string;
}

/**
 * Sanitizing markdown renderer for memory content (RD-1).
 *
 * react-markdown builds React elements from the syntax tree — no HTML string
 * is ever injected and no raw-HTML rehype plugin is loaded (ui-standards
 * enforces both), so raw HTML in a note is shown as text, never parsed;
 * `javascript:` and other unsafe URLs are blanked by react-markdown's default
 * `urlTransform`. remark-gfm adds tables, task lists,
 * strikethrough and autolinks; `remarkWikilinks` turns `[[…]]` into in-app links.
 */
const PLUGINS = [remarkGfm, remarkWikilinks];

const LINK_CLASS =
  'rounded-sm font-medium text-info underline decoration-info/40 underline-offset-2 hover:decoration-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
const SCROLL_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

/**
 * CSS-only scroll shadows for wide tables: an edge shade appears on the side
 * that has more columns (the card-coloured covers scroll with the content and
 * hide the shade at either end). Theme-aware through the colour tokens.
 */
const SHADE = 'color-mix(in srgb, var(--color-foreground) 20%, transparent)';
const SCROLL_SHADOWS: CSSProperties = {
  background: [
    'linear-gradient(to right, var(--color-card) 40%, transparent) left center / 2.5rem 100% no-repeat local',
    'linear-gradient(to left, var(--color-card) 40%, transparent) right center / 2.5rem 100% no-repeat local',
    `radial-gradient(farthest-side at 0 50%, ${SHADE}, transparent) left center / 0.75rem 100% no-repeat scroll`,
    `radial-gradient(farthest-side at 100% 50%, ${SHADE}, transparent) right center / 0.75rem 100% no-repeat scroll`,
    'var(--color-card)',
  ].join(', '),
};

/** Plain text of a hast node (for sizing table cells). */
function hastText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | undefined;
  if (!n) return '';
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(hastText).join('');
}

/** Cells up to this many characters stay on one line; longer prose wraps at a readable width. */
const SHORT_CELL = 32;

/** A relative `.md` href (`[label](Other%20Note.md)`) — Obsidian's markdown-style internal link. */
function internalNoteTarget(href: string | undefined): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return null;
  const path = href.split('#')[0];
  if (!/\.md$/i.test(path)) return null;
  try { return decodeURIComponent(path); } catch { return path; }
}

/**
 * Resolver + opener reach the anchors through context so the `components` map
 * stays module-level: a new resolver (e.g. once a link target is fetched)
 * re-renders the links in place instead of remounting them.
 */
const WikilinkContext = createContext<Pick<MemoryMarkdownProps, 'resolve' | 'onOpen'>>({});

function WikiLink({ target, children, heading }: { target: string; children: ReactNode; heading?: string }) {
  const { resolve, onOpen } = useContext(WikilinkContext);
  const hit = target && resolve ? resolve(target) : null;
  if (hit && onOpen) {
    const open = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      onOpen(hit.id);
    };
    return (
      <a
        href={`#memory-${encodeURIComponent(hit.id)}`}
        onClick={open}
        className={LINK_CLASS}
        title={heading ? `${hit.title} › ${heading}` : hit.title}
        data-testid="wikilink"
        data-resolved="true"
        data-memory-id={hit.id}
      >
        {children}
      </a>
    );
  }
  // A native `title` tooltip: the ui/Tooltip hover machinery would add ~27 kB to
  // the initial chunk for one muted label. Screen readers get the sr-only text.
  return (
    <span
      title="Not imported"
      className="cursor-help text-muted-foreground decoration-muted-foreground decoration-dotted underline-offset-2 hover:underline"
      data-testid="wikilink"
      data-resolved="false"
    >
      {children}
      <span className="sr-only"> (not imported)</span>
    </span>
  );
}

const COMPONENTS: Components = {
  // Note headings sit under the detail panel's own title (h2): shift them down.
  h1: ({ node: _n, ...p }) => <h3 className="mt-4 mb-2 text-base font-semibold text-foreground" {...p} />,
  h2: ({ node: _n, ...p }) => <h4 className="mt-4 mb-2 text-sm font-semibold text-foreground" {...p} />,
  h3: ({ node: _n, ...p }) => <h5 className="mt-3 mb-1.5 text-sm font-semibold text-foreground" {...p} />,
  h4: ({ node: _n, ...p }) => <h6 className="mt-3 mb-1 text-sm font-medium text-foreground" {...p} />,
  h5: ({ node: _n, ...p }) => <h6 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" {...p} />,
  h6: ({ node: _n, ...p }) => <h6 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" {...p} />,
  p: ({ node: _n, ...p }) => <p className="my-2" {...p} />,
  strong: ({ node: _n, ...p }) => <strong className="font-semibold text-foreground" {...p} />,
  ul: ({ node: _n, className: c, ...p }) => (
    <ul className={cn('my-2 space-y-1', c?.includes('contains-task-list') ? 'list-none pl-1' : 'list-disc pl-5 marker:text-muted-foreground')} {...p} />
  ),
  ol: ({ node: _n, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground" {...p} />,
  li: ({ node: _n, className: c, ...p }) => <li className={cn('pl-0.5', c?.includes('task-list-item') && 'flex items-start gap-2')} {...p} />,
  // GFM task-list boxes are read-only here: show the state, not a dead form control.
  input: ({ node: _n, type, checked }) => (type === 'checkbox'
    ? (
      <span
        role="img"
        aria-label={checked ? 'Done' : 'Not done'}
        className={cn(
          'mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none',
          checked ? 'border-success/60 bg-success-muted text-success' : 'border-border bg-card',
        )}
      >
        {checked ? '✓' : ''}
      </span>
    )
    : null),
  blockquote: ({ node: _n, ...p }) => <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground" {...p} />,
  hr: () => <hr className="my-4 border-border" />,
  pre: ({ node: _n, ...p }) => (
    <pre
      tabIndex={0}
      className={cn(
        'my-3 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground',
        '[&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[inherit]',
        SCROLL_FOCUS,
      )}
      {...p}
    />
  ),
  code: ({ node: _n, className: c, ...p }) => (
    <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground', c)} {...p} />
  ),
  // Wide tables scroll inside the panel, never the page.
  table: ({ node: _n, ...p }) => (
    <div
      role="region"
      aria-label="Table"
      tabIndex={0}
      data-testid="markdown-table-scroll"
      className={cn('my-3 max-w-full overflow-x-auto rounded-md border border-border', SCROLL_FOCUS)}
      style={SCROLL_SHADOWS}
    >
      <table className="min-w-full border-collapse text-xs" {...p} />
    </div>
  ),
  thead: ({ node: _n, ...p }) => <thead className="bg-muted" {...p} />,
  th: ({ node: _n, ...p }) => (
    <th className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-left font-semibold text-foreground" {...p} />
  ),
  td: ({ node, ...p }) => (
    <td
      className={cn(
        'border-t border-border px-2.5 py-1.5 align-top text-foreground',
        hastText(node).length <= SHORT_CELL ? 'whitespace-nowrap' : 'min-w-[14rem]',
      )}
      {...p}
    />
  ),
  a: ({ node, href, children }) => {
    const props = (node?.properties ?? {}) as Record<string, unknown>;
    const wikiTarget = props[WIKILINK_PROPS.target];
    if (typeof wikiTarget === 'string') {
      const heading = props[WIKILINK_PROPS.heading];
      return (
        <WikiLink target={wikiTarget} heading={typeof heading === 'string' ? heading : undefined}>
          {children}
        </WikiLink>
      );
    }
    const note = internalNoteTarget(href);
    if (note !== null) return <WikiLink target={note}>{children}</WikiLink>;
    // urlTransform blanks unsafe URLs (javascript:, data:, …) — render those as text.
    if (!href) return <span className="text-foreground">{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(LINK_CLASS, 'break-words')}>
        {children}
      </a>
    );
  },
  // Remote images are never loaded from memory content (privacy, CSP): show a link to them instead.
  img: ({ src, alt }) => {
    const label = alt?.trim() ? `Image: ${alt.trim()}` : 'Image';
    return typeof src === 'string' && src
      ? <a href={src} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} data-testid="markdown-image-link">{label}</a>
      : <span className="text-muted-foreground">{label}</span>;
  },
};

function MemoryMarkdownImpl({ content, resolve, onOpen, className }: MemoryMarkdownProps) {
  const ctx = useMemo(() => ({ resolve, onOpen }), [resolve, onOpen]);
  return (
    <div
      data-testid="memory-markdown"
      className={cn(
        'min-w-0 break-words text-sm leading-relaxed text-foreground',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      <WikilinkContext.Provider value={ctx}>
        <Markdown remarkPlugins={PLUGINS} components={COMPONENTS}>
          {content}
        </Markdown>
      </WikilinkContext.Provider>
    </div>
  );
}

export const MemoryMarkdown = memo(MemoryMarkdownImpl);
