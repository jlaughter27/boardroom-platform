import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useSessionStore, applyRebuttalEvent } from '../../src/stores/session.store';
import * as api from '../../src/lib/api';
import type { Decision, PersonaResponse } from '@boardroom/shared';

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

async function* events(list: Record<string, unknown>[]) {
  for (const e of list) yield e as never;
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
    ]) as never);

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
    ]) as never);
    await act(async () => { await useSessionStore.getState().dispatch(); });
    expect(useSessionStore.getState().rebuttingPersonas.has('technician')).toBe(true);
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
