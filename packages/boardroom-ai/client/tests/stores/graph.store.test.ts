import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '../../src/lib/api';
import { useGraphStore } from '../../src/stores/graph.store';

vi.mock('../../src/lib/api', () => ({
  spotlightSearchMemories: vi.fn(),
}));

const row = (id: string, score: number) => ({ id, title: `M ${id}`, content: 'body', status: 'CONFIRMED', createdAt: '2026-08-01T00:00:00.000Z', score });

describe('useGraphStore — spotlight', () => {
  beforeEach(() => {
    useGraphStore.getState().clearSpotlight();
    useGraphStore.setState((s) => ({ spotlight: { ...s.spotlight, asOf: null }, paletteMode: 'commands', graphMounted: false, focusRequest: null }));
    vi.clearAllMocks();
  });

  it('runs the hybrid search with the asOf day and keeps hits, cursor and active flag', async () => {
    vi.mocked(api.spotlightSearchMemories).mockResolvedValue({ items: [row('a', 0.9), row('b', 0.4)] as never, nextCursor: 'c1' });
    useGraphStore.setState({ spotlight: { ...useGraphStore.getState().spotlight, asOf: '2026-08-12' } });
    await useGraphStore.getState().runSearch('  pricing  ');
    expect(api.spotlightSearchMemories).toHaveBeenCalledWith({ query: 'pricing', limit: 20, asOfDay: '2026-08-12' });
    const s = useGraphStore.getState().spotlight;
    expect(s.active).toBe(true);
    expect(s.hits.map((h) => h.nodeId)).toEqual(['memory:a', 'memory:b']);
    expect(s.nextCursor).toBe('c1');
    expect(s.loading).toBe(false);
  });

  it('loadMore appends via the cursor and dedupes', async () => {
    vi.mocked(api.spotlightSearchMemories)
      .mockResolvedValueOnce({ items: [row('a', 0.9)] as never, nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [row('a', 0.9), row('c', 0.3)] as never, nextCursor: null });
    await useGraphStore.getState().runSearch('q');
    await useGraphStore.getState().loadMore();
    expect(api.spotlightSearchMemories).toHaveBeenLastCalledWith({ query: 'q', limit: 20, asOfDay: null, cursor: 'c1' });
    const s = useGraphStore.getState().spotlight;
    expect(s.hits.map((h) => h.nodeId)).toEqual(['memory:a', 'memory:c']);
    expect(s.nextCursor).toBeNull();
  });

  it('an empty query clears the result set but keeps the asOf day; clearSpotlight drops in-flight responses', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.spotlightSearchMemories).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    useGraphStore.setState({ spotlight: { ...useGraphStore.getState().spotlight, asOf: '2026-01-01' } });
    const p = useGraphStore.getState().runSearch('slow');
    useGraphStore.getState().clearSpotlight();
    resolve({ items: [row('x', 1)], nextCursor: null });
    await p;
    expect(useGraphStore.getState().spotlight.hits).toEqual([]);
    expect(useGraphStore.getState().spotlight.active).toBe(false);
    expect(useGraphStore.getState().spotlight.asOf).toBe('2026-01-01');
    await useGraphStore.getState().runSearch('   ');
    expect(api.spotlightSearchMemories).toHaveBeenCalledTimes(1);
  });

  it('runSearch("") invalidates an in-flight search so a stale response cannot resurrect hits under an empty query (M1)', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.spotlightSearchMemories).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const p = useGraphStore.getState().runSearch('pricing'); // user types
    await useGraphStore.getState().runSearch('');            // user clears the input before the response lands
    expect(useGraphStore.getState().spotlight.active).toBe(false);
    resolve({ items: [row('a', 0.5)], nextCursor: null });
    await p;
    const s = useGraphStore.getState().spotlight;
    expect(s.query).toBe('');
    expect(s.active).toBe(false);
    expect(s.hits).toEqual([]);
    expect(s.loading).toBe(false);
  });

  it('records errors without losing the previous hits', async () => {
    vi.mocked(api.spotlightSearchMemories).mockResolvedValueOnce({ items: [row('a', 0.9)] as never, nextCursor: null });
    await useGraphStore.getState().runSearch('ok');
    vi.mocked(api.spotlightSearchMemories).mockRejectedValueOnce(new Error('boom'));
    await useGraphStore.getState().runSearch('bad');
    const s = useGraphStore.getState().spotlight;
    expect(s.error).toBe('boom');
    expect(s.hits).toHaveLength(1);
    expect(s.loading).toBe(false);
  });

  it('focus requests are consumed once and the filter toggle flips', () => {
    const st = useGraphStore.getState();
    st.requestFocus('memory:a');
    expect(useGraphStore.getState().focusRequest).toBe('memory:a');
    expect(useGraphStore.getState().consumeFocusRequest()).toBe('memory:a');
    expect(useGraphStore.getState().consumeFocusRequest()).toBeNull();
    st.toggleFilterToResults();
    expect(useGraphStore.getState().spotlight.filterToResults).toBe(true);
  });
});
