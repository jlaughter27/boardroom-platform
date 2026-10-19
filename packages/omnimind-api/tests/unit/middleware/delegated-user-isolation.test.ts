/**
 * Lane A1 — delegated-user-isolation middleware.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  DELEGATED_ROUTE_ALLOW_LIST,
  DELEGATED_ROUTE_DENY_LIST,
  DELEGATED_ROUTE_FORBIDDEN,
  delegatedUserIsolation,
  isDelegatedRouteAllowed,
  isUserScopedPath,
  USER_SCOPED_PREFIXES,
} from '../../../src/middleware/delegated-user-isolation';
import type { AgentContext } from '../../../src/middleware/agent-context';

const USER = 'cuser00000000000000000001';
const DELEGATED: AgentContext = {
  agentId: 'mcp-token:claude-desktop-000001',
  tenantId: 'josh-business',
  sourceWeight: 1,
  scopes: ['memory:read'],
  verified: true,
  delegated: true,
  userId: USER,
};

function mk(opts: { path?: string; method?: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; ctx?: AgentContext | undefined }) {
  const req = {
    path: opts.path ?? '/memories',
    method: opts.method ?? 'GET',
    query: opts.query ?? {},
    body: opts.body,
    headers: opts.headers ?? {},
    agentContext: 'ctx' in opts ? opts.ctx : DELEGATED,
  } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('isUserScopedPath', () => {
  it('matches the contract prefixes exactly (segment-aware)', () => {
    expect(USER_SCOPED_PREFIXES).toEqual(['/memories', '/context', '/decisions', '/tasks', '/goals', '/projects', '/people', '/commitments', '/graph', '/mcp/audit']);
    expect(isUserScopedPath('/memories')).toBe(true);
    expect(isUserScopedPath('/memories/search')).toBe(true);
    expect(isUserScopedPath('/mcp/audit/stats')).toBe(true);
    expect(isUserScopedPath('/mcp/tokens')).toBe(false);
    expect(isUserScopedPath('/memoriesx')).toBe(false);
    expect(isUserScopedPath('/usage/llm')).toBe(false);
  });
});

describe('delegatedUserIsolation', () => {
  it('passes non-delegated requests through untouched', () => {
    for (const ctx of [undefined, { ...DELEGATED, delegated: false, userId: undefined }]) {
      const { req, res, next } = mk({ ctx, query: { userId: 'someone-else' } });
      delegatedUserIsolation(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.headers['x-user-id']).toBeUndefined();
    }
  });

  it('403 user_mismatch when ?userId= names another user', () => {
    const { req, res, next } = mk({ query: { userId: 'cuser00000000000000000002' } });
    delegatedUserIsolation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'user_mismatch', field: 'query.userId' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('403 user_mismatch when body.userId names another user', () => {
    const { req, res, next } = mk({ method: 'POST', body: { userId: 'cuser00000000000000000002', title: 'x' } });
    delegatedUserIsolation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'user_mismatch', field: 'body.userId' }));
  });

  it('403 user_mismatch when the x-user-id header names another user (the field the entity routes read)', () => {
    const { req, res, next } = mk({ headers: { 'x-user-id': 'cuser00000000000000000002' } });
    delegatedUserIsolation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'user_mismatch', field: 'x-user-id' }));
  });

  it('matching userId everywhere is accepted', () => {
    const { req, res, next } = mk({ method: 'POST', query: { userId: USER }, body: { userId: USER }, headers: { 'x-user-id': USER } });
    delegatedUserIsolation(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('injects query.userId + x-user-id on user-scoped GETs when absent', () => {
    const { req, res, next } = mk({ path: '/tasks' });
    delegatedUserIsolation(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.query.userId).toBe(USER);
    expect(req.headers['x-user-id']).toBe(USER);
  });

  it('injects body.userId too for POST/PATCH with an object body; never for arrays or GET', () => {
    const post = mk({ path: '/memories', method: 'POST', body: { title: 'x' } });
    delegatedUserIsolation(post.req, post.res, post.next);
    expect((post.req.body as { userId?: string }).userId).toBe(USER);

    const patch = mk({ path: '/projects/p1', method: 'PATCH', body: {} });
    delegatedUserIsolation(patch.req, patch.res, patch.next);
    expect((patch.req.body as { userId?: string }).userId).toBe(USER);

    const arr = mk({ path: '/memories', method: 'POST', body: [{ title: 'x' }] });
    delegatedUserIsolation(arr.req, arr.res, arr.next);
    expect(arr.next).toHaveBeenCalledWith();
    expect(Array.isArray(arr.req.body)).toBe(true);

    const del = mk({ path: '/memories/m1', method: 'DELETE' });
    delegatedUserIsolation(del.req, del.res, del.next);
    expect(del.req.headers['x-user-id']).toBe(USER);
    expect(del.req.body).toBeUndefined();
  });

  it('does NOT inject on allowed routes outside the user-scoped list (but still enforces mismatch)', () => {
    const ok = mk({ path: '/usage/llm', method: 'POST', body: { model: 'x' } });
    delegatedUserIsolation(ok.req, ok.res, ok.next);
    expect(ok.next).toHaveBeenCalledWith();
    expect(ok.req.query.userId).toBeUndefined();
    expect(ok.req.headers['x-user-id']).toBeUndefined();
    expect((ok.req.body as { userId?: string }).userId).toBeUndefined();

    const bad = mk({ path: '/usage/llm', method: 'POST', body: { userId: 'cuser00000000000000000002' } });
    delegatedUserIsolation(bad.req, bad.res, bad.next);
    expect(bad.res.status).toHaveBeenCalledWith(403);
    expect(bad.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'user_mismatch' }));
  });
});

// Identity review 2026-10-18 (A1/A3/A4): delegated contexts get an ALLOW-list.
describe('delegated route allow-list', () => {
  it('is exactly the entity families the MCP tools call + the audit/usage sinks', () => {
    expect(DELEGATED_ROUTE_ALLOW_LIST.filter(r => !r.exact).map(r => r.path)).toEqual([
      '/memories', '/context', '/decisions', '/tasks', '/goals', '/projects', '/people', '/commitments', '/graph',
    ]);
    expect(DELEGATED_ROUTE_ALLOW_LIST.filter(r => r.exact)).toEqual([
      { path: '/mcp/audit', exact: true, methods: ['POST', 'GET'] },
      { path: '/usage/llm', exact: true, methods: ['POST'] },
    ]);
    expect(DELEGATED_ROUTE_DENY_LIST.map(r => r.path)).toEqual(['/memories/backfill-embeddings']);
  });

  it('isDelegatedRouteAllowed: families (any method, segment-aware), exact sinks, HEAD≡GET, trailing slash', () => {
    for (const [m, p] of [
      ['GET', '/memories'], ['POST', '/memories'], ['PATCH', '/memories/m1'], ['DELETE', '/memories/m1'], ['GET', '/memories/m1'],
      ['POST', '/memories/search'], ['POST', '/memories/search-similar'], ['POST', '/memories/validate'],
      ['POST', '/context/for-persona'], ['POST', '/context/reflect'], ['GET', '/context/capsules'], ['GET', '/context/core'],
      ['GET', '/decisions'], ['POST', '/decisions'], ['GET', '/decisions/calibration'],
      ['GET', '/tasks'], ['POST', '/tasks'], ['PATCH', '/tasks/t1'],
      ['GET', '/goals/g1'], ['POST', '/goals/g1/projects/p1'],
      ['GET', '/projects'], ['POST', '/projects'], ['GET', '/people/p1'], ['GET', '/people/duplicates'],
      ['GET', '/commitments/nudges'], ['POST', '/commitments'],
      ['GET', '/graph'], ['GET', '/graph/backlinks/goal:1'], ['POST', '/graph/unlinked-mentions/link'],
      ['POST', '/mcp/audit'], ['GET', '/mcp/audit'], ['HEAD', '/mcp/audit'], ['POST', '/usage/llm'],
      ['GET', '/memories/'], ['HEAD', '/tasks'],
    ] as const) {
      expect(isDelegatedRouteAllowed(m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [
      ['GET', '/auth/user/x'], ['POST', '/auth/login'], ['POST', '/auth/verify'], ['POST', '/auth/register'],
      ['GET', '/oauth/token/google'], ['POST', '/oauth/token'], ['DELETE', '/oauth/token/google'],
      ['POST', '/mcp/tokens'], ['GET', '/mcp/tokens'], ['GET', '/mcp/tokens/options'], ['DELETE', '/mcp/tokens/t1'],
      ['POST', '/mcp/tokens/introspect'], ['POST', '/mcp/identities/resolve'], ['GET', '/mcp/identities'], ['PATCH', '/mcp/identities/i1'],
      ['GET', '/mcp/agents'], ['POST', '/mcp/agents'], ['GET', '/mcp/audit/stats'], ['DELETE', '/mcp/audit'],
      ['GET', '/usage/llm'], ['GET', '/usage/llm/summary'], ['POST', '/usage/llm/summary'],
      ['GET', '/admin/stats'], ['GET', '/admin/tenants'], ['PATCH', '/admin/tenants/t'],
      ['GET', '/subscription'], ['PATCH', '/subscription'], ['GET', '/user-profile'], ['PATCH', '/user-profile'],
      ['GET', '/custom-personas'], ['POST', '/custom-personas'], ['GET', '/outcome-reviews'], ['POST', '/outcome-reviews/x/complete'],
      ['GET', '/relationships/graph'], ['GET', '/cortex/patterns'], ['POST', '/cortex/simulate'],
      ['POST', '/memories/backfill-embeddings'],
      ['GET', '/memoriesx'], ['GET', '/mcp'], ['GET', '/'], ['GET', '/health'],
    ] as const) {
      expect(isDelegatedRouteAllowed(m, p), `${m} ${p}`).toBe(false);
    }
  });

  it('middleware: 403 delegated_route_forbidden for anything off the list, regardless of scopes; no injection happens', () => {
    const full = { ...DELEGATED, scopes: ['memory:read', 'memory:write', 'decision:write', 'task:write', 'commitment:write', 'project:write', 'code:write'] };
    for (const [method, path] of [['GET', '/auth/user/other'], ['POST', '/mcp/tokens'], ['GET', '/oauth/token/google'], ['GET', '/mcp/agents'], ['GET', '/mcp/audit/stats'], ['POST', '/memories/backfill-embeddings'], ['GET', '/admin/stats']] as const) {
      const { req, res, next } = mk({ path, method, ctx: full, body: method === 'POST' ? {} : undefined });
      delegatedUserIsolation(req, res, next);
      expect(res.status, `${method} ${path}`).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: DELEGATED_ROUTE_FORBIDDEN, method, path }));
      expect(next).not.toHaveBeenCalled();
      expect(req.headers['x-user-id']).toBeUndefined();
    }
  });

  it('middleware: user_mismatch is reported before the allow-list (never leaks which routes exist)', () => {
    const { req, res, next } = mk({ path: '/auth/user/x', query: { userId: 'cuser00000000000000000002' } });
    delegatedUserIsolation(req, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'user_mismatch' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('middleware: allowed routes pass and user-scoped ones get the principal injected', () => {
    const audit = mk({ path: '/mcp/audit', method: 'POST', body: { toolName: 'x' } });
    delegatedUserIsolation(audit.req, audit.res, audit.next);
    expect(audit.next).toHaveBeenCalledWith();
    expect(audit.req.headers['x-user-id']).toBe(USER);

    const backlinks = mk({ path: '/graph/backlinks/goal:1' });
    delegatedUserIsolation(backlinks.req, backlinks.res, backlinks.next);
    expect(backlinks.next).toHaveBeenCalledWith();
    expect(backlinks.req.query.userId).toBe(USER);
  });
});
