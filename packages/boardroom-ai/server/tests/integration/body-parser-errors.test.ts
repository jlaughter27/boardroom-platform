/**
 * Lane G item 3 — body-parser failures are client errors with stable codes.
 *
 * Before: a JSON body over express.json()'s 100 kB limit came back as
 * 413 `internal_error` ("An internal error occurred" in production) and was
 * logged as an unhandled error; malformed JSON was 400 `internal_error`.
 * Now they mirror OmniMind's mapClientError: 413 `payload_too_large` and
 * 400 `invalid_json`. Boots the real createApp() in production mode.
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
  setEnv('JWT_SECRET', 'body-parser-test-secret');
  setEnv('OMNIMIND_API_KEY', 'body-parser-test-key');
  setEnv('OMNIMIND_API_URL', 'http://127.0.0.1:1');
  setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'boardroom-client-dist-'));
  fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
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

const post = (p: string, body: string) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body,
});

describe('body-parser error mapping (lane G item 3)', () => {
  it('a JSON body over 100 kB → 413 payload_too_large (public route)', async () => {
    const res = await post('/api/auth/login', JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(120_000) }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'payload_too_large' });
    expect(body.message).toMatch(/100 kB|100kb|too large/i);
  });

  it('a JSON body over 100 kB on a protected route is also 413 payload_too_large (parser runs before the auth wall)', async () => {
    const res = await post('/api/sessions', JSON.stringify({ question: 'x'.repeat(120_000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
  });

  it('malformed JSON → 400 invalid_json', async () => {
    const res = await post('/api/auth/login', '{"email": "a@example.test", ');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_json' });
  });

  it('a well-formed body is unaffected (reaches the auth wall → 401)', async () => {
    // No cookie → the auth wall answers, as before.
    const res = await post('/api/sessions', JSON.stringify({}));
    expect(res.status).toBe(401);
  });
});
