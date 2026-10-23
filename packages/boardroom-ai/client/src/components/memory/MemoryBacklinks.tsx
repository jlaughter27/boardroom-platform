import { useEffect, useState } from 'react';
import type { MemoryBacklinksResponse } from '@boardroom/shared';
import * as api from '../../lib/api';

interface MemoryBacklinksProps {
  memoryId: string;
  /** Opens a memory in the explorer (same as clicking its card). */
  onOpen: (memoryId: string) => void;
  labelClass: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: MemoryBacklinksResponse };

/** "Linked from" — memories that link to this one (`GET /memories/:id/backlinks`, RD-1). */
export function MemoryBacklinks({ memoryId, onOpen, labelClass }: MemoryBacklinksProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    api.getMemoryBacklinks(memoryId)
      .then((data) => { if (!cancelled) setState({ kind: 'ready', data }); })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [memoryId]);

  const count = state.kind === 'ready' ? state.data.items.length : null;

  return (
    <section className="border-t border-border pt-3" aria-labelledby={`backlinks-${memoryId}`} data-testid="memory-backlinks">
      <h3 id={`backlinks-${memoryId}`} className={labelClass}>
        Linked from{count !== null && count > 0 ? ` (${count}${state.kind === 'ready' && state.data.truncated ? '+' : ''})` : ''}
      </h3>
      {state.kind === 'loading' && <p className="mt-1 text-xs text-muted-foreground">Loading backlinks…</p>}
      {state.kind === 'error' && <p className="mt-1 text-xs text-muted-foreground">Backlinks could not be loaded.</p>}
      {state.kind === 'ready' && state.data.items.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">No other memory links here yet.</p>
      )}
      {state.kind === 'ready' && state.data.items.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {state.data.items.map((b) => (
            <li key={b.memoryId}>
              <button
                type="button"
                onClick={() => onOpen(b.memoryId)}
                className="flex w-full items-baseline gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-[border-color,background-color] duration-fast ease-out hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                data-testid="backlink"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{b.title}</span>
                {b.domain && <span className="shrink-0 text-muted-foreground">{b.domain}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.kind === 'ready' && state.data.truncated && (
        <p className="mt-1 text-xs text-muted-foreground">Showing the first links only.</p>
      )}
    </section>
  );
}
