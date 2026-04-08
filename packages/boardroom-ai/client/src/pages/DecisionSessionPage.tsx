import { useState, useEffect } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useSessionStore } from '../stores/session.store';
import { ModeSelector } from '../components/decision/ModeSelector';
import { PersonaCard } from '../components/decision/PersonaCard';
import { SynthesisPanel } from '../components/decision/SynthesisPanel';
import { SufficiencyBanner } from '../components/decision/SufficiencyBanner';
import { SimulationButton } from '../components/decision/SimulationButton';
import { SimulationPanel } from '../components/decision/SimulationPanel';
import { MODE_CONFIGS, PERSONA_CONFIGS } from '@boardroom/shared';
import * as api from '../lib/api';
import type { UserMode, PersonaId, CustomPersona, PersonaResponse, SynthesisReport, SufficiencyScore } from '@boardroom/shared';
import { PageWrapper, Button, Badge, Card } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { slideUp, scaleIn, staggerContainer, staggerItem } from '../lib/motion';

export default function DecisionSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  usePageTitle(isNew ? 'New Decision' : 'Decision Session');

  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<UserMode>('decide');
  const [customPersonas, setCustomPersonas] = useState<CustomPersona[]>([]);

  useEffect(() => {
    api.getCustomPersonas()
      .then(personas => setCustomPersonas(personas.filter(p => p.isActive)))
      .catch(() => {});
  }, []);

  const {
    currentSession, personaResponses, personaStreaming, streamingPersonas,
    synthesis, synthesisStreaming, isDispatching, isSynthesizing,
    sufficiency, simulation, isSimulating, error,
    createSession, dispatch, synthesize, checkAmbiguity, runSimulation, reset,
  } = useSessionStore();

  useEffect(() => {
    if (!isNew && id && !currentSession) {
      api.getSession(id).then(session => {
        useSessionStore.setState({
          currentSession: { id: session.id, question: session.question, mode: session.mode },
          personaResponses: session.personaResponses as Record<string, PersonaResponse>,
          synthesis: session.ceoSynthesis as SynthesisReport | null,
          sufficiency: session.sufficiencyScore as SufficiencyScore | null,
        });
      }).catch(() => navigate('/decisions/new', { replace: true }));
    }
  }, [id, isNew, currentSession, navigate]);

  const hasPersonas = Object.keys(personaResponses).length > 0 || streamingPersonas.size > 0;
  const allPersonasDone = currentSession
    ? !isDispatching && Object.keys(personaResponses).length > 0 && streamingPersonas.size === 0
    : false;

  const phase: 'input' | 'personas' | 'synthesis' =
    synthesis ? 'synthesis' :
    hasPersonas || isDispatching ? 'personas' :
    'input';

  const modeConfig = currentSession ? MODE_CONFIGS[currentSession.mode] : MODE_CONFIGS[mode];
  const personaIds: PersonaId[] = modeConfig.personas;

  async function handleAnalyze() {
    if (!question.trim()) return;
    try {
      await createSession(question.trim(), mode);
      await dispatch();
    } catch {}
  }

  async function handleCheckClarity() {
    if (!question.trim()) return;
    if (!currentSession) await createSession(question.trim(), mode);
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
    <PageWrapper>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Error */}
        {error && (
          <ErrorBanner message={error} onDismiss={() => useSessionStore.setState({ error: null })} />
        )}

        {/* Phase 1: Input */}
        <AnimatePresence mode="wait">
          {phase === 'input' && (
            <motion.div key="input" {...slideUp} className="space-y-6">
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center">
                  <h1 className="text-2xl font-semibold text-text-primary mb-1">New Decision</h1>
                  <p className="text-text-secondary text-sm">
                    Describe your question, choose a mode, then analyze.
                  </p>
                </div>

                <div>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={4}
                    placeholder="What decision are you wrestling with?"
                    className="w-full bg-bg-base border border-line rounded-lg p-4 text-lg text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none resize-y transition-all duration-fast"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-3">
                    Analysis Mode
                  </label>
                  <ModeSelector selectedMode={mode} onSelect={setMode} />
                </div>

                {sufficiency && (
                  <motion.div {...slideUp}>
                    <SufficiencyBanner score={sufficiency} onProceed={handleAnalyze} />
                  </motion.div>
                )}

                <div className="flex items-center gap-3 justify-center">
                  <Button variant="primary" size="lg" onClick={handleAnalyze} disabled={!question.trim()}>
                    Analyze
                  </Button>
                  <Button variant="ghost" onClick={handleCheckClarity} disabled={!question.trim()}>
                    Check Clarity
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Phase 2 + 3: Personas + Synthesis */}
        {(phase === 'personas' || phase === 'synthesis') && (
          <motion.div {...slideUp} className="space-y-6">
            {/* Question header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-lg font-semibold text-text-primary">
                  {currentSession?.question}
                </h1>
                <Badge variant="accent" className="mt-1">
                  {MODE_CONFIGS[currentSession?.mode ?? 'decide'].label}
                </Badge>
              </div>
              <Button variant="secondary" size="sm" onClick={handleNewDecision}>
                New Decision
              </Button>
            </div>

            {/* Synthesis panel (phase 3) */}
            <AnimatePresence>
              {(phase === 'synthesis' || isSynthesizing) && (
                <motion.div {...slideUp}>
                  <SynthesisPanel
                    report={synthesis ?? undefined}
                    streamingText={synthesisStreaming}
                    isStreaming={isSynthesizing}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action bar */}
            {phase === 'synthesis' && synthesis && (
              <div className="sticky bottom-0 z-10 bg-bg-surface/80 backdrop-blur border-t border-line -mx-6 px-6 py-3 flex items-center gap-3">
                <Button variant="ghost" onClick={handleExport}>Export</Button>
                <Button variant="secondary" onClick={handleNewDecision}>New Decision</Button>
                <SimulationButton
                  defaultPath={synthesis.recommendation}
                  isSimulating={isSimulating}
                  onSimulate={runSimulation}
                />
              </div>
            )}

            {simulation && <SimulationPanel result={simulation} />}

            {/* Synthesize button */}
            {phase === 'personas' && allPersonasDone && modeConfig.includesCEO && (
              <motion.div {...scaleIn} className="text-center">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleSynthesize}
                  disabled={isSynthesizing}
                  className="w-full max-w-md"
                >
                  {isSynthesizing ? 'Synthesizing...' : '\u2728 Synthesize with CEO'}
                </Button>
              </motion.div>
            )}

            {/* Persona grid */}
            <motion.div
              {...staggerContainer}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {personaIds.map((pid) => (
                <motion.div key={pid} {...staggerItem}>
                  <PersonaCard
                    personaId={pid}
                    response={personaResponses[pid]}
                    streamingText={personaStreaming[pid]}
                    isStreaming={streamingPersonas.has(pid)}
                  />
                </motion.div>
              ))}
              {customPersonas.map((cp) => (
                <motion.div key={cp.personaId} {...staggerItem} className="relative">
                  <Badge variant="accent" className="absolute top-2 right-2 z-10">Custom</Badge>
                  <PersonaCard
                    personaId={cp.personaId as PersonaId}
                    response={personaResponses[cp.personaId]}
                    streamingText={personaStreaming[cp.personaId]}
                    isStreaming={streamingPersonas.has(cp.personaId)}
                  />
                </motion.div>
              ))}
            </motion.div>

            {isDispatching && (
              <div className="text-center text-sm text-text-tertiary">
                Dispatching personas...
              </div>
            )}
          </motion.div>
        )}
      </div>
    </PageWrapper>
  );
}
