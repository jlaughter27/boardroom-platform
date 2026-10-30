/**
 * Fix lane H (2026-10-30) — admin panel across users.
 *
 *  1. `GET /admin/duplicates` pairs carry the owning `user_id` (pairs are only
 *     ever formed within one user), and `POST /admin/duplicates/merge`
 *     archives on behalf of that owner — both memories must be the owner's,
 *     live and non-ministry, else 404 (no existence leak).
 *  2. `GET /admin/contradictions?includeAllTenants=true` lists every user's
 *     unresolved alerts and drops alerts naming a ministry project.
 *
 * Real Express app, Prisma mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), updateMany: vi.fn() },
  mcpAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), update: vi.fn() },
  tenant: { count: vi.fn().mockResolvedValue(0) },
  project: { findMany: vi.fn().mockResolvedValue([]) },
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
const OWNER = 'user-owner-1';
const OTHER = 'user-other-2';

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
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.memoryEntry.findFirst.mockResolvedValue(null);
  mockPrisma.memoryEntry.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.project.findMany.mockResolvedValue([]);
  mockPrisma.contradictionAlert.findMany.mockResolvedValue([]);
  mockPrisma.contradictionAlert.count.mockResolvedValue(0);
});

/** The SQL text of the n-th $queryRaw call (tagged template strings joined). */
function sqlOf(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray | { strings?: string[]; sql?: string };
  if (Array.isArray(strings)) return strings.join('?');
  return (strings as { sql?: string }).sql ?? '';
}

describe('GET /admin/duplicates carries the pair owner (lane H)', () => {
  it('every pair has user_id, and the query only pairs memories of one user', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{
      a_id: 'm1', a_title: 'A', a_created: new Date(0), a_domain: 'business', a_tenant: 'synthetic-business',
      b_id: 'm2', b_title: 'B', b_created: new Date(0), b_domain: 'business', b_tenant: 'synthetic-business',
      user_id: OWNER, cosine: 0.97,
    }]);
    const res = await request(app).get('/admin/duplicates?includeAllTenants=true').set(H);
    expect(res.status).toBe(200);
    expect(res.body.pairs).toEqual([{
      a_id: 'm1', a_title: 'A', a_created: new Date(0).toISOString(),
      b_id: 'm2', b_title: 'B', b_created: new Date(0).toISOString(),
      user_id: OWNER, cosine: 0.97,
    }]);
    const sql = sqlOf(mockPrisma.$queryRaw.mock.calls[0]);
    expect(sql).toMatch(/a\.user_id\s*=\s*b\.user_id/);
    expect(sql).toMatch(/a\.user_id\s+AS\s+user_id/i);
  });
});

describe('POST /admin/duplicates/merge acts for the pair owner (lane H)', () => {
  const live = (id: string, userId: string, domain = 'business', tenantId = 'synthetic-business') =>
    ({ id, userId, domain, tenantId, deletedAt: null });

  it('archives the older memory when both belong to the passed owner', async () => {
    mockPrisma.memoryEntry.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
      where.userId === OWNER ? live(where.id, OWNER) : null);
    const res = await request(app).post('/admin/duplicates/merge?includeAllTenants=true').set(H)
      .send({ keepId: 'keep-1', archiveId: 'old-1', userId: OWNER });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', kept: 'keep-1', archived: 'old-1' });
    expect(mockPrisma.memoryEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-1', userId: OWNER, deletedAt: null },
    }));
  });

  it('404 (no archive) when the kept memory belongs to another user', async () => {
    mockPrisma.memoryEntry.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === 'old-1' && where.userId === OWNER ? live('old-1', OWNER) : null);
    const res = await request(app).post('/admin/duplicates/merge?includeAllTenants=true').set(H)
      .send({ keepId: 'keep-of-other', archiveId: 'old-1', userId: OWNER });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(mockPrisma.memoryEntry.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['archive target is a legacy ministry spelling', 'old-1', 'Ministry ', 'synthetic-business'],
    ['kept memory is in the ministry tenant', 'keep-1', 'general', 'tgfc-ministry'],
  ])('404 when the %s', async (_label, ministryId, domain, tenantId) => {
    mockPrisma.memoryEntry.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
      where.userId !== OWNER ? null : where.id === ministryId ? live(where.id, OWNER, domain, tenantId) : live(where.id, OWNER));
    const res = await request(app).post('/admin/duplicates/merge?includeAllTenants=true').set(H)
      .send({ keepId: 'keep-1', archiveId: 'old-1', userId: OWNER });
    expect(res.status).toBe(404);
    expect(mockPrisma.memoryEntry.updateMany).not.toHaveBeenCalled();
  });

  it('400 when userId is not a string', async () => {
    const res = await request(app).post('/admin/duplicates/merge?includeAllTenants=true').set(H)
      .send({ keepId: 'keep-1', archiveId: 'old-1', userId: { not: 'a string' } });
    expect(res.status).toBe(400);
    expect(mockPrisma.memoryEntry.updateMany).not.toHaveBeenCalled();
  });
});

describe('GET /admin/contradictions all-users view (lane H)', () => {
  const alert = (id: string, userId: string, a: string, b: string) => ({
    id, userId, description: `Tension ${id}`, severity: 'medium', status: 'ACTIVE',
    entityA: { type: 'project', id: '', title: a }, entityB: { type: 'project', id: '', title: b },
    detectedAt: new Date(0), resolvedAt: null, resolution: null,
  });

  it('?includeAllTenants=true lists every user and drops alerts naming a ministry project', async () => {
    mockPrisma.contradictionAlert.findMany.mockResolvedValue([
      alert('c1', OWNER, 'Launch', 'Hiring'),
      alert('c2', OTHER, 'Retreat plan', 'Budget'),
      alert('c3', OTHER, 'Budget', 'Website'),
    ]);
    mockPrisma.contradictionAlert.count.mockResolvedValue(3);
    mockPrisma.project.findMany.mockResolvedValue([
      { userId: OTHER, title: 'Retreat plan', domain: 'ministry/pastoral' },
      { userId: OTHER, title: 'Budget', domain: 'business' },
      { userId: OWNER, title: 'Launch', domain: 'business' },
    ]);

    const res = await request(app).get('/admin/contradictions?includeAllTenants=true').set(H);
    expect(res.status).toBe(200);
    expect(res.body.alerts.map((a: { id: string }) => a.id)).toEqual(['c1', 'c3']);
    expect(res.body.total).toBe(2);
    expect(JSON.stringify(res.body)).not.toMatch(/Retreat plan/);
    // No user filter on the all-users view.
    expect(mockPrisma.contradictionAlert.findMany.mock.calls[0][0].where).toEqual({ resolvedAt: null });
  });

  it('the all-users opt-in wins over a stray x-user-id header', async () => {
    const res = await request(app).get('/admin/contradictions?includeAllTenants=true').set(H).set('x-user-id', OWNER);
    expect(res.status).toBe(200);
    expect(mockPrisma.contradictionAlert.findMany.mock.calls[0][0].where).toEqual({ resolvedAt: null });
  });

  it('a single-user view also drops ministry alerts', async () => {
    mockPrisma.contradictionAlert.findMany.mockResolvedValue([alert('c2', OTHER, 'Retreat plan', 'Budget')]);
    mockPrisma.contradictionAlert.count.mockResolvedValue(1);
    mockPrisma.project.findMany.mockResolvedValue([{ userId: OTHER, title: 'Retreat plan', domain: 'Ministry' }]);
    const res = await request(app).get(`/admin/contradictions?userId=${OTHER}`).set(H);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ alerts: [], total: 0 });
  });
});
