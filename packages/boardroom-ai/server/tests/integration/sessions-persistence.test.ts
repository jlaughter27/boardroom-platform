/**
 * RD-17 — the real sessions router over HTTP with an in-memory OmniMind fake:
 * create → dispatch (round-1 hook + end-of-dispatch write) → "restart" (the
 * cache is dropped) → GET reloads from OmniMind → decide links the decision to
 * the persisted session. Plus: another user's id is a 404 after a restart, and
 * an OmniMind outage at create keeps the session working from memory.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const fake = vi.hoisted(() => {
  const rows = new Map<string, any>();
  const state = { down: false, seq: 0 };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const notFound = () => Object.assign(new Error('OmniMind: 404'), { status: 404 });
  const offline = () => Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
  return {
    rows, state,
    client: {
      postLlmUsage: async () => ({ id: 'u', costUsd: 0 }),
      getCustomPersonas: async () => [],
      linkProjectDecision: async () => ({}),
      createDecision: vi.fn(async (_u: string, input: Record<string, unknown>) => ({ id: 'cdecision000000000000042', ...input })),
      createDecisionSession: vi.fn(async (userId: string, body: Record<string, unknown>) => {
        if (state.down) throw offline();
        const now = new Date().toISOString();
        const id = `cpersisted${String(++state.seq).padStart(15, '0')}`;
        const row = { id, userId, roomId: null, mode: null, status: 'OPEN', personaResponses: {}, ceoSynthesis: null, state: null, decisionId: null, ...clone(body), createdAt: now, updatedAt: now };
        rows.set(id, row);
        return clone(row);
      }),
      getDecisionSession: vi.fn(async (userId: string, id: string) => {
        if (state.down) throw offline();
        const row = rows.get(id);
        if (!row || row.userId !== userId) throw notFound();
        return clone(row);
      }),
      updateDecisionSession: vi.fn(async (userId: string, id: string, body: Record<string, unknown>) => {
        if (state.down) throw offline();
        const row = rows.get(id);
        if (!row || row.userId !== userId) throw notFound();
        Object.assign(row, clone(body), { updatedAt: new Date().toISOString() });
        return clone(row);
      }),
      listDecisionSessions: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
    },
  };
});

vi.mock('../../src/services/omnimind-client', () => ({ omnimindClient: fake.client }));

const RESPONSE = {
  personaId: 'optimist', situationReading: 'r', keyAssumptions: [], analysis: 'a', recommendation: 'Open in March',
  uncertainties: [], sourceMemoryIds: [], confidence: 0.7, dissentFlag: false,
};

vi.mock('../../src/agents/orchestrator', () => ({
  CEOOrchestrator: class {
    async dispatch(session: any, res: express.Response, _signal: AbortSignal, options: { onRoundComplete?: () => void }): Promise<void> {
      session.personaResponses.set('optimist', RESPONSE);
      session.personaResponses.set('critic', { ...RESPONSE, personaId: 'critic', recommendation: 'Wait', dissentFlag: true });
      options.onRoundComplete?.();
      session.ledger = [{ claim: 'timing', heldBy: ['optimist'], opposedBy: ['critic'], citedMemoryIds: [] }];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"dispatch_complete","personaCount":2,"durationMs":1}\n\n');
      res.end();
    }
  },
}));

import { sessionsRouter, sessionStore } from '../../src/routes/sessions.routes';

let server: Server;
let base = '';
let currentUser = 'persist-u1';
const prev = process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: currentUser, email: `${currentUser}@example.com`, teamId: 't1' }; next(); });
  app.use('/sessions', sessionsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* SSE */ }
  return { status: res.status, json, text };
}

describe('Decision Lab sessions survive a BoardRoom restart (RD-17)', () => {
  it('create → dispatch → restart → reload → decide links the decision', async () => {
    currentUser = 'persist-u1';
    const created = await call('POST', '/sessions', { question: 'Open a second market stall?', mode: 'decide' });
    expect(created.status).toBe(201);
    const id = created.json.sessionId as string;
    expect(id).toMatch(/^cpersisted/);

    const dispatched = await call('POST', `/sessions/${id}/dispatch`);
    expect(dispatched.status).toBe(200);
    await sessionStore.flushAll();
    expect(fake.rows.get(id)).toMatchObject({ status: 'DISPATCHED', state: { ledger: [{ claim: 'timing' }] } });
    expect(Object.keys(fake.rows.get(id).personaResponses)).toEqual(['optimist', 'critic']);

    sessionStore.clearCache(); // the restart

    const reloaded = await call('GET', `/sessions/${id}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.json).toMatchObject({
      id, question: 'Open a second market stall?', mode: 'decide', decisionId: null,
      ledger: [{ claim: 'timing', heldBy: ['optimist'], opposedBy: ['critic'] }],
    });
    expect(Object.keys(reloaded.json.personaResponses)).toEqual(['optimist', 'critic']);

    const decided = await call('POST', `/sessions/${id}/decide`, { chosenPath: 'Open in March', expectedOutcome: 'Pitch fee covered by week 6', probabilitySuccess: 0.6 });
    expect(decided.status).toBe(201);
    expect(fake.client.createDecision).toHaveBeenCalledWith('persist-u1', expect.objectContaining({ sessionId: null, decisionSessionId: id }));
    await sessionStore.flushAll();
    expect(fake.rows.get(id)).toMatchObject({ status: 'DECIDED', state: { decisionId: 'cdecision000000000000042' } });
  });

  it('after a restart another user gets 404 for the id', async () => {
    currentUser = 'persist-u2';
    const id = (await call('POST', '/sessions', { question: 'Private question', mode: 'decide' })).json.sessionId;
    sessionStore.clearCache();
    currentUser = 'persist-intruder';
    expect((await call('GET', `/sessions/${id}`)).status).toBe(404);
    currentUser = 'persist-u2';
    expect((await call('GET', `/sessions/${id}`)).status).toBe(200);
  });

  it('OmniMind down at create → the session works from memory and commits without a session link', async () => {
    currentUser = 'persist-u3';
    fake.state.down = true;
    try {
      const id = (await call('POST', '/sessions', { question: 'Offline question', mode: 'decide' })).json.sessionId as string;
      expect(id).toMatch(/^session_\d+_\d+$/);
      expect((await call('POST', `/sessions/${id}/dispatch`)).status).toBe(200);
      expect((await call('GET', `/sessions/${id}`)).json.personaResponses).toHaveProperty('critic');
      fake.client.createDecision.mockClear();
      const decided = await call('POST', `/sessions/${id}/decide`, { chosenPath: 'Wait', expectedOutcome: 'x', probabilitySuccess: 0.5 });
      expect(decided.status).toBe(201);
      expect(fake.client.createDecision.mock.calls[0][1]).toMatchObject({ decisionSessionId: null });
    } finally {
      fake.state.down = false;
    }
  });
});
