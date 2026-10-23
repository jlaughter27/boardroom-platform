/**
 * M0-A2 — GET /health (liveness, always 200, carries `version`) and GET /ready
 * (readiness, 503 when the DB check fails). Both are public.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../../src/lib/db', () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from '../../../src/lib/db';
import { healthRouter, readyRouter, serviceVersion } from '../../../src/routes/health.routes';

const queryRaw = vi.mocked(prisma.$queryRaw);

function makeApp() {
  const app = express();
  app.use('/health', healthRouter);
  app.use('/ready', readyRouter);
  return app;
}

const prevSha = process.env.RAILWAY_GIT_COMMIT_SHA;

beforeEach(() => {
  queryRaw.mockReset();
  process.env.RAILWAY_GIT_COMMIT_SHA = 'abc1234def';
});

afterEach(() => {
  if (prevSha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
  else process.env.RAILWAY_GIT_COMMIT_SHA = prevSha;
});

describe('serviceVersion', () => {
  it('is RAILWAY_GIT_COMMIT_SHA when set, else "dev"', () => {
    expect(serviceVersion({ RAILWAY_GIT_COMMIT_SHA: 'deadbeef' })).toBe('deadbeef');
    expect(serviceVersion({})).toBe('dev');
    expect(serviceVersion({ RAILWAY_GIT_COMMIT_SHA: '  ' })).toBe('dev');
  });
});

describe('GET /health (liveness)', () => {
  it('returns 200 with version and dbConnected=true when the DB answers', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }] as never);
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'omnimind-api', version: 'abc1234def', dbConnected: true });
  });

  it('stays HTTP 200 (degraded) when prisma.$queryRaw rejects — railway healthcheck must not fail', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'degraded', version: 'abc1234def', dbConnected: false });
  });

  it('reports version "dev" when RAILWAY_GIT_COMMIT_SHA is unset', async () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    queryRaw.mockResolvedValueOnce([] as never);
    const res = await request(makeApp()).get('/health');
    expect(res.body.version).toBe('dev');
  });
});

describe('GET /ready (readiness)', () => {
  it('returns 200 ready when the DB answers', async () => {
    queryRaw.mockResolvedValueOnce([] as never);
    const res = await request(makeApp()).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', service: 'omnimind-api', version: 'abc1234def', checks: { db: 'ok' } });
  });

  it('returns 503 not_ready when prisma.$queryRaw rejects', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(makeApp()).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'not_ready', version: 'abc1234def', checks: { db: 'fail' } });
  });
});

describe('/ready on the real app is public', () => {
  it('answers without x-api-key (not 401) — 503 here because the DB mock rejects', async () => {
    queryRaw.mockRejectedValue(new Error('no db in unit tests'));
    const { default: app } = await import('../../../src/index');
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ service: 'omnimind-api', checks: { db: 'fail' } });

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toHaveProperty('version');
  });
});
