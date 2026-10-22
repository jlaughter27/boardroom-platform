/**
 * Front door (M-2) — work that must outlive the MCP session that started it.
 *
 * `memory_write` in `OMNIMIND_MCP_WRITE_EXTRACT=async` mode answers as soon as
 * the raw row exists and extracts facts afterwards. That tail used to run on
 * the per-session OmniMind client, which `closeSession()` marks closed on
 * DELETE / idle sweep / cap eviction / shutdown — so a client that wrote and
 * then hung up within the 2-5 s Haiku takes lost every fact and the
 * `memory_write:extract` audit row. The HTTP app now gives every session a
 * second, *deferred* client bound to the same principal (same delegation or
 * identity headers) that this queue owns: the session's own client still
 * closes with the session, the deferred one closes only once the work tracked
 * against it has finished, and `close()` drains in-flight work (bounded) before
 * the process exits.
 */
import type { OmniMindClient } from './client';

export const DEFERRED_DRAIN_TIMEOUT_MS = 30_000;

/**
 * M1-B2 — waits before each attempt of an extraction that was deferred because
 * the extractor had *just* failed (sync-mode `memory_write` stores the raw row
 * and retries extraction in the background instead of refusing). Retrying at
 * once would only hit the same outage, so even the first attempt waits.
 * Work still sleeping when the process shuts down is abandoned after the drain
 * timeout; the raw row is already stored, so nothing is lost but the facts.
 */
export const DEFERRED_EXTRACTION_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];

/** Promise-based sleep whose timer never keeps the process alive. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

export interface RetryWithDelaysOptions {
  /** One attempt per entry; each attempt first waits that many ms. Must be non-empty. */
  delaysMs: readonly number[];
  /** Only errors this returns true for are retried; anything else is thrown at once. */
  retryIf: (err: unknown) => boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `fn` up to `delaysMs.length` times, sleeping `delaysMs[i]` before attempt
 * `i`. Resolves with the first success; rejects with the last error once the
 * attempts are used up, or immediately on an error `retryIf` rejects.
 */
export async function retryWithDelays<T>(fn: (attempt: number) => Promise<T>, opts: RetryWithDelaysOptions): Promise<T> {
  if (opts.delaysMs.length === 0) throw new Error('retryWithDelays: delaysMs must not be empty');
  const wait = opts.sleep ?? sleep;
  for (let attempt = 0; ; attempt++) {
    await wait(opts.delaysMs[attempt]);
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.delaysMs.length - 1 || !opts.retryIf(err)) throw err;
    }
  }
}

interface Owned {
  inflight: number;
  /** The owning session is gone: close as soon as `inflight` reaches 0. */
  released: boolean;
}

export interface DrainResult {
  /** In-flight items still running when the wait gave up (0 when fully drained). */
  remaining: number;
  waitedMs: number;
}

export class DeferredWorkQueue {
  private readonly owned = new Map<OmniMindClient, Owned>();
  private readonly inflight = new Set<Promise<void>>();
  private closed = false;

  constructor(private readonly log: (line: string) => void = line => console.log(line)) {}

  /** Register a long-lived client; the queue closes it once released and idle. */
  adopt(client: OmniMindClient): void {
    if (!this.owned.has(client)) this.owned.set(client, { inflight: 0, released: false });
  }

  /** Track one unit of deferred work bound to `client` (the promise is expected to be error-handled already). */
  track(client: OmniMindClient, done: Promise<void>): void {
    this.adopt(client);
    const entry = this.owned.get(client) as Owned;
    entry.inflight++;
    const settled: Promise<void> = done.catch(err => {
      this.log(`[omnimind-mcp] deferred work failed: ${(err as Error).message}`);
    }).finally(() => {
      this.inflight.delete(settled);
      entry.inflight--;
      if (entry.released && entry.inflight === 0) this.forget(client);
    });
    this.inflight.add(settled);
  }

  /** The owning session ended. Closes the client now when idle, otherwise after its last tracked item settles. */
  release(client: OmniMindClient): void {
    const entry = this.owned.get(client);
    if (!entry) {
      client.close();
      return;
    }
    entry.released = true;
    if (entry.inflight === 0) this.forget(client);
  }

  private forget(client: OmniMindClient): void {
    this.owned.delete(client);
    client.close();
  }

  /** Number of deferred items currently running. */
  get size(): number {
    return this.inflight.size;
  }

  /** Clients the queue currently owns (tests / diagnostics). */
  get clientCount(): number {
    return this.owned.size;
  }

  /** Wait for in-flight work to settle, at most `timeoutMs`. Never rejects. */
  async drain(timeoutMs = DEFERRED_DRAIN_TIMEOUT_MS): Promise<DrainResult> {
    const started = Date.now();
    if (this.inflight.size === 0) return { remaining: 0, waitedMs: 0 };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });
    // Items may be added while we wait (a write racing shutdown); loop until the set is empty or time is up.
    while (this.inflight.size > 0) {
      const outcome = await Promise.race([Promise.all(Array.from(this.inflight)).then(() => 'done' as const), timeout]);
      if (outcome === 'timeout') break;
    }
    if (timer) clearTimeout(timer);
    return { remaining: this.inflight.size, waitedMs: Date.now() - started };
  }

  /** Drain (bounded), then close every owned client. Later `track` calls still run but their client is closed. */
  async close(timeoutMs = DEFERRED_DRAIN_TIMEOUT_MS): Promise<DrainResult> {
    if (this.closed) return { remaining: this.inflight.size, waitedMs: 0 };
    this.closed = true;
    const result = await this.drain(timeoutMs);
    if (result.remaining > 0) {
      this.log(`[omnimind-mcp] shutdown: ${result.remaining} deferred extraction(s) still running after ${Math.round(result.waitedMs / 1000)}s — abandoning (raw rows are kept)`);
    }
    for (const client of Array.from(this.owned.keys())) this.forget(client);
    return result;
  }
}
