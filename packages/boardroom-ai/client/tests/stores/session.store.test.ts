import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useSessionStore, applyRebuttalEvent } from '../../src/stores/session.store';
import * as api from '../../src/lib/api';
import type { BoardRoomSSEEvent, Decision, PersonaResponse } from '@boardroom/shared';

vi.mock('../../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: unknown) { super(message); this.name = 'ApiError'; }
  },
  createSession: vi.fn(),
  streamSSE: vi.fn(),
  createSynthesisStream: vi.fn(),
  commitDecision: vi.fn(),
  checkAmbiguity: vi.fn(),
  runSimulation: vi.fn(),
  getDecisions: vi.fn(),
}));

const addToast = vi.fn();
vi.mock('../../src/components/ui/Toast', () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

const critic: PersonaResponse = {
  personaId: 'critic',
  situationReading: 'r',
  keyAssumptions: [],
  analysis: 'a',
  recommendation: 'Do not hire yet',
  uncertainties: [],
  sourceMemoryIds: ['m1'],
  confidence: 0.6,
  dissentFlag: true,
};

/** Typed SSE fixture — events are checked against the shared wire union, then widened to the generator's shape. */
type StreamEvent = BoardRoomSSEEvent & Record<string, unknown>;
async function* events(list: BoardRoomSSEEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of list) yield e as StreamEvent;
}

describe('applyRebuttalEvent', () => {
  it('tracks rebuttal_start in rebuttingPersonas', () => {
    const next = applyRebuttalEvent({ rebuttingPersonas: new Set(), rebuttals: {} }, { type: 'rebuttal_start', personaId: 'critic' });
    expect([...next.rebuttingPersonas]).toEqual(['critic']);
    expect(next.rebuttals).toEqual({});
  });

  it('moves a persona from rebutting to rebuttals on rebuttal_complete (type stripped)', () => {
    const next = applyRebuttalEvent(
      { rebuttingPersonas: new Set(['critic']), rebuttals: {} },
      { type: 'rebuttal_complete', personaId: 'critic', stance: 'concede', reason: 'The data changed', revisedRecommendation: 'Hire', revisedConfidence: 0.7 },
    );
    expect(next.rebuttingPersonas.size).toBe(0);
    expect(next.rebuttals.critic).toEqual({ personaId: 'critic', stance: 'concede', reason: 'The data changed', revisedRecommendation: 'Hire', revisedConfidence: 0.7 });
    expect('type' in next.rebuttals.critic).toBe(false);
  });
});

describe('applyRebuttalEvent — rebuttal_error', () => {
  it('clears the rebutting flag and keeps the round-1 position', () => {
    const next = applyRebuttalEvent(
      { rebuttingPersonas: new Set(['critic', 'doer']), rebuttals: {} },
      { type: 'rebuttal_error', personaId: 'critic', error: 'timeout' },
    );
    expect([...next.rebuttingPersonas]).toEqual(['doer']);
    expect(next.rebuttals).toEqual({});
  });
});

