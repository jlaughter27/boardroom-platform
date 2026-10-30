/**
 * Security fix C1 (2026-10-30) — e-mail case must not create a second account.
 *
 * `users.email` is `@unique` but Postgres compares it case-sensitively, and
 * BoardRoom's admin gate lower-cases. Before the fix `ADMIN@x.test` registered
 * next to `admin@x.test` and inherited admin. The fake Prisma below behaves like
 * Postgres: `where: { email: 'x' }` is an exact match, `{ equals, mode: 'insensitive' }`
 * is not, and `create` enforces exact-match uniqueness only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';

interface Row { id: string; email: string; name: string; passwordHash: string; createdAt: Date }

const store: { users: Row[]; teams: number } = { users: [], teams: 0 };

function matches(row: Row, where: { email?: string | { equals: string; mode?: string } }): boolean {
  const cond = where.email;
  if (cond === undefined) return false;
  if (typeof cond === 'string') return row.email === cond;
  return cond.mode === 'insensitive'
    ? row.email.toLowerCase() === cond.equals.toLowerCase()
    : row.email === cond.equals;
}

function withMemberships(row: Row | undefined) {
  return row ? { ...row, teamMemberships: [{ teamId: `team-${row.id}` }] } : null;
}

vi.mock('../../../src/lib/db', () => {
  const user = {
    findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.id) return withMemberships(store.users.find((u) => u.id === where.id));
      return withMemberships(store.users.find((u) => matches(u, { email: where.email })));
    }),
    findFirst: vi.fn(async ({ where, orderBy }: { where: { email: { equals: string; mode?: string } }; orderBy?: unknown }) => {
      const hits = store.users.filter((u) => matches(u, where));
      if (orderBy) hits.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      return withMemberships(hits[0]);
    }),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
      if (store.users.some((u) => u.email === data.email)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      const row: Row = { ...data, id: `u${store.users.length + 1}`, createdAt: new Date(Date.now() + store.users.length) };
      store.users.push(row);
      return row;
    }),
  };
  const team = { create: vi.fn(async () => ({ id: `team-${++store.teams}` })) };
  return {
    prisma: {
      user,
      team,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user, team })),
    },
  };
});

import { authRouter } from '../../../src/routes/auth.routes';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

beforeEach(() => {
  store.users = [];
  store.teams = 0;
});

describe('C1 — e-mail case cannot mint a second account', () => {
  it('stores a new account under lower(trim(email))', async () => {
    const res = await request(makeApp()).post('/auth/register')
      .send({ email: '  Founder@Example.TEST ', passwordHash: 'h', name: 'Founder' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('founder@example.test');
    expect(store.users.map((u) => u.email)).toEqual(['founder@example.test']);
  });

  it('409 for a case-variant of an already-registered address (admin takeover attempt)', async () => {
    const app = makeApp();
    const first = await request(app).post('/auth/register').send({ email: 'admin@l3.test', passwordHash: 'h', name: 'Owner' });
    expect(first.status).toBe(201);
    for (const email of ['ADMIN@l3.test', 'Admin@L3.test', ' admin@l3.test', 'admin@l3.test ']) {
      const res = await request(app).post('/auth/register').send({ email, passwordHash: 'h2', name: 'Attacker' });
      expect(res.status, email).toBe(409);
    }
    expect(store.users).toHaveLength(1);
  });

  it('409 when a LEGACY mixed-case row exists and the new address is its lower-case form', async () => {
    store.users.push({ id: 'legacy', email: 'Legacy.User@Example.TEST', name: 'Legacy', passwordHash: 'h', createdAt: new Date(0) });
    const res = await request(makeApp()).post('/auth/register')
      .send({ email: 'legacy.user@example.test', passwordHash: 'h2', name: 'Attacker' });
    expect(res.status).toBe(409);
    expect(store.users).toHaveLength(1);
  });

  it('login + verify find a legacy mixed-case account by any case of its address', async () => {
    const passwordHash = await bcrypt.hash('correct horse', 4);
    store.users.push({ id: 'legacy', email: 'Legacy.User@Example.TEST', name: 'Legacy', passwordHash, createdAt: new Date(0) });
    const app = makeApp();
    for (const email of ['legacy.user@example.test', 'LEGACY.USER@EXAMPLE.TEST', ' Legacy.User@Example.TEST ']) {
      const login = await request(app).post('/auth/login').send({ email });
      expect(login.status, email).toBe(200);
      expect(login.body.id).toBe('legacy');
      expect(login.body).not.toHaveProperty('passwordHash');

      const verify = await request(app).post('/auth/verify').send({ email, password: 'correct horse' });
      expect(verify.status, email).toBe(200);
      expect(verify.body.id).toBe('legacy');
    }
    const wrong = await request(app).post('/auth/verify').send({ email: 'legacy.user@example.test', password: 'nope' });
    expect(wrong.status).toBe(401);
  });

  it('login with any case works for an account registered after the fix', async () => {
    const passwordHash = await bcrypt.hash('pw-1234567', 4);
    const app = makeApp();
    await request(app).post('/auth/register').send({ email: 'Mixed@Case.test', passwordHash, name: 'M' });
    const verify = await request(app).post('/auth/verify').send({ email: 'MIXED@case.TEST', password: 'pw-1234567' });
    expect(verify.status).toBe(200);
    expect(verify.body.email).toBe('mixed@case.test');
  });
});
