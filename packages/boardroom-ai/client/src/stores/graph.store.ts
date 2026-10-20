import { create } from 'zustand';
import * as api from '../lib/api';
import { memoryRowToHit, type HybridSearchRow, type SpotlightHit } from '../components/graph/graph-search';
import type { Community } from '../components/graph/graph-communities';

/**
 * Spotlight search state shared between the ⌘K palette and the graph page.
 *
 * The palette runs the hybrid search; the graph page (when mounted) reads the
 * hits and lights them up. State lives here — not in either component — so a
 * search started elsewhere is still active when the user lands on /graph.
 */

export type PaletteMode = 'commands' | 'memory';

export interface SpotlightSearchState {
  query: string;
  /** `YYYY-MM-DD` or null for "now" */
  asOf: string | null;
  hits: SpotlightHit[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  /** True once a search has produced a result set for the current query */
  active: boolean;
  /** Hide non-hits in the graph instead of fading them */
  filterToResults: boolean;
}

export interface GraphStoreState {
  spotlight: SpotlightSearchState;
  paletteMode: PaletteMode;
  /** Set by GraphPage while it is mounted; the palette focuses in place instead of navigating */
  graphMounted: boolean;
  /** A node id the graph page should focus next (consumed by the page) */
  focusRequest: string | null;
  /** Louvain partition of the loaded graph: node id → stable community id (written by GraphPage, read by hulls / palette) */
  communityOf: ReadonlyMap<string, number>;
  communities: readonly Community[];

  setPaletteMode(mode: PaletteMode): void;
  setAsOf(day: string | null): void;
  runSearch(query: string): Promise<void>;
  loadMore(): Promise<void>;
  clearSpotlight(): void;
  toggleFilterToResults(): void;
  setGraphMounted(mounted: boolean): void;
  requestFocus(nodeId: string): void;
  consumeFocusRequest(): string | null;
  setCommunities(communityOf: ReadonlyMap<string, number>, communities: readonly Community[]): void;
}

const PAGE = 20;

const emptySpotlight = (): SpotlightSearchState => ({
  query: '',
  asOf: null,
  hits: [],
  nextCursor: null,
  loading: false,
  error: null,
  active: false,
  filterToResults: false,
});

let seq = 0;

export const useGraphStore = create<GraphStoreState>((set, get) => ({
  spotlight: emptySpotlight(),
  paletteMode: 'commands',
  graphMounted: false,
  focusRequest: null,
  communityOf: new Map(),
  communities: [],

  setPaletteMode: (paletteMode) => set({ paletteMode }),

  setAsOf: (asOf) => {
    const { spotlight } = get();
    set({ spotlight: { ...spotlight, asOf } });
    if (spotlight.query.trim()) void get().runSearch(spotlight.query);
  },

  runSearch: async (query) => {
    const q = query.trim();
    const { spotlight } = get();
    if (!q) {
      seq += 1; // an in-flight search for the previous text must not resurrect hits under an empty query
      set({ spotlight: { ...emptySpotlight(), asOf: spotlight.asOf, filterToResults: spotlight.filterToResults } });
      return;
    }
    const mySeq = ++seq;
    set({ spotlight: { ...spotlight, query: q, loading: true, error: null } });
    try {
      const res = await api.spotlightSearchMemories({ query: q, limit: PAGE, asOfDay: spotlight.asOf });
      if (mySeq !== seq) return;
      const hits = (res.items as HybridSearchRow[]).map(memoryRowToHit);
      set({ spotlight: { ...get().spotlight, hits, nextCursor: res.nextCursor ?? null, loading: false, active: true } });
    } catch (e) {
      if (mySeq !== seq) return;
      set({ spotlight: { ...get().spotlight, loading: false, error: e instanceof Error ? e.message : 'Search failed' } });
    }
  },

  loadMore: async () => {
    const { spotlight } = get();
    if (!spotlight.nextCursor || spotlight.loading || !spotlight.query) return;
    const mySeq = seq;
    set({ spotlight: { ...spotlight, loading: true } });
    try {
      const res = await api.spotlightSearchMemories({ query: spotlight.query, limit: PAGE, asOfDay: spotlight.asOf, cursor: spotlight.nextCursor });
      if (mySeq !== seq) return;
      const seen = new Set(get().spotlight.hits.map((h) => h.nodeId));
      const more = (res.items as HybridSearchRow[]).map(memoryRowToHit).filter((h) => !seen.has(h.nodeId));
      set({ spotlight: { ...get().spotlight, hits: [...get().spotlight.hits, ...more], nextCursor: res.nextCursor ?? null, loading: false } });
    } catch (e) {
      if (mySeq !== seq) return;
      set({ spotlight: { ...get().spotlight, loading: false, error: e instanceof Error ? e.message : 'Search failed' } });
    }
  },

  clearSpotlight: () => {
    seq += 1; // drop in-flight responses
    const { asOf } = get().spotlight;
    set({ spotlight: { ...emptySpotlight(), asOf } });
  },

  toggleFilterToResults: () => set((s) => ({ spotlight: { ...s.spotlight, filterToResults: !s.spotlight.filterToResults } })),

  setGraphMounted: (graphMounted) => set({ graphMounted }),

  requestFocus: (focusRequest) => set({ focusRequest }),

  consumeFocusRequest: () => {
    const id = get().focusRequest;
    if (id) set({ focusRequest: null });
    return id;
  },

  setCommunities: (communityOf, communities) => set({ communityOf, communities }),
}));
