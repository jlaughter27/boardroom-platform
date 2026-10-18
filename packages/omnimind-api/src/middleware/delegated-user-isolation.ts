/**
 * delegated-user-isolation — Lane A1 (2026-10-18)
 *
 * When agent-context resolved a DELEGATED principal (a gateway acting as a
 * per-user MCP token / OAuth identity), the request may only touch that
 * principal's user:
 *
 *   - any supplied `?userId=`, `body.userId` or `x-user-id` header that is
 *     not `agentContext.userId` → 403 `user_mismatch`
 *   - on the user-scoped route families (below) a missing userId is filled in
 *     from the principal: `req.query.userId`, `req.body.userId` (POST/PATCH/
 *     PUT with an object body) and the `x-user-id` header — the header is
 *     what the entity routes actually read, the query/body fields are the
 *     contract shape for routes that take an explicit userId.
 *
 * Non-delegated requests (BoardRoom, solo-mode agents, plain gateways) pass
 * through untouched. MUST be mounted right after `agentContextMiddleware`.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export const USER_SCOPED_PREFIXES: readonly string[] = [
  '/memories',
  '/context',
  '/decisions',
  '/tasks',
  '/goals',
  '/projects',
  '/people',
  '/commitments',
  '/graph',
  '/mcp/audit',
];

const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT']);

function firstString(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function isUserScopedPath(path: string): boolean {
  return USER_SCOPED_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
}

export function delegatedUserIsolation(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.agentContext;
  if (!ctx?.delegated || !ctx.userId) {
    next();
    return;
  }
  const userId = ctx.userId;

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : null;
  const supplied: Array<{ source: string; value: string }> = [];
  const q = firstString((req.query as Record<string, unknown>).userId);
  if (q) supplied.push({ source: 'query.userId', value: q });
  const b = body ? firstString(body.userId) : null;
  if (b) supplied.push({ source: 'body.userId', value: b });
  const h = firstString(req.headers['x-user-id']);
  if (h) supplied.push({ source: 'x-user-id', value: h });

  const mismatch = supplied.find(s => s.value !== userId);
  if (mismatch) {
    logger.warn('delegated-user-isolation: userId disagrees with delegated principal', {
      agentId: ctx.agentId,
      source: mismatch.source,
      path: req.path,
    });
    res.status(403).json({
      error: 'user_mismatch',
      message: `${mismatch.source} does not match the delegated principal's user`,
      field: mismatch.source,
    });
    return;
  }

  if (isUserScopedPath(req.path)) {
    if (!q) (req.query as Record<string, unknown>).userId = userId;
    if (!h) req.headers['x-user-id'] = userId;
    if (BODY_METHODS.has(req.method) && body && !b) body.userId = userId;
  }

  next();
}
