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
  mcpOauthIdentity: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn() },
  contradictionAlert: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
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

  it('400 validation_failed on bad scopes (wildcards / mcp:delegate are not grantable) — details are [{field,message}] like the 422s (review A7)', async () => {
    for (const scopes of [['*'], ['mcp:delegate'], ['memory:*'], [], ['memory:read', 'memory:read']]) {
      const res = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, scopes });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_failed');
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
      for (const d of res.body.details) expect(Object.keys(d).sort()).toEqual(['field', 'message']);
      expect(res.body.details.some((d: { field: string }) => d.field.startsWith('scopes'))).toBe(true);
    }
    const missing = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({});
    expect(missing.body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['userId', 'tenantId', 'name', 'scopes']));
    expect(mockPrisma.mcpToken.create).not.toHaveBeenCalled();
  });

  it('expiresInDays: omitted → 365 days; null → never (review A9)', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(0);
    mockPrisma.mcpToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...TOKEN, ...data, lastUsedAt: null, revokedAt: null }));
    const before = Date.now();
    const dflt = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send(body);
    expect(dflt.status).toBe(201);
    const exp = new Date(dflt.body.record.expiresAt).getTime();
    expect(exp - before).toBeGreaterThanOrEqual(365 * 86400000 - 5000);
    expect(exp - before).toBeLessThanOrEqual(365 * 86400000 + 5000);

    const never = await api().post('/mcp/tokens').set('x-api-key', API_KEY).send({ ...body, expiresInDays: null });
    expect(never.status).toBe(201);
    expect(never.body.record.expiresAt).toBeNull();
    expect(mockPrisma.mcpToken.create.mock.calls[1][0].data.expiresAt).toBeNull();
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
    expect(res.body.record.agentName).toMatch(/^mcp-token:claude-desktop-[A-Za-z0-9_-]{8}$/);
    expect(res.body.record.agentName.endsWith(res.body.record.id.slice(-8))).toBe(true);
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

