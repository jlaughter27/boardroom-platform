/**
 * M1-C2 — per-persona retry in CEOOrchestrator.dispatch.
 *
 * `{ personaIds: ['critic'] }` streams only the Critic, emits ZERO
 * `rebuttal_start` events (the debate round is never re-run on a retry),
 * records the Critic as a late advisor, rebuilds the ledger without an LLM
 * call, and tells the CEO about missing / late advisors. A context fetch that
 * throws becomes a `persona_error` instead of a silent hang.
 *
 * The Agent is a stub (no Anthropic calls): each persona answers with a fixed
 * PersonaResponse through the same SSE helper the real one uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonaId, PersonaResponse } from '@boardroom/shared';

const calls = vi.hoisted(() => ({ reason: [] as string[], rebut: [] as string[] }));

vi.mock('../../src/lib/prompt-loader', () => ({
  loadPrompt: () => 'persona prompt',
  loadSystemPrompt: () => 'rebuttal prompt',
}));
vi.mock('../../src/lib/anthropic-client', () => ({ createAnthropicClient: () => ({ messages: {} }) }));
vi.mock('../../src/tools', () => ({ toolRegistry: { getToolsForPersona: () => [], execute: vi.fn() } }));

vi.mock('../../src/agents/agent', async () => {
  const { sendSSE } = await import('../../src/agents/streaming');
  const answer = (personaId: string, recommendation: string, dissentFlag = false): PersonaResponse => ({
    personaId, situationReading: `${personaId} reads the room`, keyAssumptions: ['a'], analysis: `${personaId} analysis`,
    recommendation, uncertainties: ['u'], sourceMemoryIds: [], confidence: 0.7, dissentFlag,
  });
  const RECS: Record<string, PersonaResponse> = {
    optimist: answer('optimist', 'Move to per-seat pricing this quarter for growth'),
    critic: answer('critic', 'Do not switch; pilot a viewer tier with the two largest accounts first', true),
    alternate: answer('alternate', 'Move to per-seat pricing this quarter with a platform fee'),
    technician: answer('technician', 'Move to per-seat pricing this quarter once entitlements ship'),
  };
  return {
    Agent: class {
      constructor(private config: { id: string }) {}
      async reasonStreaming(_q: string, _ctx: unknown, res: any, personaId: PersonaId) {
        calls.reason.push(personaId);
        sendSSE(res, { type: 'persona_start', personaId, model: 'haiku' });
        sendSSE(res, { type: 'delta', personaId, text: '{"personaId":' });
        const response = RECS[personaId];
        sendSSE(res, { type: 'persona_complete', personaId, response });
        return response;
      }
      async rebut() {
        calls.rebut.push(this.config.id);
        return { personaId: this.config.id, stance: 'defend', reason: 'still right', revisedConfidence: 0.7 };
      }
    },
  };
});

import { CEOOrchestrator, formatAdvisorGapsForCEO, type SessionState } from '../../src/agents/orchestrator';

function fakeRes() {
  const events: Array<Record<string, any>> = [];
  const res: any = {
    writableEnded: false, destroyed: false,
    writeHead: vi.fn(),
    write: (chunk: string) => { for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6))); return true; },
    end: () => { res.writableEnded = true; },
  };
  return { res, events };
}

function omnimind(overrides: Record<string, unknown> = {}) {
  return {
    getCoreContext: vi.fn(async () => ({ block: 'core', hash: 'h', tokensEstimate: 1 })),
    getCustomPersonas: vi.fn(async () => []),
    getContextForPersona: vi.fn(async () => ({ items: [] })),
    ...overrides,
  } as any;
}

function session(): SessionState {
  return { id: 's1', userId: 'u1', question: 'Should we move to per-seat pricing?', mode: 'decide', personaResponses: new Map(), synthesis: null };
}

const types = (events: Array<Record<string, any>>, type: string) => events.filter((e) => e.type === type);

beforeEach(() => {
  calls.reason.length = 0;
  calls.rebut.length = 0;
  process.env.DEBATE_ROUND2 = 'true';
});

describe('CEOOrchestrator.dispatch — per-persona retry (M1-C2)', () => {
  it('control: a full dispatch runs the debate round (the dissenting Critic rebuts)', async () => {
    const om = omnimind();
    const s = session();
    const { res, events } = fakeRes();
    await new CEOOrchestrator(om, 'k').dispatch(s, res);
    expect(types(events, 'persona_start').map((e) => e.personaId).sort()).toEqual(['alternate', 'critic', 'optimist', 'technician']);
    expect(types(events, 'rebuttal_start').length).toBeGreaterThan(0);
    expect(calls.rebut.length).toBeGreaterThan(0);
  });

  it('{personaIds:["critic"]} emits persona_start only for the Critic and zero rebuttal_start events', async () => {
    const s = session();
    // The first dispatch lost the Critic (its context fetch failed).
    const failing = omnimind({
      getContextForPersona: vi.fn(async (req: { persona: string }) => { if (req.persona === 'critic') throw new Error('OmniMind 503'); return { items: [] }; }),
    });
    const first = fakeRes();
    await new CEOOrchestrator(failing, 'k').dispatch(s, first.res);
    expect(types(first.events, 'persona_error')).toEqual([expect.objectContaining({ personaId: 'critic', error: expect.stringContaining('OmniMind 503') })]);
    expect(s.personaResponses.has('critic')).toBe(false);
    calls.rebut.length = 0;
    const rebuttalsBefore = new Map(s.rebuttals);

    const om = omnimind();
    const retry = fakeRes();
    await new CEOOrchestrator(om, 'k').dispatch(s, retry.res, undefined, { personaIds: ['critic'] });

    expect(types(retry.events, 'persona_start').map((e) => e.personaId)).toEqual(['critic']);
    expect(types(retry.events, 'persona_complete').map((e) => e.personaId)).toEqual(['critic']);
    expect(types(retry.events, 'rebuttal_start')).toHaveLength(0);
    expect(calls.rebut).toHaveLength(0);
    expect(calls.reason).toContain('critic');
    expect(om.getContextForPersona).toHaveBeenCalledTimes(1);
    // The retry reuses the dispatch's core block instead of re-fetching it.
    expect(om.getCoreContext).not.toHaveBeenCalled();

    const done = types(retry.events, 'dispatch_complete')[0];
    expect(done).toMatchObject({ personaCount: 1, rebuttalCount: 0, retriedPersonaIds: ['critic'] });
    expect(retry.res.writableEnded).toBe(true);

    // State: the late Critic is recorded; earlier rebuttals stay; the ledger now includes the Critic.
    expect(s.personaResponses.has('critic')).toBe(true);
    expect(s.lateAdvisors).toEqual(['critic']);
    expect(s.rebuttals).toEqual(rebuttalsBefore);
    expect((s.ledger ?? []).some((row) => row.heldBy.includes('critic') || row.opposedBy.includes('critic'))).toBe(true);
  });

  it('a retried custom persona id is filtered to that persona only', async () => {
    const om = omnimind({
      getCustomPersonas: vi.fn(async () => [
        { personaId: 'custom_board', name: 'Board', isActive: true, modelTier: 'haiku', maxOutputTokens: 500, systemPrompt: 'x', toolPermissions: [] },
        { personaId: 'custom_other', name: 'Other', isActive: true, modelTier: 'haiku', maxOutputTokens: 500, systemPrompt: 'x', toolPermissions: [] },
      ]),
    });
    const { res, events } = fakeRes();
    await new CEOOrchestrator(om, 'k').dispatch(session(), res, undefined, { personaIds: ['custom_board'] });
    expect(types(events, 'persona_start').map((e) => e.personaId)).toEqual(['custom_board']);
    expect(types(events, 'rebuttal_start')).toHaveLength(0);
  });
});

describe('formatAdvisorGapsForCEO', () => {
  it('names missing and late advisors for the CEO, and is empty when everyone answered on time', () => {
    const s = session();
    const r = (id: string) => ({ personaId: id } as PersonaResponse);
    s.personaResponses = new Map([['optimist', r('optimist')], ['alternate', r('alternate')], ['technician', r('technician')]]);
    expect(formatAdvisorGapsForCEO(s)).toContain('The Critic: failed, no answer');

    s.personaResponses.set('critic', r('critic'));
    s.lateAdvisors = ['critic'];
    const text = formatAdvisorGapsForCEO(s);
    expect(text).not.toContain('without a response');
    expect(text).toContain('Late advisors');
    expect(text).toContain('The Critic: not rebutted');

    s.lateAdvisors = [];
    expect(formatAdvisorGapsForCEO(s)).toBe('');
  });
});
