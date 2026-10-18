import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMemoryStore } from '../../src/stores/memory.store';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  listMemories: vi.fn(),
  hybridSearchMemories: vi.fn(),
  updateMemory: vi.fn(),
  archiveMemory: vi.fn(),
}));

vi.mock('../../src/components/ui/Toast', () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

const row = (id: string, score: number, extra: Record<string, unknown> = {}) =>
  ({ id, title: `M ${id}`, content: 'body', tags: ['t'], status: 'CONFIRMED', createdAt: '2026-08-01T00:00:00.000Z', score, ...extra });

describe('useMemoryStore — hybrid engine (Memory Explorer)', () => {
  beforeEach(() => {
    useMemoryStore.getState().reset();
    useMemoryStore.setState({ engine: 'hybrid' });
    vi.clearAllMocks();
  });

  it('sends q, tags, asOf (end of day, UTC) and includeArchived to POST /memories/search', async () => {
    vi.mocked(api.hybridSearchMemories).mockResolvedValue({ items: [row('a', 0.8, { layers: ['semantic'] }), row('b', 0.3)] as never, nextCursor: 'c1' });
    await useMemoryStore.getState().search({ q: 'pricing', tags: ['sales', 'q3'], asOf: '2026-08-12', includeArchived: true, domain: 'business', status: 'CONFIRMED' });
    expect(api.hybridSearchMemories).toHaveBeenCalledWith({
      query: 'pricing',
      limit: 20,
      domain: 'business',
      status: 'CONFIRMED',
      tags: ['sales', 'q3'],
      includeArchived: true,
      asOf: '2026-08-12T23:59:59.999Z',
    });
    expect(api.listMemories).not.toHaveBeenCalled();
    const s = useMemoryStore.getState();
    expect(s.hybridActive).toBe(true);
    expect(s.memories.map((m) => m.id)).toEqual(['a', 'b']);
    expect(s.scores).toEqual({ a: 0.8, b: 0.3 });
    expect(s.layers).toEqual({ a: ['semantic'] });
    expect(s.nextCursor).toBe('c1');
    expect(s.isLoading).toBe(false);
  });

  it('falls back to the list endpoint for an empty query (tags comma-joined, asOf / archived dropped)', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
    await useMemoryStore.getState().search({ tags: ['a', 'b'], asOf: '2026-08-12', includeArchived: true });
    expect(api.hybridSearchMemories).not.toHaveBeenCalled();
    expect(api.listMemories).toHaveBeenCalledWith({ tags: 'a,b', limit: 20, offset: 0 });
    expect(useMemoryStore.getState().hybridActive).toBe(false);
  });

  it('loadMore pages with the cursor and dedupes rows', async () => {
    vi.mocked(api.hybridSearchMemories)
      .mockResolvedValueOnce({ items: [row('a', 0.8)] as never, nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [row('a', 0.8), row('c', 0.2)] as never, nextCursor: null });
    await useMemoryStore.getState().search({ q: 'x' });
    await useMemoryStore.getState().loadMore();
    expect(api.hybridSearchMemories).toHaveBeenLastCalledWith({ query: 'x', limit: 20, cursor: 'c1' });
    const s = useMemoryStore.getState();
    expect(s.memories.map((m) => m.id)).toEqual(['a', 'c']);
    expect(s.nextCursor).toBeNull();
    // exhausted → no further call
    await useMemoryStore.getState().loadMore();
    expect(api.hybridSearchMemories).toHaveBeenCalledTimes(2);
  });

  it('the default engine stays on the list endpoint even with a query (legacy callers)', async () => {
    useMemoryStore.setState({ engine: 'list' });
    vi.mocked(api.listMemories).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
    await useMemoryStore.getState().search({ q: 'x' });
    expect(api.listMemories).toHaveBeenCalledWith({ q: 'x', limit: 20, offset: 0 });
    expect(api.hybridSearchMemories).not.toHaveBeenCalled();
  });

  it('setFilters drops empty tag lists and re-searches', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
    useMemoryStore.getState().setFilters({ tags: [] });
    await Promise.resolve();
    expect(useMemoryStore.getState().filters.tags).toBeUndefined();
  });
});
