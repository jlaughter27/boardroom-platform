import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

/**
 * M-103 — server-side enforcement of `Agent.scopes`.
 *
 * Only applies when the agent-context middleware VERIFIED the caller via
 * `x-agent-key` (then `req.agentContext.scopes` is the Agent row's scope list).
 * Legacy header-only agents and BoardRoom AI (no agent context) are not
 * affected — there is no trustworthy scope list to enforce for them.
 *
 * Scope table mirrors CLAUDE.md "15 Available Tools" + docs/MEMORY-PROTOCOL.md:
 *   memory:read       every GET on entity routes, search, search-similar, validate,
 *                     context/for-persona, /graph, /cortex, /usage reads
 *   memory:write      POST/PATCH/DELETE /memories (+ links), /people, /goals,
 *                     POST /context/reflect, /graph link writers, /cortex
 *                     scans/patches, POST /usage/llm
 *   decision:write    POST/PATCH/DELETE /decisions
 *   task:write        POST/PATCH/DELETE /tasks
 *   commitment:write  POST/PATCH/DELETE /commitments
 *   project:write     POST/PATCH/DELETE /projects
 *
 * Wildcards mirror the MCP server's requireScope: `*` grants everything,
 * `<prefix>:*` grants every scope under that prefix. Wildcards never cross
 * prefixes.
 */

interface ScopeRule {
  prefix: string;
  read: string;
  write: string;
}

const SCOPE_TABLE: ScopeRule[] = [
  { prefix: '/memories', read: 'memory:read', write: 'memory:write' },
  { prefix: '/context', read: 'memory:read', write: 'memory:read' },
  { prefix: '/decisions', read: 'memory:read', write: 'decision:write' },
  { prefix: '/tasks', read: 'memory:read', write: 'task:write' },
  { prefix: '/commitments', read: 'memory:read', write: 'commitment:write' },
  { prefix: '/projects', read: 'memory:read', write: 'project:write' },
  { prefix: '/people', read: 'memory:read', write: 'memory:write' },
  { prefix: '/goals', read: 'memory:read', write: 'memory:write' },
  // R-O-03: previously unlisted → no enforcement at all for verified agents.
  { prefix: '/graph', read: 'memory:read', write: 'memory:write' },
  { prefix: '/cortex', read: 'memory:read', write: 'memory:write' },
  { prefix: '/usage', read: 'memory:read', write: 'memory:write' },
];

/**
 * POST endpoints that are reads in disguise. Exported so the agent rate
 * limiter bills them against the `read` bucket (R-O-07).
 * R-O-01: `/memories/search` (MCP `memory_search`) was missing → read-only
 * agents got 403.
 */
export const READ_POSTS: ReadonlySet<string> = new Set([
  '/memories/search',
  '/memories/search-similar',
  '/memories/validate',
  '/context/for-persona',
]);

/** POST endpoints under a read-ish prefix that nevertheless mutate (R-O-03). */
const WRITE_OVERRIDES: Record<string, string> = {
  '/context/reflect': 'memory:write',
};

export function hasScope(scopes: readonly string[], required: string): boolean {
  if (scopes.includes('*')) return true;
  if (scopes.includes(required)) return true;
  const [prefix] = required.split(':');
  return scopes.includes(`${prefix}:*`);
}

export function requiredScopeFor(method: string, path: string): string | null {
  const rule = SCOPE_TABLE.find(r => path === r.prefix || path.startsWith(`${r.prefix}/`));
  if (!rule) return null;
  if (method === 'GET' || method === 'HEAD') return rule.read;
  if (method === 'POST' && WRITE_OVERRIDES[path]) return WRITE_OVERRIDES[path];
  if (method === 'POST' && READ_POSTS.has(path)) return rule.read;
  return rule.write;
}

export function agentScopeEnforcer(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.agentContext;
  if (!ctx?.verified || !ctx.scopes) {
    next();
    return;
  }

  const required = requiredScopeFor(req.method, req.path);
  if (!required || hasScope(ctx.scopes, required)) {
    next();
    return;
  }

  logger.warn('Agent scope denied', { agentId: ctx.agentId, required, method: req.method, path: req.path });
  res.status(403).json({
    error: 'insufficient_scope',
    message: `Agent '${ctx.agentId}' lacks the '${required}' scope required for ${req.method} ${req.path}`,
    required,
    agentId: ctx.agentId,
  });
}
