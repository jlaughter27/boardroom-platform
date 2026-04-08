import { create } from 'zustand';
import * as api from '../lib/api';
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
  abortController: AbortController | null;
  error: string | null;

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

  clearError: () => set({ error: null }),

  createSession: async (question, mode) => {
    const result = await api.createSession({ question, mode });
    set({
      currentSession: { id: result.sessionId, question, mode },
      personaResponses: {},
      personaStreaming: {},
      streamingPersonas: new Set(),
      synthesis: null,
      synthesisStreaming: '',
      error: null,
    });
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
    set({ isDispatching: true, error: null, abortController });

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
          case 'dispatch_complete': {
            set({ isDispatching: false, abortController: null });
            break;
          }
        }
      }
    } catch (err: unknown) {
      // Silently handle abort (user re-dispatched or unmounted)
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'Dispatch failed';
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, isDispatching: false, abortController: null });
    }
  },

  synthesize: async () => {
    const { currentSession } = get();
    if (!currentSession) return;

    set({ isSynthesizing: true, synthesisStreaming: '', error: null });

    try {
      for await (const event of api.streamSSE(`/api/sessions/${currentSession.id}/synthesize`)) {
        switch (event.type) {
          case 'delta':
            set(state => ({ synthesisStreaming: state.synthesisStreaming + event.text }));
            break;
          case 'synthesis_complete':
            set({ synthesis: event.report as SynthesisReport, isSynthesizing: false });
            break;
          case 'error':
            set({ error: event.error, isSynthesizing: false });
            break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Synthesis failed';
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, isSynthesizing: false });
    }
  },

  checkAmbiguity: async () => {
    const { currentSession } = get();
    if (!currentSession) return;
    const score = await api.checkAmbiguity(currentSession.id);
    set({ sufficiency: score });
  },

  runSimulation: async (chosenPath: string) => {
    const { currentSession } = get();
    if (!currentSession) return;

    set({ isSimulating: true, simulation: null, error: null });

    try {
      const result = await api.runSimulation(
        currentSession.id,
        chosenPath,
        currentSession.question,
      );
      set({ simulation: result, isSimulating: false });
      useToastStore.getState().addToast('Simulation complete \u2014 view results', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Simulation failed';
      useToastStore.getState().addToast(message, 'error');
      set({ error: message, isSimulating: false });
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
    });
  },
}));
