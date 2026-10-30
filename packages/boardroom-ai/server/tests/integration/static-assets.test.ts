/**
 * Static client delivery (UI e2e finding, 2026-10-30): hashed `/assets/*` were
 * sent uncompressed with `Cache-Control: public, max-age=0`.
 *
 * Boots the real app factory in production mode against a throwaway dist and
 * checks: immutable year-long caching for fingerprinted assets, `no-cache` for
 * the SPA shell (static and fallback), gzip / brotli negotiation, and that an
 * SSE response is never compressed (it would be buffered until the end).
 * Plain app.listen(0) + node:http (fetch would transparently decompress).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

let server: Server;
let port = 0;
let clientDist = '';
const prevEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) { prevEnv[k] = process.env[k]; process.env[k] = v; }

const JS = `export const rows = [${Array.from({ length: 400 }, (_, i) => `"row-${i}"`).join(',')}];\n`;

interface Res { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
function get(urlPath: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

beforeAll(async () => {
  setEnv('NODE_ENV', 'production');
  setEnv('JWT_SECRET', 'static-assets-test-secret');
  setEnv('OMNIMIND_API_KEY', 'static-assets-test-key');
  setEnv('OMNIMIND_API_URL', 'http://127.0.0.1:1');
  setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');

  clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'boardroom-static-dist-'));
  fs.mkdirSync(path.join(clientDist, 'assets'));
  fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><html><body><div id="root">SPA</div><script type="module" src="/assets/index-Ab12Cd34.js"></script></body></html>');
  fs.writeFileSync(path.join(clientDist, 'assets', 'index-Ab12Cd34.js'), JS);

  const { createApp } = await import('../../src/app');
  const app = createApp({ clientDist });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(clientDist, { recursive: true, force: true });
});

describe('static client: caching + compression', () => {
  it('hashed /assets/* are cached for a year, immutable', async () => {
    const res = await get('/assets/index-Ab12Cd34.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('index.html is no-cache — served statically at / and by the SPA fallback', async () => {
    const root = await get('/', { Accept: 'text/html' });
    expect(root.status).toBe(200);
    expect(root.headers['cache-control']).toBe('no-cache');
    const fallback = await get('/decisions/s-1', { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
    expect(fallback.status).toBe(200);
    expect(fallback.body.toString()).toContain('SPA');
    expect(fallback.headers['cache-control']).toBe('no-cache');
  });

  it('gzips JS for a client that accepts gzip, and the body round-trips', async () => {
    const res = await get('/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.body.length).toBeLessThan(Buffer.byteLength(JS) / 2);
    expect(zlib.gunzipSync(res.body).toString()).toBe(JS);
  });

  it('serves brotli to a client that only accepts br', async () => {
    const res = await get('/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'br' });
    expect(res.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(res.body).toString()).toBe(JS);
  });

  it('sends identity when the client accepts no encoding', async () => {
    const res = await get('/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'identity' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.toString()).toBe(JS);
  });
});

describe('compression never buffers SSE', () => {
  // The app's SSE routes sit behind the auth wall, so the filter createApp()
  // installs is exercised on a probe app: an event stream goes out as-is even
  // when gzip / br are accepted, while a JSON body of the same size is compressed.
  it('text/event-stream is never compressed; JSON is', async () => {
    const express = (await import('express')).default;
    const compression = (await import('compression')).default;
    const { shouldCompress } = await import('../../src/app');
    const probeApp = express();
    probeApp.use(compression({ filter: shouldCompress }));
    probeApp.get('/sse', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${'x'.repeat(4096)}\n\n`);
      res.end();
    });
    probeApp.get('/json', (_req, res) => { res.json({ x: 'x'.repeat(4096) }); });
    const probe = await new Promise<Server>((resolve) => { const s = probeApp.listen(0, '127.0.0.1', () => resolve(s)); });
    const appPort = port;
    port = (probe.address() as AddressInfo).port;
    try {
      const sse = await get('/sse', { 'Accept-Encoding': 'gzip, br', Accept: 'text/event-stream' });
      expect(sse.headers['content-type']).toMatch(/text\/event-stream/);
      expect(sse.headers['content-encoding']).toBeUndefined();
      expect(sse.body.toString()).toContain('data: xxxx');
      const json = await get('/json', { 'Accept-Encoding': 'gzip' });
      expect(json.headers['content-encoding']).toBe('gzip');
    } finally {
      port = appPort;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
  });
});
