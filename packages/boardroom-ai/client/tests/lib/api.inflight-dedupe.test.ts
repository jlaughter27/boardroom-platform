import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from '../../src/lib/api';

/**
 * M2-C1 — a dashboard load fired identical GETs concurrently (outcome reviews
 * ×3 at once). `request` now coalesces identical in-flight GETs: same URL →
 * one fetch, one promise; removed on settle, so it is never a cache and a
 * failure never poisons a later call. Invented data only.
 */

interface Deferred { resolve: (body: unknown) => void; reject: (err: unknown) => void; fail: (status: number) => void }

/** A fetch whose responses the test settles by hand, in call order. */
function manualFetch() {
  const pending: Deferred[] = [];
  const fn = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    pending.push({
      resolve: (body) => resolve({ ok: true, status: 200, json: async () => body } as unknown as Response),
      reject,
      fail: (status) => resolve({ ok: false, status, json: async () => ({ message: `boom ${status}` }) } as unknown as Response),
    });
  }));
  return { fn, pending };
}

const profile = { id: 'up-1', userId: 'u-1', onboardingComplete: true, dashboardLayout: [] };

describe('api request: identical concurrent GETs share one fetch', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('two concurrent identical GETs → one fetch; both callers get the body', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.getUserProfile();
    const b = api.getUserProfile();
    expect(fn).toHaveBeenCalledTimes(1);
    pending[0].resolve(profile);
    await expect(a).resolves.toEqual(profile);
    await expect(b).resolves.toEqual(profile);
  });

  it('callers get independent copies (one mutating its result cannot change the other\'s)', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.getUserProfile();
    const b = api.getUserProfile();
    pending[0].resolve({ ...profile, dashboardLayout: [{ id: 'w1' }] });
    const [ra, rb] = await Promise.all([a, b]);
    (ra.dashboardLayout as unknown as unknown[]).push({ id: 'w2' });
    expect(rb.dashboardLayout).toHaveLength(1);
  });

  it('different URLs → two fetches', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.getLlmUsageSummary(7);
    const b = api.getLlmUsageSummary(62);
    expect(fn).toHaveBeenCalledTimes(2);
    pending[0].resolve({ days: 7 });
    pending[1].resolve({ days: 62 });
    expect((await a).days).toBe(7);
    expect((await b).days).toBe(62);
  });

  it('not a cache: a GET after the first settled fetches again', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.getUserProfile();
    pending[0].resolve(profile);
    await a;
    const b = api.getUserProfile();
    expect(fn).toHaveBeenCalledTimes(2);
    pending[1].resolve({ ...profile, onboardingComplete: false });
    expect((await b).onboardingComplete).toBe(false);
  });

  it('a failed request rejects every joined caller and does not poison the next one', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.getPendingReviews();
    const b = api.getPendingReviews();
    expect(fn).toHaveBeenCalledTimes(1);
    pending[0].fail(503);
    await expect(a).rejects.toMatchObject({ status: 503 });
    await expect(b).rejects.toMatchObject({ status: 503 });
    const c = api.getPendingReviews();
    expect(fn).toHaveBeenCalledTimes(2);
    pending[1].resolve([]);
    await expect(c).resolves.toEqual([]);
  });

  it('a network error (fetch rejects) is not poisoning either', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.getPendingReviews();
    pending[0].reject(new TypeError('Failed to fetch'));
    await expect(a).rejects.toThrow('Failed to fetch');
    const b = api.getPendingReviews();
    expect(fn).toHaveBeenCalledTimes(2);
    pending[1].resolve([]);
    await expect(b).resolves.toEqual([]);
  });

  it('never coalesces writes', async () => {
    const { fn, pending } = manualFetch();
    vi.stubGlobal('fetch', fn);
    const a = api.updateUserProfile({ dashboardLayout: [] });
    const b = api.updateUserProfile({ dashboardLayout: [] });
    expect(fn).toHaveBeenCalledTimes(2);
    pending[0].resolve(profile);
    pending[1].resolve(profile);
    await Promise.all([a, b]);
  });
});
