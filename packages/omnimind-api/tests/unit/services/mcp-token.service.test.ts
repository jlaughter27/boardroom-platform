/**
 * Lane A1 — mcp-token.service unit tests (Prisma mocked, no DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  tenant: { findFirst: vi.fn(), findMany: vi.fn() },
  mcpToken: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mcpOauthIdentity: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  mcpAuditLog: { findMany: vi.fn() },
}));
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: mockLogger }));

import {
  __resetMcpTokenStateForTest,
  buildOauthAgentName,
  buildTokenAgentName,
  createMcpToken,
  evictDelegatedPrincipal,
  generateRawMcpToken,
  generateRowId,
  getMcpAuditStats,
  getMcpTokenOptions,
  hashMcpToken,
  introspectMcpToken,
  listMcpTokens,
  loadDelegatedPrincipal,
  percentile,
  resolveMcpIdentity,
  revokeMcpToken,
  slugify,
  tokenStatus,
  toTokenRecord,
} from '../../../src/services/mcp-token.service';
import { HttpError } from '../../../src/middleware/error-handler';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const USER = 'cuser00000000000000000001';
const TENANT = 'josh-business';

function tokenRow(overrides: Partial<{
  id: string; userId: string; tenantId: string; name: string; agentName: string; prefix: string; tokenHash: string;
  scopes: string[]; sourceWeight: number; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null;
}> = {}) {
  return {
    id: 'ctoken0000000000000000001',
    userId: USER,
    tenantId: TENANT,
    name: 'Claude Desktop',
    agentName: 'mcp-token:claude-desktop-000001',
    prefix: 'omt_abcdefgh',
    tokenHash: 'h'.repeat(64),
    scopes: ['memory:read', 'memory:write'],
    sourceWeight: 1,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function identityRow(overrides: Partial<{
  id: string; issuer: string; subject: string; userId: string; tenantId: string; agentName: string; scopes: string[];
  sourceWeight: number; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null;
}> = {}) {
  return {
    id: 'cident0000000000000000001',
    issuer: 'https://accounts.example.com',
    subject: 'sub-123',
    userId: USER,
    tenantId: TENANT,
    agentName: 'oauth:accounts.example.com',
    scopes: ['memory:read'],
    sourceWeight: 1,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetMcpTokenStateForTest();
  mockPrisma.mcpToken.update.mockResolvedValue(tokenRow());
  mockPrisma.mcpOauthIdentity.update.mockResolvedValue(identityRow());
});

describe('helpers', () => {
  it('generateRawMcpToken: omt_ + 43 base64url chars, unique, sha256 hex hash', () => {
    const a = generateRawMcpToken();
    const b = generateRawMcpToken();
    expect(a).toMatch(/^omt_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashMcpToken(a)).toBe(createHash('sha256').update(a).digest('hex'));
  });

  it('generateRowId: cuid-shaped (c + 24 base36)', () => {
    expect(generateRowId()).toMatch(/^c[a-z0-9]{24}$/);
  });

  it('slugify + buildTokenAgentName: mcp-token:<slug>-<last 6 of id>', () => {
    expect(slugify('  Claude Desktop (Mac) ')).toBe('claude-desktop-mac');
    expect(slugify('!!!')).toBe('token');
    expect(buildTokenAgentName('Claude Desktop', 'cabcdefghijklmnopqrstuvwx')).toBe('mcp-token:claude-desktop-stuvwx');
  });

  it('buildOauthAgentName: clientId wins, else issuer host, else raw issuer', () => {
    expect(buildOauthAgentName('https://accounts.example.com/realm', 'my-client')).toBe('oauth:my-client');
    expect(buildOauthAgentName('https://accounts.example.com/realm')).toBe('oauth:accounts.example.com');
    expect(buildOauthAgentName('urn:issuer:x')).toBe('oauth:urn:issuer:x');
  });

  it('tokenStatus: revoked beats expired; expiry is inclusive at the boundary', () => {
    expect(tokenStatus({ revokedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe('revoked');
    expect(tokenStatus({ revokedAt: null, expiresAt: NOW }, NOW)).toBe('expired');
    expect(tokenStatus({ revokedAt: null, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe('active');
    expect(tokenStatus({ revokedAt: null, expiresAt: null }, NOW)).toBe('active');
  });

  it('toTokenRecord: never exposes tokenHash, serialises dates as ISO, drops unknown scopes', () => {
    const rec = toTokenRecord(tokenRow({ scopes: ['memory:read', '*', 'mcp:delegate'] }));
    expect(rec).not.toHaveProperty('tokenHash');
    expect(rec.createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(rec.lastUsedAt).toBeNull();
    expect(rec.scopes).toEqual(['memory:read']);
  });

  it('percentile: nearest-rank', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.95)).toBe(10);
    const sample = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(sample, 0.5)).toBe(50);
    expect(percentile(sample, 0.95)).toBe(95);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });
});

describe('createMcpToken', () => {
  const input = { userId: USER, tenantId: TENANT, name: 'Claude Desktop', scopes: ['memory:read' as const] };

  it('403 tenant_not_owned when the tenant is not owned by the user', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    await expect(createMcpToken(input, NOW)).rejects.toMatchObject({ statusCode: 403, body: { code: 'tenant_not_owned' } });
    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT, ownerUserId: USER } }));
    expect(mockPrisma.mcpToken.create).not.toHaveBeenCalled();
  });

  it('409 token_limit at 25 active tokens (revoked/expired do not count)', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(25);
    await expect(createMcpToken(input, NOW)).rejects.toMatchObject({ statusCode: 409, body: { code: 'token_limit' } });
    expect(mockPrisma.mcpToken.count).toHaveBeenCalledWith({
      where: { userId: USER, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
    });
  });

  it('stores only the hash + 12-char prefix, returns the raw token once, derives agentName and expiry', async () => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(3);
    mockPrisma.mcpToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...tokenRow(), ...data, lastUsedAt: null, revokedAt: null,
    }));
    const out = await createMcpToken({ ...input, expiresInDays: 30, sourceWeight: 0.5 }, NOW);
    expect(out.token).toMatch(/^omt_[A-Za-z0-9_-]{43}$/);
    const data = mockPrisma.mcpToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashMcpToken(out.token));
    expect(data.prefix).toBe(out.token.slice(0, 12));
    expect(data.agentName).toBe(`mcp-token:claude-desktop-${String(data.id).slice(-6)}`);
    expect(data.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 86400000));
    expect(data.sourceWeight).toBe(0.5);
    expect(JSON.stringify(data)).not.toContain(out.token);
    expect(out.record).not.toHaveProperty('tokenHash');
    expect(out.record.expiresAt).toBe(new Date(NOW.getTime() + 30 * 86400000).toISOString());
  });
});

describe('listMcpTokens / revokeMcpToken / options', () => {
  it('list: newest first, revoked older than 30 days excluded by the where clause', async () => {
    mockPrisma.mcpToken.findMany.mockResolvedValue([tokenRow()]);
    const out = await listMcpTokens(USER, NOW);
    expect(out).toHaveLength(1);
    expect(mockPrisma.mcpToken.findMany).toHaveBeenCalledWith({
      where: { userId: USER, OR: [{ revokedAt: null }, { revokedAt: { gte: new Date(NOW.getTime() - 30 * 86400000) } }] },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('revoke: false (→404) when the row is not the user\'s; sets revokedAt once; idempotent', async () => {
    mockPrisma.mcpToken.findFirst.mockResolvedValue(null);
    expect(await revokeMcpToken('ctoken0000000000000000001', 'someone-else', NOW)).toBe(false);
    expect(mockPrisma.mcpToken.update).not.toHaveBeenCalled();

    mockPrisma.mcpToken.findFirst.mockResolvedValue(tokenRow());
    expect(await revokeMcpToken('ctoken0000000000000000001', USER, NOW)).toBe(true);
    expect(mockPrisma.mcpToken.update).toHaveBeenCalledWith({ where: { id: 'ctoken0000000000000000001' }, data: { revokedAt: NOW } });

    mockPrisma.mcpToken.update.mockClear();
    mockPrisma.mcpToken.findFirst.mockResolvedValue(tokenRow({ revokedAt: NOW }));
    expect(await revokeMcpToken('ctoken0000000000000000001', USER, NOW)).toBe(true);
    expect(mockPrisma.mcpToken.update).not.toHaveBeenCalled();
  });

  it('options: owned tenants + descriptor list (never mcp:delegate)', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, name: 'Josh Business' }]);
    const out = await getMcpTokenOptions(USER);
    expect(out.tenants).toEqual([{ id: TENANT, name: 'Josh Business' }]);
    expect(out.scopes.map(s => s.id)).toEqual(['memory:read', 'memory:write', 'decision:write', 'task:write', 'commitment:write', 'project:write', 'code:write']);
    expect(out.scopes.find(s => s.id === 'memory:read')?.write).toBe(false);
    expect(out.scopes.find(s => s.id === 'task:write')?.write).toBe(true);
    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: USER } }));
  });
});

describe('introspectMcpToken', () => {
  it('looks up by sha256(raw) and returns the principal for an active token', async () => {
    const raw = generateRawMcpToken();
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(NOW.getTime() + 1000) }));
    const out = await introspectMcpToken(raw, NOW);
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashMcpToken(raw) } });
    expect(out).toEqual({
      active: true,
      principal: {
        kind: 'token',
        id: 'ctoken0000000000000000001',
        userId: USER,
        tenantId: TENANT,
        agentName: 'mcp-token:claude-desktop-000001',
        scopes: ['memory:read', 'memory:write'],
        sourceWeight: 1,
        name: 'Claude Desktop',
        expiresAt: new Date(NOW.getTime() + 1000).toISOString(),
      },
    });
  });

  it('invalid / expired / revoked reasons', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(null);
    expect(await introspectMcpToken('omt_nope', NOW)).toEqual({ active: false, reason: 'invalid' });
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(NOW.getTime() - 1) }));
    expect(await introspectMcpToken('omt_x', NOW)).toEqual({ active: false, reason: 'expired' });
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow({ revokedAt: NOW }));
    expect(await introspectMcpToken('omt_x', NOW)).toEqual({ active: false, reason: 'revoked' });
    expect(mockPrisma.mcpToken.update).not.toHaveBeenCalled();
  });

  it('touches lastUsedAt at most once per 5 minutes per token', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow());
    for (let i = 0; i < 5; i++) await introspectMcpToken('omt_x', new Date(NOW.getTime() + i * 1000));
    expect(mockPrisma.mcpToken.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.mcpToken.update).toHaveBeenCalledWith({ where: { id: 'ctoken0000000000000000001' }, data: { lastUsedAt: NOW } });
    await introspectMcpToken('omt_x', new Date(NOW.getTime() + 5 * 60 * 1000));
    expect(mockPrisma.mcpToken.update).toHaveBeenCalledTimes(2);
  });
});

describe('resolveMcpIdentity', () => {
  const req = { issuer: 'https://accounts.example.com', subject: 'sub-123' };

  it('linked: returns the existing identity as an oauth principal', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow());
    const out = await resolveMcpIdentity(req, NOW);
    expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledWith({ where: { issuer_subject: { issuer: req.issuer, subject: req.subject } } });
    expect(out).toEqual({
      active: true,
      principal: { kind: 'oauth', id: 'cident0000000000000000001', userId: USER, tenantId: TENANT, agentName: 'oauth:accounts.example.com', scopes: ['memory:read'], sourceWeight: 1 },
    });
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
  });

  it('revoked link stays unlinked (no auto re-link)', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow({ revokedAt: NOW }));
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
  });

  it('auto-link: verified email + known user owning exactly one tenant → read-only identity', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT }]);
    mockPrisma.mcpOauthIdentity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...identityRow(), ...data, id: 'cidentnew00000000000000001', revokedAt: null,
    }));
    const out = await resolveMcpIdentity({ ...req, email: 'josh@example.com', emailVerified: true, clientId: 'chatgpt' }, NOW);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'josh@example.com' }, select: { id: true } });
    expect(mockPrisma.mcpOauthIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ issuer: req.issuer, subject: req.subject, userId: USER, tenantId: TENANT, agentName: 'oauth:chatgpt', scopes: ['memory:read'], sourceWeight: 1 }),
    });
    expect(out).toMatchObject({ active: true, principal: { kind: 'oauth', id: 'cidentnew00000000000000001', userId: USER, tenantId: TENANT, scopes: ['memory:read'] } });
  });

  it('unlinked: no verified email / unknown user / user with 0 or 2 tenants', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: false }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com' }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();

    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'unlinked' });

    mockPrisma.user.findUnique.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([]);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
  });
});

describe('getMcpAuditStats', () => {
  it('computes count, p50, p95 and errorRate over the window; filters by tool + tenant', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ durationMs: i + 1, errorMessage: i < 10 ? 'boom' : null }));
    mockPrisma.mcpAuditLog.findMany.mockResolvedValue(rows);
    const out = await getMcpAuditStats({ tool: 'memory_search', sinceHours: 24, tenantId: TENANT }, NOW);
    expect(out).toEqual({ tool: 'memory_search', sinceHours: 24, count: 100, p50Ms: 50, p95Ms: 95, errorRate: 0.1 });
    expect(mockPrisma.mcpAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { gte: new Date(NOW.getTime() - 24 * 3600000) }, toolName: 'memory_search', tenantId: TENANT },
      take: 10000,
    }));
  });

  it('empty window → zeros, tool null when unfiltered', async () => {
    mockPrisma.mcpAuditLog.findMany.mockResolvedValue([]);
    expect(await getMcpAuditStats({ sinceHours: 6 }, NOW)).toEqual({ tool: null, sinceHours: 6, count: 0, p50Ms: 0, p95Ms: 0, errorRate: 0 });
    const where = mockPrisma.mcpAuditLog.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('toolName');
    expect(where).not.toHaveProperty('tenantId');
  });
});

describe('loadDelegatedPrincipal (60 s cache)', () => {
  it('malformed refs are rejected without a lookup', async () => {
    for (const bad of ['token', 'token:', 'user:abc', 'token:has space', 'oauth:' + 'x'.repeat(65)]) {
      expect(await loadDelegatedPrincipal(bad, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
    expect(mockPrisma.mcpToken.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.mcpOauthIdentity.findUnique).not.toHaveBeenCalled();
  });

  it('token: loads once, serves from cache within 60 s, refetches after', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow());
    const a = await loadDelegatedPrincipal('token:ctoken0000000000000000001', NOW);
    const b = await loadDelegatedPrincipal('token:ctoken0000000000000000001', new Date(NOW.getTime() + 59_000));
    expect(a.ok && b.ok).toBe(true);
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledWith({ where: { id: 'ctoken0000000000000000001' } });
    await loadDelegatedPrincipal('token:ctoken0000000000000000001', new Date(NOW.getTime() + 60_000));
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledTimes(2);
  });

  it('token expiring inside the cache window is refused on time (expiry checked against request clock)', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(NOW.getTime() + 10_000) }));
    expect((await loadDelegatedPrincipal('token:ctoken0000000000000000001', NOW)).ok).toBe(true);
    expect(await loadDelegatedPrincipal('token:ctoken0000000000000000001', new Date(NOW.getTime() + 10_000))).toEqual({ ok: false, reason: 'expired' });
  });

  it('revoke evicts the cache so the next request sees the revoked row', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow());
    expect((await loadDelegatedPrincipal('token:ctoken0000000000000000001', NOW)).ok).toBe(true);
    mockPrisma.mcpToken.findFirst.mockResolvedValue(tokenRow());
    await revokeMcpToken('ctoken0000000000000000001', USER, NOW);
    mockPrisma.mcpToken.findUnique.mockResolvedValue(tokenRow({ revokedAt: NOW }));
    expect(await loadDelegatedPrincipal('token:ctoken0000000000000000001', new Date(NOW.getTime() + 1000))).toEqual({ ok: false, reason: 'revoked' });
    expect(mockPrisma.mcpToken.findUnique).toHaveBeenCalledTimes(2);
  });

  it('oauth: unknown → not_found; revoked → revoked; active → principal; explicit evict forces reload', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect(await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW)).toEqual({ ok: false, reason: 'not_found' });
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow({ revokedAt: NOW }));
    expect(await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW)).toEqual({ ok: false, reason: 'revoked' });
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow());
    const ok = await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW);
    expect(ok).toMatchObject({ ok: true, principal: { kind: 'oauth', agentName: 'oauth:accounts.example.com', userId: USER } });
    evictDelegatedPrincipal('oauth:cident0000000000000000001');
    await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW);
    expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledTimes(4);
  });

  it('HttpError instances carry the contract status + code', () => {
    const e = new HttpError(403, { code: 'tenant_not_owned', message: 'x' });
    expect(e.statusCode).toBe(403);
    expect(e.body.code).toBe('tenant_not_owned');
  });
});
