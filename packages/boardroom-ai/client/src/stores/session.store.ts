import { create } from 'zustand';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import type { PersonaResponse, SynthesisReport, SimulationResult } from '@boardroom/shared';
import type { SufficiencyScore, UserMode, BoardRoomSSEEvent } from '@boardroom/shared';
import { useToastStore } from '../components/ui/Toast';

interface SessionState {
  currentSession: { id: string; question: string; mode: UserMode } | null;
  personaResponses: Record<string, PersonaResponse>;
  personaStreaming: Record<string, string>;
  streamingPersonas: Set<string>;
  synthesis: SynthesisReport | null;
  synthesisStreaming: string;
  isDispatching: boolean;
  isSynthesizing: boolean;
  sufficiency: SufficiencyScore | null;
  simulation: SimulationResult | null;
  isSimulating: boolean;
  /** Controller for whichever SSE stream (dispatch or synthesis) is in flight. */
  abortController: AbortController | null;
  error: string | null;
  /** HTTP status behind `error`, when it came from the API (402 → upgrade CTA, 503 → at capacity). */
  errorStatus: number | null;

  clearError: () => void;
  createSession: (question: string, mode: UserMode) => Promise<void>;
  dispatch: () => Promise<void>;
  synthesize: () => Promise<void>;
  checkAmbiguity: () => Promise<void>;
  runSimulation: (chosenPath: string) => Promise<void>;
  reset: () => void;
}

// SSE dispatch events may include personaId on delta (server extension)
type DispatchEvent = BoardRoomSSEEvent & Record<string, unknown>;

/**
 * Map an error to a user-facing message + status (C-104). OmniMind 4xx now
 * pass through with their real status instead of a blanket 502.
 */
