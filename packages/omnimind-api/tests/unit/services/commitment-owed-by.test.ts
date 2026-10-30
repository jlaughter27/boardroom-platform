/**
 * RD-12 — commitment direction (owedBy) on the OmniMind side:
 * buildCommitmentLinks, ownership checks on create/update, nested
 * CommitmentLink writes, the 422/404 route contract, ?owedBy filtering,
 * Idempotency-Key replay, the delegation Doer line, cortex memo and the
 * knowledge-graph edge label. Invented data only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => {
  const idemRows = new Map<string, any>();
  const k = (scope: string, key: string) => `${scope}\u0000${key}`;
  return {
    __idemRows: idemRows,
    person: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    decision: { findFirst: vi.fn() },
    task: { findFirst: vi.fn() },
    commitment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    idempotencyKey: {
      findUnique: vi.fn(async ({ where }: any) => idemRows.get(k(where.scope_key.scope, where.scope_key.key)) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const id = k(data.scope, data.key);
        if (idemRows.has(id)) { const e: any = new Error('Unique constraint'); e.code = 'P2002'; throw e; }
        idemRows.set(id, { ...data });
        return data;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $disconnect: vi.fn(),
  };
});
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const coreInvalidate = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/core-context.service', async (orig) => {
  const actual = await orig<typeof import('../../../src/services/core-context.service')>();
  return { ...actual, invalidateCoreContext: coreInvalidate };
});

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import * as svc from '../../../src/services/commitment.service';
import { HttpError } from '../../../src/middleware/error-handler';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };
const DEADLINE = '2026-11-07T23:59:59.999Z';

const owned = (id: string) => Promise.resolve({ id });

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.__idemRows.clear();
  for (const m of [mockPrisma.person, mockPrisma.project, mockPrisma.decision, mockPrisma.task]) {
    m.findFirst.mockImplementation(({ where }: any) => owned(where.id));
  }
  let n = 0;
  mockPrisma.commitment.create.mockImplementation(async ({ data }: any) => {
    n += 1;
    const { commitmentLinks: _links, ...row } = data;
    return { id: `c${n}`, status: 'OPEN', owedBy: 'USER', createdAt: new Date('2026-11-01T00:00:00Z'), ...row };
  });
  mockPrisma.commitment.findMany.mockResolvedValue([]);
  mockPrisma.commitment.count.mockResolvedValue(0);
});

describe('buildCommitmentLinks (pure)', () => {
  it('returns [] / [decision] / [decision, task] in that order', () => {
    expect(svc.buildCommitmentLinks(undefined)).toEqual([]);
    expect(svc.buildCommitmentLinks({})).toEqual([]);
    expect(svc.buildCommitmentLinks({ decisionId: 'd1' })).toEqual([{ entityType: 'decision', entityId: 'd1' }]);
    expect(svc.buildCommitmentLinks({ taskId: 't1', decisionId: 'd1' })).toEqual([
      { entityType: 'decision', entityId: 'd1' },
      { entityType: 'task', entityId: 't1' },
    ]);
  });
});

describe('createCommitment ownership + links', () => {
  it.each([
    ['person', { stakeholderId: 'p-foreign' }],
    ['project', { linkedProjectId: 'pr-foreign' }],
    ['decision', { links: { decisionId: 'd-foreign' } }],
    ['task', { links: { taskId: 't-foreign' } }],
  ] as const)('404 entity %s when the reference is not the caller\'s (or soft-deleted)', async (entity, extra) => {
    (mockPrisma as any)[entity].findFirst.mockResolvedValue(null);
    const err = await svc.createCommitment(USER, { description: 'x', ...extra }, mockPrisma as any).catch(e => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(404);
    expect(err.body).toMatchObject({ code: 'not_found', error: 'not_found', entity });
    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
  });

  it('scopes every ownership lookup to the user and live rows', async () => {
    await svc.createCommitment(USER, { description: 'x', stakeholderId: 'p1', linkedProjectId: 'pr1', links: { decisionId: 'd1', taskId: 't1' } }, mockPrisma as any);
    const q = (id: string) => ({ where: { id, userId: USER, deletedAt: null }, select: { id: true } });
    expect(mockPrisma.person.findFirst).toHaveBeenCalledWith(q('p1'));
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(q('pr1'));
    expect(mockPrisma.decision.findFirst).toHaveBeenCalledWith(q('d1'));
    expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(q('t1'));
  });

  it('a soft-deleted person is a 404 (the lookup filters deletedAt: null)', async () => {
    mockPrisma.person.findFirst.mockImplementation(({ where }: any) => Promise.resolve(where.deletedAt === null ? null : { id: where.id }));
    const err = await svc.createCommitment(USER, { description: 'x', stakeholderId: 'p-deleted' }, mockPrisma as any).catch(e => e);
    expect(err.statusCode).toBe(404);
    expect(err.body.entity).toBe('person');
  });

  it('valid links → one create with nested commitmentLinks.create, both caches invalidated', async () => {
    svc.setCachedNudges(USER, { dueSoon: [], overdue: [] });
    await svc.createCommitment(USER, {
      description: 'Send the volunteer rota', stakeholderId: 'p1', deadline: new Date(DEADLINE), owedBy: 'STAKEHOLDER',
      links: { decisionId: 'd1', taskId: 't1' },
    }, mockPrisma as any);
    expect(mockPrisma.commitment.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.commitment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: USER, owedBy: 'STAKEHOLDER', stakeholderId: 'p1' });
    expect(data).not.toHaveProperty('links');
    expect(data.commitmentLinks).toEqual({ create: [{ entityType: 'decision', entityId: 'd1' }, { entityType: 'task', entityId: 't1' }] });
    expect(coreInvalidate).toHaveBeenCalledWith(USER);
    expect(svc.getCachedNudges(USER)).toBeNull();
  });

  it('no links → create without a commitmentLinks key', async () => {
    await svc.createCommitment(USER, { description: 'Call the landlord' }, mockPrisma as any);
    const data = mockPrisma.commitment.create.mock.calls[0][0].data;
    expect(data).toEqual({ description: 'Call the landlord', userId: USER });
    expect(mockPrisma.person.findFirst).not.toHaveBeenCalled();
  });
});

describe('updateCommitment hardening', () => {
  beforeEach(() => {
    mockPrisma.commitment.findFirst.mockResolvedValue({ id: 'c1', userId: USER });
    mockPrisma.commitment.update.mockImplementation(async ({ data }: any) => ({ id: 'c1', ...data }));
  });

  it('404 for a foreign stakeholderId or linkedProjectId', async () => {
    mockPrisma.person.findFirst.mockResolvedValue(null);
    let res = await request(app).patch('/commitments/c1').set(H).send({ stakeholderId: 'p-foreign' });
    expect(res.status).toBe(404);
    expect(res.body.entity).toBe('person');
    mockPrisma.project.findFirst.mockResolvedValue(null);
    res = await request(app).patch('/commitments/c1').set(H).send({ linkedProjectId: 'pr-foreign' });
    expect(res.status).toBe(404);
    expect(res.body.entity).toBe('project');
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
  });

  it('stakeholderId null is allowed (no lookup)', async () => {
    const res = await request(app).patch('/commitments/c1').set(H).send({ stakeholderId: null });
    expect(res.status).toBe(200);
    expect(mockPrisma.person.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.commitment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { stakeholderId: null } });
  });

  it('owedBy cannot be flipped by PATCH (stripped by the update schema)', async () => {
    await request(app).patch('/commitments/c1').set(H).send({ owedBy: 'STAKEHOLDER', status: 'DEFERRED' });
    expect(mockPrisma.commitment.update.mock.calls[0][0].data).toEqual({ status: 'DEFERRED' });
  });
});

describe('POST /commitments route', () => {
  it('422 with details field stakeholderId for owedBy STAKEHOLDER without a person', async () => {
    const res = await request(app).post('/commitments').set(H).send({ description: 'x', owedBy: 'STAKEHOLDER' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'validation_failed', details: [{ field: 'stakeholderId', message: 'stakeholderId is required when owedBy is STAKEHOLDER' }] });
    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
  });

  it('422 for an unknown owedBy', async () => {
    const res = await request(app).post('/commitments').set(H).send({ description: 'x', owedBy: 'BOSS' });
    expect(res.status).toBe(422);
  });

  it('201 for a delegation; 404 body names the entity on a foreign task link', async () => {
    let res = await request(app).post('/commitments').set(H).send({ description: 'x', stakeholderId: 'p1', owedBy: 'STAKEHOLDER', deadline: DEADLINE });
    expect(res.status).toBe(201);
    expect(res.body.owedBy).toBe('STAKEHOLDER');
    mockPrisma.task.findFirst.mockResolvedValue(null);
    res = await request(app).post('/commitments').set(H).send({ description: 'x', stakeholderId: 'p1', owedBy: 'STAKEHOLDER', links: { taskId: 't-foreign' } });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not_found', entity: 'task', message: 'Task not found' });
  });

  it('Idempotency-Key replay with an owedBy+links body returns the same id and creates once', async () => {
    const body = { description: 'Send the volunteer rota', stakeholderId: 'p1', owedBy: 'STAKEHOLDER', deadline: DEADLINE, links: { decisionId: 'd1', taskId: 't1' } };
    const first = await request(app).post('/commitments').set({ ...H, 'Idempotency-Key': 'rd12-key-1' }).send(body);
    const second = await request(app).post('/commitments').set({ ...H, 'Idempotency-Key': 'rd12-key-1' }).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(mockPrisma.commitment.create).toHaveBeenCalledTimes(1);
  });
});

describe('GET /commitments?owedBy', () => {
  it('passes where.owedBy and rejects junk with 422', async () => {
    let res = await request(app).get('/commitments?owedBy=STAKEHOLDER').set(H);
    expect(res.status).toBe(200);
    expect(mockPrisma.commitment.findMany.mock.calls[0][0].where).toMatchObject({ userId: USER, deletedAt: null, owedBy: 'STAKEHOLDER' });
    res = await request(app).get('/commitments?owedBy=x').set(H);
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('owedBy');
    vi.clearAllMocks();
    mockPrisma.commitment.findMany.mockResolvedValue([]);
    mockPrisma.commitment.count.mockResolvedValue(0);
    await request(app).get('/commitments').set(H);
    expect(mockPrisma.commitment.findMany.mock.calls[0][0].where).not.toHaveProperty('owedBy');
  });
});

describe('renderCommitmentLines — delegation lines', () => {
  const now = new Date('2026-11-08T10:00:00Z');
  it('prints "waiting on {name}" with shared day helpers; user-owed lines unchanged', () => {
    const lines = svc.renderCommitmentLines({
      overdue: [
        { description: 'Send the volunteer rota', deadline: new Date(DEADLINE), owedBy: 'STAKEHOLDER', stakeholderName: 'Sam Rivera' },
        { description: 'Send invoice', deadline: new Date('2026-11-06T10:00:00Z'), owedBy: 'USER', stakeholderName: 'Dana Okafor' },
      ],
      dueSoon: [
        { description: 'Draft the budget', deadline: new Date('2026-11-08T23:59:59.999Z'), owedBy: 'STAKEHOLDER', stakeholderName: null },
        { description: 'Book the hall', deadline: new Date('2026-11-10T23:59:59.999Z'), owedBy: 'STAKEHOLDER', stakeholderName: 'Lee Park' },
        { description: 'Ship fix', deadline: new Date('2026-11-09T10:00:00Z') },
      ],
    }, now);
    expect(lines).toEqual([
      'OVERDUE: waiting on Sam Rivera — Send the volunteer rota — due 2026-11-07 (1d overdue)',
      'OVERDUE: Send invoice — due 2026-11-06 (2d overdue)',
      'DUE SOON: waiting on someone — Draft the budget — due 2026-11-08 (today)',
      'DUE SOON: waiting on Lee Park — Book the hall — due 2026-11-10 (in 2d)',
      'DUE SOON: Ship fix — due 2026-11-09 (in 1d)',
    ]);
  });

  it('no deadline → "due no deadline" with no relative suffix', () => {
    expect(svc.renderCommitmentLines({ overdue: [], dueSoon: [{ description: 'Return the keys', deadline: null, owedBy: 'STAKEHOLDER', stakeholderName: 'Sam Rivera' }] }, now))
      .toEqual(['DUE SOON: waiting on Sam Rivera — Return the keys — due no deadline']);
  });
});
