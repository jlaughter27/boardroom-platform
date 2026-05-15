/**
 * Track C — Wave 2 critical-path test (CEOOrchestrator).
 *
 * The audit calls out orchestrator.ts (331 LOC) as having ZERO tests
 * despite being "the product". This file establishes the regression
 * baseline for persona dispatch + synthesis.
 *
 * Strategy: mock the `Agent` class, `loadPrompt`, `toolRegistry`, and
 * an OmniMindClient stub so we can deterministically assert dispatch
 * behaviour without touching the Anthropic API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PersonaResponse, UserMode } from '@boardroom/shared';

// ─── Mocks ─────────────────────────────────────────────────────────────

const personaCalls: string[] = [];
const reasonStreamingMock = vi.fn();
const reasonWithToolsMock = vi.fn();

vi.mock('../../src/agents/agent', () => {
  return {
    Agent: class {
      constructor(public config: any, _client: any, public prompt: string) {
        personaCalls.push(config.id ?? 'unknown');
      }
      reasonStreaming = reasonStreamingMock;
      reasonWithTools = reasonWithToolsMock;
    },
  };
});

vi.mock('../../src/lib/prompt-loader', () => ({
  loadPrompt: vi.fn((personaId: string) => `System prompt for ${personaId}`),
}));

vi.mock('../../src/tools', () => ({
  toolRegistry: {
    getToolsForPersona: vi.fn(() => []), // no tools by default
    execute: vi.fn(),
  },
}));

vi.mock('../../src/agents/streaming', () => ({
  initSSE: vi.fn(),
  sendSSE: vi.fn((res: any, event: any) => {
    if (res.__events) res.__events.push(event);
  }),
}));

// ─── Helpers ───────────────────────────────────────────────────────────

function makePersonaResponse(personaId: string, overrides: Partial<PersonaResponse> = {}): PersonaResponse {
  return {
    personaId: personaId as any,
    situationReading: `reading-${personaId}`,
    keyAssumptions: ['a1'],
    analysis: `analysis-${personaId}`,
    recommendation: `rec-${personaId}`,
    uncertainties: ['u1'],
    sourceMemoryIds: [],
    confidence: 0.7,
    dissentFlag: false,
    ...overrides,
  };
}

function makeMockRes(): Response & { __events: any[] } {
  const events: any[] = [];
  const res: any = {
    __events: events,
    write: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response & { __events: any[] };
}

function makeMockOmnimind() {
  return {
    getContextForPersona: vi.fn().mockResolvedValue({ items: [] }),
    getCustomPersonas: vi.fn().mockResolvedValue([]),
    getDecisions: vi.fn().mockResolvedValue({ items: [] }),
    getPatterns: vi.fn().mockResolvedValue({ items: [] }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('CEOOrchestrator.dispatch', () => {
  let CEOOrchestrator: typeof import('../../src/agents/orchestrator').CEOOrchestrator;

  beforeEach(async () => {
    personaCalls.length = 0;
    vi.clearAllMocks();
    reasonStreamingMock.mockReset();
    reasonWithToolsMock.mockReset();
    const mod = await import('../../src/agents/orchestrator');
    CEOOrchestrator = mod.CEOOrchestrator;
  });

  function makeSession(mode: UserMode) {
    return {
      id: 'sess-1',
      userId: 'user-1',
      question: 'Should we ship Friday?',
      mode,
      personaResponses: new Map(),
      synthesis: null,
    };
  }

  it('routes mode "decide" to optimist + critic + alternate + technician', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) =>
      Promise.resolve(makePersonaResponse(pid)),
    );
    const omnimind = makeMockOmnimind();
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('decide');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    // The Agent is constructed once per persona — and the persona id
    // comes from PERSONA_CONFIGS keyed by personaId.
    expect(reasonStreamingMock).toHaveBeenCalledTimes(4);
    const dispatched = reasonStreamingMock.mock.calls.map((c) => c[3]);
    expect(dispatched.sort()).toEqual(['alternate', 'critic', 'optimist', 'technician']);
    expect(session.personaResponses.size).toBe(4);
  });

  it('routes mode "stress-test" to critic + alternate + technician only', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) =>
      Promise.resolve(makePersonaResponse(pid)),
    );
    const omnimind = makeMockOmnimind();
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('stress-test');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    const dispatched = reasonStreamingMock.mock.calls.map((c) => c[3]);
    expect(dispatched.sort()).toEqual(['alternate', 'critic', 'technician']);
  });

  it('routes mode "plan" to technician + doer', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) =>
      Promise.resolve(makePersonaResponse(pid)),
    );
    const omnimind = makeMockOmnimind();
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('plan');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    const dispatched = reasonStreamingMock.mock.calls.map((c) => c[3]);
    expect(dispatched.sort()).toEqual(['doer', 'technician']);
  });

  it('routes mode "clarify" to questionnaire only (no CEO)', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) =>
      Promise.resolve(makePersonaResponse(pid)),
    );
    const omnimind = makeMockOmnimind();
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('clarify');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    const dispatched = reasonStreamingMock.mock.calls.map((c) => c[3]);
    expect(dispatched).toEqual(['questionnaire']);
  });

  it('continues dispatch when one persona throws (Promise.allSettled semantics)', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) => {
      if (pid === 'critic') return Promise.reject(new Error('LLM exploded'));
      return Promise.resolve(makePersonaResponse(pid));
    });
    const omnimind = makeMockOmnimind();
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('decide');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    // critic fails -> only 3 responses recorded, but no throw bubbles up
    expect(session.personaResponses.size).toBe(3);
    expect(session.personaResponses.has('critic' as any)).toBe(false);
    expect(res.end).toHaveBeenCalled();
  });

  it('falls back to built-in personas when getCustomPersonas() throws', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) =>
      Promise.resolve(makePersonaResponse(pid)),
    );
    const omnimind = makeMockOmnimind();
    omnimind.getCustomPersonas.mockRejectedValue(new Error('OmniMind down'));
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('decide');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    expect(session.personaResponses.size).toBe(4);
    expect(res.end).toHaveBeenCalled();
  });

  it('emits a dispatch_complete SSE event with the persona count', async () => {
    reasonStreamingMock.mockImplementation((_q, _ctx, _res, pid: string) =>
      Promise.resolve(makePersonaResponse(pid)),
    );
    const omnimind = makeMockOmnimind();
    const orch = new CEOOrchestrator(omnimind as any, 'fake-key');
    const session = makeSession('plan');
    const res = makeMockRes();

    await orch.dispatch(session, res);

    const completeEvent = res.__events.find((e: any) => e.type === 'dispatch_complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent.personaCount).toBe(2);
    expect(typeof completeEvent.durationMs).toBe('number');
  });
});
