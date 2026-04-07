import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/session.store';
import { ModeSelector } from '../components/decision/ModeSelector';
import { PersonaCard } from '../components/decision/PersonaCard';
import { SynthesisPanel } from '../components/decision/SynthesisPanel';
import { SufficiencyBanner } from '../components/decision/SufficiencyBanner';
import { MODE_CONFIGS, PERSONA_CONFIGS } from '@boardroom/shared';
import * as api from '../lib/api';
import type { UserMode, PersonaId } from '@boardroom/shared';

export default function DecisionSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<UserMode>('decide');

  const {
    currentSession,
    personaResponses,
    personaStreaming,
    streamingPersonas,
    synthesis,
    synthesisStreaming,
    isDispatching,
    isSynthesizing,
    sufficiency,
    error,
    createSession,
    dispatch,
    synthesize,
    checkAmbiguity,
    reset,
  } = useSessionStore();

  // Load existing session if navigating to /decisions/:id
  useEffect(() => {
    if (!isNew && id && !currentSession) {
      api.getSession(id).then(session => {
        // Hydrate the store with existing session data
        useSessionStore.setState({
          currentSession: { id: session.id, question: session.question, mode: session.mode },
          personaResponses: session.personaResponses as Record<string, any>,
          synthesis: session.ceoSynthesis as any,
          sufficiency: session.sufficiencyScore as any,
        });
      }).catch(() => {
        // Session not found, redirect to new
        navigate('/decisions/new', { replace: true });
      });
    }
  }, [id, isNew, currentSession, navigate]);

  // Determine phase
  const hasPersonas = Object.keys(personaResponses).length > 0 || streamingPersonas.size > 0;
  const allPersonasDone = currentSession
    ? !isDispatching && Object.keys(personaResponses).length > 0 && streamingPersonas.size === 0
    : false;

  const phase: 'input' | 'personas' | 'synthesis' =
    synthesis ? 'synthesis' :
    hasPersonas || isDispatching ? 'personas' :
    'input';

  // Get persona IDs for current mode
  const modeConfig = currentSession ? MODE_CONFIGS[currentSession.mode] : MODE_CONFIGS[mode];
  const personaIds: PersonaId[] = modeConfig.personas;

  async function handleAnalyze() {
    if (!question.trim()) return;
    try {
      await createSession(question.trim(), mode);
      await dispatch();
    } catch {
      // error is set in store
    }
  }

  async function handleCheckClarity() {
    if (!question.trim()) return;
    // Need a session first to check ambiguity
    if (!currentSession) {
      await createSession(question.trim(), mode);
    }
    await checkAmbiguity();
  }

  async function handleSynthesize() {
    await synthesize();
  }

  function handleExport() {
    if (!currentSession) return;
    window.open(`/api/sessions/${currentSession.id}/export?format=json`, '_blank');
  }

  function handleNewDecision() {
    reset();
    navigate('/decisions/new');
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Phase 1: Input */}
      {phase === 'input' && (
        <>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">New Decision</h1>
            <p className="text-gray-500 text-sm">
              Describe your question or decision, choose a mode, then analyze.
            </p>
          </div>

          <div>
            <label htmlFor="question" className="block text-sm font-medium text-gray-300 mb-2">
              Your Question
            </label>
            <textarea
              id="question"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={4}
              placeholder="What decision are you facing? Be specific about context, constraints, and what success looks like..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Analysis Mode
            </label>
            <ModeSelector selectedMode={mode} onSelect={setMode} />
          </div>

          {/* Sufficiency banner */}
          {sufficiency && (
            <SufficiencyBanner
              score={sufficiency}
              onProceed={handleAnalyze}
            />
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!question.trim()}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              Analyze
            </button>
            <button
              type="button"
              onClick={handleCheckClarity}
              disabled={!question.trim()}
              className="px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors border border-gray-700"
            >
              Check Clarity
            </button>
          </div>
        </>
      )}

      {/* Phase 2: Personas streaming / complete */}
      {(phase === 'personas' || phase === 'synthesis') && (
        <>
          {/* Question header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-white">
                {currentSession?.question}
              </h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700 mt-1">
                {MODE_CONFIGS[currentSession?.mode ?? 'decide'].label}
              </span>
            </div>
            <button
              type="button"
              onClick={handleNewDecision}
              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors border border-gray-700 flex-shrink-0"
            >
              New Decision
            </button>
          </div>

          {/* Synthesis panel (phase 3) */}
          {(phase === 'synthesis' || isSynthesizing) && (
            <SynthesisPanel
              report={synthesis ?? undefined}
              streamingText={synthesisStreaming}
              isStreaming={isSynthesizing}
            />
          )}

          {/* Action buttons between synthesis and personas */}
          {phase === 'synthesis' && synthesis && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={handleNewDecision}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700"
              >
                New Decision
              </button>
            </div>
          )}

          {/* Synthesize button */}
          {phase === 'personas' && allPersonasDone && modeConfig.includesCEO && (
            <button
              type="button"
              onClick={handleSynthesize}
              disabled={isSynthesizing}
              className="w-full px-6 py-3 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {isSynthesizing ? 'Synthesizing...' : 'Synthesize with CEO'}
            </button>
          )}

          {/* Persona grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {personaIds.map(pid => (
              <PersonaCard
                key={pid}
                personaId={pid}
                response={personaResponses[pid]}
                streamingText={personaStreaming[pid]}
                isStreaming={streamingPersonas.has(pid)}
              />
            ))}
          </div>

          {/* Dispatching indicator */}
          {isDispatching && (
            <div className="text-center text-sm text-gray-500">
              Dispatching personas...
            </div>
          )}
        </>
      )}
    </div>
  );
}
