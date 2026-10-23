/**
 * RD-4 — GET /memories/budget proxies OmniMind's per-domain budget report for
 * the signed-in user, validates it at the boundary, and is matched before
 * /memories/:id (otherwise "budget" would be read as a memory id).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getMemoryBudget: vi.fn(),
    getMemoryById: vi.fn(async () => ({ id: 'should-not-be-called' })),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { entitiesRouter } from '../../src/routes/entities.routes';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: 'budget-u1', email: 'b@b.co', teamId: 't1' }; next(); });
  app.use('/', entitiesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(omnimindClient.getMemoryBudget).mockReset();
  vi.mocked(omnimindClient.getMemoryById).mockClear();
});

describe('GET /memories/budget (RD-4)', () => {
  it('returns the OmniMind report for the signed-in user', async () => {
    const report = { scope: 'user', tenantId: null, domains: [{ domain: 'business', count: 412, limit: 400, over: true }] };
    vi.mocked(omnimindClient.getMemoryBudget).mockResolvedValue(report as any);
    const res = await fetch(`${base}/memories/budget`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(omnimindClient.getMemoryBudget).toHaveBeenCalledWith('budget-u1');
    expect(omnimindClient.getMemoryById).not.toHaveBeenCalled();
  });

  it('a malformed upstream body is an error, not passed through', async () => {
    vi.mocked(omnimindClient.getMemoryBudget).mockResolvedValue({ domains: [{ domain: 'business', count: -1 }] } as any);
    const res = await fetch(`${base}/memories/budget`);
    expect(res.status).toBe(500);
  });
});
