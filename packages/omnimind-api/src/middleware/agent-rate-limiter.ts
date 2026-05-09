import type { Request, Response, NextFunction } from 'express';

// Per-agent hourly rate limits
const READ_LIMIT = parseInt(process.env.AGENT_RATE_READ ?? '1000', 10);
const WRITE_LIMIT = parseInt(process.env.AGENT_RATE_WRITE ?? '200', 10);
const DECISION_LIMIT = parseInt(process.env.AGENT_RATE_DECISION ?? '100', 10);
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

type OpType = 'read' | 'write' | 'decision';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}, 10 * 60 * 1000);

function classifyOp(req: Request): OpType {
  if (req.path.includes('decision')) return 'decision';
  if (req.method === 'GET') return 'read';
  return 'write';
}

function limitFor(op: OpType): number {
  if (op === 'decision') return DECISION_LIMIT;
  if (op === 'write') return WRITE_LIMIT;
  return READ_LIMIT;
}

export function agentRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const agentId = req.headers['x-agent-id'] as string | undefined;
  if (!agentId) {
    next();
    return;
  }

  const op = classifyOp(req);
  const key = `${agentId}:${op}`;
  const now = Date.now();
  const limit = limitFor(op);

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
      message: `Agent ${agentId} exceeded ${limit} ${op} operations per hour.`,
      retryAfter,
    });
    return;
  }

  next();
}
