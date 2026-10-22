/**
 * M0-A2 — GET /health stays 200 and carries `version`; GET /ready is 503
 * unless OmniMind's /health (over OMNIMIND_API_URL) answers `status: "ok"`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import { startHttpServer, checkUpstreamReadiness, serviceVersion, type StartedHttpServer } from '../src/transports/http';
import type { AgentContext } from '../src/types';

const agentCtx: AgentContext = {
  agentId: 'ready-test-agent', agentName: 'ready-test-agent', tenantId: 'josh-business',
  scopes: ['memory:read'], sourceWeight: 1.0,
};

function get(port: number, path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

let upstream: Server;
let upstreamUrl = '';
let upstreamBody: unknown = { status: 'ok', dbConnected: true };
let upstreamStatus = 200;
const servers: StartedHttpServer[] = [];
const prevSha = process.env.RAILWAY_GIT_COMMIT_SHA;

async function boot(opts: Parameters<typeof startHttpServer>[1]): Promise<StartedHttpServer> {
  const s = await startHttpServer(0, { apiKey: 'ready-test-key', agentCtx, log: () => {}, ...opts });
  servers.push(s);
  return s;
}

beforeAll(async () => {
  process.env.OMNIMIND_API_URL = process.env.OMNIMIND_API_URL ?? 'http://127.0.0.1:1';
  process.env.OMNIMIND_API_KEY = process.env.OMNIMIND_API_KEY ?? 'unused';
  process.env.RAILWAY_GIT_COMMIT_SHA = 'feedface42';
  upstream = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(upstreamBody));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of servers) await s.close();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  if (prevSha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = prevSha;
});

describe('serviceVersion', () => {
  it('is RAILWAY_GIT_COMMIT_SHA when set, else "dev"', () => {
    expect(serviceVersion({ RAILWAY_GIT_COMMIT_SHA: 'deadbeef' } as NodeJS.ProcessEnv)).toBe('deadbeef');
    expect(serviceVersion({} as NodeJS.ProcessEnv)).toBe('dev');
  });
});

describe('checkUpstreamReadiness', () => {
  it('ok / degraded / unreachable / unconfigured', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as unknown as typeof fetch;
    expect(await checkUpstreamReadiness('http://omni/', okFetch)).toBe('ok');
    expect(vi.mocked(okFetch).mock.calls[0][0]).toBe('http://omni/health');

    const degraded = vi.fn(async () => new Response(JSON.stringify({ status: 'degraded' }), { status: 200 })) as unknown as typeof fetch;
    expect(await checkUpstreamReadiness('http://omni', degraded)).toBe('degraded');

    const fiveHundred = vi.fn(async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    expect(await checkUpstreamReadiness('http://omni', fiveHundred)).toBe('unreachable');

    const throws = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await checkUpstreamReadiness('http://omni', throws)).toBe('unreachable');

    expect(await checkUpstreamReadiness(undefined, okFetch)).toBe('unconfigured');
  });
});

describe('GET /health and GET /ready over HTTP', () => {
  it('/health is 200 with version even when the upstream is down', async () => {
    const s = await boot({ readyUpstreamUrl: 'http://127.0.0.1:1' });
    const res = await get(s.port, '/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', version: 'feedface42' });
  });

  it('/ready is 200 when OmniMind /health answers ok (real upstream)', async () => {
    upstreamStatus = 200; upstreamBody = { status: 'ok', dbConnected: true };
    const s = await boot({ readyUpstreamUrl: upstreamUrl });
    const res = await get(s.port, '/ready');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ready', version: 'feedface42', checks: { omnimind: 'ok' } });
  });

  it('/ready is 503 when OmniMind reports itself degraded', async () => {
    upstreamStatus = 200; upstreamBody = { status: 'degraded', dbConnected: false };
    const s = await boot({ readyUpstreamUrl: upstreamUrl });
    const res = await get(s.port, '/ready');
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'not_ready', checks: { omnimind: 'degraded' } });
    upstreamBody = { status: 'ok', dbConnected: true };
  });

  it('/ready is 503 when the upstream fetch fails (connection refused)', async () => {
    const s = await boot({ readyUpstreamUrl: 'http://127.0.0.1:1' });
    const res = await get(s.port, '/ready');
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'not_ready', version: 'feedface42', checks: { omnimind: 'unreachable' } });
  });

  it('/ready is 503 when the injected upstream fetch rejects', async () => {
    const readyFetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const s = await boot({ readyUpstreamUrl: 'http://omnimind.invalid', readyFetch });
    const res = await get(s.port, '/ready');
    expect(res.status).toBe(503);
    expect(readyFetch).toHaveBeenCalledTimes(1);
  });

  it('/ready needs no key, ignores the allowed-hosts guard and leaks neither the upstream URL nor the identity', async () => {
    const s = await boot({ readyUpstreamUrl: upstreamUrl });
    const res = await get(s.port, '/ready', { Host: 'evil.example' });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('127.0.0.1');
    expect(res.body).not.toContain('josh-business');
    expect(res.body).not.toContain('ready-test-agent');
  });
});
