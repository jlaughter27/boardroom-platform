import type { Request, Response, NextFunction } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const loginBuckets = new Map<string, RateBucket>();
const registerBuckets = new Map<string, RateBucket>();

// Clean expired buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of loginBuckets) if (bucket.resetAt < now) loginBuckets.delete(key);
  for (const [key, bucket] of registerBuckets) if (bucket.resetAt < now) registerBuckets.delete(key);
}, 5 * 60 * 1000);

function createLimiter(buckets: Map<string, RateBucket>, maxAttempts: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count++;
    if (bucket.count > maxAttempts) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Please try again later.', retryAfter });
      return;
    }
    next();
  };
}

// Login: 5 attempts per 15 minutes per IP
export const loginLimiter = createLimiter(loginBuckets, 5, 15 * 60 * 1000);
// Register: 3 attempts per hour per IP
export const registerLimiter = createLimiter(registerBuckets, 3, 60 * 60 * 1000);
