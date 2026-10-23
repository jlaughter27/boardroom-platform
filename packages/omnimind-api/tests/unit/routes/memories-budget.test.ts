/**
 * RD-4 — domain budgets are SOFT: an over-budget write succeeds (201) and
 * carries a `budget` warning; `GET /memories/budget` reports per-domain
 * standing with the same tenant rules as GET /memories. Real Express app,
 * Prisma mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MemoryBudgetReportSchema, MemoryBudgetStatusSchema } from '@boardroom/shared';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn(),
    create: vi.fn(),
    groupBy: vi.fn().mockResolvedValue([]),
  },
  mcpAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), update: vi.fn() },
  tenant: { count: vi.fn().mockResolvedValue(0) },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue(null),
  getEmbeddingStatus: vi.fn().mockResolvedValue('pending'),
  backfillEmbeddings: vi.fn(),
}));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const legacyAgent = { 'x-agent-id': 'agent-a', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0' };
const body = { title: 'Note 401', content: 'One more business note.', domain: 'business', sourceType: 'MANUAL' };

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'mem-new', ...data }));
  mockPrisma.memoryEntry.groupBy.mockResolvedValue([]);
});

describe('POST /memories past the domain budget (RD-4)', () => {
  it('write #401 in business succeeds (201) and carries { budget: { domain, count, limit, over: true } }', async () => {
    mockPrisma.memoryEntry.count.mockResolvedValue(400); // 400 live business memories before this write
    const res = await request(app).post('/memories').set('x-api-key', API_KEY).set('x-user-id', USER).send(body);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('created');
    expect(res.body.budget).toEqual({ domain: 'business', count: 401, limit: 400, over: true });
    expect(MemoryBudgetStatusSchema.safeParse(res.body.budget).success).toBe(true);
    expect(mockPrisma.memoryEntry.create).toHaveBeenCalledTimes(1);
  });

  it('an agent (MCP) write far past the budget still succeeds', async () => {
    mockPrisma.memoryEntry.count.mockResolvedValue(900);
    const res = await request(app).post('/memories').set('x-api-key', API_KEY).set('x-user-id', USER).set(legacyAgent)
      .send({ ...body, sourceType: 'MCP_AGENT', dedup: false });
    expect(res.status).toBe(201);
    expect(res.body.budget).toEqual({ domain: 'business', count: 901, limit: 400, over: true });
  });

  it('write #400 lands exactly on the limit — no warning', async () => {
    mockPrisma.memoryEntry.count.mockResolvedValue(399);
    const res = await request(app).post('/memories').set('x-api-key', API_KEY).set('x-user-id', USER).send(body);
    expect(res.status).toBe(201);
    expect(res.body.budget).toBeUndefined();
  });
});

describe('GET /memories/budget (RD-4)', () => {
  it('BoardRoom (no agent): user-wide counts, every configured domain listed, unconfigured domains appended', async () => {
    mockPrisma.memoryEntry.groupBy.mockResolvedValue([
      { domain: 'business', _count: { _all: 412 } },
      { domain: 'personal', _count: { _all: 12 } },
      { domain: 'learning', _count: { _all: 30 } },
    ]);
    const res = await request(app).get('/memories/budget').set('x-api-key', API_KEY).set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(MemoryBudgetReportSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.scope).toBe('user');
    expect(res.body.tenantId).toBeNull();
    const byDomain = Object.fromEntries(res.body.domains.map((d: { domain: string }) => [d.domain, d]));
    expect(byDomain.business).toEqual({ domain: 'business', count: 412, limit: 400, over: true });
    expect(byDomain.personal).toEqual({ domain: 'personal', count: 12, limit: 200, over: false });
    expect(byDomain['ai-systems']).toEqual({ domain: 'ai-systems', count: 0, limit: 300, over: false });
    expect(byDomain.learning).toEqual({ domain: 'learning', count: 30, limit: 250, over: false });
    expect(res.body.domains.map((d: { domain: string }) => d.domain)).not.toContain('default');
    const where = mockPrisma.memoryEntry.groupBy.mock.calls[0][0].where;
    expect(where).toEqual({ userId: USER, deletedAt: null, status: { not: 'ARCHIVED' } });
  });

  it('an agent sees its own tenant only', async () => {
    const res = await request(app).get('/memories/budget').set('x-api-key', API_KEY).set('x-user-id', USER).set(legacyAgent);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('tenant');
    expect(res.body.tenantId).toBe('josh-business');
    expect(mockPrisma.memoryEntry.groupBy.mock.calls[0][0].where).toEqual(expect.objectContaining({ tenantId: 'josh-business' }));
  });

  it('an agent asking for another tenant → 403 tenant_mismatch, nothing counted', async () => {
    const res = await request(app).get('/memories/budget?tenantId=tgfc-ministry').set('x-api-key', API_KEY).set('x-user-id', USER).set(legacyAgent);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant_mismatch');
    expect(mockPrisma.memoryEntry.groupBy).not.toHaveBeenCalled();
  });

  it('BoardRoom with ?tenantId= counts that tenant', async () => {
    const res = await request(app).get('/memories/budget?tenantId=josh-personal').set('x-api-key', API_KEY).set('x-user-id', USER);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('tenant');
    expect(res.body.tenantId).toBe('josh-personal');
  });

  it('400 without x-user-id', async () => {
    const res = await request(app).get('/memories/budget').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
  });
});
