import { create } from 'zustand';
import type { WeeklyMemo, ThinkingPattern, ContradictionAlert } from '@boardroom/shared';
import * as api from '../lib/api';
import { useToastStore } from '../components/ui/Toast';

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
  error: string | null;

  clearError: () => void;
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
  error: null,

  clearError: () => set({ error: null }),

  fetchLatestMemo: async () => {
    set({ isLoadingMemo: true, error: null });
    try {
      const memo = await api.getLatestMemo();
      set({ latestMemo: memo });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoadingMemo: false });
    }
  },

  fetchPatterns: async () => {
    set({ isLoadingPatterns: true, error: null });
    try {
      const result = await api.getPatterns();
      set({ patterns: result.items, patternsTotal: result.total });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoadingPatterns: false });
    }
  },

  generateMemo: async () => {
    const toast = useToastStore.getState().addToast;
    set({ isGeneratingMemo: true, error: null });
    try {
      const result = await api.generateMemo();
      if (result && 'id' in result) {
        set({ latestMemo: result as WeeklyMemo });
        toast('Weekly memo generated', 'success');
      } else {
        toast('Not enough data for memo yet', 'info');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    } finally {
      set({ isGeneratingMemo: false });
    }
  },

  triggerPatternScan: async () => {
    const toast = useToastStore.getState().addToast;
    set({ isLoadingPatterns: true, error: null });
    try {
      await api.triggerPatternScan();
      const updated = await api.getPatterns();
      set({ patterns: updated.items, patternsTotal: updated.total });
      toast('Pattern scan complete', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    } finally {
      set({ isLoadingPatterns: false });
    }
  },

  fetchContradictions: async () => {
    set({ isLoadingContradictions: true, error: null });
    try {
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoadingContradictions: false });
    }
  },

  scanContradictions: async () => {
    const toast = useToastStore.getState().addToast;
    set({ isScanningContradictions: true, error: null });
    try {
      await api.scanContradictions();
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
      toast('Contradiction scan complete', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    } finally {
      set({ isScanningContradictions: false });
    }
  },

  resolveContradiction: async (id: string, resolution: string) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updateContradiction(id, 'RESOLVED', resolution);
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
      toast('Contradiction resolved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },

  dismissContradiction: async (id: string) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updateContradiction(id, 'DISMISSED');
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
      toast('Contradiction dismissed', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },

  acceptTension: async (id: string) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updateContradiction(id, 'ACCEPTED_TENSION');
      const result = await api.getContradictions('ACTIVE');
      set({ contradictions: result.items, contradictionsTotal: result.total });
      toast('Tension accepted', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
}));
