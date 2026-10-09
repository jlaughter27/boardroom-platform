/**
 * Review-fix route checks against the real Express app with Prisma mocked:
 *   R-O-02  POST /memories/search-similar excludes invalidated rows; GET /memories
 *           hides them by default (?includeInvalidated=true opts in); PATCH of a
 *           superseded row → 409 memory_superseded
 *   R-O-13  POST /memories/:id/links lower-cases + validates entityType and 404s
 *           on a missing entity
 *   R-O-15  GET /usage/llm/summary?all=1 is admin-gated (x-admin-key)
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), update: vi.fn() },
  memoryEntityLink: { create: vi.fn() },
  project: { findFirst: vi.fn() },
  goal: { findFirst: vi.fn() },
  llmUsage: { findMany: vi.fn().mockResolvedValue([]) },
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
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  embedMemory: vi.fn().mockResolvedValue(undefined),
  backfillEmbeddings: vi.fn(),
  getEmbeddingStatus: vi.fn().mockResolvedValue('ready'),
}));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { __resetAdminAuthForTest } from '../../../src/middleware/admin-auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };
const legacyAgent = { 'x-agent-id': 'agent-a', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0' };

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
  mockPrisma.llmUsage.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([]);
  __resetAdminAuthForTest();
});

const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?').replace(/\s+/g, ' ');

describe('R-O-02 — invalidated rows are hidden', () => {
  it('POST /memories/search-similar excludes invalid_at / superseded_by rows (with and without a tenant)', async () => {
    const r1 = await request(app).post('/memories/search-similar').set(H).send({ query: 'pricing' });
    expect(r1.status).toBe(200);
    expect(sqlOf(mockPrisma.$queryRaw.mock.calls[0])).toContain('invalid_at IS NULL AND superseded_by IS NULL');

    const r2 = await request(app).post('/memories/search-similar').set(H).set(legacyAgent).send({ query: 'pricing' });
    expect(r2.status).toBe(200);
    const sql = sqlOf(mockPrisma.$queryRaw.mock.calls[1]);
    expect(sql).toContain('tenant_id = ?');
    expect(sql).toContain('invalid_at IS NULL AND superseded_by IS NULL');
  });

  it('GET /memories hides invalidated rows by default and ?includeInvalidated=true lifts the filter', async () => {
    await request(app).get('/memories').set(H);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].where.invalidAt).toBeNull();
    await request(app).get('/memories?includeInvalidated=true').set(H);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[1][0].where).not.toHaveProperty('invalidAt');
  });

  it('PATCH /memories/:id on a superseded row → 409 memory_superseded naming supersededBy', async () => {
    mockPrisma.memoryEntry.findFirst.mockResolvedValue({ id: 'old', userId: USER, domain: 'business', content: 'x', encryptedContent: null, invalidAt: new Date(), supersededBy: 'new1' });
    const res = await request(app).patch('/memories/old').set(H).send({ title: 'zombie' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('memory_superseded');
    expect(res.body.message).toContain('new1');
    expect(mockPrisma.memoryEntry.update).not.toHaveBeenCalled();
  });
});

describe('R-O-13 — legacy POST /memories/:id/links', () => {
  beforeEach(() => {
    mockPrisma.memoryEntry.findFirst.mockResolvedValue({ id: 'm1', userId: USER });
    mockPrisma.memoryEntityLink.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'l1', ...data }));
  });

  it('lower-cases entityType, verifies the entity for this user and creates the link', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    const res = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'Project', entityId: 'p1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ memoryId: 'm1', entityType: 'project', entityId: 'p1', linkType: 'relates_to' });
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: USER, deletedAt: null }, select: { id: true } });
  });

  it('422 on an unknown entityType (no DB write)', async () => {
    const res = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'widget', entityId: 'w1' });
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('entityType');
    expect(mockPrisma.memoryEntityLink.create).not.toHaveBeenCalled();
  });

  it('404 when the entity is not the user\'s / soft-deleted', async () => {
    mockPrisma.goal.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'GOAL', entityId: 'g-foreign' });
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('goal');
    expect(mockPrisma.memoryEntityLink.create).not.toHaveBeenCalled();
  });
});

describe('R-O-15 — GET /usage/llm/summary?all=1 is admin-gated', () => {
  const env = { key: process.env.OMNIMIND_ADMIN_KEY, node: process.env.NODE_ENV };
  afterEach(() => {
    if (env.key === undefined) delete process.env.OMNIMIND_ADMIN_KEY; else process.env.OMNIMIND_ADMIN_KEY = env.key;
    process.env.NODE_ENV = env.node;
  });

  it('403 admin_required with all=1 and no / wrong x-admin-key', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'admin-secret';
    const r1 = await request(app).get('/usage/llm/summary?days=7&all=1').set(H);
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('admin_required');
    const r2 = await request(app).get('/usage/llm/summary?days=7&all=1').set(H).set('x-admin-key', 'nope');
    expect(r2.status).toBe(403);
    expect(mockPrisma.llmUsage.findMany).not.toHaveBeenCalled();
  });

  it('200 with all=1 and a valid x-admin-key — aggregates across users (no userId filter)', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'admin-secret';
    const res = await request(app).get('/usage/llm/summary?days=7&all=1').set(H).set('x-admin-key', 'admin-secret');
    expect(res.status).toBe(200);
    expect(mockPrisma.llmUsage.findMany.mock.calls[0][0].where).not.toHaveProperty('userId');
  });

  it('without all=1 the caller-scoped summary needs no admin key', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'admin-secret';
    const res = await request(app).get('/usage/llm/summary?days=7').set(H);
    expect(res.status).toBe(200);
    expect(mockPrisma.llmUsage.findMany.mock.calls[0][0].where.userId).toBe(USER);
  });

  it('production with no OMNIMIND_ADMIN_KEY configured → 403 (admin surface disabled)', async () => {
    delete process.env.OMNIMIND_ADMIN_KEY;
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/usage/llm/summary?all=1').set(H);
    expect(res.status).toBe(403);
  });
});
