/**
 * Robustness fixes (2026-10-30) — every class of malformed input the adversarial
 * e2e run turned into a 500 is now a 4xx. Real Express app, Prisma mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  memoryEntityLink: { findFirst: vi.fn(), create: vi.fn() },
  commitment: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  person: { findFirst: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { MAX_BODY_DEPTH } from '../../../src/middleware/input-guard';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };

/** Shape of a Prisma known-request error as thrown by the client. */
function prismaError(code: string) {
  return Object.assign(new Error(`Prisma ${code}`), { name: 'PrismaClientKnownRequestError', code, clientVersion: '6.19.3', meta: {} });
}

function expectValidationFailed(res: request.Response, field?: string) {
  expect(res.status).toBe(422);
  expect(res.body.error).toBe('validation_failed');
  expect(Array.isArray(res.body.details)).toBe(true);
  for (const d of res.body.details) {
    expect(typeof d.field).toBe('string');
    expect(typeof d.message).toBe('string');
  }
  if (field) expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
}

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
  mockPrisma.commitment.findMany.mockResolvedValue([]);
  mockPrisma.commitment.count.mockResolvedValue(0);
});

describe('H1b — GET /memories query validation', () => {
  it.each([
    ['status=ACTIVE', 'status'],
    ['status=garbage', 'status'],
    ['memoryClass=FOO', 'memoryClass'],
    ['limit=abc', 'limit'],
    ['limit=-1', 'limit'],
    ['offset=-1', 'offset'],
    ['offset=abc', 'offset'],
    ['since=garbage', 'since'],
    ['since=-010000-01-01', 'since'],
    ['sortBy=password', 'sortBy'],
    ['sortOrder=sideways', 'sortOrder'],
    ['tenantId[]=a&tenantId[]=b', 'tenantId'],
    ['q[]=a&q[]=b', 'q'],
    ['q=a&q=b', 'q'],
    ['domain[]=x', 'domain'],
  ])('?%s → 422 validation_failed, Prisma never called', async (qs, field) => {
    const res = await request(app).get(`/memories?${qs}`).set(H);
    expectValidationFailed(res, field);
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('valid filters still reach the service (client + MCP shapes)', async () => {
    const res = await request(app)
      .get('/memories?status=CONFIRMED&memoryClass=DECISION&sortBy=importance&sortOrder=asc&limit=20&offset=0&since=2026-10-01T00:00:00.000Z&tags=a,b&includeInvalidated=true')
      .set(H);
    expect(res.status).toBe(200);
    const args = mockPrisma.memoryEntry.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ orderBy: [{ importance: 'asc' }, { id: 'desc' }], take: 20, skip: 0 });
    expect(args.where).toMatchObject({ status: 'CONFIRMED', memoryClass: 'DECISION', tags: { hasEvery: ['a', 'b'] } });
    expect(args.where).not.toHaveProperty('invalidAt');
  });

  it('empty values mean "not given", as before', async () => {
    const res = await request(app).get('/memories?tags=&q=&limit=').set(H);
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0]).toMatchObject({ take: 20, skip: 0 });
  });
});

describe('H1b — GET /commitments query validation', () => {
  it.each([
    ['status=FOO', 'status'],
    ['status=open', 'status'],
    ['limit=abc', 'limit'],
    ['offset=-1', 'offset'],
    ['offset=abc', 'offset'],
    ['owedBy=x', 'owedBy'],
    ['owedBy=USER&owedBy=STAKEHOLDER', 'owedBy'],
  ])('?%s → 422', async (qs, field) => {
    const res = await request(app).get(`/commitments?${qs}`).set(H);
    expectValidationFailed(res, field);
    expect(mockPrisma.commitment.findMany).not.toHaveBeenCalled();
  });

  it('valid filters pass through', async () => {
    const res = await request(app).get('/commitments?status=OPEN&owedBy=STAKEHOLDER&limit=5&offset=10').set(H);
    expect(res.status).toBe(200);
    expect(mockPrisma.commitment.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: USER, status: 'OPEN', owedBy: 'STAKEHOLDER' }, take: 5, skip: 10,
    });
  });
});

