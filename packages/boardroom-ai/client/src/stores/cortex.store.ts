import { create } from 'zustand';
import type { WeeklyMemo, ThinkingPattern } from '@boardroom/shared';
import * as api from '../lib/api';

interface CortexState {
  latestMemo: WeeklyMemo | null;
  patterns: ThinkingPattern[];
  patternsTotal: number;
  isLoadingMemo: boolean;
  isLoadingPatterns: boolean;
  isGeneratingMemo: boolean;

  fetchLatestMemo: () => Promise<void>;
  fetchPatterns: () => Promise<void>;
  generateMemo: () => Promise<void>;
  triggerPatternScan: () => Promise<void>;
}

export const useCortexStore = create<CortexState>((set) => ({
  latestMemo: null,
  patterns: [],
  patternsTotal: 0,
  isLoadingMemo: false,
  isLoadingPatterns: false,
  isGeneratingMemo: false,

  fetchLatestMemo: async () => {
    set({ isLoadingMemo: true });
    try {
      const memo = await api.getLatestMemo();
      set({ latestMemo: memo });
    } finally {
      set({ isLoadingMemo: false });
    }
  },

  fetchPatterns: async () => {
    set({ isLoadingPatterns: true });
    try {
      const result = await api.getPatterns();
      set({ patterns: result.items, patternsTotal: result.total });
    } finally {
      set({ isLoadingPatterns: false });
    }
  },

  generateMemo: async () => {
    set({ isGeneratingMemo: true });
    try {
      const result = await api.generateMemo();
      // If it's a memo (has id), set it; otherwise it's a "not enough data" message
      if (result && 'id' in result) {
        set({ latestMemo: result as WeeklyMemo });
      }
    } finally {
      set({ isGeneratingMemo: false });
    }
  },

  triggerPatternScan: async () => {
    set({ isLoadingPatterns: true });
    try {
      const result = await api.triggerPatternScan();
      // Refresh patterns list after scan
      const updated = await api.getPatterns();
      set({ patterns: updated.items, patternsTotal: updated.total });
    } finally {
      set({ isLoadingPatterns: false });
    }
  },
}));
