/**
 * RD-1 — GET /memories/:id/backlinks: memories that link TO a memory (the
 * "Linked from" section in Memory Explorer). Real Express app, Prisma mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MemoryBacklinksResponseSchema } from '@boardroom/shared';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), update: vi.fn() },
  memoryEntityLink: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
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

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };
const legacyAgent = { 'x-agent-id': 'agent-a', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0' };

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.findFirst.mockResolvedValue({ id: 'target' });
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntityLink.findMany.mockResolvedValue([]);
});

describe('GET /memories/:id/backlinks (RD-1)', () => {
  it('lists each linking memory once, sorted by title, with its link types', async () => {
    mockPrisma.memoryEntityLink.findMany.mockResolvedValue([
      { memoryId: 'src-b', linkType: 'wikilink' },
      { memoryId: 'src-a', linkType: 'wikilink' },
      { memoryId: 'src-a', linkType: 'relates_to' },
      { memoryId: 'target', linkType: 'wikilink' }, // legacy self-link: ignored
    ]);
    mockPrisma.memoryEntry.findMany.mockResolvedValue([
      { id: 'src-b', title: 'Zeta plan', domain: 'business', status: 'CONFIRMED' },
      { id: 'src-a', title: 'Alpha notes', domain: null, status: 'DRAFT' },
    ]);

    const res = await request(app).get('/memories/target/backlinks').set(H);
    expect(res.status).toBe(200);
    expect(MemoryBacklinksResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toEqual({
      items: [
        { memoryId: 'src-a', title: 'Alpha notes', domain: null, status: 'DRAFT', linkTypes: ['wikilink', 'relates_to'] },
        { memoryId: 'src-b', title: 'Zeta plan', domain: 'business', status: 'CONFIRMED', linkTypes: ['wikilink'] },
      ],
      truncated: false,
    });

    // Incoming memory links only, by the indexed (entityType, entityId) pair, capped.
    const linkQuery = mockPrisma.memoryEntityLink.findMany.mock.calls[0][0];
    expect(linkQuery.where).toEqual({ entityType: { in: ['memory', 'Memory', 'MEMORY'] }, entityId: 'target' });
    expect(linkQuery.take).toBe(500);
    // Sources: this user's, live, not archived; the self-link id is not looked up.
    const srcWhere = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(srcWhere).toMatchObject({ userId: USER, deletedAt: null, status: { not: 'ARCHIVED' } });
    expect(srcWhere.id.in.sort()).toEqual(['src-a', 'src-b']);
    expect(srcWhere).not.toHaveProperty('tenantId');
  });

  it('404s when the memory is not the caller\'s (and never reads links)', async () => {
    mockPrisma.memoryEntry.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/memories/foreign/backlinks').set(H);
    expect(res.status).toBe(404);
    expect(mockPrisma.memoryEntry.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'foreign', userId: USER, deletedAt: null });
    expect(mockPrisma.memoryEntityLink.findMany).not.toHaveBeenCalled();
  });

  it('under an agent context, scopes both the target and the sources to the agent tenant', async () => {
    mockPrisma.memoryEntityLink.findMany.mockResolvedValue([{ memoryId: 'src-a', linkType: 'wikilink' }]);
    const res = await request(app).get('/memories/target/backlinks').set(H).set(legacyAgent);
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findFirst.mock.calls[0][0].where.tenantId).toBe('josh-business');
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].where.tenantId).toBe('josh-business');
  });

  it('?includeArchived=true lifts the archived filter; no links → no source query', async () => {
    mockPrisma.memoryEntityLink.findMany.mockResolvedValue([{ memoryId: 'src-a', linkType: 'wikilink' }]);
    await request(app).get('/memories/target/backlinks?includeArchived=true').set(H);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].where).not.toHaveProperty('status');

    vi.clearAllMocks();
    mockPrisma.memoryEntry.findFirst.mockResolvedValue({ id: 'target' });
    mockPrisma.memoryEntityLink.findMany.mockResolvedValue([]);
    const res = await request(app).get('/memories/target/backlinks').set(H);
    expect(res.body).toEqual({ items: [], truncated: false });
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('reports truncated when the 500-row cap is hit', async () => {
    mockPrisma.memoryEntityLink.findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({ memoryId: `src-${i}`, linkType: 'wikilink' })),
    );
    const res = await request(app).get('/memories/target/backlinks').set(H);
    expect(res.body.truncated).toBe(true);
  });

  it('400 without x-user-id', async () => {
    const res = await request(app).get('/memories/target/backlinks').set({ 'x-api-key': API_KEY });
    expect(res.status).toBe(400);
  });
});
