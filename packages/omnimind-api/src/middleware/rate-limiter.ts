import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMITS } from '@boardroom/shared';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Clean up expired buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000);

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) {
    next(); // No user ID = no rate limiting (auth will catch unauthorized)
    return;
  }

  const key = `${userId}:${req.method}`;
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
