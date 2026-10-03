/**
 * Tiny in-memory LRU with TTL — the MCP-side replay cache for `memory_write`
 * (R-M-03). OmniMind's `Idempotency-Key` makes each *row write* replay-safe,
 * but a retried `memory_write` still re-ran Haiku fact extraction before it
 * got that far. Caching the whole tool result keyed by
 * `(agentId, userId, idempotencyKey)` short-circuits the retry entirely.
 *
 * Process-local on purpose: the stdio server is one process per agent, and
 * the HTTP server shares this module across sessions, so a client that
 * reconnects after a timeout still hits the cache.
 */
export const REPLAY_CACHE_MAX_ENTRIES = 500;
export const REPLAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruTtlCache<V> {
  private readonly map = new Map<string, Entry<V>>();

  constructor(
    private readonly maxEntries: number = REPLAY_CACHE_MAX_ENTRIES,
    private readonly ttlMs: number = REPLAY_CACHE_TTL_MS,
    private readonly now: () => number = () => Date.now()
  ) {
    if (maxEntries < 1) throw new Error('LruTtlCache: maxEntries must be ≥ 1');
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency: Map preserves insertion order, so re-insert moves it to the tail.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/** Composite key — all three parts are needed: the same key from another agent or for another user is a different request. */
export function replayCacheKey(agentId: string, userId: string, idempotencyKey: string): string {
  return `${agentId}\u0000${userId}\u0000${idempotencyKey}`;
}