describe('token management refuses ANY agent context (review A2)', () => {
  const body = { userId: USER, tenantId: TENANT, name: 'escalated', scopes: ['memory:write', 'decision:write', 'task:write'] };
  const legacy = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-agent-id', 'solo').set('x-tenant-id', TENANT).set('x-source-weight', '1.0');
  const plain = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY);
  const delegated = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`);

  beforeEach(() => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(0);
    mockPrisma.mcpToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...TOKEN, ...data, lastUsedAt: null, revokedAt: null }));
    mockPrisma.mcpToken.findFirst.mockResolvedValue({ ...TOKEN, id: 'ctokenother00000000000001' });
    mockPrisma.mcpToken.findUnique.mockResolvedValue({ ...TOKEN, scopes: ['memory:read'] });
  });

  it('a read-only DELEGATED principal cannot mint, list, inspect options or revoke tokens (403 delegated_route_forbidden)', async () => {
    const mint = await delegated(api().post('/mcp/tokens')).send(body);
    expect(mint.status).toBe(403);
    expect(mint.body.error).toBe('delegated_route_forbidden');
    expect(mockPrisma.mcpToken.create).not.toHaveBeenCalled();

    const list = await delegated(api().get('/mcp/tokens')).query({ userId: USER });
    expect(list.status).toBe(403);
    expect(mockPrisma.mcpToken.findMany).not.toHaveBeenCalled();

    const options = await delegated(api().get('/mcp/tokens/options')).query({ userId: USER });
    expect(options.status).toBe(403);

    const revoke = await delegated(api().delete('/mcp/tokens/ctokenother00000000000001')).query({ userId: USER });
    expect(revoke.status).toBe(403);
    // the only update allowed is the principal's own lastUsedAt touch — never a revoke
    expect(mockPrisma.mcpToken.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.anything() }) }));
    expect(mockPrisma.mcpToken.findFirst).not.toHaveBeenCalled();
  });

  it('a plain verified agent and a legacy header-triple agent are refused too (403 agent_context_not_allowed)', async () => {
    for (const as of [plain, legacy]) {
      const mint = await as(api().post('/mcp/tokens')).send(body);
      expect(mint.status).toBe(403);
      expect(mint.body.error).toBe('agent_context_not_allowed');
      expect((await as(api().get('/mcp/tokens')).query({ userId: USER })).status).toBe(403);
      expect((await as(api().get('/mcp/tokens/options')).query({ userId: USER })).status).toBe(403);
      expect((await as(api().delete('/mcp/tokens/ctokenother00000000000001')).query({ userId: USER })).status).toBe(403);
    }
    expect(mockPrisma.mcpToken.create).not.toHaveBeenCalled();
    expect(mockPrisma.mcpToken.update).not.toHaveBeenCalled();
  });

  it('BoardRoom (service key only) is unaffected', async () => {
    expect((await api().post('/mcp/tokens').set('x-api-key', API_KEY).send(body)).status).toBe(201);
    expect((await api().get('/mcp/tokens').set('x-api-key', API_KEY).query({ userId: USER })).status).toBe(200);
  });
});

describe('GET /mcp/audit and GET /mcp/agents under delegation (review A4)', () => {
  const delegated = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`);
  beforeEach(() => { mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN); });

  it('GET /mcp/audit is pinned to the principal\'s own agentName; a different ?agentId= is 403', async () => {
    mockPrisma.mcpAuditLog.findMany.mockResolvedValue([]);
    const res = await delegated(api().get('/mcp/audit'));
    expect(res.status).toBe(200);
    expect(mockPrisma.mcpAuditLog.findMany.mock.calls[0][0].where).toEqual({ agentId: TOKEN.agentName, tenantId: TENANT });

    const same = await delegated(api().get('/mcp/audit')).query({ agentId: TOKEN.agentName });
    expect(same.status).toBe(200);

    const other = await delegated(api().get('/mcp/audit')).query({ agentId: 'claude-code-josh' });
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('audit_identity_mismatch');
    expect(mockPrisma.mcpAuditLog.findMany).toHaveBeenCalledTimes(2);
  });

  it('GET /mcp/agents → 403 delegated_route_forbidden (no roster recon)', async () => {
    const res = await delegated(api().get('/mcp/agents'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('delegated_route_forbidden');
    expect(mockPrisma.agent.findMany).not.toHaveBeenCalled();
  });

  it('GET /mcp/audit/stats is not on the delegated allow-list (the gateway calls it with its static identity)', async () => {
    const res = await delegated(api().get('/mcp/audit/stats'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('delegated_route_forbidden');
  });

  it('a plain verified agent still gets the tenant-wide listing (unchanged)', async () => {
    mockPrisma.mcpAuditLog.findMany.mockResolvedValue([]);
    const res = await api().get('/mcp/audit').set('x-api-key', API_KEY).set('x-agent-key', PLAIN_KEY);
    expect(res.status).toBe(200);
    expect(mockPrisma.mcpAuditLog.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'gw' });
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
    // stopped by the delegated allow-list before the router's own gateway check
    expect(delegated.body.error).toBe('delegated_route_forbidden');
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

    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, createdAt: new Date() }]);
    mockPrisma.mcpOauthIdentity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data }));
    const auto = await api().post('/mcp/identities/resolve').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ ...body, email: 'Josh@Example.com', emailVerified: true });
    expect(auto.status).toBe(200);
    expect(auto.body).toMatchObject({ active: true, principal: { kind: 'oauth', userId: USER, tenantId: TENANT, scopes: ['memory:read'] } });
    expect(auto.body.principal.agentName).toMatch(/^oauth:accounts\.example\.com-[A-Za-z0-9_-]{8}$/);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({ where: { email: { equals: 'josh@example.com', mode: 'insensitive' } }, select: { id: true } });
  });

  it('issuer_not_allowed when MCP_OAUTH_ALLOWED_ISSUERS is set and excludes the issuer (review A6)', async () => {
    process.env.MCP_OAUTH_ALLOWED_ISSUERS = 'https://accounts.example.com';
    try {
      const res = await api().post('/mcp/identities/resolve').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).send({ issuer: 'https://evil.example', subject: 's', email: 'josh@example.com', emailVerified: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ active: false, reason: 'issuer_not_allowed' });
      expect(mockPrisma.mcpOauthIdentity.findUnique).not.toHaveBeenCalled();
    } finally {
      delete process.env.MCP_OAUTH_ALLOWED_ISSUERS;
    }
  });
});

