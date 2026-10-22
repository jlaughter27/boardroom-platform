import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Memory } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { useVizStore, windowStart, VIZ_TTL_MS } from '../../../src/stores/viz.store';

vi.mock('../../../src/lib/api', () => ({
  listMemoriesSince: vi.fn(),
  getCommitments: vi.fn(),
  getDecisions: vi.fn(),
  getPendingReviews: vi.fn(),
  getLlmUsageSummary: vi.fn(),
}));

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

describe('viz.store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useVizStore.getState().reset();
    vi.mocked(api.listMemoriesSince).mockResolvedValue([{ id: 'm1' } as Memory]);
    vi.mocked(api.getCommitments).mockResolvedValue([]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('windowStart is the Monday 11 weeks before this week (UTC)', () => {
    expect(windowStart(NOW).toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('fetches once, shares the in-flight promise, and honours the 60 s TTL', async () => {
    const s = useVizStore.getState();
    const [a, b] = await Promise.all([s.load('memories'), s.load('memories')]);
    expect(a).toEqual(b);
    expect(api.listMemoriesSince).toHaveBeenCalledTimes(1);
    expect(api.listMemoriesSince).toHaveBeenCalledWith('2026-08-03T00:00:00.000Z');
    expect(useVizStore.getState().memories.data).toHaveLength(1);

    await s.load('memories');
    expect(api.listMemoriesSince).toHaveBeenCalledTimes(1); // still fresh

    vi.setSystemTime(NOW + VIZ_TTL_MS + 1);
    await s.load('memories');
    expect(api.listMemoriesSince).toHaveBeenCalledTimes(2); // stale → refetch

    s.invalidate('memories');
    await s.load('memories');
    expect(api.listMemoriesSince).toHaveBeenCalledTimes(3);

    await s.load('memories', true);
    expect(api.listMemoriesSince).toHaveBeenCalledTimes(4);
  });

  it('records the error and keeps the slice usable', async () => {
    vi.mocked(api.getCommitments).mockRejectedValueOnce(new Error('503'));
    const out = await useVizStore.getState().load('commitments');
    expect(out).toBeNull();
    const slice = useVizStore.getState().commitments;
    expect(slice.error).toBe('503');
    expect(slice.loading).toBe(false);
    expect(slice.data).toBeNull();
    await useVizStore.getState().load('commitments');
    expect(useVizStore.getState().commitments.data).toEqual([]);
    expect(useVizStore.getState().commitments.error).toBeNull();
  });
});

describe('api.listMemoriesSince paging', () => {
  it('walks pages until a short page or the total', async () => {
    vi.doUnmock('../../../src/lib/api');
    vi.resetModules();
    const real = await import('../../../src/lib/api');
    const pages = [Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })), Array.from({ length: 20 }, (_, i) => ({ id: `b${i}` }))];
    let call = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('since=2026-08-03');
      expect(url).toContain('sortBy=createdAt');
      const items = pages[call++] ?? [];
      return new Response(JSON.stringify({ items, total: 120, offset: 0, limit: 100 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await real.listMemoriesSince('2026-08-03T00:00:00.000Z');
    expect(out).toHaveLength(120);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('offset=100');
    vi.unstubAllGlobals();
  });
});
