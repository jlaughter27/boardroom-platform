/**
 * Lane A1 — delegated-user-isolation middleware.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { delegatedUserIsolation, isUserScopedPath, USER_SCOPED_PREFIXES } from '../../../src/middleware/delegated-user-isolation';
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

  it('does NOT inject on routes outside the user-scoped list (but still enforces mismatch)', () => {
    const ok = mk({ path: '/mcp/tokens/introspect', method: 'POST', body: { token: 'omt_x' } });
    delegatedUserIsolation(ok.req, ok.res, ok.next);
    expect(ok.next).toHaveBeenCalledWith();
    expect(ok.req.query.userId).toBeUndefined();
    expect(ok.req.headers['x-user-id']).toBeUndefined();
    expect((ok.req.body as { userId?: string }).userId).toBeUndefined();

    const bad = mk({ path: '/mcp/tokens', query: { userId: 'cuser00000000000000000002' } });
    delegatedUserIsolation(bad.req, bad.res, bad.next);
    expect(bad.res.status).toHaveBeenCalledWith(403);
  });
});
