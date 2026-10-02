import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMITS } from '@boardroom/shared';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Clean up expired buckets every 5 minutes.
// F-209/F-211: keep the handle so shutdown can clear it, and unref() so a
// pending timer never keeps the process (or vitest) alive on its own.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000);
(cleanupInterval as { unref?: () => void }).unref?.();

export function stopRateLimiterCleanup(): void {
  clearInterval(cleanupInterval);
}

/**
 * IP-keyed buckets aggregate every caller behind one address (BoardRoom's
 * Railway instance, an MCP host running several agents), so they get a wider
 * budget than a single user. Tunable via IP_RATE_LIMIT_MULTIPLIER.
 */
export const IP_BUCKET_MULTIPLIER = Math.max(1, parseInt(process.env.IP_RATE_LIMIT_MULTIPLIER ?? '5', 10) || 5);

/**
 * F-105/F-207: never skip. Key precedence:
 *   1. `x-user-id`                (per-user, the normal BoardRoom/MCP case)
 *   2. agent identity             (per-agent, for agent calls without a user)
 *   3. client IP                  (accurate behind Railway: index.ts sets
 *                                  `trust proxy`) — omitting headers no longer
 *                                  disables rate limiting.
 */
export function rateLimitKeyFor(req: Request): { key: string; byIp: boolean } {
  const userId = req.headers['x-user-id'];
  if (typeof userId === 'string' && userId.length > 0) return { key: `user:${userId}`, byIp: false };
  const agentId = req.agentContext?.agentId ?? req.headers['x-agent-id'];
  if (typeof agentId === 'string' && agentId.length > 0) return { key: `agent:${agentId}`, byIp: false };
  return { key: `ip:${req.ip ?? 'unknown'}`, byIp: true };
}

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === '/health') {
    next();
    return;
  }
  // M-106: audit-log POSTs are governed by the agent limiter's dedicated
  // `audit` bucket; counting them here too would charge an agent's write
  // minute-budget twice per tool call.
  if (req.method === 'POST' && req.path === '/mcp/audit') {
    next();
    return;
  }

  const { key: subject, byIp } = rateLimitKeyFor(req);
  const key = `${subject}:${req.method}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1-minute window
  const maxRequests = RATE_LIMITS.MAX_QUERIES_PER_MINUTE * (byIp ? IP_BUCKET_MULTIPLIER : 1);


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