describe('useSessionStore debate + commit', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    useSessionStore.setState({ currentSession: { id: 's1', question: 'Should we hire?', mode: 'decide' } });
    vi.clearAllMocks();
  });

  it('handles rebuttal events and the extended synthesis report on the dispatch stream', async () => {
    vi.mocked(api.streamSSE).mockReturnValue(events([
      { type: 'persona_start', personaId: 'critic', model: 'haiku' },
      { type: 'persona_complete', personaId: 'critic', response: critic },
      { type: 'rebuttal_start', personaId: 'critic' },
      { type: 'rebuttal_complete', personaId: 'critic', stance: 'defend', reason: 'Still too early', revisedConfidence: 0.65 },
      {
        type: 'synthesis_complete',
        qualityScore: 0.8,
        report: {
          disagreementMap: '', decisiveTradeoff: '', recommendation: 'Wait a quarter', nextActions: [], topRisks: [],
          assumptionsToMonitor: [], sourceMemoryIds: [],
          ledgerResolutions: [{ claim: 'Runway is short', resolution: 'Confirmed: 9 months' }],
          droppedConsiderations: ['m1'],
        },
      },
      { type: 'dispatch_complete', personaCount: 1, durationMs: 10 },
    ]));

    await act(async () => { await useSessionStore.getState().dispatch(); });

    const s = useSessionStore.getState();
    expect(s.personaResponses.critic).toEqual(critic);
    expect(s.rebuttingPersonas.size).toBe(0);
    expect(s.rebuttals.critic?.stance).toBe('defend');
    expect(s.rebuttals.critic?.reason).toBe('Still too early');
    expect(s.synthesis?.ledgerResolutions).toHaveLength(1);
    expect(s.synthesis?.droppedConsiderations).toEqual(['m1']);
    expect(s.isDispatching).toBe(false);
  });

  it('keeps a persona in rebuttingPersonas while its rebuttal is in flight', async () => {
    vi.mocked(api.streamSSE).mockReturnValue(events([
      { type: 'rebuttal_start', personaId: 'technician' },
    ]));
    await act(async () => { await useSessionStore.getState().dispatch(); });
    expect(useSessionStore.getState().rebuttingPersonas.has('technician')).toBe(true);
  });

  it('an error event followed by the stream closing clears isDispatching', async () => {
    vi.mocked(api.streamSSE).mockReturnValue(events([
      { type: 'persona_start', personaId: 'critic', model: 'haiku' },
      { type: 'error', error: 'upstream exploded' },
    ]));
    await act(async () => { await useSessionStore.getState().dispatch(); });
    const s = useSessionStore.getState();
    expect(s.error).toBe('upstream exploded');
    expect(s.isDispatching).toBe(false);
    expect(s.abortController).toBeNull();
  });

  it('commitDecision adopts the existing decision on 409 already_decided', async () => {
    const existing = { id: 'd9', chosenPath: 'Wait', status: 'DECIDED' } as unknown as Decision;
    vi.mocked(api.commitDecision).mockRejectedValue(new api.ApiError('This session already committed a decision', 409, { error: 'already_decided', decisionId: 'd9' }));
    vi.mocked(api.getDecisions).mockResolvedValue([{ id: 'other' } as Decision, existing]);

    let result: Decision | null = null;
    await act(async () => {
      result = await useSessionStore.getState().commitDecision({ chosenPath: 'Wait', expectedOutcome: 'x', probabilitySuccess: 0.5 });
    });

    expect(result).toEqual(existing);
    const s = useSessionStore.getState();
    expect(s.committedDecision).toEqual(existing);
    expect(s.isCommitting).toBe(false);
    expect(s.error).toBeNull();
    expect(addToast).toHaveBeenCalledWith('This session already committed a decision', 'info');
  });

  it('commitDecision falls back to the error path when the 409 body has no decisionId', async () => {
    vi.mocked(api.commitDecision).mockRejectedValue(new api.ApiError('conflict', 409, { error: 'already_decided' }));
    let result: Decision | null = null;
    await act(async () => {
      result = await useSessionStore.getState().commitDecision({ chosenPath: 'Wait', expectedOutcome: 'x', probabilitySuccess: 0.5 });
    });
    expect(result).toBeNull();
    expect(api.getDecisions).not.toHaveBeenCalled();
    expect(useSessionStore.getState().errorStatus).toBe(409);
  });

  it('commitDecision posts to the session and stores the decision', async () => {
    const decision = { id: 'd1', chosenPath: 'Wait', expectedOutcome: 'Cash stays > 6 mo', probabilitySuccess: 0.7, status: 'DECIDED' } as unknown as Decision;
    vi.mocked(api.commitDecision).mockResolvedValue(decision);

    let result: Decision | null = null;
    await act(async () => {
      result = await useSessionStore.getState().commitDecision({
        chosenPath: 'Wait', expectedOutcome: 'Cash stays > 6 mo', probabilitySuccess: 0.7, reviewAt: '2026-11-01T09:00:00.000Z',
      });
    });

    expect(api.commitDecision).toHaveBeenCalledWith('s1', {
      chosenPath: 'Wait', expectedOutcome: 'Cash stays > 6 mo', probabilitySuccess: 0.7, reviewAt: '2026-11-01T09:00:00.000Z',
    });
    expect(result).toEqual(decision);
    expect(useSessionStore.getState().committedDecision).toEqual(decision);
    expect(useSessionStore.getState().isCommitting).toBe(false);
    expect(addToast).toHaveBeenCalledWith('Decision committed', 'success');
  });

  it('commitDecision surfaces errors and returns null', async () => {
    vi.mocked(api.commitDecision).mockRejectedValue(new Error('expectedOutcome is required'));
    let result: Decision | null = null;
    await act(async () => {
      result = await useSessionStore.getState().commitDecision({ chosenPath: 'x', expectedOutcome: '', probabilitySuccess: 0.5 });
    });
    expect(result).toBeNull();
    expect(useSessionStore.getState().error).toBe('expectedOutcome is required');
    expect(useSessionStore.getState().committedDecision).toBeNull();
  });

  it('reset clears debate + commit state', () => {
    useSessionStore.setState({ rebuttals: { critic: { personaId: 'critic', stance: 'defend', reason: 'r', revisedConfidence: 0.5 } }, rebuttingPersonas: new Set(['critic']), committedDecision: { id: 'd' } as Decision });
    useSessionStore.getState().reset();
    const s = useSessionStore.getState();
    expect(s.rebuttals).toEqual({});
    expect(s.rebuttingPersonas.size).toBe(0);
    expect(s.committedDecision).toBeNull();
  });
});

