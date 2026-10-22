// Streaming decision-session fixtures (Phase 8 Lane C: M1-C1 / M1-C2).
//
// A dispatch SSE script built from the real persona responses in pages.mjs:
// each persona's JSON is cut into small deltas exactly as the server sends
// them (`delta {personaId, text}`), then `persona_complete` with the parsed
// object, or `persona_error`. Times are deterministic (no randomness) so the
// shots and the CLS check (tests/e2e/live/checks/cls.mjs) replay the same run.
//
// Scenarios:
//   full  — all four `decide` advisors finish; the dissenting Critic rebuts; dispatch_complete.
//   mid   — Optimist done, Critic failed, Alternate / Technician part-way; the stream then stays open.
//   error — Optimist, Alternate, Technician finish; the Critic fails; dispatch_complete.
//   retry — `{personaIds:['critic']}`: only the Critic streams and finishes (no rebuttal events).
//
// Mock routes (mounted by shoot-pages.mjs through mock-api.mjs's `sse` support):
//   GET  /sessions/s-stream | s-stream-error           → an undispatched `decide` session
//   POST /sessions/s-stream/dispatch                    → `mid`
//   POST /sessions/s-stream-error/dispatch              → `error`, or `retry` when the body names personaIds
//   POST /sessions (question)                           → s-stream (used by the standalone CLS run)

import { personaResponses } from './pages.mjs';

export const STREAM_QUESTION = 'Should we move from usage-based to per-seat pricing before the Q1 renewals?';
export const DECIDE_PERSONAS = ['optimist', 'critic', 'alternate', 'technician'];
export const PERSONA_ERROR = 'Persona response failed validation: analysis is required';

const CHUNKS = [7, 11, 5, 13, 9, 6, 12, 8];

/** Cut `text` into delta-sized pieces (deterministic sizes). */
export function chunk(text) {
  const out = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const n = CHUNKS[k % CHUNKS.length];
    out.push(text.slice(i, i + n));
    i += n;
    k += 1;
  }
  return out;
}

/**
 * Build `[{ at, event }]` (ms from the start of the stream) for a scenario.
 * `tickMs` is the gap between one persona's deltas.
 */
export function dispatchScript(scenario = 'full', { tickMs = 22 } = {}) {
  const events = [];
  const push = (at, event) => events.push({ at: Math.round(at), event });
  const personas = scenario === 'retry' ? ['critic'] : DECIDE_PERSONAS;
  let last = 0;

  personas.forEach((personaId, p) => {
    const start = 60 + p * 45;
    push(start, { type: 'persona_start', personaId, model: 'haiku' });
    const response = personaResponses[personaId];
    const pieces = chunk(JSON.stringify(response));
    const fails = (scenario === 'mid' || scenario === 'error') && personaId === 'critic';
    // mid: Alternate and Technician stop part-way and the stream stays open.
    const stopAt = scenario === 'mid' && personaId === 'alternate' ? 0.55
      : scenario === 'mid' && personaId === 'technician' ? 0.35
      : fails ? 0.12
      : 1;
    // Optimist finishes quickly in `mid` so the shot holds a finished card.
    const gap = scenario === 'mid' && personaId === 'optimist' ? tickMs / 3 : tickMs;
    const count = Math.ceil(pieces.length * stopAt);
    for (let i = 0; i < count; i++) push(start + 20 + i * gap, { type: 'delta', personaId, text: pieces[i] });
    const end = start + 20 + count * gap + 30;
    if (fails) push(end, { type: 'persona_error', personaId, error: PERSONA_ERROR });
    else if (stopAt === 1) push(end, { type: 'persona_complete', personaId, response });
    last = Math.max(last, end);
  });

  if (scenario === 'mid') return { events: events.sort((a, b) => a.at - b.at), hold: true };

  if (scenario === 'full') {
    push(last + 120, { type: 'rebuttal_start', personaId: 'critic' });
    push(last + 900, {
      type: 'rebuttal_complete', personaId: 'critic', stance: 'defend',
      reason: 'The two largest accounts still carry the most revenue at risk; nothing the others said changes that.',
      revisedConfidence: 0.7,
    });
    last += 900;
  }
  push(last + 80, { type: 'dispatch_complete', personaCount: personas.length - (scenario === 'error' ? 1 : 0), durationMs: last + 80, rebuttalCount: scenario === 'full' ? 1 : 0 });
  return { events: events.sort((a, b) => a.at - b.at), hold: false };
}

/** Play a script into `write(event)`; resolves when done, or when `signal` aborts (held streams wait for it). */
export async function playScript({ events, hold }, write, signal) {
  const t0 = Date.now();
  for (const { at, event } of events) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (signal?.aborted) return;
    write(event);
  }
  if (hold) await new Promise((r) => { if (signal?.aborted) r(); else signal?.addEventListener('abort', r, { once: true }); });
}

const NOW = Date.now();
const undispatched = (id) => ({
  id, question: STREAM_QUESTION, mode: 'decide', personaResponses: {}, ceoSynthesis: null,
  sufficiencyScore: null, decisionId: null, createdAt: new Date(NOW - 60_000).toISOString(),
});

/** An `sse` mock response that plays `script` until the client goes away. */
const sse = (script) => ({
  sse: (write, _req, res) => {
    // Listen on the response: a request emits `close` as soon as its body is read.
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    return playScript(script, write, ac.signal);
  },
});

export default {
  routes: [
    { method: 'GET', path: '/sessions/s-stream', handler: () => ({ body: undispatched('s-stream') }) },
    { method: 'GET', path: '/sessions/s-stream-error', handler: () => ({ body: undispatched('s-stream-error') }) },
    { method: 'POST', path: '/sessions/s-stream/dispatch', handler: () => sse(dispatchScript('mid')) },
    {
      method: 'POST', path: '/sessions/s-stream-error/dispatch',
      handler: (req) => sse(dispatchScript(Array.isArray(req.json?.personaIds) ? 'retry' : 'error')),
    },
    {
      method: 'POST', path: '/sessions',
      handler: (req) => ({ status: 201, body: { sessionId: 's-stream', question: req.json?.question ?? STREAM_QUESTION, mode: req.json?.mode ?? 'decide', personasToFire: DECIDE_PERSONAS, includesCEO: true } }),
    },
  ],
};
