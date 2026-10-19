/**
 * M-2 — `DeferredWorkQueue`: clients it owns close only once released AND
 * idle; `drain()` waits (bounded) for in-flight work; `close()` abandons
 * what is still running after the timeout and closes everything.
 */
import { describe, it, expect, vi } from 'vitest';
import { DeferredWorkQueue } from '../src/lib/deferred-work';
import { OmniMindClient } from '../src/lib/client';

function client(): OmniMindClient {
  return new OmniMindClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'x' });
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('DeferredWorkQueue', () => {
  it('a released client with in-flight work stays open until that work settles, then closes', async () => {
    const q = new DeferredWorkQueue(() => {});
    const c = client();
    const work = deferred();
    q.adopt(c);
    q.track(c, work.promise);
    expect(q.size).toBe(1);
    q.release(c); // the session ended (DELETE / idle sweep / eviction)
    expect(c.isClosed).toBe(false); // still usable by the running extraction
    expect(q.clientCount).toBe(1);
    work.resolve();
    await new Promise(r => setImmediate(r));
    expect(c.isClosed).toBe(true);
    expect(q.size).toBe(0);
    expect(q.clientCount).toBe(0);
  });

  it('a released idle client closes immediately; an unadopted client is closed on release too', () => {
    const q = new DeferredWorkQueue(() => {});
    const a = client();
    q.adopt(a);
    q.release(a);
    expect(a.isClosed).toBe(true);
    const b = client();
    q.release(b);
    expect(b.isClosed).toBe(true);
  });

  it('a client that is still owned by a live session is NOT closed when its work finishes', async () => {
    const q = new DeferredWorkQueue(() => {});
    const c = client();
    const work = deferred();
    q.track(c, work.promise);
    work.resolve();
    await new Promise(r => setImmediate(r));
    expect(c.isClosed).toBe(false);
    expect(q.clientCount).toBe(1);
  });

  it('failures are logged, never thrown, and still count as settled', async () => {
    const lines: string[] = [];
    const q = new DeferredWorkQueue(l => lines.push(l));
    const c = client();
    q.track(c, Promise.reject(new Error('Haiku down')));
    q.release(c);
    await new Promise(r => setImmediate(r));
    expect(lines.some(l => /deferred work failed: Haiku down/.test(l))).toBe(true);
    expect(q.size).toBe(0);
    expect(c.isClosed).toBe(true);
  });

  it('drain() waits for in-flight work (including work added while waiting) and reports remaining on timeout', async () => {
    vi.useFakeTimers();
    try {
      const q = new DeferredWorkQueue(() => {});
      const c = client();
      const first = deferred();
      const second = deferred();
      q.track(c, first.promise);
      const draining = q.drain(5_000);
      await vi.advanceTimersByTimeAsync(100);
      q.track(c, second.promise); // a write racing shutdown
      first.resolve();
      await vi.advanceTimersByTimeAsync(100);
      second.resolve();
      await expect(draining).resolves.toMatchObject({ remaining: 0 });

      const stuck = deferred();
      q.track(c, stuck.promise);
      const timedOut = q.drain(1_000);
      await vi.advanceTimersByTimeAsync(1_100);
      await expect(timedOut).resolves.toMatchObject({ remaining: 1 });
      expect(c.isClosed).toBe(false); // drain never closes
      stuck.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() drains, logs what it had to abandon and closes every owned client', async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const q = new DeferredWorkQueue(l => lines.push(l));
      const a = client();
      const b = client();
      const done = deferred();
      const stuck = deferred();
      q.track(a, done.promise);
      q.track(b, stuck.promise);
      const closing = q.close(2_000);
      done.resolve();
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(closing).resolves.toMatchObject({ remaining: 1 });
      expect(a.isClosed).toBe(true);
      expect(b.isClosed).toBe(true);
      expect(q.clientCount).toBe(0);
      expect(lines.some(l => /1 deferred extraction\(s\) still running/.test(l))).toBe(true);
      stuck.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