describe('M4 — body-parser errors', () => {
  it('malformed JSON → 400 invalid_json', async () => {
    const res = await request(app).post('/commitments').set(H).set('content-type', 'application/json').send('{"description":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('a bare null body → 400 invalid_json', async () => {
    const res = await request(app).patch('/commitments/c1').set(H).set('content-type', 'application/json').send('null');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('a body over 1 MB → 413 payload_too_large', async () => {
    const res = await request(app).post('/memories').set(H).set('content-type', 'application/json')
      .send(JSON.stringify({ title: 't', content: 'c'.repeat(1024 * 1024 + 10), domain: 'business', sourceType: 'MANUAL' }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('payload_too_large');
  });
});

describe('M4 — Prisma unique / foreign-key violations', () => {
  beforeEach(() => {
    mockPrisma.memoryEntry.findFirst.mockResolvedValue({ id: 'm1', userId: USER });
    mockPrisma.person.findFirst.mockResolvedValue({ id: 'p1' });
  });

  it('POST /memories/:id/links twice returns the existing link (200), no second insert', async () => {
    const link = { id: 'l1', memoryId: 'm1', entityType: 'person', entityId: 'p1', linkType: 'relates_to' };
    mockPrisma.memoryEntityLink.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(link);
    mockPrisma.memoryEntityLink.create.mockResolvedValue(link);
    const first = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'person', entityId: 'p1' });
    const second = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'person', entityId: 'p1' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(link);
    expect(mockPrisma.memoryEntityLink.create).toHaveBeenCalledTimes(1);
  });

  it('a concurrent duplicate that still hits P2002 → 409 conflict', async () => {
    mockPrisma.memoryEntityLink.findFirst.mockResolvedValue(null);
    mockPrisma.memoryEntityLink.create.mockRejectedValue(prismaError('P2002'));
    const res = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'person', entityId: 'p1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
  });

  it('an unknown foreign key (P2003, e.g. sourceSessionId) → 422 invalid_reference', async () => {
    mockPrisma.commitment.create.mockRejectedValue(prismaError('P2003'));
    const res = await request(app).post('/commitments').set(H).send({ description: 'Send Pat the deck', sourceSessionId: 'no-such-session' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_reference');
  });
});

describe('M4 — NUL (U+0000) anywhere → 422', () => {
  const memory = { title: 't', content: 'c', domain: 'business', sourceType: 'MANUAL' };
  it.each([
    ['tags', { ...memory, tags: ['a\u0000b'] }, 'tags.0'],
    ['domain', { ...memory, domain: 'busi\u0000ness' }, 'domain'],
    ['sector', { ...memory, sector: '\u0000' }, 'sector'],
    ['sourceRef', { ...memory, sourceRef: 'x\u0000' }, 'sourceRef'],
    ['metadata value', { ...memory, metadata: { note: 'a\u0000b' } }, 'metadata.note'],
    ['metadata key', { ...memory, metadata: { 'k\u0000': 1 } }, 'metadata.k\\0'],
  ])('POST /memories %s', async (_label, body, field) => {
    const res = await request(app).post('/memories').set(H).send(body);
    expectValidationFailed(res, field);
    expect(mockPrisma.memoryEntry.create).not.toHaveBeenCalled();
  });

  it('PATCH /commitments/:id description', async () => {
    const res = await request(app).patch('/commitments/c1').set(H).send({ description: 'a\u0000b' });
    expectValidationFailed(res, 'description');
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
  });

  it('POST /people name', async () => {
    const res = await request(app).post('/people').set(H).send({ name: 'Pat\u0000' });
    expectValidationFailed(res, 'name');
    expect(mockPrisma.person.create).not.toHaveBeenCalled();
  });

  it('POST /memories/:id/links linkType', async () => {
    const res = await request(app).post('/memories/m1/links').set(H).send({ entityType: 'person', entityId: 'p1', linkType: 'x\u0000' });
    expectValidationFailed(res, 'linkType');
  });

  it('query ?q= with %00', async () => {
    const res = await request(app).get('/memories?q=a%00b').set(H);
    expectValidationFailed(res, 'query.q');
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('path id with %00', async () => {
    const res = await request(app).get('/memories/m%001').set(H);
    expectValidationFailed(res, 'path');
    expect(mockPrisma.memoryEntry.findFirst).not.toHaveBeenCalled();
  });
});

describe('M4 — out-of-range dates', () => {
  it.each([
    ['commitment deadline 10001 BC', 'post', '/commitments', { description: 'd', deadline: '-010000-01-01T00:00:00Z' }, 'deadline'],
    ['commitment deadline +275760', 'post', '/commitments', { description: 'd', deadline: '+275760-09-13T00:00:00.000Z' }, 'deadline'],
    ['commitment deadline -8.64e15', 'post', '/commitments', { description: 'd', deadline: -8.64e15 }, 'deadline'],
    ['commitment completedAt -8.64e15', 'post', '/commitments', { description: 'd', completedAt: -8.64e15 }, 'completedAt'],
    ['PATCH commitment deadline 10001 BC', 'patch', '/commitments/c1', { deadline: '-010000-01-01T00:00:00Z' }, 'deadline'],
    ['person lastContactAt 10001 BC', 'post', '/people', { name: 'Pat', lastContactAt: '-010000-01-01T00:00:00Z' }, 'lastContactAt'],
  ] as const)('%s → 422', async (_label, method, path, body, field) => {
    const res = await request(app)[method](path).set(H).send(body);
    expectValidationFailed(res, field);
    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
    expect(mockPrisma.person.create).not.toHaveBeenCalled();
  });
});

describe('M4 — deep nesting, non-finite ints, oversized ids', () => {
  it(`metadata nested 3000 levels → 422 (cap ${MAX_BODY_DEPTH})`, async () => {
    const metadata = JSON.parse('{"a":'.repeat(3000) + '1' + '}'.repeat(3000));
    const res = await request(app).post('/memories').set(H)
      .send({ title: 't', content: 'c', domain: 'business', sourceType: 'MANUAL', metadata });
    expectValidationFailed(res);
    expect(res.body.details[0].message).toMatch(/nesting deeper than/);
    expect(res.body.details[0].field.length).toBeLessThanOrEqual(201);
    expect(mockPrisma.memoryEntry.create).not.toHaveBeenCalled();
  });

  it('person interactionFrequency 1e308 → 422', async () => {
    const res = await request(app).post('/people').set(H).send({ name: 'Pat', interactionFrequency: 1e308 });
    expectValidationFailed(res, 'interactionFrequency');
    expect(mockPrisma.person.create).not.toHaveBeenCalled();
  });

  it('commitment sourceSessionId of 10k chars → 422', async () => {
    const res = await request(app).post('/commitments').set(H).send({ description: 'd', sourceSessionId: 's'.repeat(10_000) });
    expectValidationFailed(res, 'sourceSessionId');
    expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
  });
});
