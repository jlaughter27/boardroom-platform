import { create } from 'zustand';
import type { Memory } from '@boardroom/shared';
import * as api from '../lib/api';

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
}

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
    set({ isLoading: true, offset: 0, error: null });
    try {
      const res = await api.listMemories({
        ...filters,
        limit: PAGE_SIZE,
        offset: 0,
      });
      set({
        memories: res.items,
        total: res.total,
        offset: res.items.length,
        filters,
      });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { filters, offset, total, memories, isLoading } = get();
    if (isLoading || offset >= total) return;
    set({ isLoading: true });
    try {
      const res = await api.listMemories({
        ...filters,
        limit: PAGE_SIZE,
        offset,
      });
      set({
        memories: [...memories, ...res.items],
        total: res.total,
        offset: offset + res.items.length,
      });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  select: (id) => {
    const found = get().memories.find((m) => m.id === id) ?? null;
    set({ selectedMemory: found });
  },

  clearSelection: () => set({ selectedMemory: null }),

  updateMemory: async (id, input) => {
    try {
      const updated = await api.updateMemory(id, input);
      set((state) => ({
        memories: state.memories.map((m) => (m.id === id ? updated : m)),
        selectedMemory:
          state.selectedMemory?.id === id ? updated : state.selectedMemory,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  archiveMemory: async (id) => {
    try {
      await api.archiveMemory(id);
      set((state) => ({
        memories: state.memories.filter((m) => m.id !== id),
        selectedMemory:
          state.selectedMemory?.id === id ? null : state.selectedMemory,
        total: state.total - 1,
      }));
    } catch (err) {
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
}));
