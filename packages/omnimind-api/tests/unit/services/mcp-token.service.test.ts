/**
 * Lane A1 — mcp-token.service unit tests (Prisma mocked, no DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  tenant: { findFirst: vi.fn(), findMany: vi.fn() },
  mcpToken: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mcpOauthIdentity: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  mcpAuditLog: { findMany: vi.fn() },
}));
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: mockLogger }));

import {
  __resetMcpTokenStateForTest,
  AGENT_NAME_SUFFIX_LENGTH,
  buildOauthAgentName,
  buildTokenAgentName,
  createMcpIdentity,
  createMcpToken,
  evictDelegatedPrincipal,
  generateRawMcpToken,
  generateRowId,
  getMcpAuditStats,
  getMcpTokenOptions,
  hashMcpToken,
  introspectMcpToken,
  isIssuerAllowed,
  isUniqueViolation,
  listMcpIdentities,
  listMcpTokens,
  loadDelegatedPrincipal,
  normalizeEmail,
  normalizeIssuer,
  oauthAgentNameBase,
  parseAllowedIssuers,
  percentile,
  resolveMcpIdentity,
  revokeMcpIdentity,
  revokeMcpToken,
  slugify,
  subjectHashPrefix,
  toIdentityRecord,
  tokenStatus,
  toTokenRecord,
  updateMcpIdentity,
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

  it('generateRowId (review A10): c + 24 base64url chars from CSPRNG bytes, no modulo bias, unique, principal-ref safe', () => {
    const ids = new Set(Array.from({ length: 2000 }, generateRowId));
    expect(ids.size).toBe(2000);
    const seen = new Set<string>();
    for (const id of ids) {
      expect(id).toMatch(/^c[A-Za-z0-9_-]{24}$/);
      expect(`token:${id}`).toMatch(/^(token|oauth):[A-Za-z0-9_-]{1,64}$/);
      for (const ch of id.slice(1)) seen.add(ch);
    }
    // base64url yields all 64 symbols (a base36 `% 36` generator could never emit upper-case, '-' or '_')
    expect(seen.size).toBe(64);
  });

  it('isUniqueViolation: Prisma P2002 only (duck-typed)', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['agent_name'] } })).toBe(true);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('slugify + buildTokenAgentName: mcp-token:<slug>-<last 8 of id>', () => {
    expect(AGENT_NAME_SUFFIX_LENGTH).toBe(8);
    expect(slugify('  Claude Desktop (Mac) ')).toBe('claude-desktop-mac');
    expect(slugify('!!!')).toBe('token');
    expect(buildTokenAgentName('Claude Desktop', 'cabcdefghijklmnopqrstuvwx')).toBe('mcp-token:claude-desktop-qrstuvwx');
  });

  it('buildOauthAgentName (review A5): per-identity suffix; clientId wins, else issuer host, else raw issuer', () => {
    expect(oauthAgentNameBase('https://accounts.example.com/realm', 'my-client')).toBe('oauth:my-client');
    expect(oauthAgentNameBase('https://accounts.example.com/realm')).toBe('oauth:accounts.example.com');
    expect(oauthAgentNameBase('urn:issuer:x')).toBe('oauth:urn:issuer:x');
    const a = buildOauthAgentName('https://accounts.example.com/realm', 'my-client', 'cidentAAAAAAAAAAAAAAAAAA1');
    const b = buildOauthAgentName('https://accounts.example.com/realm', 'my-client', 'cidentBBBBBBBBBBBBBBBBBB2');
    expect(a).toBe('oauth:my-client-AAAAAAA1');
    expect(b).toBe('oauth:my-client-BBBBBBB2');
    expect(a).not.toBe(b);
    expect(buildOauthAgentName('https://accounts.example.com/realm', undefined, 'cidentAAAAAAAAAAAAAAAAAA1')).toBe('oauth:accounts.example.com-AAAAAAA1');
  });

  it('normalizeEmail / normalizeIssuer / parseAllowedIssuers / isIssuerAllowed (review A6)', () => {
    expect(normalizeEmail('  Josh@Gmail.COM ')).toBe('josh@gmail.com');
    expect(normalizeIssuer(' https://idp.example/ ')).toBe('https://idp.example');
    expect(parseAllowedIssuers(undefined)).toBeNull();
    expect(parseAllowedIssuers('')).toBeNull();
    expect(parseAllowedIssuers(' , ')).toBeNull();
    expect([...parseAllowedIssuers('https://a.example/, https://b.example')!]).toEqual(['https://a.example', 'https://b.example']);
    expect(isIssuerAllowed('https://anything', {})).toBe(true);
    expect(isIssuerAllowed('https://a.example', { MCP_OAUTH_ALLOWED_ISSUERS: 'https://a.example/' })).toBe(true);
    expect(isIssuerAllowed('https://evil.example', { MCP_OAUTH_ALLOWED_ISSUERS: 'https://a.example' })).toBe(false);
  });

  it('toIdentityRecord: ISO dates, drops unknown scopes, carries issuer/subject', () => {
    const rec = toIdentityRecord(identityRow({ scopes: ['memory:read', '*'] }));
    expect(rec).toMatchObject({ id: 'cident0000000000000000001', issuer: 'https://accounts.example.com', subject: 'sub-123', userId: USER, tenantId: TENANT, scopes: ['memory:read'], revokedAt: null });
    expect(typeof rec.createdAt).toBe('string');
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
    expect(data.agentName).toBe(`mcp-token:claude-desktop-${String(data.id).slice(-8)}`);
    expect(data.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 86400000));
    expect(data.sourceWeight).toBe(0.5);
    expect(JSON.stringify(data)).not.toContain(out.token);
    expect(out.record).not.toHaveProperty('tokenHash');
    expect(out.record.expiresAt).toBe(new Date(NOW.getTime() + 30 * 86400000).toISOString());
  });
});

describe('createMcpToken — expiry default + unique-violation retry (reviews A9 / A10)', () => {
  const input = { userId: USER, tenantId: TENANT, name: 'Claude Desktop', scopes: ['memory:read' as const] };
  beforeEach(() => {
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
    mockPrisma.mcpToken.count.mockResolvedValue(0);
    mockPrisma.mcpToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...tokenRow(), ...data, lastUsedAt: null, revokedAt: null,
    }));
  });

  it('expiresInDays omitted → 365 days, never null', async () => {
    const out = await createMcpToken(input, NOW);
    expect(mockPrisma.mcpToken.create.mock.calls[0][0].data.expiresAt).toEqual(new Date(NOW.getTime() + 365 * 86400000));
    expect(out.record.expiresAt).toBe(new Date(NOW.getTime() + 365 * 86400000).toISOString());
  });

  it('expiresInDays: null → never expires (explicit)', async () => {
    const out = await createMcpToken({ ...input, expiresInDays: null }, NOW);
    expect(mockPrisma.mcpToken.create.mock.calls[0][0].data.expiresAt).toBeNull();
    expect(out.record.expiresAt).toBeNull();
  });

  it('P2002 on the first INSERT → retried once with a fresh id + token; second P2002 → rethrown', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['agent_name'] } });
    mockPrisma.mcpToken.create
      .mockRejectedValueOnce(p2002)
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ ...tokenRow(), ...data, lastUsedAt: null, revokedAt: null }));
    const out = await createMcpToken(input, NOW);
    expect(mockPrisma.mcpToken.create).toHaveBeenCalledTimes(2);
    const [first, second] = mockPrisma.mcpToken.create.mock.calls.map(c => c[0].data);
    expect(first.id).not.toBe(second.id);
    expect(first.tokenHash).not.toBe(second.tokenHash);
    expect(hashMcpToken(out.token)).toBe(second.tokenHash);

    mockPrisma.mcpToken.create.mockReset();
    mockPrisma.mcpToken.create.mockRejectedValue(p2002);
    await expect(createMcpToken(input, NOW)).rejects.toMatchObject({ code: 'P2002' });
    expect(mockPrisma.mcpToken.create).toHaveBeenCalledTimes(2);

    mockPrisma.mcpToken.create.mockReset();
    mockPrisma.mcpToken.create.mockRejectedValue(new Error('db down'));
    await expect(createMcpToken(input, NOW)).rejects.toThrow('db down');
    expect(mockPrisma.mcpToken.create).toHaveBeenCalledTimes(1);
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

  const createImpl = async ({ data }: { data: Record<string, unknown> }) => ({ ...identityRow(), ...data, revokedAt: null });

  it('auto-link: verified email + known user owning one tenant → read-only identity with a per-identity agentName (A5) and a case-insensitive, trimmed email match (A6)', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, createdAt: NOW }]);
    mockPrisma.mcpOauthIdentity.create.mockImplementation(createImpl);
    const out = await resolveMcpIdentity({ ...req, email: '  Josh@Example.COM ', emailVerified: true, clientId: 'chatgpt' }, NOW);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({ where: { email: { equals: 'josh@example.com', mode: 'insensitive' } }, select: { id: true } });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith({ where: { ownerUserId: USER }, select: { id: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const data = mockPrisma.mcpOauthIdentity.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ issuer: req.issuer, subject: req.subject, userId: USER, tenantId: TENANT, scopes: ['memory:read'], sourceWeight: 1 });
    expect(data.id).toMatch(/^c[A-Za-z0-9_-]{24}$/);
    expect(data.agentName).toBe(`oauth:chatgpt-${String(data.id).slice(-8)}`);
    expect(out).toMatchObject({ active: true, principal: { kind: 'oauth', id: data.id, userId: USER, tenantId: TENANT, scopes: ['memory:read'], agentName: data.agentName } });
  });

  it('auto-link (review D/M6): a user owning several tenants is linked to the OLDEST-created one, deterministically', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    // the service asks the DB for createdAt asc, id asc — the first row is the oldest
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 'josh-personal', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'josh-business', createdAt: new Date('2026-02-01T00:00:00Z') },
      { id: 'tgfc-ministry', createdAt: new Date('2026-03-01T00:00:00Z') },
    ]);
    mockPrisma.mcpOauthIdentity.create.mockImplementation(createImpl);
    const out = await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW);
    expect(mockPrisma.mcpOauthIdentity.create.mock.calls[0][0].data).toMatchObject({ tenantId: 'josh-personal', scopes: ['memory:read'] });
    expect(out).toMatchObject({ active: true, principal: { tenantId: 'josh-personal', scopes: ['memory:read'] } });
  });

  it('unlinked: no verified email / unknown user / user with 0 tenants', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: false }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com' }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();

    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'unlinked' });

    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([]);
    expect(await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
  });

  it('issuer allow-list (review A6): MCP_OAUTH_ALLOWED_ISSUERS set → other issuers are issuer_not_allowed before any lookup', async () => {
    const prev = process.env.MCP_OAUTH_ALLOWED_ISSUERS;
    try {
      process.env.MCP_OAUTH_ALLOWED_ISSUERS = 'https://accounts.example.com/, https://other.example';
      mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow());
      expect(await resolveMcpIdentity({ issuer: 'https://evil.example', subject: 'sub-123', email: 'j@x.com', emailVerified: true }, NOW)).toEqual({ active: false, reason: 'issuer_not_allowed' });
      expect(mockPrisma.mcpOauthIdentity.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
      // listed issuer (trailing-slash tolerant) still resolves
      expect((await resolveMcpIdentity(req, NOW)).active).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MCP_OAUTH_ALLOWED_ISSUERS; else process.env.MCP_OAUTH_ALLOWED_ISSUERS = prev;
    }
  });

  it('create race (review A6): P2002 on (issuer, subject) → the winner row is re-read and returned, never a 500', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(identityRow({ id: 'cidentwinner0000000000001' }));
    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, createdAt: NOW }]);
    mockPrisma.mcpOauthIdentity.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['issuer', 'subject'] } }));
    const out = await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW);
    expect(out).toMatchObject({ active: true, principal: { id: 'cidentwinner0000000000001' } });
    expect(mockPrisma.mcpOauthIdentity.create).toHaveBeenCalledTimes(1);
  });

  it('agentName collision (review A10): P2002 with no winner row → retried once with a fresh id; a second P2002 is rethrown', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, createdAt: NOW }]);
    const p2002 = Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['agent_name'] } });
    mockPrisma.mcpOauthIdentity.create.mockRejectedValueOnce(p2002).mockImplementationOnce(createImpl);
    const out = await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true, clientId: 'c' }, NOW);
    expect(out.active).toBe(true);
    expect(mockPrisma.mcpOauthIdentity.create).toHaveBeenCalledTimes(2);
    const [a, b] = mockPrisma.mcpOauthIdentity.create.mock.calls.map(c => c[0].data);
    expect(a.id).not.toBe(b.id);
    expect(a.agentName).not.toBe(b.agentName);

    mockPrisma.mcpOauthIdentity.create.mockReset();
    mockPrisma.mcpOauthIdentity.create.mockRejectedValue(p2002);
    await expect(resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW)).rejects.toMatchObject({ code: 'P2002' });
    expect(mockPrisma.mcpOauthIdentity.create).toHaveBeenCalledTimes(2);
  });
});

describe('OAuth identity administration (review D/M6)', () => {
  it('listMcpIdentities: newest first, public records only; userId omitted → every identity; limit defaults to 50 and is clamped to 1..200', async () => {
    mockPrisma.mcpOauthIdentity.findMany.mockResolvedValue([identityRow()]);
    const out = await listMcpIdentities({ userId: USER });
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenCalledWith({ where: { userId: USER }, orderBy: { createdAt: 'desc' }, take: 50 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'cident0000000000000000001', scopes: ['memory:read'] });

    await listMcpIdentities();
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenLastCalledWith({ where: {}, orderBy: { createdAt: 'desc' }, take: 50 });
    await listMcpIdentities({ limit: 5 });
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenLastCalledWith({ where: {}, orderBy: { createdAt: 'desc' }, take: 5 });
    await listMcpIdentities({ limit: 9999 });
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200 }));
    await listMcpIdentities({ limit: 0 });
    expect(mockPrisma.mcpOauthIdentity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('updateMcpIdentity: null for unknown id; tenant must be owned by the identity user (403 tenant_not_owned); scopes replaced; cache evicted', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect(await updateMcpIdentity('nope', { scopes: ['memory:read'] })).toBeNull();

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow());
    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    await expect(updateMcpIdentity('cident0000000000000000001', { tenantId: 'tgfc-ministry' })).rejects.toMatchObject({ statusCode: 403, body: { code: 'tenant_not_owned' } });
    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({ where: { id: 'tgfc-ministry', ownerUserId: USER }, select: { id: true } });
    expect(mockPrisma.mcpOauthIdentity.update).not.toHaveBeenCalled();

    // warm the delegation cache, then update: the next load must refetch
    await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW);
    mockPrisma.mcpOauthIdentity.findUnique.mockClear();
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'tgfc-ministry' });
    mockPrisma.mcpOauthIdentity.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => identityRow({ ...(data as object) }));
    const rec = await updateMcpIdentity('cident0000000000000000001', { tenantId: 'tgfc-ministry', scopes: ['memory:read', 'task:write'] });
    expect(mockPrisma.mcpOauthIdentity.update).toHaveBeenCalledWith({ where: { id: 'cident0000000000000000001' }, data: { tenantId: 'tgfc-ministry', scopes: ['memory:read', 'task:write'] } });
    expect(rec).toMatchObject({ tenantId: 'tgfc-ministry', scopes: ['memory:read', 'task:write'] });
    mockPrisma.mcpOauthIdentity.findUnique.mockClear();
    await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW);
    expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledTimes(1);
  });

  it('revokeMcpIdentity: false for unknown id; sets revokedAt once (idempotent); evicts the cache so the next request is refused', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    expect(await revokeMcpIdentity('nope', NOW)).toBe(false);

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow());
    expect((await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW)).ok).toBe(true);
    expect(await revokeMcpIdentity('cident0000000000000000001', NOW)).toBe(true);
    expect(mockPrisma.mcpOauthIdentity.update).toHaveBeenCalledWith({ where: { id: 'cident0000000000000000001' }, data: { revokedAt: NOW } });
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow({ revokedAt: NOW }));
    expect(await loadDelegatedPrincipal('oauth:cident0000000000000000001', NOW)).toEqual({ ok: false, reason: 'revoked' });
    mockPrisma.mcpOauthIdentity.update.mockClear();
    expect(await revokeMcpIdentity('cident0000000000000000001', NOW)).toBe(true);
    expect(mockPrisma.mcpOauthIdentity.update).not.toHaveBeenCalled();
  });
});

describe('resolveMcpIdentity — unlinked attempts are logged without the subject; issuer is normalised', () => {
  const req = { issuer: 'https://accounts.example.com/', subject: 'sub-secret-123' };
  const warnLines = () => mockLogger.warn.mock.calls.filter(c => String(c[0]).includes('unlinked'));
  const serialized = () => JSON.stringify(warnLines());

  it('subjectHashPrefix: 12 hex chars of sha256(subject), stable, never the subject', () => {
    const h = subjectHashPrefix('sub-secret-123');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(h).toBe(createHash('sha256').update('sub-secret-123').digest('hex').slice(0, 12));
    expect(h).not.toContain('sub-secret');
  });

  it('lookup + create use the trailing-slash-trimmed issuer, so an operator-linked row matches a JWT iss with a trailing slash', async () => {
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow({ subject: 'sub-secret-123' }));
    expect((await resolveMcpIdentity(req, NOW)).active).toBe(true);
    expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledWith({ where: { issuer_subject: { issuer: 'https://accounts.example.com', subject: 'sub-secret-123' } } });

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: TENANT, createdAt: NOW }]);
    mockPrisma.mcpOauthIdentity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...identityRow(), ...data, revokedAt: null }));
    await resolveMcpIdentity({ ...req, email: 'j@x.com', emailVerified: true }, NOW);
    const data = mockPrisma.mcpOauthIdentity.create.mock.calls[0][0].data;
    expect(data.issuer).toBe('https://accounts.example.com');
    expect(data.agentName).toBe(`oauth:accounts.example.com-${String(data.id).slice(-8)}`);
    expect(warnLines()).toHaveLength(0);
  });

  it('no verified e-mail / unknown user / no tenant / revoked → one warn each with issuer, subjectHash, reason, emailPresent — never the raw subject or e-mail', async () => {
    const hash = subjectHashPrefix('sub-secret-123');
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(null);

    await resolveMcpIdentity(req, NOW);
    expect(warnLines()).toHaveLength(1);
    expect(warnLines()[0][1]).toEqual({ issuer: 'https://accounts.example.com', subjectHash: hash, reason: 'no_verified_email', emailPresent: false, emailVerified: false, clientId: null });

    await resolveMcpIdentity({ ...req, email: 'Secret.Person@x.com', emailVerified: false, clientId: 'chatgpt' }, NOW);
    expect(warnLines()[1][1]).toMatchObject({ reason: 'no_verified_email', emailPresent: true, emailVerified: false, clientId: 'chatgpt' });

    mockPrisma.user.findFirst.mockResolvedValue(null);
    await resolveMcpIdentity({ ...req, email: 'Secret.Person@x.com', emailVerified: true }, NOW);
    expect(warnLines()[2][1]).toMatchObject({ reason: 'user_not_found', emailPresent: true, emailVerified: true });

    mockPrisma.user.findFirst.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findMany.mockResolvedValue([]);
    await resolveMcpIdentity({ ...req, email: 'Secret.Person@x.com', emailVerified: true }, NOW);
    expect(warnLines()[3][1]).toMatchObject({ reason: 'no_owned_tenant', userId: USER });

    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValue(identityRow({ id: 'cidentrevoked00000000001', subject: 'sub-secret-123', revokedAt: NOW }));
    expect(await resolveMcpIdentity(req, NOW)).toEqual({ active: false, reason: 'unlinked' });
    expect(warnLines()[4][1]).toMatchObject({ reason: 'revoked', identityId: 'cidentrevoked00000000001' });

    expect(warnLines()).toHaveLength(5);
    expect(serialized()).not.toContain('sub-secret-123');
    expect(serialized()).not.toContain('Secret.Person');
    expect(serialized()).not.toContain('secret.person');
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
  });
});

describe('createMcpIdentity (operator link, POST /mcp/identities)', () => {
  const ID = 'cident0000000000000000001';
  const input = { issuer: 'https://idp.example/', subject: 'sub-9', userId: USER, tenantId: TENANT };
  const byKey = (rows: { byPair?: ReturnType<typeof identityRow> | null; byId?: ReturnType<typeof identityRow> | null }) =>
    mockPrisma.mcpOauthIdentity.findUnique.mockImplementation(async ({ where }: { where: { id?: string; issuer_subject?: unknown } }) =>
      where.issuer_subject ? (rows.byPair ?? null) : (rows.byId ?? null));
  const createImpl = async ({ data }: { data: Record<string, unknown> }) => ({ ...identityRow(), ...data, lastUsedAt: null, revokedAt: null });

  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER });
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT });
  });

  it('happy path: normalised issuer, default read-only scopes, sourceWeight 1, per-identity agentName, outcome created', async () => {
    byKey({ byPair: null });
    mockPrisma.mcpOauthIdentity.create.mockImplementation(createImpl);
    const out = await createMcpIdentity(input, NOW);
    expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledWith({ where: { issuer_subject: { issuer: 'https://idp.example', subject: 'sub-9' } } });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: USER }, select: { id: true } });
    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({ where: { id: TENANT, ownerUserId: USER }, select: { id: true } });
    const data = mockPrisma.mcpOauthIdentity.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ issuer: 'https://idp.example', subject: 'sub-9', userId: USER, tenantId: TENANT, scopes: ['memory:read'], sourceWeight: 1, createdAt: NOW });
    expect(data.id).toMatch(/^c[A-Za-z0-9_-]{24}$/);
    expect(data.agentName).toBe(`oauth:idp.example-${String(data.id).slice(-8)}`);
    expect(data.lastUsedAt).toBeUndefined();
    expect(out.outcome).toBe('created');
    expect(out.identity).toMatchObject({ id: data.id, issuer: 'https://idp.example', subject: 'sub-9', scopes: ['memory:read'], revokedAt: null });
  });

  it('explicit scopes / sourceWeight / clientId are honoured', async () => {
    byKey({ byPair: null });
    mockPrisma.mcpOauthIdentity.create.mockImplementation(createImpl);
    const out = await createMcpIdentity({ ...input, scopes: ['memory:read', 'task:write'], sourceWeight: 0.5, clientId: 'chatgpt' }, NOW);
    const data = mockPrisma.mcpOauthIdentity.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ scopes: ['memory:read', 'task:write'], sourceWeight: 0.5 });
    expect(data.agentName).toBe(`oauth:chatgpt-${String(data.id).slice(-8)}`);
    expect(out.identity.scopes).toEqual(['memory:read', 'task:write']);
  });

  it('409 identity_exists carrying the existing id when the pair already has an ACTIVE row — before user/tenant are even looked up', async () => {
    byKey({ byPair: identityRow({ id: 'cidentactive0000000000001' }) });
    await expect(createMcpIdentity(input, NOW)).rejects.toMatchObject({ statusCode: 409, body: { code: 'identity_exists', existingId: 'cidentactive0000000000001' } });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
    expect(mockPrisma.mcpOauthIdentity.update).not.toHaveBeenCalled();
  });

  it('a REVOKED row for the pair is reactivated in place (unique (issuer, subject) forbids a second row): revokedAt cleared, user/tenant/scopes/weight replaced, id + createdAt kept, cache evicted', async () => {
    const revoked = identityRow({ id: ID, issuer: 'https://idp.example', subject: 'sub-9', userId: 'colduser00000000000000001', tenantId: 'old-tenant', scopes: ['memory:read', 'memory:write'], agentName: 'oauth:old-client-00000001', revokedAt: new Date('2026-10-10T00:00:00Z') });
    // warm the delegation cache with the (then active) row, as a gateway would have
    byKey({ byPair: revoked, byId: { ...revoked, revokedAt: null } });
    expect((await loadDelegatedPrincipal(`oauth:${ID}`, NOW)).ok).toBe(true);
    mockPrisma.mcpOauthIdentity.findUnique.mockClear();

    mockPrisma.mcpOauthIdentity.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...revoked, ...data }));
    const out = await createMcpIdentity({ ...input, scopes: ['task:write'] }, NOW);
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
    expect(mockPrisma.mcpOauthIdentity.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { revokedAt: null, userId: USER, tenantId: TENANT, scopes: ['task:write'], sourceWeight: 1 },
    });
    expect(out.outcome).toBe('reactivated');
    expect(out.identity).toMatchObject({ id: ID, userId: USER, tenantId: TENANT, scopes: ['task:write'], revokedAt: null, createdAt: '2026-10-01T00:00:00.000Z', agentName: 'oauth:old-client-00000001' });

    // evicted: the next delegated load goes back to the DB
    mockPrisma.mcpOauthIdentity.findUnique.mockClear();
    await loadDelegatedPrincipal(`oauth:${ID}`, NOW);
    expect(mockPrisma.mcpOauthIdentity.findUnique).toHaveBeenCalledWith({ where: { id: ID } });

    // a clientId on reactivation rebuilds the agentName (same suffix, since the id is kept)
    mockPrisma.mcpOauthIdentity.update.mockClear();
    await createMcpIdentity({ ...input, clientId: 'cursor' }, NOW);
    expect(mockPrisma.mcpOauthIdentity.update.mock.calls[0][0].data).toMatchObject({ agentName: `oauth:cursor-${ID.slice(-8)}`, scopes: ['memory:read'] });
  });

  it('403 tenant_not_owned / 404 user_not_found — nothing written', async () => {
    byKey({ byPair: null });
    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    await expect(createMcpIdentity(input, NOW)).rejects.toMatchObject({ statusCode: 403, body: { code: 'tenant_not_owned' } });

    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(createMcpIdentity(input, NOW)).rejects.toMatchObject({ statusCode: 404, body: { code: 'user_not_found' } });
    expect(mockPrisma.mcpOauthIdentity.create).not.toHaveBeenCalled();
    expect(mockPrisma.mcpOauthIdentity.update).not.toHaveBeenCalled();
  });

  it('403 issuer_not_allowed when MCP_OAUTH_ALLOWED_ISSUERS is set and excludes the issuer (trailing-slash tolerant), before any lookup', async () => {
    const prev = process.env.MCP_OAUTH_ALLOWED_ISSUERS;
    try {
      process.env.MCP_OAUTH_ALLOWED_ISSUERS = 'https://idp.example';
      byKey({ byPair: null });
      mockPrisma.mcpOauthIdentity.create.mockImplementation(createImpl);
      await expect(createMcpIdentity({ ...input, issuer: 'https://evil.example' }, NOW)).rejects.toMatchObject({ statusCode: 403, body: { code: 'issuer_not_allowed' } });
      expect(mockPrisma.mcpOauthIdentity.findUnique).not.toHaveBeenCalled();
      expect((await createMcpIdentity(input, NOW)).outcome).toBe('created');
    } finally {
      if (prev === undefined) delete process.env.MCP_OAUTH_ALLOWED_ISSUERS; else process.env.MCP_OAUTH_ALLOWED_ISSUERS = prev;
    }
  });

  it('lost race on the pair (P2002 with a winner row) → 409 identity_exists naming the winner; agentName collision → one retry, then rethrow', async () => {
    const p2002 = Object.assign(new Error('dup'), { code: 'P2002' });
    mockPrisma.mcpOauthIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(identityRow({ id: 'cidentwinner0000000000001' }));
    mockPrisma.mcpOauthIdentity.create.mockRejectedValue(p2002);
    await expect(createMcpIdentity(input, NOW)).rejects.toMatchObject({ statusCode: 409, body: { code: 'identity_exists', existingId: 'cidentwinner0000000000001' } });
    expect(mockPrisma.mcpOauthIdentity.create).toHaveBeenCalledTimes(1);

    byKey({ byPair: null });
    mockPrisma.mcpOauthIdentity.create.mockReset();
    mockPrisma.mcpOauthIdentity.create.mockRejectedValueOnce(p2002).mockImplementationOnce(createImpl);
    expect((await createMcpIdentity(input, NOW)).outcome).toBe('created');
    const [a, b] = mockPrisma.mcpOauthIdentity.create.mock.calls.map(c => c[0].data);
    expect(a.id).not.toBe(b.id);

    mockPrisma.mcpOauthIdentity.create.mockReset();
    mockPrisma.mcpOauthIdentity.create.mockRejectedValue(p2002);
    await expect(createMcpIdentity(input, NOW)).rejects.toMatchObject({ code: 'P2002' });
    expect(mockPrisma.mcpOauthIdentity.create).toHaveBeenCalledTimes(2);
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
