/**
 * M1-C2 — POST /sessions/:id/dispatch body over real HTTP (express.json + the
 * real sessions router; the orchestrator is a stub that records its options).
 *
 *  - no body / `{}`               → every persona (no options)
 *  - `{personaIds:['critic']}`    → the orchestrator receives exactly that list
 *  - an id that is not an advisor → 400 `unknown_persona` (mode roster + active custom personas)
 *  - a bad shape                  → 422 `validation_failed` (validateBody, the repo's validation status)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const state = vi.hoisted(() => ({ dispatches: [] as Array<{ sessionId: string; options: unknown }> }));

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    postLlmUsage: vi.fn(async () => ({ id: 'u', costUsd: 0 })),
    getCustomPersonas: vi.fn(async () => [
      { personaId: 'custom_board', isActive: true },
      { personaId: 'custom_retired', isActive: false },
    ]),
  },
}));

vi.mock('../../src/agents/orchestrator', () => ({
  CEOOrchestrator: class {
    async dispatch(session: { id: string }, res: express.Response, _signal: AbortSignal, options: unknown): Promise<void> {
      state.dispatches.push({ sessionId: session.id, options });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"dispatch_complete","personaCount":0,"durationMs":1}\n\n');
      res.end();
    }
  },
}));

import { sessionsRouter } from '../../src/routes/sessions.routes';

let server: Server;
let base = '';
const prev = process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: 'retry-u1', email: 'r@b.co', teamId: 't1' }; next(); });
  app.use('/sessions', sessionsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
});

beforeEach(() => { state.dispatches.length = 0; });

async function createSession(mode = 'decide'): Promise<string> {
  const res = await fetch(`${base}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Hire a designer?', mode }) });
  expect(res.status).toBe(201);
  return (await res.json()).sessionId as string;
}

function dispatch(id: string, body?: unknown) {
  return fetch(`${base}/sessions/${id}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('POST /sessions/:id/dispatch — optional { personaIds } (M1-C2)', () => {
  it('no body and {} dispatch every persona', async () => {
    const id = await createSession();
    expect((await dispatch(id)).status).toBe(200);
    expect((await dispatch(id, {})).status).toBe(200);
    expect(state.dispatches).toEqual([{ sessionId: id, options: {} }, { sessionId: id, options: {} }]);
  });

  it('{personaIds:["critic"]} reaches the orchestrator as a retry of the Critic only', async () => {
    const id = await createSession();
    const res = await dispatch(id, { personaIds: ['critic'] });
    expect(res.status).toBe(200);
    await res.text();
    expect(state.dispatches).toEqual([{ sessionId: id, options: { personaIds: ['critic'] } }]);
  });

  it('accepts an active custom persona of the user', async () => {
    const id = await createSession();
    expect((await dispatch(id, { personaIds: ['custom_board'] })).status).toBe(200);
  });

  it('an unknown id → 400 unknown_persona, and nothing is dispatched', async () => {
    const id = await createSession();
    for (const personaIds of [['bogus'], ['critic', 'doer'], ['custom_retired']]) {
      const res = await dispatch(id, { personaIds });
      expect(res.status, JSON.stringify(personaIds)).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('unknown_persona');
    }
    // `doer` is a real persona, but not an advisor of a `decide` session.
    expect(state.dispatches).toHaveLength(0);
  });

  it('a malformed body → 422 validation_failed (validateBody)', async () => {
    const id = await createSession();
    for (const body of [{ personaIds: 'critic' }, { personaIds: [] }, { personaIds: ['Critic!'] }]) {
      const res = await dispatch(id, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await res.json()).error).toBe('validation_failed');
    }
    expect(state.dispatches).toHaveLength(0);
  });
});
