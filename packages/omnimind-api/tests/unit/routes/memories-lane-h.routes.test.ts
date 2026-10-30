/**
 * Fix lane H (2026-10-30) — memory route fixes. Real Express app, Prisma mocked.
 *
 *  - A BoardRoom (no agent context) `POST /memories` lands in the user's own
 *    default tenant (oldest owned non-ministry tenant) instead of the column
 *    default; a user who owns the column-default tenant, or owns none, keeps
 *    the column default (unchanged behaviour).
 *  - `POST /memories/search-similar` (MCP fact-extractor dedup) never returns
 *    a ministry row in any spelling or the ministry tenant.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  tenant: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  mcpAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), update: vi.fn() },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue([0.1, 0.2]),
  getEmbeddingStatus: vi.fn().mockResolvedValue('pending'),
  backfillEmbeddings: vi.fn(),
}));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000042';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };
const legacyAgent = { 'x-agent-id': 'agent-a', 'x-tenant-id': 'synthetic-agency', 'x-source-weight': '1.0' };
const body = { title: 'Pricing note', content: 'Annual plan converts better.', domain: 'business', sourceType: 'MANUAL' };

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'mem-new', ...data }));
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
  mockPrisma.tenant.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

const createdData = () => mockPrisma.memoryEntry.create.mock.calls[0][0].data as Record<string, unknown>;

describe('POST /memories from BoardRoom lands in the user\'s own tenant (lane H)', () => {
  it('a user who owns tenants gets their oldest owned tenant', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'synthetic-studio' }, { id: 'synthetic-side-project' }]);
    const res = await request(app).post('/memories').set(H).send(body);
    expect(res.status).toBe(201);
    expect(createdData().tenantId).toBe('synthetic-studio');
    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: USER },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('never picks the ministry tenant (the write would become a refused ministry write)', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'tgfc-ministry' }, { id: 'synthetic-studio' }]);
    const res = await request(app).post('/memories').set(H).send(body);
    expect(res.status).toBe(201);
    expect(createdData().tenantId).toBe('synthetic-studio');
  });

  it.each([
    ['owns no tenant', []],
    ['owns only the ministry tenant', [{ id: 'tgfc-ministry' }]],
    ['owns the column-default tenant (unchanged founder path)', [{ id: 'josh-business' }, { id: 'josh-personal' }]],
  ])('keeps the column default when the user %s', async (_label, owned) => {
    mockPrisma.tenant.findMany.mockResolvedValue(owned);
    const res = await request(app).post('/memories').set(H).send(body);
    expect(res.status).toBe(201);
    expect(createdData()).not.toHaveProperty('tenantId');
  });

  it('a failing tenant lookup never fails the write (column default)', async () => {
    mockPrisma.tenant.findMany.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/memories').set(H).send(body);
    expect(res.status).toBe(201);
    expect(createdData()).not.toHaveProperty('tenantId');
  });

  it('an agent write keeps its context tenant and does not look up owned tenants', async () => {
    const res = await request(app).post('/memories').set(H).set(legacyAgent).send({ ...body, sourceType: 'MCP_AGENT', dedup: false });
    expect(res.status).toBe(201);
    expect(createdData().tenantId).toBe('synthetic-agency');
    expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /memories/search-similar excludes ministry rows (lane H)', () => {
  const sim = (id: string, domain: string, tenant = 'synthetic-studio') => ({
    id, title: `T ${id}`, content: `C ${id}`, domain, tags: [], importance: 0.5, source_type: 'MANUAL',
    tenant_id: tenant, source_weight: 1, created_at: new Date(0), updated_at: new Date(0), similarity: 0.95,
  });

  it('drops legacy ministry spellings and ministry-tenant rows; SQL excludes ministry% too', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      sim('keep', 'business'),
      sim('drop-1', 'Ministry '),
      sim('drop-2', ' ministry/pastoral'),
      sim('drop-3', 'general', 'tgfc-ministry'),
    ]);
    const res = await request(app).post('/memories/search-similar').set(H).send({ query: 'retreat budget', limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body.memories.map((m: { id: string }) => m.id)).toEqual(['keep']);
    const strings = mockPrisma.$queryRaw.mock.calls[0][0] as string[];
    expect(strings.join('?')).toMatch(/lower\(domain\) NOT LIKE 'ministry%'/);
  });
});
