/**
 * Lane F (2026-10-30) — the cross-user admin views (`GET /admin/memories`,
 * `GET /admin/duplicates`) never list ministry content: not a ministry-domain
 * row in any spelling (shared `isMinistryDomain`), not a row in the ministry
 * tenant (`isMinistryTenant`). Same exclude policy as backlinks / core-context.
 * Real Express app, Prisma mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), updateMany: vi.fn() },
  mcpAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), update: vi.fn() },
  tenant: { count: vi.fn().mockResolvedValue(0) },
  contradictionAlert: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/services/embedding.service', () => ({
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  embedMemory: vi.fn().mockResolvedValue(undefined),
  backfillEmbeddings: vi.fn(),
  getEmbeddingStatus: vi.fn().mockResolvedValue('ready'),
}));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { __resetAdminAuthForTest } from '../../../src/middleware/admin-auth';

const API_KEY = 'test-api-key';
const H = { 'x-api-key': API_KEY, 'x-admin-key': 'adm' };
const prevAdmin = process.env.OMNIMIND_ADMIN_KEY;

const row = (id: string, domain: string, tenantId = 'synthetic-business') => ({
  id, title: `Title ${id}`, content: `Content ${id}`, domain, sourceType: 'MANUAL', agentId: null, tenantId,
  importance: 5, tags: [], status: 'CONFIRMED', createdAt: new Date(0), updatedAt: new Date(0),
});

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  process.env.OMNIMIND_ADMIN_KEY = 'adm';
  __resetApiKeyForTest();
  __resetAdminAuthForTest();
});
afterAll(() => {
  if (prevAdmin === undefined) delete process.env.OMNIMIND_ADMIN_KEY; else process.env.OMNIMIND_ADMIN_KEY = prevAdmin;
});
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe('GET /admin/memories excludes ministry content (lane F)', () => {
  it('filters canonical ministry domain + ministry tenant in the query, and every other spelling after it', async () => {
    mockPrisma.memoryEntry.findMany.mockResolvedValue([
      row('keep-1', 'business'),
      row('keep-2', 'administration'),
      row('drop-1', 'ministry/pastoral'),
      row('drop-2', 'mіnistry'), // Cyrillic і
      row('drop-3', 'general', 'tgfc-ministry'),
      row('keep-3', 'personal'),
    ]);
    mockPrisma.memoryEntry.count.mockResolvedValue(6);

    const res = await request(app).get('/admin/memories?includeAllTenants=true').set(H);
    expect(res.status).toBe(200);
    expect(res.body.memories.map((m: { id: string }) => m.id)).toEqual(['keep-1', 'keep-2', 'keep-3']);
    expect(JSON.stringify(res.body)).not.toMatch(/Content drop/);
    expect(res.body.total).toBe(3);

    const where = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { NOT: { domain: { equals: 'ministry', mode: 'insensitive' } } },
      { NOT: { tenantId: 'tgfc-ministry' } },
    ]));
  });

  it.each([
    ['domain', 'ministry'],
    ['domain', 'Ministries'],
    ['tenantId', 'tgfc-ministry'],
  ])('an explicit ?%s=%s answers an empty page without querying', async (key, value) => {
    const res = await request(app).get(`/admin/memories?includeAllTenants=true&${key}=${encodeURIComponent(value)}`).set(H);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memories: [], total: 0 });
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /admin/duplicates excludes ministry pairs (lane F)', () => {
  it('drops a pair when either side is ministry (domain or tenant) and never returns the side columns', async () => {
    const pair = (id: string, aDomain: string, bTenant = 'synthetic-business') => ({
      a_id: `${id}-a`, a_title: `A ${id}`, a_created: new Date(0), a_domain: aDomain, a_tenant: 'synthetic-business',
      b_id: `${id}-b`, b_title: `B ${id}`, b_created: new Date(0), b_domain: 'business', b_tenant: bTenant,
      cosine: 0.97,
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      pair('keep', 'business'),
      pair('drop1', 'ministry-care'),
      pair('drop2', 'business', 'tgfc-ministry'),
    ]);
    const res = await request(app).get('/admin/duplicates?includeAllTenants=true').set(H);
    expect(res.status).toBe(200);
    expect(res.body.pairs).toHaveLength(1);
    expect(res.body.pairs[0]).toEqual({
      a_id: 'keep-a', a_title: 'A keep', a_created: new Date(0).toISOString(),
      b_id: 'keep-b', b_title: 'B keep', b_created: new Date(0).toISOString(),
      cosine: 0.97,
    });
  });
});
