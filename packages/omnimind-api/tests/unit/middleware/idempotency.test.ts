/**
 * Phase 6 (A2) — Idempotency-Key middleware with a fake prisma: miss → store,
 * hit → replay with original status + `Idempotent-Replayed: true`, scope
 * (verified agent+user vs x-user-id — R-O-14), route mismatch, TTL expiry, key length, unique
 * constraint race → re-read and replay, non-2xx not stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  idempotent,
  IDEMPOTENCY_TTL_MS,
  __resetIdempotencyStateForTest,
  type IdempotencyPrisma,
} from '../../../src/middleware/idempotency';

vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

interface Row { scope: string; key: string; route: string; resultId: string | null; resultJson: unknown; expiresAt: Date }

/** In-memory IdempotencyKey table honouring the (scope, key) unique constraint. */
function fakeDb(now: () => Date) {
  const rows = new Map<string, Row>();
  const k = (scope: string, key: string) => `${scope}\u0000${key}`;
  const idempotencyKey = {
    findUnique: vi.fn(async ({ where }: any) => rows.get(k(where.scope_key.scope, where.scope_key.key)) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const id = k(data.scope, data.key);
      if (rows.has(id)) { const e: any = new Error('Unique constraint'); e.code = 'P2002'; throw e; }
      const row: Row = { ...data };
      rows.set(id, row);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const [id, r] of rows) {
        const expired = where.expiresAt?.lt ? r.expiresAt < where.expiresAt.lt : false;
        const exact = where.scope !== undefined ? r.scope === where.scope && r.key === where.key : false;
        if (expired || exact) { rows.delete(id); count++; }
      }
      return { count };
    }),
  };
  return { prisma: { idempotencyKey } as unknown as IdempotencyPrisma, idempotencyKey, rows, now };
}

function makeApp(db: ReturnType<typeof fakeDb>, handler?: express.RequestHandler, agent?: { agentId: string; verified?: boolean }) {
  const app = express();
  app.use(express.json());
  if (agent) app.use((req, _res, next) => { (req as any).agentContext = { agentId: agent.agentId, tenantId: 't', sourceWeight: 1, verified: agent.verified ?? true }; next(); });
  let calls = 0;
  app.post('/things', idempotent('things.create', { prisma: db.prisma, now: db.now }), handler ?? ((req, res) => {
    calls += 1;
    res.status(201).json({ id: `thing-${calls}`, calls, echo: req.body });
  }));
  app.post('/other', idempotent('other.create', { prisma: db.prisma, now: db.now }), (_req, res) => { res.status(201).json({ id: 'o1' }); });
  return { app, handlerCalls: () => calls };
}

let clock = new Date('2026-10-02T10:00:00Z');
const now = () => clock;

beforeEach(() => { clock = new Date('2026-10-02T10:00:00Z'); __resetIdempotencyStateForTest(); });

