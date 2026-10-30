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
  // requireAdmin (app.ts) runs before this router with an authenticated caller.
  app.use((req: any, _res, next) => { req.auth = { userId: 'admin-user-1', email: 'ops@example.test' }; next(); });
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
  });
});

// Lane F (2026-10-30) — with the admin key sent, OmniMind answered 400
// `tenant_scope_required` to /stats, /agents, /audit, /memories, /duplicates
// (and merge) and 400 `user_scope_required` to /contradictions: BoardRoom has
// no agent context, so the admin-wide views must opt in to
// `includeAllTenants=true` server-side (the browser never knows about tenancy),
// and /contradictions is scoped to the signed-in admin's userId.
describe('BoardRoom /admin proxy scoping (lane F)', () => {
  const ALL = { includeAllTenants: 'true' };
  const KEY = { adminKey: 'adm-secret' };
  beforeEach(() => { process.env.OMNIMIND_ADMIN_KEY = 'adm-secret'; });

  it.each([
    ['/admin/stats', 'getAdminStats', ALL],
    ['/admin/agents', 'getAdminAgents', ALL],
    ['/admin/audit', 'getAdminAudit', ALL],
    ['/admin/memories', 'getAdminMemories', ALL],
    ['/admin/duplicates', 'getAdminDuplicates', ALL],
    ['/admin/audit?toolName=memory_write&limit=10', 'getAdminAudit', { ...ALL, toolName: 'memory_write', limit: '10' }],
    ['/admin/memories?q=plan&domain=business&offset=25', 'getAdminMemories', { ...ALL, domain: 'business', q: 'plan', offset: '25' }],
    ['/admin/duplicates?threshold=0.9', 'getAdminDuplicates', { ...ALL, threshold: '0.9' }],
  ])('GET %s sends includeAllTenants=true without the browser asking', async (path, fn, params) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    expect(client[fn]).toHaveBeenCalledWith(params, KEY);
  });

  it('a browser-supplied includeAllTenants=false cannot narrow the admin view into a 400', async () => {
    await fetch(`${base}/admin/stats?includeAllTenants=false`);
    expect(client.getAdminStats).toHaveBeenCalledWith(ALL, KEY);
  });

  // Lane H (2026-10-30): the admin panel is an operator view, so contradictions
  // are the all-users view (OmniMind excludes ministry alerts); a
  // browser-supplied ?userId= is ignored, as before.
  it('GET /admin/contradictions requests the all-users view', async () => {
    await fetch(`${base}/admin/contradictions?limit=20&userId=someone-else`);
    expect(client.getAdminContradictions).toHaveBeenCalledWith({ ...ALL, limit: '20' }, KEY);
  });

  // Lane H (2026-10-30): the duplicates list spans users and each pair carries
  // its owner (`user_id`); OmniMind only archives the owner's row, so the merge
  // must be sent for the pair owner, not the signed-in admin (that 404'd for
  // every pair the admin did not own). The route is admin-gated.
  it("POST /admin/duplicates/merge opts in to all tenants and acts for the pair owner from the body", async () => {
    await fetch(`${base}/admin/duplicates/merge`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keepId: 'k', archiveId: 'a', userId: 'pair-owner-7', extra: 'dropped' }),
    });
    expect(client.mergeAdminDuplicates).toHaveBeenCalledWith({ keepId: 'k', archiveId: 'a', userId: 'pair-owner-7' }, ALL, KEY);
  });

  it.each([
    ['userId missing', { keepId: 'k', archiveId: 'a' }],
    ['userId not a string', { keepId: 'k', archiveId: 'a', userId: 42 }],
    ['userId empty', { keepId: 'k', archiveId: 'a', userId: '' }],
    ['keepId missing', { archiveId: 'a', userId: 'u' }],
  ])('POST /admin/duplicates/merge → 400 without calling OmniMind when %s', async (_label, body) => {
    const res = await fetch(`${base}/admin/duplicates/merge`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_failed');
    expect(client.mergeAdminDuplicates).not.toHaveBeenCalled();
  });
});
