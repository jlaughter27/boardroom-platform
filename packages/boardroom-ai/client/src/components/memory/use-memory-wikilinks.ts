import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Memory } from '@boardroom/shared';
import * as api from '../../lib/api';
import type { MemoryEntityLink } from '../../lib/api';
import { buildWikilinkResolver, type ResolvedWikilink } from '../../lib/markdown';
import { useMemoryStore } from '../../stores/memory.store';
import { useToastStore } from '../ui/Toast';

/** Link-row targets fetched by id when the explorer list does not hold them. */
export const MAX_LINK_TARGET_FETCHES = 40;

const isMemoryLink = (l: MemoryEntityLink) => l.entityType.toLowerCase() === 'memory';

/**
 * Brings a memory into the detail panel — exactly what clicking its card does
 * when it is in the list (`select`); otherwise the fetched row becomes the
 * selection. Then moves focus to the new title so keyboard users land on it.
 */
export async function openMemoryInExplorer(id: string, known?: Memory): Promise<void> {
  const store = useMemoryStore.getState();
  if (store.memories.some((m) => m.id === id)) {
    store.select(id);
  } else {
    try {
      const memory = known ?? await api.getMemory(id);
      useMemoryStore.setState({ selectedMemory: memory });
    } catch (err) {
      useToastStore.getState().addToast(`Could not open that memory: ${(err as Error).message}`, 'error');
      return;
    }
  }
  requestAnimationFrame(() => {
    const title = document.querySelector<HTMLElement>('[data-testid="memory-detail"] [data-memory-title]');
    title?.scrollIntoView({ block: 'nearest' });
    title?.focus({ preventScroll: true });
  });
}

/**
 * Wikilink resolution for one memory (RD-1): (a) its outgoing memory→memory
 * link rows (`GET /memories/:id/links`), resolved to the target memories — from
 * the explorer list when present, else fetched by id; (b) a title match among
 * memories the client holds; (c) unresolved.
 */
export function useMemoryWikilinks(memory: Memory, links: MemoryEntityLink[]) {
  const listed = useMemoryStore((s) => s.memories);
  const [fetched, setFetched] = useState<Record<string, Memory>>({});

  const targetIds = useMemo(
    () => [...new Set(links.filter(isMemoryLink).map((l) => l.entityId))].filter((id) => id !== memory.id),
    [links, memory.id],
  );

  useEffect(() => {
    const listedIds = new Set(listed.map((m) => m.id));
    const missing = targetIds.filter((id) => !listedIds.has(id) && !fetched[id]).slice(0, MAX_LINK_TARGET_FETCHES);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.allSettled(missing.map((id) => api.getMemory(id))).then((results) => {
      if (cancelled) return;
      const add: Record<string, Memory> = {};
      results.forEach((r) => { if (r.status === 'fulfilled' && r.value?.id) add[r.value.id] = r.value; });
      if (Object.keys(add).length > 0) setFetched((prev) => ({ ...prev, ...add }));
    });
    return () => { cancelled = true; };
    // `fetched` is read, not a trigger: re-running on it would only find nothing missing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIds, listed]);

  const byId = useMemo(() => {
    const map = new Map<string, Memory>();
    for (const m of Object.values(fetched)) map.set(m.id, m);
    for (const m of listed) map.set(m.id, m);
    return map;
  }, [fetched, listed]);

  const linkedTargets = useMemo(
    () => targetIds.map((id) => byId.get(id)).filter((m): m is Memory => !!m),
    [targetIds, byId],
  );

  const resolve = useMemo(
    () => buildWikilinkResolver(linkedTargets, listed, memory.id),
    [linkedTargets, listed, memory.id],
  );

  const open = useCallback((id: string) => { void openMemoryInExplorer(id, byId.get(id)); }, [byId]);

  return { resolve: resolve as (target: string) => ResolvedWikilink | null, open, linkedTargets, byId };
}
