/**
 * Security fix M6 (2026-10-30) — the BoardRoom admin panel proxies OmniMind's
 * `/admin/*`, which is guarded by `x-admin-key`. BoardRoom never sent it, so
 * every panel call was an upstream 401 → 502. The router now forwards
 * BoardRoom's OMNIMIND_ADMIN_KEY on every call, and answers a clear
 * `503 admin_key_not_configured` (without calling OmniMind) when it is unset.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => {
  const ok = () => vi.fn(async () => ({ ok: true }));
  return {
    omnimindClient: {
      getAdminStats: ok(),
      getAdminAgents: ok(),
      getAdminAudit: ok(),
      getAdminMemories: ok(),
      getAdminContradictions: ok(),
      triggerAdminSummarize: ok(),
      getAdminDuplicates: ok(),
      mergeAdminDuplicates: ok(),
      triggerAdminDecay: ok(),
    },
  };
});

import { omnimindClient } from '../../src/services/omnimind-client';
import { adminRouter } from '../../src/routes/admin.routes';

let server: Server;
let base = '';
const prevAdminKey = process.env.OMNIMIND_ADMIN_KEY;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error' }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prevAdminKey === undefined) delete process.env.OMNIMIND_ADMIN_KEY; else process.env.OMNIMIND_ADMIN_KEY = prevAdminKey;
});

beforeEach(() => { vi.clearAllMocks(); });

const client = omnimindClient as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CASES: Array<{ method: 'GET' | 'POST'; path: string; fn: string; body?: unknown }> = [
  { method: 'GET', path: '/admin/stats', fn: 'getAdminStats' },
  { method: 'GET', path: '/admin/agents', fn: 'getAdminAgents' },
  { method: 'GET', path: '/admin/audit?limit=5', fn: 'getAdminAudit' },
  { method: 'GET', path: '/admin/memories?q=x', fn: 'getAdminMemories' },
  { method: 'GET', path: '/admin/contradictions', fn: 'getAdminContradictions' },
  { method: 'POST', path: '/admin/summarize', fn: 'triggerAdminSummarize' },
  { method: 'GET', path: '/admin/duplicates?threshold=0.9', fn: 'getAdminDuplicates' },
  { method: 'POST', path: '/admin/duplicates/merge', fn: 'mergeAdminDuplicates', body: { keepId: 'a', archiveId: 'b', userId: 'u' } },
  { method: 'POST', path: '/admin/decay/run', fn: 'triggerAdminDecay' },
];

const call = (c: (typeof CASES)[number]) => fetch(`${base}${c.path}`, {
  method: c.method,
  headers: { 'content-type': 'application/json' },
  body: c.body ? JSON.stringify(c.body) : undefined,
});

describe('BoardRoom /admin proxy (M6)', () => {
  it.each(CASES)('$method $path → 503 admin_key_not_configured when OMNIMIND_ADMIN_KEY is unset', async (c) => {
    delete process.env.OMNIMIND_ADMIN_KEY;
    const res = await call(c);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('admin_key_not_configured');
    expect(json.message).toMatch(/OMNIMIND_ADMIN_KEY/);
    expect(client[c.fn]).not.toHaveBeenCalled();
  });

  it.each(CASES)('$method $path forwards the admin key to the client', async (c) => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm-secret';
    const res = await call(c);
    expect(res.status).toBe(200);
    expect(client[c.fn]).toHaveBeenCalledTimes(1);
    const args = client[c.fn].mock.calls[0];
    expect(args[args.length - 1]).toEqual({ adminKey: 'adm-secret' });
  });

  it('keeps forwarding query params alongside the key', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm-secret';
    await fetch(`${base}/admin/audit?agentId=a1&limit=5&includeAllTenants=true`);
    expect(client.getAdminAudit).toHaveBeenCalledWith({ includeAllTenants: 'true', agentId: 'a1', limit: '5' }, { adminKey: 'adm-secret' });
    await fetch(`${base}/admin/duplicates/merge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepId: 'k' }) });
    expect(client.mergeAdminDuplicates).toHaveBeenCalledWith({ keepId: 'k' }, { adminKey: 'adm-secret' });
  });
});