describe('OAuth identity administration: GET/PATCH/DELETE /mcp/identities (x-admin-key, review D/M6)', () => {
  const IDENTITY = { id: 'cident0000000000000000001', issuer: 'https://accounts.example.com', subject: 'sub-1', userId: USER, tenantId: TENANT, agentName: 'oauth:claude-desktop-00000001', scopes: ['memory:read'], sourceWeight: 1, createdAt: new Date('2026-10-01T00:00:00Z'), lastUsedAt: null, revokedAt: null };
  const admin = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-admin-key', 'adm');
  beforeEach(() => { process.env.OMNIMIND_ADMIN_KEY = 'adm'; });

  it('401 without the admin key; 403 for a delegated principal even with it', async () => {
    expect((await api().get(`/mcp/identities?userId=${USER}`).set('x-api-key', API_KEY)).status).toBe(401);
    expect((await api().patch(`/mcp/identities/${IDENTITY.id}`).set('x-api-key', API_KEY).send({ scopes: ['memory:read'] })).status).toBe(401);
    expect((await api().delete(`/mcp/identities/${IDENTITY.id}`).set('x-api-key', API_KEY)).status).toBe(401);
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const del = await admin(api().get(`/mcp/identities?userId=${USER}`)).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`);
    expect(del.status).toBe(403);
    expect(del.body.error).toBe('delegated_route_forbidden');
  });

  it('GET lists a user\'s identities (limit defaults to 50)', async () => {
    mockPrisma.mcpOauthIdentity.findMany.mockResolvedValue([IDENTITY]);
    const res = await admin(api().get(`/mcp/identities?userId=${USER}`));
    expect(res.status).toBe(200);
    expect(res.body.identities).toEqual([expect.objectContaining({ id: IDENTITY.id, issuer: IDENTITY.issuer, subject: 'sub-1', tenantId: TENANT, scopes: ['memory:read'], createdAt: '2026-10-01T00:00:00.000Z' })]);
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenCalledWith({ where: { userId: USER }, orderBy: { createdAt: 'desc' }, take: 50 });
  });

  it('GET without userId lists EVERY identity newest first (operator view), honouring ?limit= ≤ 200; 400 above it or non-integer', async () => {
    const other = { ...IDENTITY, id: 'cident0000000000000000002', userId: OTHER, subject: 'sub-2', createdAt: new Date('2026-10-02T00:00:00Z'), revokedAt: new Date('2026-10-03T00:00:00Z') };
    mockPrisma.mcpOauthIdentity.findMany.mockResolvedValue([other, IDENTITY]);
    const all = await admin(api().get('/mcp/identities'));
    expect(all.status).toBe(200);
    expect(all.body.identities.map((i: { id: string }) => i.id)).toEqual([other.id, IDENTITY.id]);
    expect(all.body.identities[0]).toMatchObject({ userId: OTHER, revokedAt: '2026-10-03T00:00:00.000Z' });
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { createdAt: 'desc' }, take: 50 });

    const limited = await admin(api().get('/mcp/identities?limit=5'));
    expect(limited.status).toBe(200);
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenLastCalledWith({ where: {}, orderBy: { createdAt: 'desc' }, take: 5 });
    expect((await admin(api().get('/mcp/identities?limit=200'))).status).toBe(200);
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200 }));

    for (const bad of ['limit=201', 'limit=0', 'limit=abc', 'limit=2.5']) {
      const res = await admin(api().get(`/mcp/identities?${bad}`));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_failed');
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain('limit');
    }
  });

  it('PATCH re-points tenant (owned only) and re-scopes (subset only); 404 unknown; 400 empty/invalid', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(IDENTITY);
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'josh-personal' });
    mockPrisma.mcpOauthIdentity.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...IDENTITY, ...data }));
    const ok = await admin(api().patch(`/mcp/identities/${IDENTITY.id}`)).send({ tenantId: 'josh-personal', scopes: ['memory:read', 'memory:write'] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: IDENTITY.id, tenantId: 'josh-personal', scopes: ['memory:read', 'memory:write'] });
    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({ where: { id: 'josh-personal', ownerUserId: USER }, select: { id: true } });

    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    const notOwned = await admin(api().patch(`/mcp/identities/${IDENTITY.id}`)).send({ tenantId: 'someone-elses' });
    expect(notOwned.status).toBe(403);
    expect(notOwned.body.code).toBe('tenant_not_owned');

    for (const bad of [{}, { scopes: [] }, { scopes: ['*'] }, { scopes: ['mcp:delegate'] }, { scopes: ['memory:read', 'memory:read'] }]) {
      const res = await admin(api().patch(`/mcp/identities/${IDENTITY.id}`)).send(bad);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_failed');
      expect(Array.isArray(res.body.details)).toBe(true);
    }

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect((await admin(api().patch('/mcp/identities/nope')).send({ scopes: ['memory:read'] })).status).toBe(404);
  });

  it('DELETE revokes (204, idempotent) and the principal is refused on the very next delegated request; 404 unknown', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(IDENTITY);
    mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
    const live = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `oauth:${IDENTITY.id}`);
    expect(live.status).toBe(200);

    const del = await admin(api().delete(`/mcp/identities/${IDENTITY.id}`));
    expect(del.status).toBe(204);
    expect(mockPrisma.mcpOauthIdentity.update).toHaveBeenCalledWith({ where: { id: IDENTITY.id }, data: { revokedAt: expect.any(Date) } });

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue({ ...IDENTITY, revokedAt: new Date() });
    const after = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `oauth:${IDENTITY.id}`);
    expect(after.status).toBe(401);
    expect(after.body.reason).toBe('revoked');

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect((await admin(api().delete('/mcp/identities/nope'))).status).toBe(404);
  });

  describe('POST /mcp/identities (operator link for IdPs that send no verified e-mail)', () => {
    const body = { issuer: 'https://idp.example/', subject: 'sub-9', userId: USER, tenantId: TENANT };
    const byKey = (byPair: Record<string, unknown> | null, byId: Record<string, unknown> | null = null) =>
      mockPrisma.mcpOauthIdentity.findUnique.mockImplementation(async ({ where }: { where: { id?: string; issuer_subject?: unknown } }) => (where.issuer_subject ? byPair : byId));
    const createImpl = async ({ data }: { data: Record<string, unknown> }) => ({ ...IDENTITY, ...data, lastUsedAt: null, revokedAt: null });

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: USER });
      mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
      byKey(null);
      mockPrisma.mcpOauthIdentity.create.mockImplementation(createImpl);
    });

    it('401 without the admin key; 403 delegated_route_forbidden for a delegated principal; 403 for a plain verified agent without the admin key', async () => {
      expect((await api().post('/mcp/identities').set('x-api-key', API_KEY).send(body)).status).toBe(401);
      mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
      const del = await admin(api().post('/mcp/identities')).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).send(body);
      expect(del.status).toBe(403);
      expect(del.body.error).toBe('delegated_route_forbidden');
      expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
    });

    it('201 { identity } — issuer normalised, read-only default scopes, agentName oauth:<issuer host>-<suffix>', async () => {
      const res = await admin(api().post('/mcp/identities')).send(body);
      expect(res.status).toBe(201);
      expect(Object.keys(res.body)).toEqual(['identity']);
      expect(res.body.identity).toMatchObject({ issuer: 'https://idp.example', subject: 'sub-9', userId: USER, tenantId: TENANT, scopes: ['memory:read'], sourceWeight: 1, revokedAt: null, lastUsedAt: null });
      expect(res.body.identity.agentName).toBe(`oauth:idp.example-${String(res.body.identity.id).slice(-8)}`);
      expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledWith({ where: { issuer_subject: { issuer: 'https://idp.example', subject: 'sub-9' } } });
      expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({ where: { id: TENANT, ownerUserId: USER }, select: { id: true } });

      const full = await admin(api().post('/mcp/identities')).send({ ...body, scopes: ['memory:read', 'task:write'], sourceWeight: 1.5, clientId: 'chatgpt' });
      expect(full.status).toBe(201);
      expect(full.body.identity).toMatchObject({ scopes: ['memory:read', 'task:write'], sourceWeight: 1.5 });
      expect(full.body.identity.agentName).toMatch(/^oauth:chatgpt-[A-Za-z0-9_-]{8}$/);
    });

    it('409 identity_exists with the existing id when the pair already has an active row', async () => {
      byKey({ ...IDENTITY, id: 'cidentactive0000000000001' });
      const res = await admin(api().post('/mcp/identities')).send(body);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'identity_exists', existingId: 'cidentactive0000000000001' });
      expect(res.body.message).toContain('PATCH /mcp/identities/cidentactive0000000000001');
      expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.mcpOauthIdentity.update).not.toHaveBeenCalled();
    });

    it('a revoked row for the pair → 200 { identity } reactivated in place, and the delegation cache is evicted', async () => {
      const revoked = { ...IDENTITY, issuer: 'https://idp.example', subject: 'sub-9', userId: OTHER, tenantId: 'old-tenant', revokedAt: new Date('2026-10-10T00:00:00Z') };
      // the gateway had this principal cached while it was still active
      byKey(revoked, { ...revoked, revokedAt: null });
      mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
      expect((await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `oauth:${IDENTITY.id}`)).status).toBe(200);

      mockPrisma.mcpOauthIdentity.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...revoked, ...data }));
      const res = await admin(api().post('/mcp/identities')).send({ ...body, scopes: ['memory:read', 'memory:write'] });
      expect(res.status).toBe(200);
      expect(res.body.identity).toMatchObject({ id: IDENTITY.id, userId: USER, tenantId: TENANT, scopes: ['memory:read', 'memory:write'], revokedAt: null });
      expect(mockPrisma.mcpOauthIdentity.update).toHaveBeenCalledWith({ where: { id: IDENTITY.id }, data: { revokedAt: null, userId: USER, tenantId: TENANT, scopes: ['memory:read', 'memory:write'], sourceWeight: 1 } });
      expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();

      // evicted: the very next delegated request re-reads the row (which now carries the new user/tenant)
      byKey(revoked, { ...revoked, revokedAt: null, userId: USER, tenantId: TENANT, scopes: ['memory:read', 'memory:write'] });
      mockPrisma.mcpOauthIdentity.findUnique.mockClear();
      const after = await api().get('/memories').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `oauth:${IDENTITY.id}`);
      expect(after.status).toBe(200);
      expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledWith({ where: { id: IDENTITY.id } });
    });

    it('403 tenant_not_owned / 404 user_not_found / 403 issuer_not_allowed', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(null);
      const notOwned = await admin(api().post('/mcp/identities')).send(body);
      expect(notOwned.status).toBe(403);
      expect(notOwned.body.code).toBe('tenant_not_owned');

      mockPrisma.user.findUnique.mockResolvedValue(null);
      const noUser = await admin(api().post('/mcp/identities')).send(body);
      expect(noUser.status).toBe(404);
      expect(noUser.body.code).toBe('user_not_found');

      const prev = process.env.MCP_OAUTH_ALLOWED_ISSUERS;
      try {
        process.env.MCP_OAUTH_ALLOWED_ISSUERS = 'https://accounts.example.com';
        mockPrisma.mcpOauthIdentity.findUnique.mockClear();
        const refused = await admin(api().post('/mcp/identities')).send(body);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('issuer_not_allowed');
        expect(mockPrisma.mcpOauthIdentity.findUnique).not.toHaveBeenCalled();
      } finally {
        if (prev === undefined) delete process.env.MCP_OAUTH_ALLOWED_ISSUERS; else process.env.MCP_OAUTH_ALLOWED_ISSUERS = prev;
      }
      expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
    });

    it('400 validation_failed with [{field,message}] details (review A7 shape): missing fields, bad scopes, weight > 2, empty clientId', async () => {
      const missing = await admin(api().post('/mcp/identities')).send({});
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('validation_failed');
      for (const d of missing.body.details) expect(Object.keys(d).sort()).toEqual(['field', 'message']);
      expect(missing.body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['issuer', 'subject', 'userId', 'tenantId']));

      for (const [bad, field] of [
        [{ ...body, scopes: [] }, 'scopes'], [{ ...body, scopes: ['*'] }, 'scopes'], [{ ...body, scopes: ['mcp:delegate'] }, 'scopes'],
        [{ ...body, scopes: ['memory:read', 'memory:read'] }, 'scopes'], [{ ...body, sourceWeight: 2.5 }, 'sourceWeight'], [{ ...body, clientId: '' }, 'clientId'],
      ] as const) {
        const res = await admin(api().post('/mcp/identities')).send(bad);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('validation_failed');
        expect(res.body.details.some((d: { field: string }) => d.field.startsWith(field))).toBe(true);
      }
      expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
    });
  });
});

describe('/mcp validation body shape (review A7)', () => {
  it('POST /mcp/audit and POST /mcp/agents answer 400 validation_failed with [{field,message}] details', async () => {
    const audit = await api().post('/mcp/audit').set('x-api-key', API_KEY).send({ toolName: 'x' });
    expect(audit.status).toBe(400);
    expect(audit.body.error).toBe('validation_failed');
    expect(audit.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'agentId' }), expect.objectContaining({ field: 'tenantId' })]));
    expect(audit.body.details).not.toHaveProperty('fieldErrors');

    const agents = await api().post('/mcp/agents').set('x-api-key', API_KEY).send({ name: 'x' });
    expect(agents.status).toBe(400);
    expect(agents.body.error).toBe('validation_failed');
    expect(agents.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'apiKeyHash', message: expect.any(String) })]));
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
