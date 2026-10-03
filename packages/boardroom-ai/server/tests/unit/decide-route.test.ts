/**
 * POST /sessions/:id/decide — route-level validation + wiring with a mocked
 * omnimindClient. Boots the real sessions router behind a fake auth shim.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    createDecision: vi.fn(async (_userId: string, input: Record<string, unknown>) => ({ id: 'dec_42', ...input })),
    linkProjectDecision: vi.fn(async () => ({})),
    postLlmUsage: vi.fn(async () => ({ id: 'u', costUsd: 0 })),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { sessionsRouter } from '../../src/routes/sessions.routes';

let server: Server;
let base: string;
// Switchable so later suites don't exhaust u1's SESSIONS_PER_DAY (5) bucket.
let currentUser = 'u1';

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: currentUser, email: `${currentUser}@example.com`, teamId: 't1' }; next(); });
  app.use('/sessions', sessionsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('POST /sessions/:id/decide', () => {
  it('422 when probabilitySuccess / expectedOutcome are missing or out of range', async () => {
    const created = await post('/sessions', { question: 'Should I hire?', mode: 'decide' });
    expect(created.status).toBe(201);
    const id = created.json.sessionId;

    const missing = await post(`/sessions/${id}/decide`, { chosenPath: 'Hire' });
    expect(missing.status).toBe(422);
    expect(missing.json.error).toBe('validation_failed');
    const fields = missing.json.details.map((d: any) => d.field);
    expect(fields).toContain('expectedOutcome');
    expect(fields).toContain('probabilitySuccess');

    const outOfRange = await post(`/sessions/${id}/decide`, { chosenPath: 'Hire', expectedOutcome: 'x', probabilitySuccess: 1.5 });
    expect(outOfRange.status).toBe(422);
    expect(omnimindClient.createDecision).not.toHaveBeenCalled();
  });

  it('404 for an unknown session', async () => {
    const res = await post('/sessions/session_nope/decide', { chosenPath: 'Hire', expectedOutcome: 'x', probabilitySuccess: 0.5 });
    expect(res.status).toBe(404);
  });

  it('201 creates the Decision through OmniMind with mode/sessionId/decidedAt and then 409 on a second commit', async () => {
    const created = await post('/sessions', { question: 'Should I hire a senior engineer?', mode: 'premortem', asOf: '2026-09-01T00:00:00.000Z' });
    expect(created.status).toBe(201);
    expect(created.json.personasToFire).toEqual(['critic', 'technician', 'questionnaire']);
    const id = created.json.sessionId;

    const res = await post(`/sessions/${id}/decide`, { chosenPath: 'Hire now', rationale: 'speed', expectedOutcome: 'Ship Q3 on time', probabilitySuccess: 0.65, reviewAt: '2026-12-01T00:00:00.000Z' });
    expect(res.status).toBe(201);
    expect(res.json.id).toBe('dec_42');
    expect(omnimindClient.createDecision).toHaveBeenCalledTimes(1);
    const [userId, input] = (omnimindClient.createDecision as any).mock.calls[0];
    expect(userId).toBe('u1');
    expect(input).toMatchObject({
      question: 'Should I hire a senior engineer?',
      chosenPath: 'Hire now', rationale: 'speed', expectedOutcome: 'Ship Q3 on time', probabilitySuccess: 0.65,
      status: 'DECIDED', mode: 'premortem', sessionId: id, personaForecasts: [], assumptions: [],
    });
    expect(new Date(input.reviewAt).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(input.decidedAt).toBeInstanceOf(Date);

    const again = await post(`/sessions/${id}/decide`, { chosenPath: 'Hire now', expectedOutcome: 'x', probabilitySuccess: 0.5 });
    expect(again.status).toBe(409);
    expect(again.json.decisionId).toBe('dec_42');

    const get = await fetch(`${base}/sessions/${id}`).then(r => r.json());
    expect(get.decisionId).toBe('dec_42');
    expect(get.asOf).toBe('2026-09-01T00:00:00.000Z');
    expect(get.ledger).toEqual([]);
  });
});

describe('POST /sessions/:id/decide — concurrency (R-B-06)', () => {
  const decideBody = { chosenPath: 'Hire now', expectedOutcome: 'Ship Q3', probabilitySuccess: 0.6 };

  it('two concurrent commits → exactly ONE OmniMind create; the loser gets 409 while the first is in flight', async () => {
    currentUser = 'u-concurrent';
    const created = await post('/sessions', { question: 'Concurrent commit?', mode: 'decide' });
    expect(created.status).toBe(201);
    const id = created.json.sessionId;

    const create = vi.mocked(omnimindClient.createDecision);
    create.mockClear();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // Slow upstream: the first commit parks here, exactly the window the old
    // `if (session.decisionId)` check could not cover.
    create.mockImplementationOnce(async (_userId: string, input: unknown) => { await gate; return { id: 'dec_slow', ...(input as object) }; });

    const [a, b] = await Promise.all([
      post(`/sessions/${id}/decide`, decideBody),
      post(`/sessions/${id}/decide`, decideBody).then(async (r) => { release(); return r; }), // release only once BOTH requests are in
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = a.status === 409 ? a : b;
    expect(rejected.json.error).toBe('decision_pending');
    expect(create).toHaveBeenCalledTimes(1);

    // Afterwards the session is decided for good.
    const again = await post(`/sessions/${id}/decide`, decideBody);
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('already_decided');
    expect(again.json.decisionId).toBe('dec_slow');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a failed upstream create clears the pending marker so the user can retry', async () => {
    currentUser = 'u-retry';
    const created = await post('/sessions', { question: 'Retry after failure?', mode: 'decide' });
    const id = created.json.sessionId;

    const create = vi.mocked(omnimindClient.createDecision);
    create.mockClear();
    create.mockRejectedValueOnce(Object.assign(new Error('OmniMind POST /decisions: 503'), { status: 503 }));

    const failed = await post(`/sessions/${id}/decide`, decideBody);
    expect(failed.status).toBe(503);

    const retry = await post(`/sessions/${id}/decide`, decideBody);
    expect(retry.status).toBe(201);
    expect(retry.json.id).toBe('dec_42');
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('GET /sessions — list (S-1)', () => {
  it('returns each session\'s REAL createdAt (stable across calls) and lists newest first', async () => {
    currentUser = 'u-list';
    const first = await post('/sessions', { question: 'First question', mode: 'decide' });
    await new Promise((r) => setTimeout(r, 15));
    const second = await post('/sessions', { question: 'Second question', mode: 'plan' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const list1 = await fetch(`${base}/sessions`).then(r => r.json());
    expect(list1.items.map((s: any) => s.id)).toEqual([second.json.sessionId, first.json.sessionId]);
    expect(list1.total).toBe(2);
    for (const item of list1.items) expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt); // valid ISO
    expect(new Date(list1.items[0].createdAt).getTime()).toBeGreaterThan(new Date(list1.items[1].createdAt).getTime());

    // The old code stamped `new Date()` on every row — a second read must NOT move createdAt.
    await new Promise((r) => setTimeout(r, 15));
    const list2 = await fetch(`${base}/sessions`).then(r => r.json());
    expect(list2.items.map((s: any) => s.createdAt)).toEqual(list1.items.map((s: any) => s.createdAt));

    // GET /sessions/:id agrees with the list.
    const detail = await fetch(`${base}/sessions/${first.json.sessionId}`).then(r => r.json());
    expect(detail.createdAt).toBe(list1.items[1].createdAt);
  });
});
