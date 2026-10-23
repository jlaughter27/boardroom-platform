import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useSessionStore } from '../../src/stores/session.store';
import * as api from '../../src/lib/api';
import type { BoardRoomSSEEvent, PersonaResponse } from '@boardroom/shared';

/** M1-C2 — the store keeps `persona_error`, and Retry re-dispatches one advisor. */

vi.mock('../../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: unknown) { super(message); this.name = 'ApiError'; }
  },
  createSession: vi.fn(),
  streamSSE: vi.fn(),
  createSynthesisStream: vi.fn(),
}));
vi.mock('../../src/components/ui/Toast', () => ({ useToastStore: { getState: () => ({ addToast: vi.fn() }) } }));

type StreamEvent = BoardRoomSSEEvent & Record<string, unknown>;
async function* events(list: BoardRoomSSEEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of list) yield e as StreamEvent;
}

const critic: PersonaResponse = {
  personaId: 'critic', situationReading: 'r', keyAssumptions: [], analysis: 'a', recommendation: 'Wait',
  uncertainties: [], sourceMemoryIds: [], confidence: 0.6, dissentFlag: false,
};

beforeEach(() => {
  useSessionStore.getState().reset();
  useSessionStore.setState({ currentSession: { id: 's1', question: 'Hire?', mode: 'decide' } });
  vi.clearAllMocks();
});

describe('session store — failed advisors (M1-C2)', () => {
  it('persona_error is kept in personaErrors (it used to be dropped)', async () => {
    vi.mocked(api.streamSSE).mockReturnValue(events([
      { type: 'persona_start', personaId: 'critic', model: 'haiku' },
      { type: 'persona_error', personaId: 'critic', error: 'Persona response failed validation' },
      { type: 'dispatch_complete', personaCount: 0, durationMs: 1 },
    ]));
    await act(async () => { await useSessionStore.getState().dispatch(); });
    const s = useSessionStore.getState();
    expect(s.personaErrors).toEqual({ critic: 'Persona response failed validation' });
    expect(s.streamingPersonas.has('critic')).toBe(false);
    expect(s.isDispatching).toBe(false);
    expect(s.dispatchScope).toBeNull();
  });

  it('retryPersona posts { personaIds: [id] }, scopes the dispatch, and clears the error on success', async () => {
    useSessionStore.setState({ personaErrors: { critic: 'boom', doer: 'also boom' } });
    let scopeDuring: string[] | null = null;
    vi.mocked(api.streamSSE).mockImplementation(() => (async function* () {
      scopeDuring = useSessionStore.getState().dispatchScope;
      // The retried advisor's old error is gone as soon as the retry starts; others keep theirs.
      expect(useSessionStore.getState().personaErrors).toEqual({ doer: 'also boom' });
      yield { type: 'persona_start', personaId: 'critic', model: 'haiku' } as StreamEvent;
      yield { type: 'persona_complete', personaId: 'critic', response: critic } as StreamEvent;
      yield { type: 'dispatch_complete', personaCount: 1, durationMs: 1, rebuttalCount: 0 } as StreamEvent;
    })());

    await act(async () => { await useSessionStore.getState().retryPersona('critic'); });

    expect(api.streamSSE).toHaveBeenCalledWith('/api/sessions/s1/dispatch', 'POST', { personaIds: ['critic'] }, expect.any(AbortSignal));
    expect(scopeDuring).toEqual(['critic']);
    const s = useSessionStore.getState();
    expect(s.personaResponses.critic).toEqual(critic);
    expect(s.personaErrors).toEqual({ doer: 'also boom' });
    expect(s.dispatchScope).toBeNull();
  });

  it('a full dispatch sends no body and starts with no errors', async () => {
    useSessionStore.setState({ personaErrors: { critic: 'old' } });
    vi.mocked(api.streamSSE).mockReturnValue(events([{ type: 'dispatch_complete', personaCount: 0, durationMs: 1 }]));
    await act(async () => { await useSessionStore.getState().dispatch(); });
    expect(api.streamSSE).toHaveBeenCalledWith('/api/sessions/s1/dispatch', 'POST', undefined, expect.any(AbortSignal));
    expect(useSessionStore.getState().personaErrors).toEqual({});
  });

  it('synthesize records which advisors it ran without; reset clears it', async () => {
    vi.mocked(api.createSynthesisStream).mockReturnValue(events([]) as never);
    await act(async () => { await useSessionStore.getState().synthesize({ without: ['Critic'] }); });
    expect(useSessionStore.getState().synthesisWithout).toEqual(['Critic']);
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().synthesisWithout).toEqual([]);
    expect(useSessionStore.getState().personaErrors).toEqual({});
  });
});
