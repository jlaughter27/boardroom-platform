import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { agentScopeEnforcer, hasScope, requiredScopeFor } from '../../../src/middleware/scope-enforcer';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('scope table mirrors CLAUDE.md', () => {
  it.each([
    ['GET', '/memories', 'memory:read'],
    ['GET', '/memories/abc', 'memory:read'],
    ['POST', '/memories', 'memory:write'],
    ['POST', '/memories/search', 'memory:read'], // R-O-01: MCP memory_search
    ['POST', '/memories/search-similar', 'memory:read'],
    ['POST', '/memories/validate', 'memory:read'],
    ['PATCH', '/memories/abc', 'memory:write'],
    ['DELETE', '/memories/abc', 'memory:write'],
    ['POST', '/memories/abc/links', 'memory:write'],
    ['POST', '/context/for-persona', 'memory:read'],
    ['GET', '/context/core', 'memory:read'],
    ['GET', '/context/capsules', 'memory:read'],
    ['POST', '/context/reflect', 'memory:write'], // R-O-03: reflect writes a capsule
    // R-O-03: /graph, /cortex, /usage were unlisted (no enforcement at all)
    ['GET', '/graph', 'memory:read'],
    ['GET', '/graph/backlinks/project:p1', 'memory:read'],
    ['GET', '/graph/unlinked-mentions', 'memory:read'],
    ['POST', '/graph/unlinked-mentions/link', 'memory:write'],
    ['GET', '/cortex/patterns', 'memory:read'],
    ['GET', '/cortex/memo/latest', 'memory:read'],
    ['POST', '/cortex/patterns/scan', 'memory:write'],
    ['POST', '/cortex/memo/generate', 'memory:write'],
    ['PATCH', '/cortex/memo/m1/items/k', 'memory:write'],
    ['PATCH', '/cortex/contradictions/c1', 'memory:write'],
    ['POST', '/cortex/simulate', 'memory:write'],
    ['GET', '/usage/llm/summary', 'memory:read'],
    ['POST', '/usage/llm', 'memory:write'],
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

  it('R-O-01: a read-only verified agent may POST /memories/search', () => {
    const { req, res, next } = mk('POST', '/memories/search', { agentId: 'ro', tenantId: 't', sourceWeight: 1, scopes: ['memory:read'], verified: true });
    agentScopeEnforcer(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('R-O-03: a read-only verified agent is denied POST /context/reflect and POST /cortex/memo/generate', () => {
    for (const path of ['/context/reflect', '/cortex/memo/generate']) {
      const { req, res, next } = mk('POST', path, { agentId: 'ro', tenantId: 't', sourceWeight: 1, scopes: ['memory:read'], verified: true });
      agentScopeEnforcer(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'insufficient_scope', required: 'memory:write' }));
      expect(next).not.toHaveBeenCalled();
    }
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
