/**
 * Security fix C1 (2026-10-30) — BoardRoom forwards the canonical
 * lower(trim(email)) to OmniMind on register AND login, and OmniMind's 409 for
 * a case variant of an existing address surfaces as a 409 here.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';

vi.mock('../../src/middleware/auth-rate-limiter', () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  registerLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    registerUser: vi.fn(async (email: string, _hash: string, name: string) => ({ id: 'u1', email, name, teamId: 't1' })),
    verifyCredentials: vi.fn(async (email: string) => ({ id: 'u1', email, name: 'Owner', teamId: 't1' })),
    getUserById: vi.fn(),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { authRouter } from '../../src/routes/auth.routes';

let server: Server;
let base = '';
const prevSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret-c1';
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prevSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevSecret;
});

beforeEach(() => { vi.mocked(omnimindClient.registerUser).mockClear(); vi.mocked(omnimindClient.verifyCredentials).mockClear(); });

const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('BoardRoom /auth e-mail canonicalisation (C1)', () => {
  it.each(['ADMIN@l3.test', 'Admin@L3.test', ' admin@l3.test', 'admin@l3.test '])(
    'register %j forwards admin@l3.test to OmniMind',
    async (email) => {
      const res = await post('/auth/register', { email, password: 'Passw0rd-l3!', name: 'Case trick' });
      expect(res.status).toBe(201);
      expect(vi.mocked(omnimindClient.registerUser).mock.calls[0][0]).toBe('admin@l3.test');
    },
  );

  it('login forwards the canonical address to /auth/verify', async () => {
    const res = await post('/auth/login', { email: ' Owner@Example.TEST ', password: 'whatever' });
    expect(res.status).toBe(200);
    expect(omnimindClient.verifyCredentials).toHaveBeenCalledWith('owner@example.test', 'whatever');
  });

  it("OmniMind's 409 for a case variant surfaces as 409 email already registered", async () => {
    vi.mocked(omnimindClient.registerUser).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    const res = await post('/auth/register', { email: 'ADMIN@l3.test', password: 'Passw0rd-l3!', name: 'Attacker' });
    expect(res.status).toBe(409);
    expect((await res.json()).details[0]).toMatchObject({ field: 'email' });
  });
});
