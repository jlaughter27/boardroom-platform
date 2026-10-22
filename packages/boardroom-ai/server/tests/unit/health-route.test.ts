/**
 * M0-A2 — GET /health (liveness, always 200, carries `version`) and GET /ready
 * (readiness, 503 when OmniMind is unreachable or degraded).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: { health: vi.fn() },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { healthRouter, readyRouter, serviceVersion } from '../../src/routes/health.routes';

const health = vi.mocked(omnimindClient.health);
let server: Server;
let base = '';
const prevSha = process.env.RAILWAY_GIT_COMMIT_SHA;

beforeAll(async () => {
  process.env.RAILWAY_GIT_COMMIT_SHA = 'c0ffee1234';
  const app = express();
  app.use('/health', healthRouter);
  app.use('/ready', readyRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prevSha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = prevSha;
});

beforeEach(() => { health.mockReset(); });

describe('serviceVersion', () => {
  it('is RAILWAY_GIT_COMMIT_SHA when set, else "dev"', () => {
    expect(serviceVersion({ RAILWAY_GIT_COMMIT_SHA: 'deadbeef' })).toBe('deadbeef');
    expect(serviceVersion({})).toBe('dev');
  });
});

describe('GET /health (liveness)', () => {
  it('returns 200 with version when OmniMind is ok', async () => {
    health.mockResolvedValueOnce({ status: 'ok', dbConnected: true });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'boardroom-ai', version: 'c0ffee1234', omnimindConnected: true });
  });

  it('stays HTTP 200 (degraded) when the omnimind client throws', async () => {
    health.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'degraded', version: 'c0ffee1234', omnimindConnected: false });
  });
});

describe('GET /ready (readiness)', () => {
  it('returns 200 ready when OmniMind is ok', async () => {
    health.mockResolvedValueOnce({ status: 'ok', dbConnected: true });
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ready', service: 'boardroom-ai', version: 'c0ffee1234', checks: { omnimind: 'ok' } });
  });

  it('returns 503 when the omnimind client throws (unreachable / breaker open)', async () => {
    health.mockRejectedValueOnce(Object.assign(new Error('OmniMind circuit breaker OPEN'), { code: 'ECIRCUIT_OPEN', status: 503 }));
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'not_ready', checks: { omnimind: 'unreachable' } });
  });

  it('returns 503 when OmniMind answers but reports itself degraded', async () => {
    health.mockResolvedValueOnce({ status: 'degraded', dbConnected: false });
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'not_ready', checks: { omnimind: 'degraded' } });
  });
});