export function describeSessionError(err: unknown, fallback: string): { message: string; status: number | null } {
  if (err instanceof ApiError) {
    if (err.status === 402) {
      return { message: 'Your plan does not include this — upgrade to continue running decisions.', status: 402 };
    }
    if (err.status === 503) {
      return { message: 'BoardRoom is at capacity right now. Please try again in a moment.', status: 503 };
    }
    return { message: err.message || fallback, status: err.status };
  }
  return { message: err instanceof Error ? err.message : fallback, status: null };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const useSessionStore = create<SessionState>((set, get) => ({
  currentSession: null,
  personaResponses: {},
  personaStreaming: {},
  streamingPersonas: new Set(),
  synthesis: null,
  synthesisStreaming: '',
  isDispatching: false,
  isSynthesizing: false,
  sufficiency: null,
  simulation: null,
  isSimulating: false,
  abortController: null,
  error: null,
  errorStatus: null,

  clearError: () => set({ error: null, errorStatus: null }),

  createSession: async (question, mode) => {
    // Abort any in-flight stream BEFORE clearing state so it cannot keep
    // writing persona cards into the new session (C-107).
    const { abortController: inFlight } = get();
    if (inFlight) inFlight.abort();
    set({ isDispatching: false, isSynthesizing: false, abortController: null, error: null, errorStatus: null });

    try {
      const result = await api.createSession({ question, mode });
      set({
        currentSession: { id: result.sessionId, question, mode },
        personaResponses: {},
        personaStreaming: {},
        streamingPersonas: new Set(),
        synthesis: null,
        synthesisStreaming: '',
        sufficiency: null,
        simulation: null,
        error: null,
        errorStatus: null,
      });
    } catch (err: unknown) {
      const { message, status } = describeSessionError(err, 'Could not create session');
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, errorStatus: status });
      throw err;
    }
  },

  dispatch: async () => {
    if (get().isDispatching) return; // Guard against re-entry

    const { currentSession, abortController: existingController } = get();
    if (!currentSession) return;

    // Abort any previous SSE connection
    if (existingController) {
      existingController.abort();
    }

    const abortController = new AbortController();
    set({ isDispatching: true, error: null, errorStatus: null, abortController });

    try {
      for await (const event of api.streamSSE(`/api/sessions/${currentSession.id}/dispatch`, 'POST', undefined, abortController.signal)) {
        const typed = event as DispatchEvent;
        switch (typed.type) {
          case 'persona_start': {
            const { personaId } = typed;
            set(state => ({
              streamingPersonas: new Set([...state.streamingPersonas, personaId]),
              personaStreaming: { ...state.personaStreaming, [personaId]: '' },
            }));
            break;
          }
          case 'delta': {
            // Server sends personaId on dispatch deltas (extension of SSEDelta)
            const personaId = (typed as DispatchEvent).personaId as string | undefined;
            if (personaId) {
              set(state => ({
                personaStreaming: {
                  ...state.personaStreaming,
                  [personaId]: (state.personaStreaming[personaId] ?? '') + typed.text,
                },
              }));
            }
            break;
          }
          case 'persona_complete': {
            const { personaId, response } = typed;
            set(state => {
              const streaming = new Set(state.streamingPersonas);
              streaming.delete(personaId);
              return {
                personaResponses: { ...state.personaResponses, [personaId]: response as PersonaResponse },
                streamingPersonas: streaming,
              };
            });
            break;
          }
          case 'persona_error': {
            const { personaId } = typed;
            set(state => {
              const streaming = new Set(state.streamingPersonas);
              streaming.delete(personaId);
              const updatedPersonaStreaming = { ...state.personaStreaming };
              delete updatedPersonaStreaming[personaId];
              return { streamingPersonas: streaming, personaStreaming: updatedPersonaStreaming };
            });
            break;
          }
          case 'synthesis_complete': {
            // quick-take mode synthesizes inline on the dispatch stream
            set({ synthesis: typed.report as SynthesisReport });
            break;
          }
          case 'error': {
            set({ error: typed.error, errorStatus: null });
            break;
          }
          case 'dispatch_complete': {
            set({ isDispatching: false, abortController: null });
            break;
          }
        }
      }
      // Stream ended without dispatch_complete (server closed early) — don't stay stuck
      if (get().abortController === abortController) {
        set({ isDispatching: false, abortController: null });
      }
    } catch (err: unknown) {
      // Silently handle abort (user re-dispatched or unmounted)
      if (isAbortError(err)) {
        return;
      }
      const { message, status } = describeSessionError(err, 'Dispatch failed');
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, errorStatus: status, isDispatching: false, abortController: null });
    }
  },

  synthesize: async () => {
    const { currentSession, abortController: existingController } = get();
    if (!currentSession) return;

    if (existingController) {
      existingController.abort();
    }
    const abortController = new AbortController();
    set({ isSynthesizing: true, synthesisStreaming: '', error: null, errorStatus: null, abortController });

    try {
      for await (const event of api.createSynthesisStream(currentSession.id, abortController.signal)) {
        switch (event.type) {
          case 'delta':
            set(state => ({ synthesisStreaming: state.synthesisStreaming + event.text }));
            break;
          case 'synthesis_complete':
            set({ synthesis: event.report as SynthesisReport, isSynthesizing: false });
            break;
          case 'error':
            set({ error: event.error, errorStatus: null, isSynthesizing: false });
            break;
        }
      }
      if (get().abortController === abortController) {
        set({ isSynthesizing: false, abortController: null });
      }
    } catch (err: unknown) {
      if (isAbortError(err)) {
        return;
      }
      const { message, status } = describeSessionError(err, 'Synthesis failed');
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, errorStatus: status, isSynthesizing: false, abortController: null });
    }
  },

  checkAmbiguity: async () => {
    const { currentSession } = get();
    if (!currentSession) return;
    try {
      const score = await api.checkAmbiguity(currentSession.id);
      set({ sufficiency: score, error: null, errorStatus: null });
    } catch (err: unknown) {
      const { message, status } = describeSessionError(err, 'Clarity check failed');
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, errorStatus: status });
      throw err;
    }
  },

  runSimulation: async (chosenPath: string) => {
    const { currentSession } = get();
    if (!currentSession) return;

    set({ isSimulating: true, simulation: null, error: null, errorStatus: null });

    try {
      const result = await api.runSimulation(
        currentSession.id,
        chosenPath,
        currentSession.question,
      );
      set({ simulation: result, isSimulating: false });
      useToastStore.getState().addToast('Simulation complete — view results', 'success');
    } catch (err: unknown) {
      const { message, status } = describeSessionError(err, 'Simulation failed');
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, errorStatus: status, isSimulating: false });
    }
  },

  reset: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({
      currentSession: null,
      personaResponses: {},
      personaStreaming: {},
      streamingPersonas: new Set(),
      synthesis: null,
      synthesisStreaming: '',
      isDispatching: false,
      isSynthesizing: false,
      sufficiency: null,
      simulation: null,
      isSimulating: false,
      abortController: null,
      error: null,
      errorStatus: null,
    });
  },
}));
