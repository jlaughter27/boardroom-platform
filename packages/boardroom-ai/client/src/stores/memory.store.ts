import { create } from 'zustand';
import type { Memory } from '@boardroom/shared';
import * as api from '../lib/api';
import { useToastStore } from '../components/ui/Toast';
import { asOfToIso, hitLayers, type HybridSearchRow } from '../components/graph/graph-search';

const PAGE_SIZE = 20;

export interface MemoryFilters {
  q?: string;
  domain?: string;
  memoryClass?: string;
  status?: string;
  since?: string;
  sortBy?: string;
  sortOrder?: string;
  /** Multi-select tag filter (hybrid: `tags[]`; list: comma-joined `tags`) */
  tags?: string[];
  /** `YYYY-MM-DD` — hybrid search only: memories valid as of that day */
  asOf?: string;
  /** Hybrid search only: include ARCHIVED rows */
  includeArchived?: boolean;
}

/**
 * Which endpoint answers a query:
 *  - 'list'   → always `GET /memories` (legacy behaviour, the default)
 *  - 'hybrid' → `POST /memories/search` (semantic + FTS + trigram, cursor paged)
 *               whenever `q` is present; the list endpoint for empty queries
 */
export type MemorySearchEngine = 'list' | 'hybrid';

interface MemoryState {
  memories: Memory[];
  selectedMemory: Memory | null;
  filters: MemoryFilters;
  isLoading: boolean;
  total: number;
  offset: number;
  error: string | null;
  engine: MemorySearchEngine;
  /** Relevance per memory id (hybrid results only) */
  scores: Record<string, number>;
  /** Retrieval layers that matched per memory id, when the server reports them */
  layers: Record<string, string[]>;
  /** Cursor for the next hybrid page; null when exhausted */
  nextCursor: string | null;
  /** True when the current result set came from the hybrid endpoint */
  hybridActive: boolean;
  /** A deep-linked id (`/memory/:id`, `/memory?id=`) that resolved to no memory */
  notFoundId: string | null;

  clearError: () => void;
  setEngine: (engine: MemorySearchEngine) => void;
  search: (filters?: MemoryFilters) => Promise<void>;
  loadMore: () => Promise<void>;
  select: (id: string) => void;
  /**
   * Select a memory by id even when it is not in the loaded page (deep links):
   * the list first, else `GET /memories/:id`. A 404 sets `notFoundId`.
   */
  openById: (id: string) => Promise<void>;
  clearSelection: () => void;
  updateMemory: (id: string, input: Record<string, unknown>) => Promise<void>;
  archiveMemory: (id: string) => Promise<void>;
  setFilters: (filters: Partial<MemoryFilters>) => void;
  reset: () => void;
}

// Monotonic request sequence (C-113). Each `search` bumps it; any response
// (search or loadMore) whose sequence is no longer current is dropped so a
// slow stale response cannot overwrite a newer result set or its offset.
let requestSeq = 0;
// Same idea for deep-link opens: a newer open (or a manual selection) wins.
let openSeq = 0;

function toListParams(filters: MemoryFilters, limit: number, offset: number): api.ListMemoriesParams {
  const { tags, asOf: _asOf, includeArchived: _inc, ...rest } = filters;
  const params: api.ListMemoriesParams = { ...rest, limit, offset };
  if (tags && tags.length > 0) params.tags = tags.join(',');
  return params;
}

function toHybridParams(filters: MemoryFilters, cursor?: string | null): api.HybridSearchParams {
  const params: api.HybridSearchParams = { query: filters.q ?? '', limit: PAGE_SIZE };
  if (filters.domain) params.domain = filters.domain;
  if (filters.status) params.status = filters.status;
  if (filters.tags && filters.tags.length > 0) params.tags = filters.tags;
  if (filters.includeArchived) params.includeArchived = true;
  const asOf = asOfToIso(filters.asOf);
  if (asOf) params.asOf = asOf;
  if (cursor) params.cursor = cursor;
  return params;
}