describe('idempotent()', () => {
  it('without the header the handler runs every time and nothing is stored', async () => {
    const db = fakeDb(now);
    const { app, handlerCalls } = makeApp(db);
    await request(app).post('/things').set('x-user-id', 'u1').send({ a: 1 });
    await request(app).post('/things').set('x-user-id', 'u1').send({ a: 1 });
    expect(handlerCalls()).toBe(2);
    expect(db.rows.size).toBe(0);
  });

  it('miss → handler runs, result stored with route + 24h TTL; hit → replay with original status and Idempotent-Replayed', async () => {
    const db = fakeDb(now);
    const { app, handlerCalls } = makeApp(db);
    const first = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k1').send({ a: 1 });
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(db.rows.size).toBe(1);
    const row = [...db.rows.values()][0];
    expect(row).toMatchObject({ scope: 'user:u1', key: 'k1', route: 'things.create', resultId: 'thing-1' });
    expect(row.expiresAt.getTime()).toBe(clock.getTime() + IDEMPOTENCY_TTL_MS);
    expect(row.resultJson).toEqual({ status: 201, body: { id: 'thing-1', calls: 1, echo: { a: 1 } } });

    const second = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k1').send({ a: 2 });
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(handlerCalls()).toBe(1);
  });

  it('R-O-14: scope is agent:<id>:user:<x-user-id> for a verified agent, else user:<x-user-id> — same key in different scopes does not collide', async () => {
    const db = fakeDb(now);
    const userApp = makeApp(db);
    const agentApp = makeApp(db, undefined, { agentId: 'claude-code-josh', verified: true });
    const a = await request(userApp.app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'same').send({});
    const b = await request(agentApp.app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'same').send({});
    expect(a.headers['idempotent-replayed']).toBeUndefined();
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect([...db.rows.values()].map(r => r.scope).sort()).toEqual(['agent:claude-code-josh:user:u1', 'user:u1']);
  });

  it('R-O-14: the same verified agent acting for two users never replays across them', async () => {
    const db = fakeDb(now);
    const { app, handlerCalls } = makeApp(db, undefined, { agentId: 'claude-code-josh', verified: true });
    const a = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k').send({});
    const b = await request(app).post('/things').set('x-user-id', 'u2').set('Idempotency-Key', 'k').send({});
    expect(a.body.id).toBe('thing-1');
    expect(b.body.id).toBe('thing-2');
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(handlerCalls()).toBe(2);
    expect([...db.rows.values()].map(r => r.scope).sort()).toEqual(['agent:claude-code-josh:user:u1', 'agent:claude-code-josh:user:u2']);
  });

  it('R-O-14: an UNVERIFIED (legacy header) agent falls back to the user scope — a spoofed x-agent-id gets no namespace of its own', async () => {
    const db = fakeDb(now);
    const legacy = makeApp(db, undefined, { agentId: 'spoofed', verified: false });
    const user = makeApp(db);
    const a = await request(legacy.app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k').send({});
    const b = await request(user.app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k').send({});
    expect(a.headers['idempotent-replayed']).toBeUndefined();
    expect(b.headers['idempotent-replayed']).toBe('true'); // same scope → replay
    expect([...db.rows.values()].map(r => r.scope)).toEqual(['user:u1']);
  });

  it('422 idempotency_key_reused when the same scope+key hits a different route', async () => {
    const db = fakeDb(now);
    const { app } = makeApp(db);
    await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k2').send({});
    const res = await request(app).post('/other').set('x-user-id', 'u1').set('Idempotency-Key', 'k2').send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('idempotency_key_reused');
  });

  it('expired rows are not replayed: the handler runs again and the row is replaced', async () => {
    const db = fakeDb(now);
    const { app, handlerCalls } = makeApp(db);
    await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k3').send({});
    clock = new Date(clock.getTime() + IDEMPOTENCY_TTL_MS + 1000);
    const res = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k3').send({});
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body.id).toBe('thing-2');
    expect(handlerCalls()).toBe(2);
    expect(db.rows.size).toBe(1);
    expect([...db.rows.values()][0].resultId).toBe('thing-2');
  });

  it('lazy cleanup deletes expired rows at most once per interval', async () => {
    const db = fakeDb(now);
    const { app } = makeApp(db);
    await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'a').send({});
    await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'b').send({});
    const cleanupCalls = () => db.idempotencyKey.deleteMany.mock.calls.filter(c => c[0]?.where?.expiresAt).length;
    expect(cleanupCalls()).toBe(1);
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'c').send({});
    expect(cleanupCalls()).toBe(2);
  });

  it('400 when the key exceeds 128 chars', async () => {
    const db = fakeDb(now);
    const { app, handlerCalls } = makeApp(db);
    const res = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'x'.repeat(129)).send({});
    expect(res.status).toBe(400);
    expect(handlerCalls()).toBe(0);
  });

  it('non-2xx responses are not stored, so a retry runs the handler again', async () => {
    const db = fakeDb(now);
    let n = 0;
    const { app } = makeApp(db, (_req, res) => {
      n += 1;
      if (n === 1) { res.status(422).json({ error: 'validation_failed' }); return; }
      res.status(201).json({ id: 'ok' });
    });
    const r1 = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k4').send({});
    expect(r1.status).toBe(422);
    expect(db.rows.size).toBe(0);
    const r2 = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k4').send({});
    expect(r2.status).toBe(201);
    expect(db.rows.size).toBe(1);
  });

  it('concurrent duplicate: a P2002 on store re-reads the winner and replays it', async () => {
    const db = fakeDb(now);
    // Simulate the race: the lookup misses, but by the time we store, another
    // request has written the row.
    db.idempotencyKey.findUnique
      .mockResolvedValueOnce(null) // first lookup (miss)
      .mockImplementation(async ({ where }: any) => db.rows.get(`${where.scope_key.scope}\u0000${where.scope_key.key}`) ?? null);
    db.rows.set('user:u1\u0000race', {
      scope: 'user:u1', key: 'race', route: 'things.create', resultId: 'winner',
      resultJson: { status: 201, body: { id: 'winner' } }, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS),
    });
    const { app, handlerCalls } = makeApp(db);
    const res = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'race').send({});
    expect(handlerCalls()).toBe(1); // the handler did run (the spec stores after success)
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(res.body).toEqual({ id: 'winner' });
  });

  it('storage lookup failure does not block the write (handler runs, no replay)', async () => {
    const db = fakeDb(now);
    db.idempotencyKey.findUnique.mockRejectedValueOnce(new Error('db down'));
    const { app, handlerCalls } = makeApp(db);
    const res = await request(app).post('/things').set('x-user-id', 'u1').set('Idempotency-Key', 'k5').send({});
    expect(res.status).toBe(201);
    expect(handlerCalls()).toBe(1);
  });
});
