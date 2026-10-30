import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../../src/lib/api';

/**
 * Entity lists used to stop at OmniMind's default page of 20: a heavy account
 * (40 people, 150 tasks, 60 commitments) showed 20 people in the Delegate
 * search, "3 commitments due ≤7d" instead of 14, "18 active tasks" instead of
 * ~110. The getters now read every page (limit=100) up to a cap of 1000.
 * Invented data only.
 */

function rows(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, name: `Person ${i}`, title: `Item ${i}` }));
}

/** A fake OmniMind list endpoint over `all`, honouring limit/offset like entity.service (default 20, max 100). */
function pagedFetch(all: unknown[]) {
  return vi.fn(async (url: string) => {
    const u = new URL(url, 'http://localhost');
    const limit = Math.min(Number(u.searchParams.get('limit') ?? 20), 100);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const body = { items: all.slice(offset, offset + limit), total: all.length, offset, limit };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
}

describe('entity list getters read every page', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const getters = [
    ['getGoals', '/api/goals'],
    ['getProjects', '/api/projects'],
    ['getTasks', '/api/tasks'],
    ['getPeople', '/api/people'],
    ['getDecisions', '/api/decisions'],
    ['getCommitments', '/api/commitments'],
  ] as const;

  it.each(getters)('%s returns all 240 rows across three pages of 100', async (fn, path) => {
    const fetchMock = pagedFetch(rows(240, fn));
    vi.stubGlobal('fetch', fetchMock);
    const out = await api[fn]();
    expect(out).toHaveLength(240);
    expect(new Set(out.map((r) => r.id)).size).toBe(240);
    const urls = fetchMock.mock.calls.map(([u]) => new URL(u as string, 'http://localhost'));
    expect(urls.map((u) => u.pathname)).toEqual([path, path, path]);
    expect(urls.map((u) => [u.searchParams.get('limit'), u.searchParams.get('offset')])).toEqual([['100', '0'], ['100', '100'], ['100', '200']]);
  });

  it('getPeople: 40 people → one request, all 40 (Delegate search sees every person)', async () => {
    const fetchMock = pagedFetch(rows(40, 'p'));
    vi.stubGlobal('fetch', fetchMock);
    const people = await api.getPeople();
    expect(people).toHaveLength(40);
    expect(people.some((p) => p.name === 'Person 35')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops at the 1000-row cap', async () => {
    const fetchMock = pagedFetch(rows(1500, 't'));
    vi.stubGlobal('fetch', fetchMock);
    const tasks = await api.getTasks();
    expect(tasks).toHaveLength(1000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('stops on a short page even if total is stale', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: rows(7, 'c'), total: 500, offset: 0, limit: 100 }) }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.getCommitments()).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('entity list getters — errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ message: 'upstream' }) }) as unknown as Response));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a failed page rejects (no silent partial list)', async () => {
    await expect(api.getPeople()).rejects.toMatchObject({ status: 502 });
  });
});
