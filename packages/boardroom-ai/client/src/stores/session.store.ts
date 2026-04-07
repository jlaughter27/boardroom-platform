import { create } from 'zustand';
import * as api from '../lib/api';
import type { PersonaId, PersonaResponse, SynthesisReport } from '@boardroom/shared';
import type { SufficiencyScore, UserMode } from '@boardroom/shared';

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
  error: string | null;

  createSession: (question: string, mode: UserMode) => Promise<void>;
  dispatch: () => Promise<void>;
  synthesize: () => Promise<void>;
  checkAmbiguity: () => Promise<void>;
  reset: () => void;
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
  error: null,

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
    const { currentSession } = get();
    if (!currentSession) return;

    set({ isDispatching: true, error: null });

    try {
      for await (const event of api.streamSSE(`/api/sessions/${currentSession.id}/dispatch`)) {
        switch (event.type) {
          case 'persona_start': {
            const personaId = event.personaId as string;
            set(state => ({
              streamingPersonas: new Set([...state.streamingPersonas, personaId]),
              personaStreaming: { ...state.personaStreaming, [personaId]: '' },
            }));
            break;
          }
          case 'delta': {
            const personaId = event.personaId as string;
            if (personaId) {
              set(state => ({
                personaStreaming: {
                  ...state.personaStreaming,
                  [personaId]: (state.personaStreaming[personaId] ?? '') + (event.text as string),
                },
              }));
            }
            break;
          }
          case 'persona_complete': {
            const personaId = event.personaId as string;
            const response = event.response as PersonaResponse;
            set(state => {
              const streaming = new Set(state.streamingPersonas);
              streaming.delete(personaId);
              return {
                personaResponses: { ...state.personaResponses, [personaId]: response },
                streamingPersonas: streaming,
              };
            });
            break;
          }
          case 'persona_error': {
            const personaId = event.personaId as string;
            set(state => {
              const streaming = new Set(state.streamingPersonas);
              streaming.delete(personaId);
              return { streamingPersonas: streaming };
            });
            break;
          }
          case 'dispatch_complete': {
            set({ isDispatching: false });
            break;
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Dispatch failed';
      set({ error: message, isDispatching: false });
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
            set(state => ({ synthesisStreaming: state.synthesisStreaming + (event.text as string) }));
            break;
          case 'synthesis_complete':
            set({ synthesis: event.report as SynthesisReport, isSynthesizing: false });
            break;
          case 'error':
            set({ error: event.error as string, isSynthesizing: false });
            break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Synthesis failed';
      set({ error: message, isSynthesizing: false });
    }
  },

  checkAmbiguity: async () => {
    const { currentSession } = get();
    if (!currentSession) return;
    const score = await api.checkAmbiguity(currentSession.id);
    set({ sufficiency: score });
  },

  reset: () => set({
    currentSession: null,
    personaResponses: {},
    personaStreaming: {},
    streamingPersonas: new Set(),
    synthesis: null,
    synthesisStreaming: '',
    isDispatching: false,
    isSynthesizing: false,
    sufficiency: null,
    error: null,
  }),
}));
