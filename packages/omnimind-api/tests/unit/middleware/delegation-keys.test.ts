/**
 * Lane A1 — a delegated context must be keyed by the PRINCIPAL (its agentName),
 * not by the gateway, in the agent rate limiter and the idempotency scope.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';

vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { agentKeyFor, classifyOp } from '../../../src/middleware/agent-rate-limiter';
import { resolveScope } from '../../../src/middleware/idempotency';
import { requiredScopeFor, agentScopeEnforcer } from '../../../src/middleware/scope-enforcer';
import { buildOauthAgentName } from '../../../src/services/mcp-token.service';
import type { AgentContext } from '../../../src/middleware/agent-context';

const USER = 'cuser00000000000000000001';
const delegated: AgentContext = {
  agentId: 'mcp-token:claude-desktop-000001',
  tenantId: 'josh-business',
  sourceWeight: 1,
  scopes: ['memory:read'],
  verified: true,
  delegated: true,
  userId: USER,
};

describe('agent-rate-limiter × delegation', () => {
  it('buckets per principal agentName even when x-agent-id names the gateway', () => {
    const req = { agentContext: delegated, headers: { 'x-agent-id': 'mcp-gateway' }, ip: '1.1.1.1' } as unknown as Request;
    expect(agentKeyFor(req)).toEqual({ key: 'agent:mcp-token:claude-desktop-000001', isAgent: true });
  });

  it('two principals behind one gateway get separate buckets', () => {
    const a = { agentContext: delegated, headers: {} } as unknown as Request;
    const b = { agentContext: { ...delegated, agentId: 'mcp-token:other-000002' }, headers: {} } as unknown as Request;
    expect(agentKeyFor(a).key).not.toBe(agentKeyFor(b).key);
  });

  it('two OAuth identities behind ONE client (same clientId) get separate buckets (review A5)', () => {
    const a = buildOauthAgentName('https://idp.example', 'claude-desktop', 'cidentAAAAAAAAAAAAAAAAAA1');
    const b = buildOauthAgentName('https://idp.example', 'claude-desktop', 'cidentBBBBBBBBBBBBBBBBBB2');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^oauth:claude-desktop-[A-Za-z0-9_-]{8}$/);
    const reqA = { agentContext: { ...delegated, agentId: a }, headers: {} } as unknown as Request;
    const reqB = { agentContext: { ...delegated, agentId: b, userId: 'cuser00000000000000000002' }, headers: {} } as unknown as Request;
    expect(agentKeyFor(reqA).key).not.toBe(agentKeyFor(reqB).key);
  });

  it('GET /mcp/audit/stats and GET /mcp/tokens are reads; POST /mcp/tokens is a write', () => {
    expect(classifyOp({ method: 'GET', path: '/mcp/audit/stats' } as Request)).toBe('read');
    expect(classifyOp({ method: 'GET', path: '/mcp/tokens' } as Request)).toBe('read');
    expect(classifyOp({ method: 'POST', path: '/mcp/tokens' } as Request)).toBe('write');
  });
});

describe('idempotency scope × delegation', () => {
  it('uses the delegated agentName and the (injected) x-user-id', () => {
    const req = { agentContext: delegated, headers: { 'x-user-id': USER } } as unknown as Request;
    expect(resolveScope(req)).toBe(`agent:mcp-token:claude-desktop-000001:user:${USER}`);
  });

  it('two principals replaying the same key never collide', () => {
    const a = { agentContext: delegated, headers: { 'x-user-id': USER } } as unknown as Request;
    const b = { agentContext: { ...delegated, agentId: 'mcp-token:other-000002', userId: 'cuser00000000000000000002' }, headers: { 'x-user-id': 'cuser00000000000000000002' } } as unknown as Request;
    expect(resolveScope(a)).not.toBe(resolveScope(b));
  });
});

describe('scope-enforcer × delegation', () => {
  it('enforces the intersected principal scopes under the principal name', () => {
    const req = { agentContext: delegated, method: 'POST', path: '/tasks' } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    agentScopeEnforcer(req, res as never, next);
    expect(requiredScopeFor('POST', '/tasks')).toBe('task:write');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'insufficient_scope', agentId: 'mcp-token:claude-desktop-000001', required: 'task:write' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('the /mcp token-management routes carry no entity scope (gateway auth is enforced in the router)', () => {
    expect(requiredScopeFor('POST', '/mcp/tokens/introspect')).toBeNull();
    expect(requiredScopeFor('POST', '/mcp/identities/resolve')).toBeNull();
  });
});
