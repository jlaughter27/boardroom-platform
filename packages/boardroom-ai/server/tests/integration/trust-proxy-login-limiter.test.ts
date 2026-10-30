/**
 * Lane G item 2 — a client-supplied X-Forwarded-For must not rotate the login
 * rate-limit key.
 *
 * Before: app.ts hard-coded `trust proxy = 1`. Reached directly (no Railway
 * edge in front — local, CI, a private-network caller), the right-most XFF
 * entry is whatever the client wrote, so every login attempt with a fresh XFF
 * got a fresh 5-per-15-min bucket. Now the hop count comes from
 * TRUST_PROXY_HOPS (default 1 in production — Railway's single edge — and 0
 * otherwise), and with 1 hop only the entry the proxy appended counts.
 *
 * Boots the real createApp() over real HTTP (no supertest in this package).
 * The bodies are invalid on purpose: the limiter runs before validateBody, so
 * every request counts and nothing reaches OmniMind.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { __resetAuthRateLimitersForTest } from '../../src/middleware/auth-rate-limiter';
import { resolveTrustProxy } from '../../src/lib/trust-proxy';

const KEYS = ['NODE_ENV', 'JWT_SECRET', 'OMNIMIND_API_KEY', 'OMNIMIND_API_URL', 'ANTHROPIC_API_KEY', 'TRUST_PROXY_HOPS'] as const;
const prev: Record<string, string | undefined> = {};
let server: Server | null = null;
let base = '';

async function boot(env: Record<string, string | undefined>): Promise<void> {
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const { createApp } = await import('../../src/app');
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  for (const k of KEYS) prev[k] = process.env[k];
  process.env.JWT_SECRET = 'trust-proxy-test-secret';
  process.env.OMNIMIND_API_KEY = 'trust-proxy-test-key';
  process.env.OMNIMIND_API_URL = 'http://127.0.0.1:1';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  __resetAuthRateLimitersForTest();
});

afterEach(async () => {
  const s = server;
  server = null;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});

const login = (xff: string) => fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json', 'x-forwarded-for': xff },
  body: JSON.stringify({}),
});

async function statuses(xffs: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const x of xffs) out.push((await login(x)).status);
  return out;
}

const spoofed = (n: number) => Array.from({ length: n }, (_, i) => `203.0.113.${i + 1}`);

describe('trust proxy vs the login limiter (lane G item 2)', () => {
  it('outside production (no proxy in front): spoofed XFF values share ONE bucket → the 6th attempt is 429', async () => {
    await boot({ NODE_ENV: 'test', TRUST_PROXY_HOPS: undefined });
    const s = await statuses(spoofed(6));
    expect(s.slice(0, 5).every(code => code !== 429)).toBe(true);
    expect(s[5]).toBe(429);
  });

  it('TRUST_PROXY_HOPS=0 in production also ignores XFF', async () => {
    await boot({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' });
    const s = await statuses(spoofed(6));
    expect(s[5]).toBe(429);
  });

  it('TRUST_PROXY_HOPS=1 (Railway): only the proxy-appended right-most entry counts — rotating the client-written prefix gets no fresh bucket', async () => {
    await boot({ NODE_ENV: 'test', TRUST_PROXY_HOPS: '1' });
    // The client writes "<spoof>"; the (simulated) edge appends the real peer.
    const s = await statuses(spoofed(6).map(ip => `${ip}, 198.51.100.7`));
    expect(s[5]).toBe(429);
    // A genuinely different client (different appended address) is unaffected.
    expect((await login('198.51.100.8')).status).not.toBe(429);
  });
});

describe('resolveTrustProxy', () => {
  it('defaults: 1 hop in production, off otherwise', () => {
    expect(resolveTrustProxy({ NODE_ENV: 'production' })).toBe(1);
    expect(resolveTrustProxy({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveTrustProxy({})).toBe(false);
  });
  it('TRUST_PROXY_HOPS overrides: 0 → off, N → N hops', () => {
    expect(resolveTrustProxy({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' })).toBe(false);
    expect(resolveTrustProxy({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '1' })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY_HOPS: ' 2 ' })).toBe(2);
    expect(resolveTrustProxy({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '' })).toBe(1);
  });
  it('rejects anything but a small non-negative integer (no "true" — that trusts every hop)', () => {
    for (const bad of ['true', 'yes', '-1', '1.5', 'loopback', '11', 'abc']) {
      expect(() => resolveTrustProxy({ TRUST_PROXY_HOPS: bad })).toThrow(/TRUST_PROXY_HOPS/);
    }
  });
});
