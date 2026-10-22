import { cn } from '../../lib/cn';
import { formatAsOf } from './graph-search';
import type { SpotlightSearchState } from '../../stores/graph.store';

interface Props {
  spotlight: SpotlightSearchState;
  /** Hits that are currently in the loaded graph */
  loadedHits: number;
  /** Hits whose neighbourhood fetch came back empty (archived / superseded / deleted) — never retried. */
  unavailableHits?: number;
  fetchingMissing: boolean;
  /** "Filter to results" is on but none of the hits is in the graph, so the canvas falls back to fading. */
  emptyFilter?: boolean;
  onToggleFilter(): void;
  onLoadMore(): void;
  onFit(): void;
  onEdit(): void;
  onClear(): void;
  className?: string;
}

/** Status strip shown on the graph page while a spotlight search is active. */
export function SpotlightBar({
  spotlight, loadedHits, unavailableHits = 0, fetchingMissing, emptyFilter = false, onToggleFilter, onLoadMore, onFit, onEdit, onClear, className,
}: Props) {
  const asOf = formatAsOf(spotlight.asOf);
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 rounded-control border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs text-foreground', className)}
      role="status"
      data-testid="spotlight-bar"
    >
      <span>
        <span className="tabular-nums font-medium">{spotlight.hits.length}</span>
        {spotlight.hits.length === 1 ? ' hit' : ' hits'} for{' '}
        <button type="button" onClick={onEdit} className="font-medium underline-offset-2 hover:underline" title="Edit search (⌘K)">
          “{spotlight.query}”
        </button>
        {loadedHits < spotlight.hits.length && (
          <span className="text-muted-foreground"> · {loadedHits} in view{fetchingMissing ? ', fetching the rest…' : ''}</span>
        )}
        {unavailableHits > 0 && (
          <span className="text-muted-foreground" data-testid="spotlight-unavailable">
            {' '}· {unavailableHits} {unavailableHits === 1 ? 'result is' : 'results are'} not in the graph (archived or superseded)
          </span>
        )}
      </span>
      {asOf && (
        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground" data-testid="asof-chip">{asOf}</span>
      )}
      {spotlight.loading && <span className="text-muted-foreground">Searching…</span>}
      {spotlight.error && <span className="text-destructive">{spotlight.error}</span>}
      {emptyFilter && (
        <span className="text-warning" data-testid="spotlight-empty-filter">
          None of the hits is in the graph yet — showing everything faded instead of hiding it.
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleFilter}
          aria-pressed={spotlight.filterToResults}
          className={cn('h-7 rounded-md border px-2.5', spotlight.filterToResults ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
          title="Hide everything that is not a hit"
        >
          Filter to results
        </button>
        {spotlight.nextCursor && (
          <button type="button" onClick={onLoadMore} disabled={spotlight.loading} className="h-7 rounded-md border border-border bg-card px-2.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
            Load more
          </button>
        )}
        <button type="button" onClick={onFit} className="h-7 rounded-md border border-border bg-card px-2.5 text-muted-foreground hover:text-foreground" title="Fit the view to the hits">
          Fit hits
        </button>
        <button type="button" onClick={onClear} className="h-7 rounded-md border border-border bg-card px-2.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
          Clear
        </button>
      </span>
    </div>
  );
}
