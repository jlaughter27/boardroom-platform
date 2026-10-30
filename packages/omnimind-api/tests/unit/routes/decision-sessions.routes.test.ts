/**
 * RD-17 — /decision-sessions through the real Express app (Prisma mocked):
 * user scoping on every query, agent refusal, size limit (413), soft delete,
 * strict bodies, the decisionId projection, and the POST /decisions link check.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { DECISION_SESSION_STATE_MAX_BYTES, DecisionSessionSchema, DecisionSessionListResponseSchema } from '@boardroom/shared';

const mockPrisma = vi.hoisted(() => {
  const t = () => ({
    findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    decisionSession: t(), decision: t(), agent: t(), idempotencyKey: t(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $disconnect: vi.fn(),
  };
});
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const OTHER = 'cuser00000000000000000002';
const SID = 'csess00000000000000000001';

function call(method: 'get' | 'post' | 'patch' | 'delete', path: string, headers: Record<string, string> = { 'x-user-id': USER }) {
  let r = request(app)[method](path).set('x-api-key', API_KEY);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r;
}

function row(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-10-30T10:00:00.000Z');
  return {
    id: SID, userId: USER, roomId: null, question: 'Should the bakery open a second stall?', mode: 'decide', status: 'OPEN',
    personaResponses: {}, ceoSynthesis: null, state: null, createdAt: now, updatedAt: now, decision: null,
    ...overrides,
  };
}

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.decisionSession.findFirst.mockResolvedValue(null);
  mockPrisma.decisionSession.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe('/decision-sessions (RD-17) — caller rules', () => {
  it('400 without x-user-id', async () => {
    const res = await call('get', '/decision-sessions', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('403 agent_context_unsupported for an agent caller; no query runs', async () => {
    const res = await call('get', `/decision-sessions/${SID}`, {
      'x-user-id': USER, 'x-agent-id': 'claude-code-test', 'x-tenant-id': 'test-business', 'x-source-weight': '1.0',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('agent_context_unsupported');
    expect(mockPrisma.decisionSession.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /decision-sessions', () => {
  it('201: creates the row for the caller and returns the record', async () => {
    mockPrisma.decisionSession.create.mockResolvedValue(row());
    const res = await call('post', '/decision-sessions').send({ question: 'Should the bakery open a second stall?', mode: 'decide' });
    expect(res.status).toBe(201);
    const data = mockPrisma.decisionSession.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: USER, question: 'Should the bakery open a second stall?', mode: 'decide' });
    expect(DecisionSessionSchema.parse(res.body)).toMatchObject({ id: SID, status: 'OPEN', decisionId: null, state: null });
  });

  it('a body userId cannot override the header (strict body → 422)', async () => {
    const res = await call('post', '/decision-sessions').send({ question: 'q', userId: OTHER });
    expect(res.status).toBe(422);
    expect(mockPrisma.decisionSession.create).not.toHaveBeenCalled();
  });

  it('422 on a missing question or an unknown status', async () => {
    expect((await call('post', '/decision-sessions').send({ mode: 'decide' })).status).toBe(422);
    expect((await call('post', '/decision-sessions').send({ question: 'q', status: 'ARCHIVED' })).status).toBe(422);
  });

  it('413 when personaResponses + state exceed the snapshot limit', async () => {
    const big = 'x'.repeat(DECISION_SESSION_STATE_MAX_BYTES / 2 + 10);
    const res = await call('post', '/decision-sessions').send({ question: 'q', personaResponses: { critic: big }, state: { note: big } });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('payload_too_large');
    expect(mockPrisma.decisionSession.create).not.toHaveBeenCalled();
  });
});

describe('GET /decision-sessions/:id', () => {
  it('scopes by user and excludes archived rows; 404 otherwise', async () => {
    const res = await call('get', `/decision-sessions/${SID}`, { 'x-user-id': OTHER });
    expect(res.status).toBe(404);
    expect(mockPrisma.decisionSession.findFirst.mock.calls[0][0].where).toEqual({ id: SID, userId: OTHER, deletedAt: null });
  });

  it('decisionId comes from the live linked decision only', async () => {
    mockPrisma.decisionSession.findFirst.mockResolvedValueOnce(row({ status: 'DECIDED', decision: { id: 'cdec1', deletedAt: null } }));
    expect((await call('get', `/decision-sessions/${SID}`)).body.decisionId).toBe('cdec1');
    mockPrisma.decisionSession.findFirst.mockResolvedValueOnce(row({ decision: { id: 'cdec1', deletedAt: new Date() } }));
    expect((await call('get', `/decision-sessions/${SID}`)).body.decisionId).toBeNull();
  });
});

describe('GET /decision-sessions', () => {
  it('lists the caller’s live sessions newest first, never shipping state', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{
      id: SID, question: 'q', mode: 'decide', status: 'SYNTHESIZED', has_ceo: false, persona_count: 6, decision_id: null,
      created_at: new Date(), updated_at: new Date(),
    }]);
    mockPrisma.decisionSession.count.mockResolvedValue(1);
    const res = await call('get', '/decision-sessions?limit=5&offset=0');
    expect(res.status).toBe(200);
    const body = DecisionSessionListResponseSchema.parse(res.body);
    expect(body).toMatchObject({ total: 1, limit: 5, offset: 0, items: [{ id: SID, personaCount: 6, hasSynthesis: true }] });
    expect(res.body.items[0]).not.toHaveProperty('state');
    const [sql, ...values] = mockPrisma.$queryRaw.mock.calls[0];
    expect((sql as string[]).join('?')).toMatch(/deleted_at IS NULL/);
    expect(values).toEqual([USER, 5, 0]);
    expect(mockPrisma.decisionSession.count.mock.calls[0][0].where).toEqual({ userId: USER, deletedAt: null });
  });

  it('422 on a limit over 100', async () => {
    expect((await call('get', '/decision-sessions?limit=101')).status).toBe(422);
  });
});

describe('PATCH /decision-sessions/:id', () => {
  it('updates only the caller’s live row and returns the fresh record', async () => {
    mockPrisma.decisionSession.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.decisionSession.findFirst.mockResolvedValue(row({ status: 'DISPATCHED', personaResponses: { critic: { recommendation: 'Wait' } } }));
    const res = await call('patch', `/decision-sessions/${SID}`).send({ status: 'DISPATCHED', personaResponses: { critic: { recommendation: 'Wait' } } });
    expect(res.status).toBe(200);
    const args = mockPrisma.decisionSession.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: SID, userId: USER, deletedAt: null });
    expect(args.data).toEqual({ status: 'DISPATCHED', personaResponses: { critic: { recommendation: 'Wait' } } });
    expect(res.body.status).toBe('DISPATCHED');
  });

  it('404 for another user’s (or an archived) session', async () => {
    const res = await call('patch', `/decision-sessions/${SID}`, { 'x-user-id': OTHER }).send({ status: 'DISPATCHED' });
    expect(res.status).toBe(404);
  });

  it('422 on an empty body; 413 on an oversized state', async () => {
    expect((await call('patch', `/decision-sessions/${SID}`).send({})).status).toBe(422);
    const res = await call('patch', `/decision-sessions/${SID}`).send({ state: { blob: 'y'.repeat(DECISION_SESSION_STATE_MAX_BYTES + 1) } });
    expect(res.status).toBe(413);
    expect(mockPrisma.decisionSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /decision-sessions/:id', () => {
  it('soft-deletes (sets deletedAt) the caller’s live row', async () => {
    mockPrisma.decisionSession.updateMany.mockResolvedValue({ count: 1 });
    const res = await call('delete', `/decision-sessions/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SID, status: 'archived' });
    const args = mockPrisma.decisionSession.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: SID, userId: USER, deletedAt: null });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('404 when already archived', async () => {
    expect((await call('delete', `/decision-sessions/${SID}`)).status).toBe(404);
  });
});

describe('POST /decisions with decisionSessionId (RD-17)', () => {
  const body = { title: 'Second stall', question: 'Should the bakery open a second stall?', decisionSessionId: SID };

  it('422 invalid_reference when the session is not the caller’s live session', async () => {
    const res = await call('post', '/decisions').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_reference');
    expect(mockPrisma.decisionSession.findFirst.mock.calls[0][0].where).toEqual({ id: SID, userId: USER, deletedAt: null });
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it('201 and the link is written; a soft-deleted decision releases the session first', async () => {
    mockPrisma.decisionSession.findFirst.mockResolvedValue({ id: SID, decision: { id: 'cold', deletedAt: new Date() } });
    mockPrisma.decision.create.mockResolvedValue({ id: 'cnew', decisionSessionId: SID, assumptions: [] });
    const res = await call('post', '/decisions').send(body);
    expect(res.status).toBe(201);
    expect(mockPrisma.decision.update).toHaveBeenCalledWith({ where: { id: 'cold' }, data: { decisionSessionId: null } });
    expect(mockPrisma.decision.create.mock.calls[0][0].data).toMatchObject({ userId: USER, decisionSessionId: SID });
  });
});
