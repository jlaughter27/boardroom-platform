import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMITS } from '@boardroom/shared';
import { logger } from '../lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redis: any = null;
let useRedis = false;

// Attempt to load Redis client
async function initRedis(): Promise<void> {
  if (redis || !process.env.REDIS_URL) return;
  
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - ioredis types may not be available
    const Redis = await import('ioredis');
    redis = new Redis.default(process.env.REDIS_URL);
    useRedis = true;
    logger.info('Redis rate limiter initialized');
    
    redis.on('error', (err: unknown) => {
      logger.error('Redis connection error', { error: (err as Error).message });
      useRedis = false;
    });
  } catch {
    logger.warn('ioredis not available, using in-memory rate limiting');
    useRedis = false;
  }
}

// Initialize on first use
void initRedis();

interface RateBucket {
  count: number;
  resetAt: number;
}

// Fallback in-memory buckets
const buckets = new Map<string, RateBucket>();

// Clean up expired buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000);

// Sliding window rate limiting with Redis
async function checkRedisRateLimit(key: string, maxRequests: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redis || !useRedis) {
    return { allowed: true, remaining: maxRequests, resetAt: Date.now() + windowMs };
  }

  const now = Date.now();
  const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;
  
  try {
    // Increment counter
    const count = await redis.incr(windowKey);
    
    // Set expiry on first increment
    if (count === 1) {
      await redis.pexpire(windowKey, windowMs);
    }
    
    // Get sliding window count (current + previous half-window)
    const prevWindowKey = `ratelimit:${key}:${Math.floor((now - windowMs / 2) / windowMs)}`;
    const prevCount = await redis.get(prevWindowKey) || 0;
    
    // Weighted sliding window calculation
    const timeIntoCurrent = (now % windowMs) / windowMs;
    const weightedCount = Math.floor(Number(prevCount) * (1 - timeIntoCurrent)) + count;
    
    const allowed = weightedCount <= maxRequests;
    const remaining = Math.max(0, maxRequests - weightedCount);
    const resetAt = now + windowMs - (now % windowMs);
    
    return { allowed, remaining, resetAt };
  } catch (err) {
    logger.error('Redis rate limit check failed', { error: (err as Error).message });
    // Fail open - allow request if Redis is down
    return { allowed: true, remaining: maxRequests, resetAt: now + windowMs };
  }
}

// In-memory rate limiting for fallback
function checkMemoryRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  
  bucket.count++;
  const allowed = bucket.count <= maxRequests;
  const remaining = Math.max(0, maxRequests - bucket.count);
  
  return { allowed, remaining, resetAt: bucket.resetAt };
}

// Main rate limiter middleware
export const rateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  const ip = req.ip || 'unknown';
  
  // Use userId for authenticated requests, IP for unauthenticated
  const key = userId ? `${userId}` : `ip:${ip}`;
  const windowMs = 60 * 1000; // 1-minute window
  const maxRequests = userId ? RATE_LIMITS.MAX_QUERIES_PER_MINUTE : Math.floor(RATE_LIMITS.MAX_QUERIES_PER_MINUTE / 2); // Stricter for unauthenticated

  let result: { allowed: boolean; remaining: number; resetAt: number };
  
  if (useRedis && redis) {
    result = await checkRedisRateLimit(key, maxRequests, windowMs);
  } else {
    result = checkMemoryRateLimit(`${key}:${req.method}`, maxRequests, windowMs);
  }

  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    logger.warn('Rate limit exceeded', { userId: userId?.substring(0, 10), ip, path: req.path });
    res.status(429).json({
      error: 'rate_limited',
      message: `Rate limit exceeded. Max ${maxRequests} requests per minute.`,
      retryAfter,
    });
    return;
  }

  next();
};

// Health check for rate limiter
export async function getRateLimiterStatus(): Promise<{ type: 'redis' | 'memory'; healthy: boolean }> {
  if (useRedis && redis) {
    try {
      await redis.ping();
      return { type: 'redis', healthy: true };
    } catch {
      return { type: 'redis', healthy: false };
    }
  }
  return { type: 'memory', healthy: true };
}
