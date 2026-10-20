import { useEffect } from 'react';
import { create } from 'zustand';
import type { Commitment, Decision, LlmUsageSummary, Memory, OutcomeReviewNudge } from '@boardroom/shared';
import * as api from '../lib/api';
import { startOfUtcWeek, WEEK_MS } from '../components/viz/aggregate';

/**
 * Cached inputs for the dashboard charts. Each slice is fetched once, shared
 * by every widget that needs it, and re-fetched after `VIZ_TTL_MS` (or on
 * `invalidate`). Aggregation itself happens in the widgets via `viz/aggregate`.
 */

export const VIZ_TTL_MS = 60_000;
/** Weeks of history the dashboard charts cover. */
export const VIZ_WINDOW_WEEKS = 12;
/** Days of LLM usage requested so month-to-date and the previous month both fit. */
export const VIZ_USAGE_DAYS = 62;

export interface VizSlice<T> {
  data: T | null;
  fetchedAt: number;
  loading: boolean;
  error: string | null;
}

export type VizKey = 'memories' | 'commitments' | 'decisions' | 'pendingReviews' | 'usage';

interface VizData {
  memories: Memory[];
  commitments: Commitment[];
  decisions: Decision[];
  pendingReviews: OutcomeReviewNudge[];
  usage: LlmUsageSummary;
}

export interface VizState {
  memories: VizSlice<Memory[]>;
  commitments: VizSlice<Commitment[]>;
  decisions: VizSlice<Decision[]>;
  pendingReviews: VizSlice<OutcomeReviewNudge[]>;
  usage: VizSlice<LlmUsageSummary>;
  /** Ensure a slice is fresh (within TTL). Concurrent callers share one request. */
  load: <K extends VizKey>(key: K, force?: boolean) => Promise<VizData[K] | null>;
  /** Drop one slice (or all) so the next `load` refetches — call after a write. */
  invalidate: (key?: VizKey) => void;
  reset: () => void;
}

const empty = <T,>(): VizSlice<T> => ({ data: null, fetchedAt: 0, loading: false, error: null });

/** Start of the 12-week window: Monday 00:00Z, 11 weeks before this week's Monday. */
export function windowStart(now: number = Date.now(), weeks: number = VIZ_WINDOW_WEEKS): Date {
  return new Date(startOfUtcWeek(now).getTime() - (weeks - 1) * WEEK_MS);
}

const FETCHERS: { [K in VizKey]: () => Promise<VizData[K]> } = {
  memories: () => api.listMemoriesSince(windowStart().toISOString()),
  commitments: () => api.getCommitments(),
  decisions: () => api.getDecisions(),
  pendingReviews: () => api.getPendingReviews(),
  usage: () => api.getLlmUsageSummary(VIZ_USAGE_DAYS),
};

const inflight = new Map<VizKey, Promise<unknown>>();

export const useVizStore = create<VizState>((set, get) => ({
  memories: empty(),
  commitments: empty(),
  decisions: empty(),
  pendingReviews: empty(),
  usage: empty(),

  load: async <K extends VizKey>(key: K, force = false) => {
    const slice = get()[key] as VizSlice<VizData[K]>;
    const fresh = slice.data !== null && Date.now() - slice.fetchedAt < VIZ_TTL_MS;
    if (fresh && !force) return slice.data;
    const pending = inflight.get(key) as Promise<VizData[K] | null> | undefined;
    if (pending) return pending;
    set({ [key]: { ...slice, loading: true, error: null } } as Partial<VizState>);
    const p = (FETCHERS[key]() as Promise<VizData[K]>)
      .then((data) => {
        set({ [key]: { data, fetchedAt: Date.now(), loading: false, error: null } } as Partial<VizState>);
        return data;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Could not load';
        set({ [key]: { ...(get()[key] as VizSlice<VizData[K]>), loading: false, error: message } } as Partial<VizState>);
        return null;
      })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  },

  invalidate: (key) => {
    if (key) { set({ [key]: { ...(get()[key] as VizSlice<unknown>), fetchedAt: 0 } } as Partial<VizState>); return; }
    set({
      memories: { ...get().memories, fetchedAt: 0 },
      commitments: { ...get().commitments, fetchedAt: 0 },
      decisions: { ...get().decisions, fetchedAt: 0 },
      pendingReviews: { ...get().pendingReviews, fetchedAt: 0 },
      usage: { ...get().usage, fetchedAt: 0 },
    });
  },

  reset: () => {
    inflight.clear();
    set({ memories: empty(), commitments: empty(), decisions: empty(), pendingReviews: empty(), usage: empty() });
  },
}));

/** Subscribe to a cached dashboard slice and make sure it is loaded (within TTL). */
export function useVizSlice<K extends VizKey>(key: K, enabled = true): VizSlice<VizData[K]> {
  const slice = useVizStore((s) => s[key]) as VizSlice<VizData[K]>;
  const load = useVizStore((s) => s.load);
  useEffect(() => {
    if (enabled) void load(key);
  }, [key, enabled, load]);
  return slice;
}
