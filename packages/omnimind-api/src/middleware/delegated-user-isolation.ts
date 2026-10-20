/**
 * delegated-user-isolation — Lane A1 (2026-10-18)
 *
 * When agent-context resolved a DELEGATED principal (a gateway acting as a
 * per-user MCP token / OAuth identity), the request may only touch that
 * principal's user, and only through the routes the MCP gateway needs:
 *
 *   - any supplied `?userId=`, `body.userId` or `x-user-id` header that is
 *     not `agentContext.userId` → 403 `user_mismatch`
 *   - the route must be on the delegated ALLOW-list below → else 403
 *     `delegated_route_forbidden`, regardless of the principal's scopes
 *   - on the user-scoped route families a missing userId is filled in from
 *     the principal: `req.query.userId`, `req.body.userId` (POST/PATCH/PUT
 *     with an object body) and the `x-user-id` header — the header is what the
 *     entity routes actually read, the query/body fields are the contract
 *     shape for routes that take an explicit userId.
 *
 * Why an allow-list (identity review 2026-10-18, A1/A3/A4): a delegated
 * context is the first caller that is LESS trusted than the shared service
 * key yet runs through the same `app.use` chain. Scope enforcement and user
 * pinning are deny-lists over the entity families; every other mounted
 * prefix (`/auth`, `/oauth`, `/admin`, `/mcp/tokens*`, `/mcp/agents`,
 * `/subscription`, `/user-profile`, …) was reachable with the service key's
 * full trust. The allow-list is exactly what omnimind-mcp's tools and
 * resources call (see `packages/omnimind-mcp/src/lib/client.ts`).
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

export interface DelegatedRouteRule {
  /** Route path. With `exact: false` (default) it is a family prefix (segment-aware). */
  path: string;
  exact?: boolean;
  /** Allowed methods, or `'*'` for any. HEAD is treated as GET. */
  methods: '*' | readonly string[];
}

/**
 * What a delegated principal may call. Entity families allow every method —
 * `scope-enforcer` decides read vs write inside them from the principal's
 * scopes. The exact entries are the gateway's side channels: the audit sink
 * (`POST`), its own audit rows (`GET`, pinned to the principal in the router)
 * and the LLM usage sink used by the fact extractor.
 */
export const DELEGATED_ROUTE_ALLOW_LIST: readonly DelegatedRouteRule[] = [
  { path: '/memories', methods: '*' },
  { path: '/context', methods: '*' },
  { path: '/decisions', methods: '*' },
  { path: '/tasks', methods: '*' },
  { path: '/goals', methods: '*' },
  { path: '/projects', methods: '*' },
  { path: '/people', methods: '*' },
  { path: '/commitments', methods: '*' },
  { path: '/graph', methods: '*' },
  { path: '/mcp/audit', exact: true, methods: ['POST', 'GET'] },
  { path: '/usage/llm', exact: true, methods: ['POST'] },
];

/**
 * Carve-outs inside an allowed family: operator maintenance endpoints that no
 * MCP tool calls. Checked before the allow-list.
 */
export const DELEGATED_ROUTE_DENY_LIST: readonly DelegatedRouteRule[] = [
  { path: '/memories/backfill-embeddings', exact: true, methods: '*' },
];

export const DELEGATED_ROUTE_FORBIDDEN = 'delegated_route_forbidden';

const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT']);

function firstString(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function matchesPath(rule: DelegatedRouteRule, path: string): boolean {
  if (rule.exact) return path === rule.path;
  return path === rule.path || path.startsWith(`${rule.path}/`);
}

function matchesMethod(rule: DelegatedRouteRule, method: string): boolean {
  if (rule.methods === '*') return true;
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return rule.methods.includes(m);
}

export function isUserScopedPath(path: string): boolean {
  return USER_SCOPED_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
}

/** Trailing-slash tolerant: `/memories/` is the `/memories` family. */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path;
}

export function isDelegatedRouteAllowed(method: string, rawPath: string): boolean {
  const path = normalizePath(rawPath);
  if (DELEGATED_ROUTE_DENY_LIST.some(r => matchesPath(r, path) && matchesMethod(r, method))) return false;
  return DELEGATED_ROUTE_ALLOW_LIST.some(r => matchesPath(r, path) && matchesMethod(r, method));
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

  if (!isDelegatedRouteAllowed(req.method, req.path)) {
    logger.warn('delegated-user-isolation: route is not on the delegated allow-list', {
      agentId: ctx.agentId,
      method: req.method,
      path: req.path,
    });
    res.status(403).json({
      error: DELEGATED_ROUTE_FORBIDDEN,
      message: `${req.method} ${req.path} is not available to a delegated MCP principal`,
      method: req.method,
      path: req.path,
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
