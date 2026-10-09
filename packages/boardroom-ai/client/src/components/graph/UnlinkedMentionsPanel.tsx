import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeGraphNodeType } from '@boardroom/shared';
import * as api from '../../lib/api';
import type { UnlinkedMention } from '../../types/debate';
import { cn } from '../../lib/cn';
import { ShapeGlyph } from './GraphControls';
import { TYPE_SHAPE } from './graph-theme';
import { Skeleton, useToastStore } from '../ui';

interface Props {
  /** Called after a link is created so the page can refetch the graph. */
  onLinked(): void;
  /** Reports the number of open mentions (for the toggle button). */
  onCount?(n: number): void;
  /** Select a graph node (`type:refId`). */
  onSelectNode?(id: string): void;
  onClose(): void;
  className?: string;
}

const mentionKey = (m: UnlinkedMention) => `${m.memoryId}|${m.entityType}:${m.entityId}`;

/**
 * Obsidian-style "unlinked mentions": memories whose text contains a person's
 * name or a project/goal title but have no MemoryEntityLink to it. One-click
 * Link → `POST /graph/unlinked-mentions/link`, then the graph refetches.
 */
export function UnlinkedMentionsPanel({ onLinked, onCount, onSelectNode, onClose, className }: Props) {
  const [items, setItems] = useState<UnlinkedMention[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getUnlinkedMentions(50);
      setItems(res.items);
      onCount?.(res.items.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load unlinked mentions');
      setItems([]);
    }
  }, [onCount]);

  useEffect(() => { void load(); }, [load]);

  async function link(m: UnlinkedMention) {
    const key = mentionKey(m);
    setBusy((b) => new Set(b).add(key));
    try {
      await api.linkUnlinkedMention({ memoryId: m.memoryId, entityType: m.entityType, entityId: m.entityId });
      setItems((prev) => {
        const next = (prev ?? []).filter((x) => mentionKey(x) !== key);
        onCount?.(next.length);
        return next;
      });
      useToastStore.getState().addToast(`Linked “${m.memoryTitle}” to ${m.entityLabel}`, 'success');
      onLinked();
    } catch (e) {
      useToastStore.getState().addToast(e instanceof Error ? e.message : 'Could not create link', 'error');
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(key); return n; });
    }
  }

  return (
    <aside className={cn('flex min-h-0 flex-col bg-card text-foreground', className)} aria-label="Unlinked mentions">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Graph hygiene</div>
          <h2 className="text-base font-semibold leading-snug">Unlinked mentions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Memories that name an entity without being linked to it.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close unlinked mentions" className="-mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything that mentions a person, project or goal is already linked. Nice.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((m) => {
              const key = mentionKey(m);
              const type = (m.entityType as KnowledgeGraphNodeType) in TYPE_SHAPE ? (m.entityType as KnowledgeGraphNodeType) : 'memory';
              const isBusy = busy.has(key);
              return (
                <li key={key} className="rounded-md border border-border p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0" style={{ color: `var(--color-entity-${type})` }}>
                      <ShapeGlyph shape={TYPE_SHAPE[type]} color="currentColor" size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onSelectNode?.(`${m.entityType}:${m.entityId}`)}
                        className="text-left text-sm font-medium text-foreground hover:text-primary"
                        title="Select in graph"
                      >
                        {m.entityLabel}
                      </button>
                      <p className="truncate text-xs text-muted-foreground" title={m.memoryTitle}>in “{m.memoryTitle}”</p>
                      {m.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.snippet}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => link(m)}
                      className="h-7 shrink-0 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {isBusy ? 'Linking…' : 'Link'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
