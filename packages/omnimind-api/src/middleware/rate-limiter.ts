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

/**
 * Per-user READ budget (GET/HEAD) per minute. BoardRoom proxies every client
 * call with `x-user-id`, and one dashboard or graph page load fans out to
 * 20–40 GETs (entity lists, viz slices, cortex, sessions, nudges), so the
 * shared `MAX_QUERIES_PER_MINUTE` (20) used to refuse the UI mid-load
 * (caught by the 2026-10-20 browser e2e: "Rate limit exceeded. Max 20
 * requests per minute." on /graph). Writes keep the shared budget.
 */
export const USER_READ_RATE_LIMIT_PER_MINUTE = Math.max(
  RATE_LIMITS.MAX_QUERIES_PER_MINUTE,
  parseInt(process.env.USER_READ_RATE_LIMIT_PER_MINUTE ?? '120', 10) || 120
);

/**
 * POST endpoints that only read (the contract's "POST reads": search bodies are
 * too rich for a query string). They share the read budget with GET/HEAD.
 * Counting them as writes let one decision dispatch (one /context/for-persona
 * per persona) or an MCP client searching hard (memory_search → POST
 * /memories/search) exhaust the 20/min write budget and lock the user out of
 * every POST, writes included — found by the 2026-10-23 real-data e2e.
 */
export const READ_ONLY_POST_PATHS: ReadonlySet<string> = new Set([
  '/memories/search',
  '/memories/search-similar',
  '/memories/validate',
  '/context/for-persona',
  // RD-13 — every dashboard load POSTs one meeting-brief read; billing it as a
  // write would spend the 20/min write budget on page loads.
  '/people/briefs',
]);

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
  const isRead = req.method === 'GET' || req.method === 'HEAD' || (req.method === 'POST' && READ_ONLY_POST_PATHS.has(req.path));
  const key = `${subject}:${isRead ? 'READ' : req.method}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1-minute window
  const baseBudget = isRead ? USER_READ_RATE_LIMIT_PER_MINUTE : RATE_LIMITS.MAX_QUERIES_PER_MINUTE;
  const maxRequests = baseBudget * (byIp ? IP_BUCKET_MULTIPLIER : 1);


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
