/**
 * S-2 — GET /usage/llm/summary admin proxy. OmniMind guards the cross-user
 * (`all=1`) summary with `x-admin-key`; BoardRoom must forward `all=1`
 * explicitly, attach its OMNIMIND_ADMIN_KEY, and fail clearly (503
 * admin_disabled) when that key is not configured.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getLlmUsageSummary: vi.fn(async () => ({ days: 7, totalCostUsd: 1.23, byPurpose: [] })),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { usageRouter } from '../../src/routes/usage.routes';

let server: Server;
let base = '';
const prevAdminKey = process.env.OMNIMIND_ADMIN_KEY;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as any).auth = { userId: 'admin-1', email: 'admin@b.co', teamId: 't1' }; next(); });
  app.use('/usage', usageRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prevAdminKey === undefined) delete process.env.OMNIMIND_ADMIN_KEY; else process.env.OMNIMIND_ADMIN_KEY = prevAdminKey;
});

beforeEach(() => { vi.mocked(omnimindClient.getLlmUsageSummary).mockClear(); });

describe('GET /usage/llm/summary (S-2)', () => {
  it('503 admin_disabled when OMNIMIND_ADMIN_KEY is unset, without calling OmniMind', async () => {
    delete process.env.OMNIMIND_ADMIN_KEY;
    const res = await fetch(`${base}/usage/llm/summary?days=7`);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('admin_disabled');
    expect(json.message).toMatch(/OMNIMIND_ADMIN_KEY/);
    expect(omnimindClient.getLlmUsageSummary).not.toHaveBeenCalled();
  });

  it('forwards all=1 + clamped days and passes the admin key when configured', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm-secret';
    const res = await fetch(`${base}/usage/llm/summary?days=7`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ totalCostUsd: 1.23 });
    expect(omnimindClient.getLlmUsageSummary).toHaveBeenCalledTimes(1);
    expect(omnimindClient.getLlmUsageSummary).toHaveBeenCalledWith({ all: '1', days: '7' }, { adminKey: 'adm-secret' });
  });

  it('always sends all=1 even without a days param, and clamps days to 365', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm-secret';
    await fetch(`${base}/usage/llm/summary`);
    expect(omnimindClient.getLlmUsageSummary).toHaveBeenLastCalledWith({ all: '1' }, { adminKey: 'adm-secret' });
    await fetch(`${base}/usage/llm/summary?days=9999`);
    expect(omnimindClient.getLlmUsageSummary).toHaveBeenLastCalledWith({ all: '1', days: '365' }, { adminKey: 'adm-secret' });
  });
});