function indexHybrid(rows: HybridSearchRow[]) {
  const scores: Record<string, number> = {};
  const layers: Record<string, string[]> = {};
  for (const r of rows) {
    if (typeof r.score === 'number') scores[r.id] = r.score;
    const l = hitLayers(r);
    if (l.length) layers[r.id] = l;
  }
  return { scores, layers };
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  selectedMemory: null,
  filters: {},
  isLoading: false,
  total: 0,
  offset: 0,
  error: null,
  engine: 'list',
  scores: {},
  layers: {},
  nextCursor: null,
  hybridActive: false,
  notFoundId: null,

  clearError: () => set({ error: null }),

  setEngine: (engine) => set({ engine }),

  search: async (overrideFilters) => {
    const filters = overrideFilters ?? get().filters;
    const seq = ++requestSeq;
    const useHybrid = get().engine === 'hybrid' && !!filters.q?.trim();
    set({ isLoading: true, offset: 0, error: null, filters });
    try {
      if (useHybrid) {
        const res = await api.hybridSearchMemories(toHybridParams(filters));
        if (seq !== requestSeq) return; // stale
        const rows = res.items as HybridSearchRow[];
        const { scores, layers } = indexHybrid(rows);
        set({
          memories: rows as unknown as Memory[],
          total: rows.length,
          offset: rows.length,
          nextCursor: res.nextCursor ?? null,
          scores,
          layers,
          hybridActive: true,
          filters,
        });
      } else {
        const res = await api.listMemories(toListParams(filters, PAGE_SIZE, 0));
        if (seq !== requestSeq) return; // stale
        set({
          memories: res.items,
          total: res.total,
          offset: res.items.length,
          nextCursor: null,
          scores: {},
          layers: {},
          hybridActive: false,
          filters,
        });
      }
    } catch (err) {
      if (seq !== requestSeq) return; // stale
      set({ error: (err as Error).message });
    } finally {
      if (seq === requestSeq) set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { filters, offset, total, isLoading, hybridActive, nextCursor } = get();
    if (isLoading) return;
    if (hybridActive ? !nextCursor : offset >= total) return;
    const seq = requestSeq;
    set({ isLoading: true });
    try {
      if (hybridActive) {
        const res = await api.hybridSearchMemories(toHybridParams(filters, nextCursor));
        if (seq !== requestSeq) return; // a newer search replaced this result set
        const rows = res.items as HybridSearchRow[];
        const { scores, layers } = indexHybrid(rows);
        set((state) => {
          const seen = new Set(state.memories.map((m) => m.id));
          const fresh = (rows as unknown as Memory[]).filter((m) => !seen.has(m.id));
          return {
            memories: [...state.memories, ...fresh],
            total: state.memories.length + fresh.length,
            offset: state.memories.length + fresh.length,
            nextCursor: res.nextCursor ?? null,
            scores: { ...state.scores, ...scores },
            layers: { ...state.layers, ...layers },
          };
        });
      } else {
        const res = await api.listMemories(toListParams(filters, PAGE_SIZE, offset));
        if (seq !== requestSeq) return; // a newer search replaced this result set
        set((state) => ({
          memories: [...state.memories, ...res.items],
          total: res.total,
          offset: offset + res.items.length,
        }));
      }
    } catch (err) {
      if (seq !== requestSeq) return;
      set({ error: (err as Error).message });
    } finally {
      if (seq === requestSeq) set({ isLoading: false });
    }
  },

  select: (id) => {
    openSeq++;
    const found = get().memories.find((m) => m.id === id) ?? null;
    set({ selectedMemory: found, notFoundId: null });
  },

  openById: async (id) => {
    const seq = ++openSeq;
    const known = get().memories.find((m) => m.id === id);
    if (known) { set({ selectedMemory: known, notFoundId: null }); return; }
    set({ notFoundId: null });
    try {
      const memory = await api.getMemory(id);
      if (seq !== openSeq) return;
      set({ selectedMemory: memory, notFoundId: null });
    } catch (err) {
      if (seq !== openSeq) return;
      // Duck-typed (ApiError carries `status`): tests often mock the api module wholesale.
      if ((err as { status?: unknown })?.status === 404) set({ selectedMemory: null, notFoundId: id });
      else set({ error: (err as Error).message });
    }
  },

  clearSelection: () => { openSeq++; set({ selectedMemory: null, notFoundId: null }); },

  updateMemory: async (id, input) => {
    const toast = useToastStore.getState().addToast;
    try {
      const updated = await api.updateMemory(id, input);
      set((state) => ({
        memories: state.memories.map((m) => (m.id === id ? updated : m)),
        selectedMemory:
          state.selectedMemory?.id === id ? updated : state.selectedMemory,
      }));
      toast('Memory updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
      throw err;
    }
  },

  archiveMemory: async (id) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.archiveMemory(id);
      set((state) => ({
        memories: state.memories.filter((m) => m.id !== id),
        selectedMemory:
          state.selectedMemory?.id === id ? null : state.selectedMemory,
        total: state.total - 1,
      }));
      toast('Memory archived', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
      throw err;
    }
  },

  setFilters: (partial) => {
    const filters = { ...get().filters, ...partial };
    // Remove empty/undefined values (and empty tag lists)
    for (const key of Object.keys(filters) as (keyof MemoryFilters)[]) {
      const v = filters[key];
      if (!v || (Array.isArray(v) && v.length === 0)) delete filters[key];
    }
    set({ filters });
    get().search(filters);
  },

  reset: () =>
    set({
      memories: [],
      selectedMemory: null,
      filters: {},
      isLoading: false,
      total: 0,
      offset: 0,
      error: null,
      engine: 'list', // the explorer opts back in on mount; nothing else should inherit hybrid mode
      scores: {},
      layers: {},
      nextCursor: null,
      hybridActive: false,
      notFoundId: null,
    }),
}));
