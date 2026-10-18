/**
 * Lane A1 — /mcp token + identity routes, delegated end-to-end flow and
 * PATCH /admin/tenants/:id, run against the real Express app with Prisma mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
  mcpAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), update: vi.fn() },
  tenant: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), update: vi.fn() },
  mcpToken: { count: vi.fn(), create: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mcpOauthIdentity: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  contradictionAlert: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { __resetAdminAuthForTest } from '../../../src/middleware/admin-auth';
import { __resetAgentContextStateForTest } from '../../../src/middleware/agent-context';
import { __resetMcpTokenStateForTest, hashMcpToken } from '../../../src/services/mcp-token.service';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const OTHER = 'cuser00000000000000000002';
const TENANT = 'josh-business';

const GATEWAY_KEY = 'omk_gateway';
const PLAIN_KEY = 'omk_plain';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const GATEWAY = { id: 'cgateway000000000000000001', name: 'mcp-gateway', apiKeyHash: hash(GATEWAY_KEY), tenantId: 'gw', scopes: ['mcp:delegate', 'memory:read', 'memory:write'], sourceWeight: 1, createdAt: new Date(), lastSeenAt: null };
const PLAIN = { ...GATEWAY, id: 'cplain0000000000000000001', name: 'plain', apiKeyHash: hash(PLAIN_KEY), scopes: ['memory:read', 'memory:write'] };

const TOKEN = {
  id: 'ctoken0000000000000000001', userId: USER, tenantId: TENANT, name: 'Claude Desktop', agentName: 'mcp-token:claude-desktop-000001',
  prefix: 'omt_abcdefgh', tokenHash: 'h'.repeat(64), scopes: ['memory:read', 'memory:write'], sourceWeight: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'), lastUsedAt: null, expiresAt: null, revokedAt: null,
};

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetAdminAuthForTest();
  __resetAgentContextStateForTest();
  __resetMcpTokenStateForTest();
  delete process.env.OMNIMIND_ADMIN_KEY;
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
  mockPrisma.mcpAuditLog.findMany.mockResolvedValue([]);
  mockPrisma.mcpToken.findMany.mockResolvedValue([]);
  mockPrisma.tenant.findMany.mockResolvedValue([]);
  mockPrisma.agent.update.mockResolvedValue(GATEWAY);
  mockPrisma.mcpToken.update.mockResolvedValue(TOKEN);
  mockPrisma.mcpOauthIdentity.update.mockResolvedValue({});
  mockPrisma.agent.findFirst.mockImplementation(async ({ where }: { where: { apiKeyHash: string } }) => {
    if (where.apiKeyHash === GATEWAY.apiKeyHash) return GATEWAY;
    if (where.apiKeyHash === PLAIN.apiKeyHash) return PLAIN;
    return null;
  });
});

const api = () => request(app);

describe('POST /mcp/tokens', () => {
  const body = { userId: USER, tenantId: TENANT, name: 'Claude Desktop', scopes: ['memory:read', 'task:write'] };

  it('400 validation_failed on bad scopes (wildcards / mcp:delegate are not grantable)', async () => {
    for (const scopes of [['*'], ['mcp:delegate'], ['memory:*'], [], ['memory:read', 'memory:read']]) {
      const res = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, scopes });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_failed');
    }
    expect(mockPrisma.mcpToken.create).not.toHaveBeenCalled();
  });

  it('400 on name > 60 chars / expiresInDays out of range / sourceWeight > 2', async () => {
    expect((await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, name: 'x'.repeat(61) })).status).toBe(400);
    expect((await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, expiresInDays: 0 })).status).toBe(400);
    expect((await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, expiresInDays: 366 })).status).toBe(400);
    expect((await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, sourceWeight: 2.5 })).status).toBe(400);
  });

  it('403 tenant_not_owned', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    const res = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('tenant_not_owned');
  });

  it('409 token_limit', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(25);
    const res = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('token_limit');
  });

  it('201 {token, record} — raw omt_ token once, record without hash', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(0);
    mockPrisma.mcpToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...TOKEN, ...data, lastUsedAt: null, revokedAt: null }));
    const res = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, expiresInDays: 7 });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^omt_[A-Za-z0-9_-]{43}$/);
    expect(res.body.record).toMatchObject({ userId: USER, tenantId: TENANT, name: 'Claude Desktop', scopes: ['memory:read', 'task:write'], sourceWeight: 1, revokedAt: null, lastUsedAt: null });
    expect(res.body.record.agentName).toMatch(/^mcp-token:claude-desktop-[a-z0-9]{6}$/);
    expect(res.body.record.prefix).toBe(res.body.token.slice(0, 12));
    expect(typeof res.body.record.expiresAt).toBe('string');
    expect(res.body.record).not.toHaveProperty('tokenHash');
    expect(mockPrisma.mcpToken.create.mock.calls[0][0].data.tokenHash).toBe(hashMcpToken(res.body.token));
  });
});

describe('GET /mcp/tokens, GET /mcp/tokens/options, DELETE /mcp/tokens/:id', () => {
  it('GET /mcp/tokens requires userId; returns records newest-first without hashes', async () => {
    expect((await api().get('/mcp/tokens').set('x-api-key', API_KEY)).status).toBe(400);
    mockPrisma.mcpToken.findMany.mockResolvedValue([TOKEN]);
    const res = await api().get(`/mcp/tokens?userId=${USER}`).set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(1);
    expect(res.body.tokens[0]).not.toHaveProperty('tokenHash');
    expect(res.body.tokens[0].createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(mockPrisma.mcpToken.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: USER }), orderBy: { createdAt: 'desc' } }));
  });

  it('GET /mcp/tokens/options returns owned tenants + scope descriptors (and is not shadowed by /tokens/:id)', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, name: 'Josh Business' }]);
    const res = await api().get(`/mcp/tokens/options?userId=${USER}`).set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual([{ id: TENANT, name: 'Josh Business' }]);
    expect(res.body.scopes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'memory:read', write: false })]));
    expect(res.body.scopes.map((s: { id: string }) => s.id)).not.toContain('mcp:delegate');
  });

  it('DELETE: 204 on revoke (own token), 404 when not that user\'s, 400 without userId', async () => {
    mockPrisma.mcpToken.findFirst.mockResolvedValue(TOKEN);
    const ok = await api().delete(`/mcp/tokens/${TOKEN.id}?userId=${USER}`).set('x-api-key', API_KEY);
    expect(ok.status).toBe(204);
    expect(mockPrisma.mcpToken.findFirst).toHaveBeenCalledWith({ where: { id: TOKEN.id, userId: USER } });
    expect(mockPrisma.mcpToken.update).toHaveBeenCalledWith({ where: { id: TOKEN.id }, data: { revokedAt: expect.any(Date) } });

    mockPrisma.mcpToken.findFirst.mockResolvedValue(null);
    const nf = await api().delete(`/mcp/tokens/${TOKEN.id}?userId=${OTHER}`).set('x-api-key', API_KEY);
    expect(nf.status).toBe(404);
    expect(nf.body.error).toBe('not_found');

    expect((await api().delete(`/mcp/tokens/${TOKEN.id}`).set('x-api-key', API_KEY)).status).toBe(400);
  });
});

describe('POST /mcp/tokens/introspect (gateway only)', () => {
  it('403 gateway_scope_required without x-agent-key, for a non-delegate agent, and for a delegated principal', async () => {
    const anon = await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).send({ token: 'omt_x' });
    expect(anon.status).toBe(403);
    expect(anon.body.error).toBe('gateway_scope_required');

    const plain = await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY).send({ token: 'omt_x' });
    expect(plain.status).toBe(403);
    expect(plain.body.error).toBe('gateway_scope_required');

    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const delegated = await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY)
      .set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).send({ token: 'omt_x' });
    expect(delegated.status).toBe(403);
    expect(delegated.body.error).toBe('gateway_scope_required');
    expect(mockPrisma.mcpToken.findUnique).not.toHaveBeenCalledWith({ where: { tokenHash: hashMcpToken('omt_x') } });
  });

  it('gateway: active → {active:true, principal}; expired/revoked/invalid reasons', async () => {
    const raw = 'omt_' + 'a'.repeat(43);
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const ok = await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ token: raw });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      active: true,
      principal: { kind: 'token', id: TOKEN.id, userId: USER, tenantId: TENANT, agentName: TOKEN.agentName, scopes: ['memory:read', 'memory:write'], sourceWeight: 1, name: 'Claude Desktop' },
    });
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashMcpToken(raw) } });

    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, expiresAt: new Date(Date.now() - 1) });
    expect((await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ token: raw })).body).toEqual({ active: false, reason: 'expired' });
    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, revokedAt: new Date() });
    expect((await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ token: raw })).body).toEqual({ active: false, reason: 'revoked' });
    mockPrisma.mcpToken.findUnique.mockResolvedValue(null);
    expect((await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ token: raw })).body).toEqual({ active: false, reason: 'invalid' });
  });

  it('400 validation_failed on a missing token', async () => {
    const res = await api().post('/mcp/tokens/introspect').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /mcp/identities/resolve (gateway only)', () => {
  const body = { issuer: 'https://accounts.example.com', subject: 'sub-1' };

  it('403 for a non-gateway', async () => {
    const res = await api().post('/mcp/identities/resolve').set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY).send(body);
    expect(res.status).toBe(403);
  });

  it('linked → active principal; unlinked → {active:false, reason:unlinked}; auto-link creates a read-only row', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue({ id: 'cident0000000000000000001', ...body, userId: USER, tenantId: TENANT, agentName: 'oauth:accounts.example.com', scopes: ['memory:read'], sourceWeight: 1, createdAt: new Date(), lastUsedAt: null, revokedAt: null });
    const linked = await api().post('/mcp/identities/resolve').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send(body);
    expect(linked.status).toBe(200);
    expect(linked.body).toEqual({ active: true, principal: { kind: 'oauth', id: 'cident0000000000000000001', userId: USER, tenantId: TENANT, agentName: 'oauth:accounts.example.com', scopes: ['memory:read'], sourceWeight: 1 } });

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    const unlinked = await api().post('/mcp/identities/resolve').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send(body);
    expect(unlinked.body).toEqual({ active: false, reason: 'unlinked' });

    mockPrisma.user.findUnique.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT }]);
    mockPrisma.mcpOauthIdentity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cidentnew00000000000000001', createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data }));
    const auto = await api().post('/mcp/identities/resolve').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ ...body, email: 'josh@example.com', emailVerified: true });
    expect(auto.status).toBe(200);
    expect(auto.body).toMatchObject({ active: true, principal: { kind: 'oauth', id: 'cidentnew00000000000000001', userId: USER, tenantId: TENANT, scopes: ['memory:read'], agentName: 'oauth:accounts.example.com' } });
  });
});

describe('GET /mcp/audit/stats', () => {
  it('returns percentiles for a tool over the window (no agent context → all tenants unless ?tenantId=)', async () => {
    mockPrisma.mcpAuditLog.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ durationMs: (i + 1) * 10, errorMessage: i === 0 ? 'x' : null })));
    const res = await api().get('/mcp/audit/stats?tool=memory_search&sinceHours=48').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tool: 'memory_search', sinceHours: 48, count: 20, p50Ms: 100, p95Ms: 190, errorRate: 0.05 });
    const where = mockPrisma.mcpAuditLog.findMany.mock.calls[0][0].where;
    expect(where.toolName).toBe('memory_search');
    expect(where).not.toHaveProperty('tenantId');
  });

  it('defaults sinceHours to 24, tool null when omitted; agent context pins the tenant; mismatch → 403', async () => {
    const res = await api().get('/mcp/audit/stats').set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tool: null, sinceHours: 24, count: 0, p50Ms: 0, p95Ms: 0, errorRate: 0 });
    expect(mockPrisma.mcpAuditLog.findMany.mock.calls[0][0].where.tenantId).toBe('gw');

    const bad = await api().get('/mcp/audit/stats?tenantId=other').set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY);
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe('tenant_mismatch');
  });

  it('400 on an invalid sinceHours', async () => {
    expect((await api().get('/mcp/audit/stats?sinceHours=0').set('x-api-key', API_KEY)).status).toBe(400);
  });
});

describe('delegated end-to-end (gateway + x-mcp-principal through the real middleware chain)', () => {
  it('GET /memories without x-user-id: the principal\'s userId is injected and the tenant pinned', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const res = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`);
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: USER, tenantId: TENANT }),
    }));
  });

  it('x-user-id for another user → 403 user_mismatch before any query', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const res = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).set('x-user-id', OTHER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('user_mismatch');
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('scopes are the intersection: a read-only token cannot POST /memories (403 insufficient_scope naming the principal)', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, scopes: ['memory:read'] });
    const res = await api().post('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).send({ title: 'x', content: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    expect(res.body.agentId).toBe(TOKEN.agentName);
  });

  it('a revoked principal is refused with 401 principal_invalid', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, revokedAt: new Date() });
    const res = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('principal_invalid');
  });

  it('a non-delegate agent presenting x-mcp-principal → 403 delegation_not_allowed', async () => {
    const res = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).set('x-user-id', USER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('delegation_not_allowed');
  });

  it('POST /mcp/audit: the delegated principal may only write audit rows under its own agentName/tenant', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    mockPrisma.mcpAuditLog.create.mockResolvedValue({ id: 'caudit000000000000000000001' });
    const base = { toolName: 'memory_search', inputJson: {}, durationMs: 5 };
    const ok = await api().post('/mcp/audit').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`)
      .send({ ...base, agentId: TOKEN.agentName, tenantId: TENANT });
    expect(ok.status).toBe(201);
    const bad = await api().post('/mcp/audit').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`)
      .send({ ...base, agentId: 'mcp-gateway', tenantId: 'gw' });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('audit_identity_mismatch');
  });
});

describe('PATCH /admin/tenants/:id + GET /admin/tenants', () => {
  it('requires the admin key when configured', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    const res = await api().patch(`/admin/tenants/${TENANT}`).set('x-api-key', API_KEY).send({ ownerUserId: USER });
    expect(res.status).toBe(401);
  });

  it('sets ownerUserId; 404 for unknown tenant / user; 400 on bad body', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT });
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER });
    mockPrisma.tenant.update.mockResolvedValue({ id: TENANT, name: 'Josh Business', ownerUserId: USER });
    const ok = await api().patch(`/admin/tenants/${TENANT}`).set('x-api-key', API_KEY).set('x-admin-key', 'adm').send({ ownerUserId: USER });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: TENANT, name: 'Josh Business', ownerUserId: USER });
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT }, data: { ownerUserId: USER } }));

    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    expect((await api().patch('/admin/tenants/nope').set('x-api-key', API_KEY).set('x-admin-key', 'adm').send({ ownerUserId: USER })).status).toBe(404);
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect((await api().patch(`/admin/tenants/${TENANT}`).set('x-api-key', API_KEY).set('x-admin-key', 'adm').send({ ownerUserId: 'cnope' })).status).toBe(404);
    expect((await api().patch(`/admin/tenants/${TENANT}`).set('x-api-key', API_KEY).set('x-admin-key', 'adm').send({})).status).toBe(400);

    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, name: 'Josh Business', ownerUserId: USER }]);
    const list = await api().get('/admin/tenants').set('x-api-key', API_KEY).set('x-admin-key', 'adm');
    expect(list.status).toBe(200);
    expect(list.body.tenants).toHaveLength(1);
  });
});
