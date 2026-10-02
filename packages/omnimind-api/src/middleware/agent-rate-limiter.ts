import type { Request, Response, NextFunction } from 'express';

// Per-agent hourly rate limits
const READ_LIMIT = parseInt(process.env.AGENT_RATE_READ ?? '1000', 10);
const WRITE_LIMIT = parseInt(process.env.AGENT_RATE_WRITE ?? '200', 10);
const DECISION_LIMIT = parseInt(process.env.AGENT_RATE_DECISION ?? '100', 10);
// M-106: audit-log writes get their own bucket so a tool call's audit POST
// never consumes the agent's `write` budget (previously every tool call cost
// two writes, and past the limit audit rows were silently dropped).
const AUDIT_LIMIT = parseInt(process.env.AGENT_RATE_AUDIT ?? '5000', 10);
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export type OpType = 'read' | 'write' | 'decision' | 'audit';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// F-209/F-211: retain + unref the cleanup timer; cleared on shutdown.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}, 10 * 60 * 1000);
(cleanupInterval as { unref?: () => void }).unref?.();

export function stopAgentRateLimiterCleanup(): void {
  clearInterval(cleanupInterval);
}

export function classifyOp(req: Request): OpType {
  if (req.method === 'POST' && req.path === '/mcp/audit') return 'audit';
  if (req.path.includes('decision')) return 'decision';
  if (req.method === 'GET') return 'read';
  return 'write';
}

function limitFor(op: OpType): number {
  if (op === 'audit') return AUDIT_LIMIT;
  if (op === 'decision') return DECISION_LIMIT;
  if (op === 'write') return WRITE_LIMIT;
  return READ_LIMIT;
}

/**
 * The hourly budgets above are sized for ONE MCP agent. Requests that carry no
 * agent identity (BoardRoom AI on behalf of a user, or a bare IP) get the
 * budget × this multiplier so a single BoardRoom instance / onboarding import
 * is not clamped to an agent's allowance. Tunable via AGENT_RATE_NON_AGENT_MULTIPLIER.
 */
export const NON_AGENT_MULTIPLIER = Math.max(1, parseInt(process.env.AGENT_RATE_NON_AGENT_MULTIPLIER ?? '5', 10) || 5);

/**
 * F-105/F-207: never skip. Key precedence:
 *   1. verified/legacy agent context (set by agent-context middleware)
 *   2. raw x-agent-id header
 *   3. x-user-id (BoardRoom AI traffic — per user, widened budget)
 *   4. client IP (trust proxy is enabled in index.ts — widened budget)
 */
export function agentKeyFor(req: Request): { key: string; isAgent: boolean } {
  if (req.agentContext?.agentId) return { key: `agent:${req.agentContext.agentId}`, isAgent: true };
  const header = req.headers['x-agent-id'];
  if (typeof header === 'string' && header.length > 0) return { key: `agent:${header}`, isAgent: true };
  const userId = req.headers['x-user-id'];
  if (typeof userId === 'string' && userId.length > 0) return { key: `user:${userId}`, isAgent: false };
  return { key: `ip:${req.ip ?? 'unknown'}`, isAgent: false };
}

export function agentRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const op = classifyOp(req);
  const { key: subject, isAgent } = agentKeyFor(req);
  const key = `${subject}:${op}`;
  const now = Date.now();
  const limit = limitFor(op) * (isAgent ? 1 : NON_AGENT_MULTIPLIER);


  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.status(429).json({
      error: 'agent_rate_limited',
      message: `${subject} exceeded ${limit} ${op} operations per hour.`,
      retryAfter,
    });
    return;
  }

  next();
}
