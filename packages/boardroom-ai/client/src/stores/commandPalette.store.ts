import { create } from 'zustand';

/** Tasks / commitments are refetched for the palette at most this often. */
export const PALETTE_ENTITY_TTL_MS = 60_000;

interface CommandPaletteStore {
  open: boolean;
  /** Epoch ms of the last palette-triggered task / commitment fetch (0 = never this session). */
  tasksFetchedAt: number;
  commitmentsFetchedAt: number;
  toggle: () => void;
  close: () => void;
  markFetched: (what: 'tasks' | 'commitments', at?: number) => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  tasksFetchedAt: 0,
  commitmentsFetchedAt: 0,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  markFetched: (what, at = Date.now()) => set(what === 'tasks' ? { tasksFetchedAt: at } : { commitmentsFetchedAt: at }),
}));

/**
 * Whether the palette should (re)fetch an entity list: the first open of the
 * session fetches an empty list once; afterwards only the TTL triggers a refetch
 * (so users with zero tasks no longer refetch on every open).
 */
export function shouldRefetch(fetchedAt: number, listLength: number, now = Date.now(), ttl = PALETTE_ENTITY_TTL_MS): boolean {
  if (fetchedAt === 0) return listLength === 0;
  return now - fetchedAt > ttl;
}
