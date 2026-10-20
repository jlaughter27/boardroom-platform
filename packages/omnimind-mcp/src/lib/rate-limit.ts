/**
 * Front door (M-4) — per-IP token bucket for *failed* authentication.
 *
 * Every unauthenticated or rejected request costs one token from the caller's
 * bucket; a request from an IP whose bucket is empty is answered
 * `429 Too Many Requests` with `Retry-After` *before* any credential is
 * resolved — so an attacker streaming `Bearer omt_<nonce>` can no longer turn
 * each request into a `POST /mcp/tokens/introspect` (a DB lookup) on OmniMind.
 * Requests whose credential is already known good (static key, cached
 * positive) are never throttled, so a live client behind the same NAT / proxy
 * keeps working while the bucket is drained by someone else.
 *
 * Defaults: 30 failures per minute per IP, refilled continuously. Buckets are
 * kept in a bounded LRU; a full bucket that has not been touched for a while
 * is simply forgotten (it would be full again anyway).
 */
export const AUTH_FAILURE_CAPACITY = 30;
export const AUTH_FAILURE_REFILL_PER_MINUTE = 30;
export const AUTH_FAILURE_MAX_BUCKETS = 10_000;

export interface AuthFailureLimiterOptions {
  /** Failures allowed in a burst (default 30). */
  capacity?: number;
  /** Sustained failures per minute (default 30). */
  refillPerMinute?: number;
  /** Distinct IPs tracked at once (default 10,000; least-recently-seen evicted). */
  maxBuckets?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface LimitDecision {
  limited: boolean;
  /** Whole seconds until one token is available again (≥ 1 when `limited`). */
  retryAfterS: number;
}

export class AuthFailureLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;

  constructor(opts: AuthFailureLimiterOptions = {}) {
    this.capacity = opts.capacity ?? AUTH_FAILURE_CAPACITY;
    this.maxBuckets = opts.maxBuckets ?? AUTH_FAILURE_MAX_BUCKETS;
    this.now = opts.now ?? (() => Date.now());
    const perMinute = opts.refillPerMinute ?? AUTH_FAILURE_REFILL_PER_MINUTE;
    if (!(this.capacity >= 1) || !(perMinute > 0) || !(this.maxBuckets >= 1)) {
      throw new Error('AuthFailureLimiter: capacity ≥ 1, refillPerMinute > 0 and maxBuckets ≥ 1 are required');
    }
    this.refillPerMs = perMinute / 60_000;
  }

  private bucket(key: string): Bucket {
    const t = this.now();
    let b = this.buckets.get(key);
    if (b) {
      b.tokens = Math.min(this.capacity, b.tokens + (t - b.updatedAt) * this.refillPerMs);
      b.updatedAt = t;
      // Refresh recency (Map keeps insertion order).
      this.buckets.delete(key);
    } else {
      b = { tokens: this.capacity, updatedAt: t };
    }
    this.buckets.set(key, b);
    while (this.buckets.size > this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
    return b;
  }

  /** Is this key out of failure budget right now? (Does not consume.) */
  check(key: string): LimitDecision {
    const b = this.bucket(key);
    if (b.tokens >= 1) return { limited: false, retryAfterS: 0 };
    return { limited: true, retryAfterS: Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerMs / 1000)) };
  }

  /** Record one failed / unauthenticated attempt for this key. */
  recordFailure(key: string): void {
    const b = this.bucket(key);
    b.tokens = Math.max(0, b.tokens - 1);
  }

  get size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }
}

/**
 * The client address a request is attributed to. The socket's peer by default;
 * the right-most `X-Forwarded-For` entry (the one appended by the nearest
 * proxy, i.e. Railway's edge) only when `trustProxy` is on — an attacker can
 * put anything in that header, so honouring it must be an operator decision.
 */
export function clientIpOf(
  req: { socket?: { remoteAddress?: string | null }; headers: Record<string, string | string[] | undefined> },
  trustProxy: boolean
): string {
  if (trustProxy) {
    const raw = req.headers['x-forwarded-for'];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const last = value?.split(',').pop()?.trim();
    if (last) return last;
  }
  return req.socket?.remoteAddress || 'unknown';
}
