/**
 * Lane G item 1 — logout revokes the JWT, not just the cookie.
 *
 * Before: POST /auth/logout only cleared the `boardroom_token` cookie, so a
 * copied token kept authenticating for the rest of its 7-day life. Now every
 * issued token carries a `jti`; logout records it in an in-process revocation
 * list (entries expire with the token) and authMiddleware refuses it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';

vi.mock('../../src/middleware/auth-rate-limiter', () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  registerLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    registerUser: vi.fn(),
    verifyCredentials: vi.fn(async (email: string) => ({ id: 'user-synthetic-1', email, name: 'Sam Example', teamId: 'team-synthetic-1' })),
    getUserById: vi.fn(),
  },
}));

import { authRouter } from '../../src/routes/auth.routes';
import {
  authMiddleware,
  createToken,
  verifyToken,
  __resetJwtSecretForTest,
  __resetRevokedTokensForTest,
} from '../../src/middleware/auth';

let server: Server;
let base = '';
const prevSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret-lane-g-logout';
  __resetJwtSecretForTest();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  app.use(authMiddleware);
  app.get('/whoami', (req, res) => { res.json({ userId: (req as unknown as { auth: { userId: string } }).auth.userId }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prevSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevSecret;
  __resetJwtSecretForTest();
});

beforeEach(() => { __resetRevokedTokensForTest(); });

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = /boardroom_token=([^;]+)/.exec(raw);
  if (!m) throw new Error(`no boardroom_token cookie in: ${raw}`);
  return m[1];
}

const whoami = (token: string) => fetch(`${base}/whoami`, { headers: { cookie: `boardroom_token=${token}` } });
const logout = (token: string | null) => fetch(`${base}/auth/logout`, {
  method: 'POST',
  headers: token ? { cookie: `boardroom_token=${token}` } : {},
});

describe('logout revokes the JWT (lane G item 1)', () => {
  it('token works → logout → the SAME token is 401', async () => {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'sam@example.test', password: 'Passw0rd-example!' }),
    });
    expect(login.status).toBe(200);
    const token = cookieFrom(login);

    const before = await whoami(token);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ userId: 'user-synthetic-1' });

    const out = await logout(token);
    expect(out.status).toBe(200);
    // Cookie is cleared too.
    expect(out.headers.get('set-cookie') ?? '').toMatch(/boardroom_token=;/);

    const after = await whoami(token);
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('logging out one session does not revoke another token for the same user', async () => {
    const a = createToken({ userId: 'user-synthetic-2', email: 'alex@example.test', teamId: 't' });
    const b = createToken({ userId: 'user-synthetic-2', email: 'alex@example.test', teamId: 't' });
    expect(a).not.toBe(b); // distinct jti per issue, even within the same second
    await logout(a);
    expect((await whoami(a)).status).toBe(401);
    expect((await whoami(b)).status).toBe(200);
  });

  it('issued tokens carry a jti', () => {
    const t = createToken({ userId: 'u', email: 'e@example.test', teamId: 't' });
    const decoded = jwt.decode(t) as { jti?: string };
    expect(typeof decoded.jti).toBe('string');
    expect(decoded.jti!.length).toBeGreaterThanOrEqual(16);
  });

  it('a legacy token without a jti (issued before this change) is revoked by logout as well', async () => {
    const legacy = jwt.sign({ userId: 'user-synthetic-3', email: 'lee@example.test', teamId: 't' }, 'test-jwt-secret-lane-g-logout', { expiresIn: '7d' });
    expect((await whoami(legacy)).status).toBe(200);
    await logout(legacy);
    expect((await whoami(legacy)).status).toBe(401);
  });

  it('logout without a cookie, or with garbage, is still 200 and revokes nothing', async () => {
    expect((await logout(null)).status).toBe(200);
    expect((await logout('not-a-jwt')).status).toBe(200);
  });

  it('verifyToken returns null for a revoked token (optionalAuth / OAuth callbacks honour revocation too)', async () => {
    const t = createToken({ userId: 'user-synthetic-4', email: 'kai@example.test', teamId: 't' });
    expect(verifyToken(t)).not.toBeNull();
    await logout(t);
    expect(verifyToken(t)).toBeNull();
  });
});
