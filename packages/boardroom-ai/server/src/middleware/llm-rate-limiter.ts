// B-110 — Per-user token bucket for LLM-backed endpoints (dispatch, synthesize,
// cortex scans, Gmail extraction, onboarding bootstrap, ...). Keyed on
// req.auth.userId. In-memory, per-process (same trade-off as the other
// limiters — see "Known Limitations" in .claude/CLAUDE.md).
//
// Env (both optional):
//   LLM_RATE_LIMIT_PER_HOUR   bucket capacity AND refill per window (default 60)
//   LLM_RATE_LIMIT_WINDOW_MS  refill window (default 3_600_000 = 1h)

import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

const buckets = new Map<string, Bucket>();

function capacity(): number {
  const n = Number(process.env.LLM_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function windowMs(): number {
  const n = Number(process.env.LLM_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000;
}

/** Refill the bucket proportionally to elapsed time, then try to take one token. */
function take(key: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
  const cap = capacity();
  const win = windowMs();
  const refillPerMs = cap / win;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: cap, lastRefillAt: now };
    buckets.set(key, bucket);
  } else {
    const elapsed = Math.max(0, now - bucket.lastRefillAt);
    bucket.tokens = Math.min(cap, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillAt = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterSec: 0 };
  }
  const deficitMs = (1 - bucket.tokens) / refillPerMs;
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil(deficitMs / 1000)) };
}

export function llmRateLimiter(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.auth) { next(); return; }
  const { ok, retryAfterSec } = take(req.auth.userId);
  if (!ok) {
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'rate_limited',
      message: `LLM request limit reached (${capacity()} per ${Math.round(windowMs() / 60000)} min)`,
      retryAfter: retryAfterSec,
    });
    return;
  }
  next();
}

// Test helper — not used by runtime code.
export function __resetLlmBucketsForTest(): void {
  buckets.clear();
}

// Evict idle buckets periodically so the map cannot grow unbounded.
const sweeper = setInterval(() => {
  const now = Date.now();
  const idle = windowMs() * 2;
  for (const [key, b] of buckets) if (now - b.lastRefillAt > idle) buckets.delete(key);
}, 10 * 60 * 1000);
sweeper.unref?.();
