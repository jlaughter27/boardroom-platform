import type { KnowledgeGraph } from '@boardroom/shared';
import { KNOWLEDGE_GRAPH_MEMORY_LIMIT } from '@boardroom/shared';
import { cn } from '../../lib/cn';

/**
 * RD-6 — the graph loads only the top-N memories by importance. This says how
 * many of how many are on the canvas and offers the next step ("Show 200
 * more") until everything is loaded or the API maximum is reached.
 */

export interface MemoryCapState {
  /** Memory nodes on the loaded graph (includes ones the lazy neighbourhood fetch merged in). */
  shown: number;
  /** Memories that exist for this view (server `stats.memoryTotal`, never below `shown`). */
  total: number;
  hidden: number;
  /** The `memoryLimit` "Show more" would request, or null when nothing more can be loaded. */
  nextLimit: number | null;
  /** True when memories are hidden but the API maximum has been reached. */
  atMax: boolean;
}

export function memoryCapState(graph: KnowledgeGraph | null, limit: number): MemoryCapState | null {
  if (!graph) return null;
  let shown = 0;
  for (const n of graph.nodes) if (n.type === 'memory') shown += 1;
  // Older servers did not send memoryTotal: fall back to "at least what we have" (+1 when the cap was hit).
  const reported = typeof graph.stats.memoryTotal === 'number' ? graph.stats.memoryTotal : shown + (graph.stats.memoryLimitHit ? 1 : 0);
  const total = Math.max(reported, shown);
  const hidden = Math.max(0, total - shown);
  if (hidden === 0) return { shown, total, hidden, nextLimit: null, atMax: false };
  const atMax = limit >= KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX;
  const nextLimit = atMax ? null : Math.min(limit + KNOWLEDGE_GRAPH_MEMORY_LIMIT.STEP, KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX);
  return { shown, total, hidden, nextLimit, atMax };
}

interface GraphMemoryCapProps {
  state: MemoryCapState;
  loading: boolean;
  onShowMore(nextLimit: number): void;
  className?: string;
}

/** Inline, in the page subtitle: "Showing 200 of 640 memories · Show 200 more". Renders nothing when nothing is hidden. */
export function GraphMemoryCap({ state, loading, onShowMore, className }: GraphMemoryCapProps) {
  if (state.hidden === 0) return null;
  const step = Math.min(state.hidden, KNOWLEDGE_GRAPH_MEMORY_LIMIT.STEP);
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)} data-testid="graph-memory-cap">
      <span>
        Showing <span className="tnum text-foreground">{state.shown}</span> of <span className="tnum">{state.total}</span> memories
        <span className="sr-only"> (the most important first)</span>
      </span>
      {state.nextLimit !== null ? (
        <button
          type="button"
          onClick={() => onShowMore(state.nextLimit!)}
          disabled={loading}
          aria-busy={loading || undefined}
          data-testid="graph-show-more"
          title={`Load the next ${step} memories by importance`}
          className="rounded-sm font-medium text-primary-text underline-offset-2 hover:underline disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {loading ? 'Loading…' : `Show ${step} more`}
        </button>
      ) : (
        <span title={`The graph shows at most ${KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX} memories; search finds the rest.`}>
          · {state.hidden} more not shown (limit {KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX})
        </span>
      )}
    </span>
  );
}
