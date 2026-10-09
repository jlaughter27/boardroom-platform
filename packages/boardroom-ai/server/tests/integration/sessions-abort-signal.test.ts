/**
 * R-B-01 — client-disconnect AbortSignal must be wired to the RESPONSE.
 *
 * On Node >= 16 an IncomingMessage emits `close` as soon as its body has been
 * consumed. express.json() consumes the body of every JSON POST before the
 * route handler runs, so `req.on('close', abort)` produced a signal that was
 * ALREADY aborted when the orchestrator was invoked → every persona failed in
 * milliseconds with "Request was aborted". The fix listens on `res.on('close')`
 * and only aborts when the response did not finish normally.
 *
 * Boots the real sessions router over real HTTP (JSON body + express.json),
 * with the orchestrator / sufficiency stubbed to capture the signal.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const state = vi.hoisted(() => ({
  dispatch: {
    signal: undefined as AbortSignal | undefined,
    abortedAtInvoke: undefined as boolean | undefined,
    abortedAfterTick: undefined as boolean | undefined,
  },
  sufficiency: {
    signal: undefined as AbortSignal | undefined,
    abortedAtInvoke: undefined as boolean | undefined,
    abortedAfterTick: undefined as boolean | undefined,
  },
}));

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: { postLlmUsage: vi.fn(async () => ({ id: 'u', costUsd: 0 })) },
}));

vi.mock('../../src/agents/orchestrator', () => ({
  CEOOrchestrator: class {
    async dispatch(_session: unknown, res: express.Response, signal: AbortSignal): Promise<void> {
      state.dispatch.signal = signal;
      state.dispatch.abortedAtInvoke = signal.aborted;
      await new Promise<void>((resolve) => setImmediate(resolve)); // let any pending `close` fire
      state.dispatch.abortedAfterTick = signal.aborted;

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: {"type":"persona_start","personaId":"optimist"}\n\n');
      // Emulate a long-running LLM call that only ends when the client goes away.
      await new Promise<void>((resolve) => {
        if (signal.aborted) { resolve(); return; }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (!res.writableEnded) res.end();
    }
  },
}));

vi.mock('../../src/agents/sufficiency', () => ({
  checkSufficiency: async (question: string, _client: unknown, signal?: AbortSignal) => {
    state.sufficiency.signal = signal;
    state.sufficiency.abortedAtInvoke = signal?.aborted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    state.sufficiency.abortedAfterTick = signal?.aborted;
    return { score: 0.9, missingDimensions: [], suggestedQuestions: [], inferredIntent: question, canProceed: true };
  },
}));

import { sessionsRouter } from '../../src/routes/sessions.routes';

let server: Server;
let base = '';
const prevEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) { prevEnv[k] = process.env[k]; process.env[k] = v; }

beforeAll(async () => {
  setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  setEnv('JWT_SECRET', 'abort-signal-test');
  const app = express();
  app.use(express.json()); // the body consumer that triggers the request-side `close`
  app.use((req, _res, next) => { (req as any).auth = { userId: 'abort-u1', email: 'a@b.co', teamId: 't1' }; next(); });
  app.use('/sessions', sessionsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function createSession(): Promise<string> {
  const res = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Should we expand to Europe next quarter?', mode: 'decide' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).sessionId as string;
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

describe('R-B-01 — abortOnClose listens on the response, not the request', () => {
  it('POST /sessions/:id/dispatch with a JSON body: signal is NOT aborted when the orchestrator runs, and IS aborted when the client drops mid-stream', async () => {
    const id = await createSession();

    const ac = new AbortController();
    const res = await fetch(`${base}/sessions/${id}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({}), // a consumed JSON body is what used to pre-abort the signal
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    // Read the first SSE chunk so we know the stubbed orchestrator is running.
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('persona_start');

    expect(state.dispatch.signal).toBeInstanceOf(AbortSignal);
    expect(state.dispatch.abortedAtInvoke).toBe(false);
    expect(state.dispatch.abortedAfterTick).toBe(false);
    expect(state.dispatch.signal!.aborted).toBe(false);

    // Client disconnects mid-stream → socket destroyed → res 'close' with
    // writableFinished === false → the upstream work must be cancelled.
    ac.abort();
    reader.cancel().catch(() => {});
    expect(await waitFor(() => state.dispatch.signal!.aborted === true)).toBe(true);
  });

  it('POST /sessions/:id/check-ambiguity (plain JSON round-trip): signal stays un-aborted through a normal completion', async () => {
    const id = await createSession();
    const res = await fetch(`${base}/sessions/${id}/check-ambiguity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).score).toBe(0.9);

    expect(state.sufficiency.abortedAtInvoke).toBe(false);
    expect(state.sufficiency.abortedAfterTick).toBe(false);
    // The response finished normally (writableFinished) — the 'close' that
    // follows a completed response must NOT flip the signal.
    await new Promise((r) => setTimeout(r, 50));
    expect(state.sufficiency.signal!.aborted).toBe(false);
  });
});
