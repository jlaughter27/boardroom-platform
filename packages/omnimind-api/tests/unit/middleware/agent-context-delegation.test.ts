/**
 * Lane A1 — delegated identity in agent-context (x-mcp-principal).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  agent: { findFirst: vi.fn(), update: vi.fn() },
  mcpToken: { findUnique: vi.fn(), update: vi.fn() },
  mcpOauthIdentity: { findUnique: vi.fn(), update: vi.fn() },
}));
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: mockLogger }));

import { agentContextMiddleware, intersectDelegatedScopes, __resetAgentContextStateForTest } from '../../../src/middleware/agent-context';
import { __resetMcpTokenStateForTest } from '../../../src/services/mcp-token.service';

const GATEWAY_KEY = 'omk_gateway_key';
const GATEWAY_HASH = createHash('sha256').update(GATEWAY_KEY).digest('hex');
const GATEWAY = {
  id: 'cgateway000000000000000001',
  name: 'mcp-gateway',
  apiKeyHash: GATEWAY_HASH,
  tenantId: 'gateway-tenant',
  scopes: ['mcp:delegate', 'memory:read', 'memory:write', 'task:write'],
  sourceWeight: 1.0,
  createdAt: new Date(),
  lastSeenAt: null,
};
const PLAIN_KEY = 'omk_plain_key';
const PLAIN = { ...GATEWAY, id: 'cplain0000000000000000001', name: 'plain-agent', apiKeyHash: createHash('sha256').update(PLAIN_KEY).digest('hex'), scopes: ['memory:read', 'memory:write'] };

const TOKEN = {
  id: 'ctoken0000000000000000001',
  userId: 'cuser00000000000000000001',
  tenantId: 'josh-business',
  name: 'Claude Desktop',
  agentName: 'mcp-token:claude-desktop-000001',
  prefix: 'omt_abcdefgh',
  tokenHash: 'h'.repeat(64),
  scopes: ['memory:read', 'memory:write', 'decision:write'],
  sourceWeight: 0.8,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
};

function mk(headers: Record<string, string>, path = '/memories') {
  const req = { path, headers, ip: '127.0.0.1' } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentContextStateForTest();
  __resetMcpTokenStateForTest();
  delete process.env.OMNIMIND_REQUIRE_AGENT_KEY;
  mockPrisma.agent.update.mockResolvedValue(GATEWAY);
  mockPrisma.mcpToken.update.mockResolvedValue(TOKEN);
  mockPrisma.mcpOauthIdentity.update.mockResolvedValue({});
  mockPrisma.agent.findFirst.mockImplementation(async ({ where }: { where: { apiKeyHash: string } }) => {
    if (where.apiKeyHash === GATEWAY_HASH) return GATEWAY;
    if (where.apiKeyHash === PLAIN.apiKeyHash) return PLAIN;
    return null;
  });
});

describe('intersectDelegatedScopes', () => {
  it('keeps principal scopes the gateway also holds, strips mcp:delegate, honours gateway wildcards', () => {
    expect(intersectDelegatedScopes(['memory:read', 'memory:write', 'decision:write'], GATEWAY.scopes)).toEqual(['memory:read', 'memory:write']);
    expect(intersectDelegatedScopes(['memory:read', 'mcp:delegate'], ['*'])).toEqual(['memory:read']);
    expect(intersectDelegatedScopes(['memory:read', 'task:write'], ['mcp:delegate', 'memory:*'])).toEqual(['memory:read']);
    expect(intersectDelegatedScopes(['memory:read'], ['mcp:delegate'])).toEqual([]);
  });
});

describe('agentContextMiddleware — x-mcp-principal (Lane A1)', () => {
  it('happy path: gateway + token principal → delegated context with the principal identity and intersected scopes', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(req.agentContext).toEqual({
      agentId: 'mcp-token:claude-desktop-000001',
      tenantId: 'josh-business',
      sourceWeight: 0.8,
      scopes: ['memory:read', 'memory:write'],
      verified: true,
      delegated: true,
      userId: 'cuser00000000000000000001',
    });
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledWith({ where: { id: TOKEN.id } });
    // the gateway's own lastSeenAt is still touched
    expect(mockPrisma.agent.update).toHaveBeenCalledWith({ where: { id: GATEWAY.id }, data: { lastSeenAt: expect.any(Date) } });
  });

  it('happy path: oauth principal', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue({
      id: 'cident0000000000000000001', issuer: 'https://acc.example.com', subject: 's', userId: 'cuser00000000000000000002',
      tenantId: 'other-tenant', agentName: 'oauth:acc.example.com', scopes: ['memory:read'], sourceWeight: 1, createdAt: new Date(), lastUsedAt: null, revokedAt: null,
    });
    const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': 'oauth:cident0000000000000000001' });
    await agentContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.agentContext).toMatchObject({ agentId: 'oauth:acc.example.com', tenantId: 'other-tenant', scopes: ['memory:read'], delegated: true, userId: 'cuser00000000000000000002' });
  });

  it('without x-mcp-principal the gateway is an ordinary verified agent (not delegated)', async () => {
    const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY });
    await agentContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.agentContext).toEqual({ agentId: 'mcp-gateway', tenantId: 'gateway-tenant', sourceWeight: 1, scopes: GATEWAY.scopes, verified: true });
    expect(mockPrisma.mcpToken.findUnique).not.toHaveBeenCalled();
  });

  it('revoked principal → 401 principal_invalid (reason revoked)', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, revokedAt: new Date() });
    const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'principal_invalid', reason: 'revoked' }));
    expect(next).not.toHaveBeenCalled();
    expect(req.agentContext).toBeUndefined();
  });

  it('expired principal → 401 principal_invalid (reason expired); unknown → reason not_found', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, expiresAt: new Date(Date.now() - 1000) });
    const a = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(a.req, a.res, a.next);
    expect(a.res.status).toHaveBeenCalledWith(401);
    expect(a.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'principal_invalid', reason: 'expired' }));

    mockPrisma.mcpToken.findUnique.mockResolvedValue(null);
    const b = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': 'token:cnope000000000000000000001' });
    await agentContextMiddleware(b.req, b.res, b.next);
    expect(b.res.status).toHaveBeenCalledWith(401);
    expect(b.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'principal_invalid', reason: 'not_found' }));
  });

  it('malformed x-mcp-principal → 401 principal_invalid without touching the DB', async () => {
    const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': 'user:whatever' });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'principal_invalid', reason: 'malformed' }));
    expect(mockPrisma.mcpToken.findUnique).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('verified agent WITHOUT mcp:delegate presenting x-mcp-principal → 403 delegation_not_allowed (no principal lookup)', async () => {
    const { req, res, next } = mk({ 'x-agent-key': PLAIN_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'delegation_not_allowed' }));
    expect(mockPrisma.mcpToken.findUnique).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('a `*` agent does NOT implicitly hold mcp:delegate', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue({ ...PLAIN, scopes: ['*'] });
    const { req, res, next } = mk({ 'x-agent-key': PLAIN_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'delegation_not_allowed' }));
  });

  it('legacy (unverified) agent or no identity at all presenting x-mcp-principal → 403 delegation_not_allowed', async () => {
    const legacy = mk({ 'x-agent-id': 'solo', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0', 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(legacy.req, legacy.res, legacy.next);
    expect(legacy.res.status).toHaveBeenCalledWith(403);
    expect(legacy.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'delegation_not_allowed' }));
    expect(legacy.next).not.toHaveBeenCalled();

    const anon = mk({ 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(anon.req, anon.res, anon.next);
    expect(anon.res.status).toHaveBeenCalledWith(403);
    expect(anon.next).not.toHaveBeenCalled();
  });

  it('legacy headers may name either the gateway or the principal; anything else is still a 403 mismatch', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const asPrincipal = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}`, 'x-agent-id': TOKEN.agentName, 'x-tenant-id': TOKEN.tenantId, 'x-source-weight': '0.8' });
    await agentContextMiddleware(asPrincipal.req, asPrincipal.res, asPrincipal.next);
    expect(asPrincipal.next).toHaveBeenCalledWith();

    const asGateway = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}`, 'x-agent-id': 'mcp-gateway', 'x-tenant-id': 'gateway-tenant' });
    await agentContextMiddleware(asGateway.req, asGateway.res, asGateway.next);
    expect(asGateway.next).toHaveBeenCalledWith();
    expect(asGateway.req.agentContext).toMatchObject({ agentId: TOKEN.agentName, delegated: true });

    const wrong = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}`, 'x-tenant-id': 'tgfc-ministry' });
    await agentContextMiddleware(wrong.req, wrong.res, wrong.next);
    expect(wrong.res.status).toHaveBeenCalledWith(403);
    expect(wrong.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'agent_header_mismatch', fields: ['x-tenant-id'] }));
  });

  it('principal lookup DB failure fails CLOSED (503)', async () => {
    mockPrisma.mcpToken.findUnique.mockRejectedValue(new Error('db down'));
    const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('principal rows are cached for 60 s across requests', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    for (let i = 0; i < 4; i++) {
      const { req, res, next } = mk({ 'x-agent-key': GATEWAY_KEY, 'x-mcp-principal': `token:${TOKEN.id}` });
      await agentContextMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    }
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledTimes(1);
  });
});
