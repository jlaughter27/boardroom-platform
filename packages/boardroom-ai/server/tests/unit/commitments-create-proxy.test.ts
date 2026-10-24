/**
 * RD-12 — POST /commitments proxies a delegation (body + Idempotency-Key) to
 * OmniMind behind the JWT wall, validating the body at the boundary.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: { createCommitment: vi.fn() },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { entitiesRouter } from '../../src/routes/entities.routes';
import { authMiddleware, createToken, __resetJwtSecretForTest } from '../../src/middleware/auth';

let server: Server;
let base = '';
let token = '';

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'rd12-test-secret-rd12-test-secret';
  __resetJwtSecretForTest();
  token = createToken({ userId: 'deleg-u1', email: 'owner@example.test', teamId: 't1' } as any);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // the real app parses cookies first; the test sends the JWT as a cookie header
    const m = /boardroom_token=([^;]+)/.exec(req.headers.cookie ?? '');
    (req as any).cookies = m ? { boardroom_token: m[1] } : {};
    next();
  });
  app.use(authMiddleware as express.RequestHandler);
  app.use('/', entitiesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'upstream', status: err.status }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => vi.mocked(omnimindClient.createCommitment).mockReset());

const body = {
  description: 'Send the volunteer rota',
  stakeholderId: 'p1',
  deadline: '2026-11-07T23:59:59.999Z',
  owedBy: 'STAKEHOLDER',
  linkedProjectId: 'pr1',
  links: { decisionId: 'd1', taskId: 't1' },
};

const post = (b: unknown, headers: Record<string, string> = {}) => fetch(`${base}/commitments`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `boardroom_token=${token}`, ...headers },
  body: JSON.stringify(b),
});

describe('POST /commitments (RD-12)', () => {
  it('proxies the body and the Idempotency-Key and returns 201', async () => {
    vi.mocked(omnimindClient.createCommitment).mockResolvedValue({ id: 'c1', owedBy: 'STAKEHOLDER' } as any);
    const res = await post(body, { 'Idempotency-Key': 'k-123' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'c1', owedBy: 'STAKEHOLDER' });
    const [userId, sent, key] = vi.mocked(omnimindClient.createCommitment).mock.calls[0];
    expect(userId).toBe('deleg-u1');
    expect(key).toBe('k-123');
    expect(JSON.parse(JSON.stringify(sent))).toEqual(body);
  });

  it('no Idempotency-Key → undefined key', async () => {
    vi.mocked(omnimindClient.createCommitment).mockResolvedValue({ id: 'c2' } as any);
    await post(body);
    expect(vi.mocked(omnimindClient.createCommitment).mock.calls[0][2]).toBeUndefined();
  });

  it('an invalid body (owedBy X) is 422 and never reaches OmniMind', async () => {
    const res = await post({ ...body, owedBy: 'X' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('validation_failed');
    expect(omnimindClient.createCommitment).not.toHaveBeenCalled();
  });

  it('401 without a JWT', async () => {
    const res = await fetch(`${base}/commitments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(401);
    expect(omnimindClient.createCommitment).not.toHaveBeenCalled();
  });
});
