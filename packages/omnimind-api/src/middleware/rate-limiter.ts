import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMITS } from '@boardroom/shared';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// F-209: track the cleanup interval handle so shutdown() can clear it.
// Without this, SIGTERM-driven shutdown leaks the interval and Node has to
// fall back to a hard exit (which also breaks vitest cleanup).
const cleanupHandle = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000);

// Don't keep the process alive solely because of this timer.
cleanupHandle.unref?.();

export function stopRateLimiter(): void {
  clearInterval(cleanupHandle);
}

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  // F-207: previously the limiter dropped entirely when `x-user-id` was absent,
  // which let any caller holding OMNIMIND_API_KEY trivially bypass it by
  // omitting the header. Fall back to the request IP so unauthenticated /
  // header-omitting traffic still hits a bucket.
  const userId = req.headers['x-user-id'] as string | undefined;
  const limitKey = userId ?? req.ip ?? 'unknown';

  const key = `${limitKey}:${req.method}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1-minute window
  const maxRequests = RATE_LIMITS.MAX_QUERIES_PER_MINUTE;

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.status(429).json({
      error: 'rate_limited',
      message: `Rate limit exceeded. Max ${maxRequests} requests per minute.`,
      retryAfter,
    });
    return;
  }

  next();
};
