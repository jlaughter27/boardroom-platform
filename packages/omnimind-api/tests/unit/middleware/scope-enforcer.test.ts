import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { agentScopeEnforcer, hasScope, requiredScopeFor } from '../../../src/middleware/scope-enforcer';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('scope table mirrors CLAUDE.md', () => {
  it.each([
    ['GET', '/memories', 'memory:read'],
    ['GET', '/memories/abc', 'memory:read'],
    ['POST', '/memories', 'memory:write'],
    ['POST', '/memories/search-similar', 'memory:read'],
    ['POST', '/memories/validate', 'memory:read'],
    ['PATCH', '/memories/abc', 'memory:write'],
    ['DELETE', '/memories/abc', 'memory:write'],
    ['POST', '/memories/abc/links', 'memory:write'],
    ['POST', '/context/for-persona', 'memory:read'],
    ['POST', '/decisions', 'decision:write'],
    ['GET', '/decisions', 'memory:read'],
    ['POST', '/tasks', 'task:write'],
    ['PATCH', '/tasks/t1', 'task:write'],
    ['POST', '/commitments', 'commitment:write'],
    ['POST', '/projects', 'project:write'],
    ['POST', '/projects/p1/tasks/t1', 'project:write'],
    ['POST', '/goals/g1/projects/p1', 'memory:write'],
    ['GET', '/people/p', 'memory:read'],
    ['POST', '/mcp/audit', null],
    ['GET', '/health', null],
  ])('%s %s → %s', (method, path, expected) => {
    expect(requiredScopeFor(method, path)).toBe(expected);
  });
});

describe('hasScope wildcard semantics (same as omnimind-mcp requireScope)', () => {
  it('exact, * and prefix:* match; prefixes never cross', () => {
    expect(hasScope(['memory:read'], 'memory:read')).toBe(true);
    expect(hasScope(['*'], 'task:write')).toBe(true);
    expect(hasScope(['memory:*'], 'memory:write')).toBe(true);
    expect(hasScope(['memory:*'], 'task:write')).toBe(false);
    expect(hasScope(['memory:read'], 'memory:write')).toBe(false);
  });
});

describe('agentScopeEnforcer', () => {
  const mk = (method: string, path: string, agentContext?: any) => {
    const req = { method, path, agentContext } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const next = vi.fn();
    return { req, res, next };
  };

  it('403 insufficient_scope for a verified agent missing the scope', () => {
    const { req, res, next } = mk('POST', '/memories', { agentId: 'ro', tenantId: 't', sourceWeight: 1, scopes: ['memory:read'], verified: true });
    agentScopeEnforcer(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'insufficient_scope', required: 'memory:write' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a verified agent that holds the scope', () => {
    const { req, res, next } = mk('POST', '/decisions', { agentId: 'a', tenantId: 't', sourceWeight: 1, scopes: ['decision:write'], verified: true });
    agentScopeEnforcer(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('does not enforce for legacy (unverified) agents or BoardRoom (no context)', () => {
    const legacy = mk('POST', '/memories', { agentId: 'a', tenantId: 't', sourceWeight: 1, verified: false });
    agentScopeEnforcer(legacy.req, legacy.res, legacy.next);
    expect(legacy.next).toHaveBeenCalled();
    const none = mk('POST', '/memories', undefined);
    agentScopeEnforcer(none.req, none.res, none.next);
    expect(none.next).toHaveBeenCalled();
  });
});
