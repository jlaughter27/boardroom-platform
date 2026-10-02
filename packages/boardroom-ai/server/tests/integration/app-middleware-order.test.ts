/**
 * B-102 / B-103 / B-104 / B-107 — production middleware order.
 *
 * Boots the REAL app factory (server/src/app.ts) with NODE_ENV=production and
 * a throwaway client dist, then drives it over real HTTP. This is the test the
 * 2026-10-02 audit said was missing: every prior suite mocked the routers, so
 * the SPA fallback swallowing /api/goals was never caught.
 *
 * No supertest dependency (not installed for this package) — plain app.listen(0)
 * + global fetch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

let server: Server;
let base = '';
let clientDist = '';
const prevEnv: Record<string, string | undefined> = {};

function setEnv(k: string, v: string) { prevEnv[k] = process.env[k]; process.env[k] = v; }

beforeAll(async () => {
  setEnv('NODE_ENV', 'production');
  setEnv('JWT_SECRET', 'middleware-order-test-secret');
  setEnv('OMNIMIND_API_KEY', 'middleware-order-test-key');
  setEnv('OMNIMIND_API_URL', 'http://127.0.0.1:1'); // nothing listens — no upstream calls should be needed
  setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  // Stripe "configured" so the webhook handler runs the real signature check
  // (constructEvent is pure crypto — no network). Nothing else in this file
  // gets past the auth wall, so requireSubscription never fires.
  setEnv('STRIPE_SECRET_KEY', 'sk_test_middleware_order');
  setEnv('STRIPE_WEBHOOK_SECRET', 'whsec_middleware_order');
  setEnv('STRIPE_PRICE_ID', 'price_middleware_order');

  clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'boardroom-client-dist-'));
  fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><html><body><div id="root">SPA</div></body></html>');

  const { createApp } = await import('../../src/app');
  const app = createApp({ clientDist });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(clientDist, { recursive: true, force: true });
});

describe('production middleware order', () => {
  // ---- B-102 ---------------------------------------------------------------
  it('GET /api/goals (fetch, Accept: application/json) reaches the API → 401 JSON, not index.html', async () => {
    const res = await fetch(`${base}/api/goals`, { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /api/goals with a bare */* Accept (fetch default) is still NOT served HTML', async () => {
    const res = await fetch(`${base}/api/goals`, { headers: { Accept: '*/*' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).not.toMatch(/text\/html/);
  });

  it('GET /api/sessions → 401 JSON', async () => {
    const res = await fetch(`${base}/api/sessions`, { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /integrations as a browser navigation (Accept: text/html) → 200 index.html (client route)', async () => {
    const res = await fetch(`${base}/integrations`, { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('SPA');
  });

  it('GET /admin as a browser navigation → 200 index.html; GET /api/admin/stats as fetch → 401 JSON', async () => {
    const nav = await fetch(`${base}/admin`, { headers: { Accept: 'text/html,*/*;q=0.8' } });
    expect(nav.status).toBe(200);
    expect(nav.headers.get('content-type')).toMatch(/text\/html/);

    const api = await fetch(`${base}/api/admin/stats`, { headers: { Accept: 'application/json' } });
    expect(api.status).toBe(401);
    expect(api.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /api/integrations as fetch → 401 JSON (same prefix, API side)', async () => {
    const res = await fetch(`${base}/api/integrations`, { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('GET /api/health is public and JSON', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ service: 'boardroom-ai' });
  });

  it('POST (non-GET) to an unknown path is never served index.html', async () => {
    const res = await fetch(`${base}/no-such-route`, { method: 'POST', headers: { Accept: 'text/html' } });
    expect(res.headers.get('content-type')).not.toMatch(/text\/html/);
  });

  // ---- B-103 ---------------------------------------------------------------
  it.each(['/subscription/webhook', '/api/subscription/webhook'])(
    'POST %s is reachable without a cookie and does not get the JSON parser (400 from signature check, not 401)',
    async (p) => {
      const res = await fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=bogus' },
        body: JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Webhook verification failed' });
    },
  );

  // ---- B-104 ---------------------------------------------------------------
  it('trusts one proxy hop: X-Forwarded-For drives req.ip (per-IP limiters)', async () => {
    // Exhaust the login limiter (5/15min) for a forwarded IP, then show a
    // different forwarded IP is NOT limited. Without `trust proxy` both would
    // share the loopback bucket and the second IP would be 429 too.
    const body = JSON.stringify({ email: 'a@b.co', password: 'whatever1' });
    const hit = (ip: string) => fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body,
    });
    let last: globalThis.Response | undefined;
    for (let i = 0; i < 6; i++) last = await hit('203.0.113.10');
    expect(last!.status).toBe(429);

    const other = await hit('203.0.113.11');
    expect(other.status).not.toBe(429);
  });

  // ---- B-107 ---------------------------------------------------------------
  it('OAuth callbacks are reachable before the auth wall (bad state → 400, not 401)', async () => {
    for (const p of ['/calendar/callback?code=x&state=bogus', '/api/integrations/gmail/callback?code=x&state=bogus']) {
      const res = await fetch(`${base}${p}`, { redirect: 'manual' });
      expect(res.status).toBe(400);
    }
  });

  // ---- B-116 ---------------------------------------------------------------
  it('a disallowed CORS origin gets no Allow-Origin header and no 500', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
