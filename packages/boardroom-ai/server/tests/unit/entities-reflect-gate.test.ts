/**
 * R-B-05 — POST /context/reflect spends a Haiku call on the OmniMind side, so
 * it must carry the same gates as every other LLM-backed route: the per-user
 * LLM token bucket and the subscription check. The entities router is mounted
 * bare at `/`, so nothing upstream supplies them.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    reflectEntity: vi.fn(async () => ({ entityId: 'g1', capsule: 'ok' })),
    getSubscription: vi.fn(async () => null),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { entitiesRouter } from '../../src/routes/entities.routes';
import { __resetLlmBucketsForTest } from '../../src/middleware/llm-rate-limiter';

let server: Server;
let base = '';
let currentUser = 'reflect-u1';
const prevEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in prevEnv)) prevEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: currentUser, email: 'r@b.co', teamId: 't1' }; next(); });
  app.use('/', entitiesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  __resetLlmBucketsForTest();
  vi.mocked(omnimindClient.reflectEntity).mockClear();
  vi.mocked(omnimindClient.getSubscription).mockClear();
  setEnv('STRIPE_SECRET_KEY', undefined); // dev mode → requireSubscription passes through
  setEnv('LLM_RATE_LIMIT_PER_HOUR', undefined);
});

const body = JSON.stringify({ entityType: 'goal', entityId: 'g1' });
const post = () => fetch(`${base}/context/reflect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('POST /context/reflect gates (R-B-05)', () => {
  it('has llmRateLimiter and requireSubscription attached to the route layer', () => {
    const layer = (entitiesRouter as any).stack.find((l: any) => l.route?.path === '/context/reflect' && l.route?.methods?.post);
    expect(layer).toBeDefined();
    const names = layer.route.stack.map((l: any) => l.name);
    expect(names).toContain('llmRateLimiter');
    expect(names).toContain('requireSubscription');
    // Gates run BEFORE the handler/validation so a rate-limited user never reaches OmniMind.
    expect(names.indexOf('llmRateLimiter')).toBeLessThan(names.length - 1);
  });

  it('429 rate_limited after the configured LLM burst (LLM_RATE_LIMIT_PER_HOUR=1)', async () => {
    currentUser = 'reflect-burst-user';
    setEnv('LLM_RATE_LIMIT_PER_HOUR', '1');

    const first = await post();
    expect(first.status).toBe(200);
    expect(omnimindClient.reflectEntity).toHaveBeenCalledTimes(1);

    const second = await post();
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
    expect(await second.json()).toMatchObject({ error: 'rate_limited' });
    expect(omnimindClient.reflectEntity).toHaveBeenCalledTimes(1); // not called again
  });

  it('402 subscription_required when Stripe is configured and the user has no subscription', async () => {
    currentUser = 'reflect-nosub-user';
    setEnv('STRIPE_SECRET_KEY', 'sk_test_reflect_gate');
    vi.mocked(omnimindClient.getSubscription).mockResolvedValueOnce(null);

    const res = await post();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
    expect(omnimindClient.reflectEntity).not.toHaveBeenCalled();
  });

  it('still validates the body after the gates (422 on a bad entityType)', async () => {
    currentUser = 'reflect-validate-user';
    const res = await fetch(`${base}/context/reflect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityType: 'task', entityId: 'x' }),
    });
    expect(res.status).toBe(422);
    expect(omnimindClient.reflectEntity).not.toHaveBeenCalled();
  });
});