describe('useSessionStore — token deltas reach the store once per frame (M1-C1)', () => {
  let frames: Array<() => void> = [];
  beforeEach(() => {
    useSessionStore.getState().reset();
    useSessionStore.setState({ currentSession: { id: 's1', question: 'Should we hire?', mode: 'decide' } });
    vi.clearAllMocks();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(() => cb(0)); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', (h: number) => { frames[h - 1] = () => {}; });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const runFrames = () => { const due = frames; frames = []; for (const f of due) f(); };

  it('200 deltas in one frame produce at most 2 personaStreaming updates, with every character kept', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const chunks = Array.from({ length: 200 }, (_, i) => `t${i} `);
    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'persona_start', personaId: 'optimist', model: 'haiku' } as StreamEvent;
      for (const text of chunks) yield { type: 'delta', personaId: 'optimist', text } as StreamEvent;
      await hold;
      yield { type: 'dispatch_complete', personaCount: 0, durationMs: 1 } as StreamEvent;
    }
    vi.mocked(api.streamSSE).mockReturnValue(stream());

    let updates = 0;
    const unsubscribe = useSessionStore.subscribe((next, prev) => {
      if (next.personaStreaming.optimist !== prev.personaStreaming.optimist) updates += 1;
    });

    const run = useSessionStore.getState().dispatch();
    // Let the generator drain all 201 events (microtasks only: no frame has run).
    for (let i = 0; i < 1000; i++) await Promise.resolve();
    expect(useSessionStore.getState().personaStreaming.optimist).toBe('');
    updates = 0; // persona_start's reset to '' is not a delta update

    runFrames();
    expect(updates).toBeLessThanOrEqual(2);
    expect(useSessionStore.getState().personaStreaming.optimist).toBe(chunks.join(''));

    release();
    await act(async () => { await run; });
    unsubscribe();
  });

  it('flushes buffered deltas when the persona completes or the stream closes, and reset discards them', async () => {
    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'persona_start', personaId: 'critic', model: 'haiku' } as StreamEvent;
      yield { type: 'delta', personaId: 'critic', text: '{"personaId":"critic",' } as StreamEvent;
      yield { type: 'persona_complete', personaId: 'critic', response: critic } as StreamEvent;
      yield { type: 'persona_start', personaId: 'doer', model: 'haiku' } as StreamEvent;
      yield { type: 'delta', personaId: 'doer', text: 'late' } as StreamEvent;
    }
    vi.mocked(api.streamSSE).mockReturnValue(stream());
    await act(async () => { await useSessionStore.getState().dispatch(); });
    expect(useSessionStore.getState().personaStreaming.critic).toBe('{"personaId":"critic",');
    expect(useSessionStore.getState().personaStreaming.doer).toBe('late');

    async function* stale(): AsyncGenerator<StreamEvent> {
      yield { type: 'persona_start', personaId: 'doer', model: 'haiku' } as StreamEvent;
      yield { type: 'delta', personaId: 'doer', text: 'stale' } as StreamEvent;
      await new Promise(() => {});
    }
    vi.mocked(api.streamSSE).mockReturnValue(stale());
    void useSessionStore.getState().dispatch();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    useSessionStore.getState().reset();
    runFrames();
    expect(useSessionStore.getState().personaStreaming).toEqual({});
  });
});
