/**
 * Focus history — back / forward over the last N focused nodes, browser-style.
 * Pure, immutable; the page keeps the value in state and persists nothing.
 */

export interface FocusHistory {
  entries: string[];
  /** Index of the current entry, -1 when empty */
  index: number;
}

export const FOCUS_HISTORY_MAX = 20;

export function createFocusHistory(): FocusHistory {
  return { entries: [], index: -1 };
}

export function currentFocus(h: FocusHistory): string | null {
  return h.index >= 0 ? h.entries[h.index] ?? null : null;
}

export function canGoBack(h: FocusHistory): boolean {
  return h.index > 0;
}

export function canGoForward(h: FocusHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

/**
 * Record a new focus. Re-focusing the current node is a no-op; focusing after
 * going back drops the forward entries (like a browser); the list is capped at
 * FOCUS_HISTORY_MAX by dropping the oldest.
 */
export function pushFocus(h: FocusHistory, id: string): FocusHistory {
  if (currentFocus(h) === id) return h;
  const kept = h.entries.slice(0, h.index + 1);
  kept.push(id);
  const overflow = Math.max(0, kept.length - FOCUS_HISTORY_MAX);
  const entries = overflow ? kept.slice(overflow) : kept;
  return { entries, index: entries.length - 1 };
}

export function goBack(h: FocusHistory): FocusHistory {
  return canGoBack(h) ? { ...h, index: h.index - 1 } : h;
}

export function goForward(h: FocusHistory): FocusHistory {
  return canGoForward(h) ? { ...h, index: h.index + 1 } : h;
}

/**
 * Drop entries that no longer resolve (e.g. a node that left the graph after a
 * refetch, or a 404'd lazy fetch). Consecutive duplicates created by the removal
 * collapse to one; the index follows the current entry, or the nearest earlier
 * survivor when the current one was dropped.
 */
export function pruneHistory(h: FocusHistory, keep: (id: string) => boolean): FocusHistory {
  const entries: string[] = [];
  let index = -1;
  for (let i = 0; i < h.entries.length; i++) {
    const id = h.entries[i];
    if (!keep(id)) continue;
    if (entries[entries.length - 1] === id) {
      if (i === h.index) index = entries.length - 1;
      continue;
    }
    entries.push(id);
    if (i <= h.index) index = entries.length - 1;
  }
  if (entries.length === h.entries.length && index === h.index) return h;
  return { entries, index: entries.length === 0 ? -1 : Math.max(0, Math.min(index, entries.length - 1)) };
}

/** The trail that leads to the current focus (oldest → current), at most `n` long. */
export function breadcrumbs(h: FocusHistory, n = 5): string[] {
  if (h.index < 0) return [];
  const from = Math.max(0, h.index + 1 - n);
  return h.entries.slice(from, h.index + 1);
}
