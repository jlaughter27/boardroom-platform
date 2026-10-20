import type { KnowledgeGraphNode } from '@boardroom/shared';
import { cn } from '../../lib/cn';
import { ShapeGlyph } from './GraphControls';
import { TYPE_SHAPE } from './graph-theme';
import { breadcrumbs, canGoBack, canGoForward, type FocusHistory } from './graph-focus';

interface Props {
  history: FocusHistory;
  nodesById: ReadonlyMap<string, KnowledgeGraphNode>;
  onBack(): void;
  onForward(): void;
  /** Jump to a crumb (re-focus without pushing a new entry when it is the current one). */
  onCrumb(id: string): void;
  className?: string;
}

/**
 * Back / forward over the last 20 focused nodes (keyboard `[` and `]`) plus a
 * breadcrumb trail of the most recent five — Obsidian users complain graph
 * search history is lost; this is the cheap fix.
 */
export function FocusHistoryBar({ history, nodesById, onBack, onForward, onCrumb, className }: Props) {
  const crumbs = breadcrumbs(history, 5);
  if (history.entries.length === 0) return null;
  const current = history.entries[history.index];
  return (
    <nav className={cn('flex min-w-0 items-center gap-1 text-xs', className)} aria-label="Focus history">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack(history)}
        aria-label="Back to previous focus ( [ )"
        title="Previous focus  [ "
        className="h-7 w-7 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onForward}
        disabled={!canGoForward(history)}
        aria-label="Forward to next focus ( ] )"
        title="Next focus  ] "
        className="h-7 w-7 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        ›
      </button>
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="focus-breadcrumbs">
        {crumbs.map((id, i) => {
          const n = nodesById.get(id);
          const isCurrent = id === current && i === crumbs.length - 1;
          return (
            <li key={`${id}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/60" aria-hidden="true">/</span>}
              <button
                type="button"
                onClick={() => onCrumb(id)}
                aria-current={isCurrent ? 'location' : undefined}
                className={cn('flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 hover:bg-muted', isCurrent ? 'text-foreground' : 'text-muted-foreground')}
                title={n?.label ?? id}
              >
                {n && (
                  <span className="shrink-0" style={{ color: `var(--color-entity-${n.type})` }}>
                    <ShapeGlyph shape={TYPE_SHAPE[n.type]} color="currentColor" size={9} />
                  </span>
                )}
                <span className="max-w-[140px] truncate">{n?.label ?? id}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
