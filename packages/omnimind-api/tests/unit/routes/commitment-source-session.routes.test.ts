/**
 * Fix lane H (2026-10-30) — `sourceSessionId` ownership.
 *
 * `Commitment.sourceSessionId` is a foreign key to an OmniMind `Session` row
 * (schema.prisma: `session Session? @relation(fields: [sourceSessionId] …)`),
 * but writes only checked its length, so a caller could attach a commitment to
 * another user's session. Like every other reference on a commitment, the
 * session must be the caller's (`sessions.created_by = userId`) and not
 * soft-deleted, else 404 `not_found` naming the entity — the same answer for
 * "missing" and "someone else's" (no existence leak), checked before the write.
 * Real Express app, Prisma mocked. Invented data only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  session: { findFirst: vi.fn() },
  person: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  decision: { findFirst: vi.fn() },
  task: { findFirst: vi.fn() },
  commitment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const OTHER = 'cuser00000000000000000002';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };

// Sessions: s-mine belongs to USER, s-theirs to OTHER, s-gone is USER's but soft-deleted.
const SESSIONS: Record<string, { id: string; createdBy: string; deletedAt: Date | null }> = {
  's-mine': { id: 's-mine', createdBy: USER, deletedAt: null },
  's-theirs': { id: 's-theirs', createdBy: OTHER, deletedAt: null },
  's-gone': { id: 's-gone', createdBy: USER, deletedAt: new Date(0) },
};

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.session.findFirst.mockImplementation(async ({ where }: { where: { id: string; createdBy: string; deletedAt: null } }) => {
    const s = SESSIONS[where.id];
    return s && s.createdBy === where.createdBy && (where.deletedAt !== null || s.deletedAt === null) ? { id: s.id } : null;
  });
  mockPrisma.commitment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c-new', ...data }));
  mockPrisma.commitment.findFirst.mockResolvedValue({ id: 'c-1', userId: USER, deletedAt: null });
  mockPrisma.commitment.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c-1', ...data }));
});

describe('POST /commitments sourceSessionId', () => {
  it("201 with the caller's own session", async () => {
    const res = await request(app).post('/commitments').set(H).send({ description: 'Send Pat the deck', sourceSessionId: 's-mine' });
    expect(res.status).toBe(201);
    expect(mockPrisma.session.findFirst).toHaveBeenCalledWith({ where: { id: 's-mine', createdBy: USER, deletedAt: null }, select: { id: true } });
  });

  it.each(['s-theirs', 's-gone', 'no-such-session'])('404 not_found (entity session) for %s — nothing written', async (sid) => {
    const res = await request(app).post('/commitments').set(H).send({ description: 'Send Pat the deck', sourceSessionId: sid });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not_found', entity: 'session' });
    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
  });

  it('no session lookup when sourceSessionId is absent or null', async () => {
    expect((await request(app).post('/commitments').set(H).send({ description: 'd' })).status).toBe(201);
    expect((await request(app).post('/commitments').set(H).send({ description: 'd', sourceSessionId: null })).status).toBe(201);
    expect(mockPrisma.session.findFirst).not.toHaveBeenCalled();
  });
});

describe('PATCH /commitments/:id sourceSessionId', () => {
  it("re-pointing to someone else's session → 404, no update", async () => {
    const res = await request(app).patch('/commitments/c-1').set(H).send({ sourceSessionId: 's-theirs' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not_found', entity: 'session' });
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
  });

  it("re-pointing to the caller's own session → 200", async () => {
    const res = await request(app).patch('/commitments/c-1').set(H).send({ sourceSessionId: 's-mine' });
    expect(res.status).toBe(200);
    expect(mockPrisma.commitment.update).toHaveBeenCalledTimes(1);
  });
});
