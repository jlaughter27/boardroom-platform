import { create } from 'zustand';
import type { Memory } from '@boardroom/shared';
import * as api from '../lib/api';
import { useToastStore } from '../components/ui/Toast';

const PAGE_SIZE = 20;

export interface MemoryFilters {
  q?: string;
  domain?: string;
  memoryClass?: string;
  status?: string;
  since?: string;
  sortBy?: string;
  sortOrder?: string;
}

interface MemoryState {
  memories: Memory[];
  selectedMemory: Memory | null;
  filters: MemoryFilters;
  isLoading: boolean;
  total: number;
  offset: number;
  error: string | null;

  clearError: () => void;
  search: (filters?: MemoryFilters) => Promise<void>;
  loadMore: () => Promise<void>;
  select: (id: string) => void;
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

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  selectedMemory: null,
  filters: {},
  isLoading: false,
  total: 0,
  offset: 0,
  error: null,

  clearError: () => set({ error: null }),

  search: async (overrideFilters) => {
    const filters = overrideFilters ?? get().filters;
    const seq = ++requestSeq;
    set({ isLoading: true, offset: 0, error: null, filters });
    try {
      const res = await api.listMemories({
        ...filters,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (seq !== requestSeq) return; // stale
      set({
        memories: res.items,
        total: res.total,
        offset: res.items.length,
        filters,
      });
    } catch (err) {
      if (seq !== requestSeq) return; // stale
      set({ error: (err as Error).message });
    } finally {
      if (seq === requestSeq) set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { filters, offset, total, isLoading } = get();
    if (isLoading || offset >= total) return;
    const seq = requestSeq;
    set({ isLoading: true });
    try {
      const res = await api.listMemories({
        ...filters,
        limit: PAGE_SIZE,
        offset,
      });
      if (seq !== requestSeq) return; // a newer search replaced this result set
      set((state) => ({
        memories: [...state.memories, ...res.items],
        total: res.total,
        offset: offset + res.items.length,
      }));
    } catch (err) {
      if (seq !== requestSeq) return;
      set({ error: (err as Error).message });
    } finally {
      if (seq === requestSeq) set({ isLoading: false });
    }
  },

  select: (id) => {
    const found = get().memories.find((m) => m.id === id) ?? null;
    set({ selectedMemory: found });
  },

  clearSelection: () => set({ selectedMemory: null }),

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
    // Remove empty/undefined values
    for (const key of Object.keys(filters) as (keyof MemoryFilters)[]) {
      if (!filters[key]) delete filters[key];
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
    }),
}));
