import { create } from 'zustand';
import type { WeeklyMemo, ThinkingPattern, ContradictionAlert } from '@boardroom/shared';
import * as api from '../lib/api';

interface CortexState {
  latestMemo: WeeklyMemo | null;
  patterns: ThinkingPattern[];
  patternsTotal: number;
  contradictions: ContradictionAlert[];
  contradictionsTotal: number;
  isLoadingMemo: boolean;
  isLoadingPatterns: boolean;
  isLoadingContradictions: boolean;
  isGeneratingMemo: boolean;
  isScanningContradictions: boolean;

  fetchLatestMemo: () => Promise<void>;
  fetchPatterns: () => Promise<void>;
  fetchContradictions: () => Promise<void>;
  generateMemo: () => Promise<void>;
  triggerPatternScan: () => Promise<void>;
  scanContradictions: () => Promise<void>;
  resolveContradiction: (id: string, resolution: string) => Promise<void>;
  dismissContradiction: (id: string) => Promise<void>;
  acceptTension: (id: string) => Promise<void>;
}

export const useCortexStore = create<CortexState>((set) => ({
  latestMemo: null,
  patterns: [],
  patternsTotal: 0,
  contradictions: [],
  contradictionsTotal: 0,
  isLoadingMemo: false,
  isLoadingPatterns: false,
  isLoadingContradictions: false,
  isGeneratingMemo: false,
  isScanningContradictions: false,

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

  fetchContradictions: async () => {
    set({ isLoadingContradictions: true });
    try {
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
    } finally {
      set({ isLoadingContradictions: false });
    }
  },

  scanContradictions: async () => {
    set({ isScanningContradictions: true });
    try {
      await api.scanContradictions();
      // Refresh after scan
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
    } finally {
      set({ isScanningContradictions: false });
    }
  },

  resolveContradiction: async (id: string, resolution: string) => {
    await api.updateContradiction(id, 'RESOLVED', resolution);
    const result = await api.getContradictions('ACTIVE');
    set({ contradictions: result.items, contradictionsTotal: result.total });
  },

  dismissContradiction: async (id: string) => {
    await api.updateContradiction(id, 'DISMISSED');
    const result = await api.getContradictions('ACTIVE');
    set({ contradictions: result.items, contradictionsTotal: result.total });
  },

  acceptTension: async (id: string) => {
    await api.updateContradiction(id, 'ACCEPTED_TENSION');
    const result = await api.getContradictions('ACTIVE');
    set({ contradictions: result.items, contradictionsTotal: result.total });
  },
}));
