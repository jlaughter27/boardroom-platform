import { useState, useEffect, useRef } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { BILLING_SETTINGS_PATH } from '../components/shared/TrialBanner';
import { motion, AnimatePresence } from 'motion/react';
import { useSessionStore } from '../stores/session.store';
import { ModeSelector } from '../components/decision/ModeSelector';
import { PersonaCard } from '../components/decision/PersonaCard';
import { SynthesisPanel, SynthesisSheet } from '../components/decision/SynthesisPanel';
import { SufficiencyBanner } from '../components/decision/SufficiencyBanner';
import { SimulationButton } from '../components/decision/SimulationButton';
import { SimulationPanel } from '../components/decision/SimulationPanel';
import { DecisionCommitCard } from '../components/decision/DecisionCommitCard';
import { WhatChangedCard } from '../components/decision/WhatChangedCard';
import * as api from '../lib/api';
import { truncate } from '@boardroom/shared';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { PersonaId, CustomPersona, PersonaResponse, SufficiencyScore } from '@boardroom/shared';
import { CLIENT_MODE_CONFIGS, type ClientUserMode, type ExtendedSynthesisReport } from '../types/debate';
import { useDebounce } from '../hooks/useDebounce';
import { PageWrapper, PageHeader, Button, Badge, Skeleton } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { AINudge } from '../components/shared/AINudge';
import { slideUp, scaleIn, staggerContainer, staggerItem } from '../lib/motion';

/** Router state that asks the page to dispatch once the session has loaded (set by Analyze after it created the session). */
interface SessionRouteState { autoDispatch?: boolean }

/** Tab titles keep the H1's words; long questions are cut with an ellipsis. */
export const TAB_TITLE_MAX = 60;

export default function DecisionSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = !id || id === 'new';

  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<ClientUserMode>('decide');
  /** Existing, undispatched session: the user chose Edit, so the composer replaces the read-only question. */
  const [editing, setEditing] = useState(false);
  const debouncedQuestion = useDebounce(question, 600);
  const [customPersonas, setCustomPersonas] = useState<CustomPersona[]>([]);

  useEffect(() => {
    api.getCustomPersonas()
      .then(personas => setCustomPersonas(personas.filter(p => p.isActive)))
      .catch(() => {});
  }, []);

  const {
    currentSession, personaResponses, personaStreaming, streamingPersonas,
    synthesis, synthesisStreaming, isDispatching, isSynthesizing,
    sufficiency, simulation, isSimulating, error, errorStatus,
    rebuttals, rebuttingPersonas, committedDecision, isCommitting,
    personaErrors, dispatchScope, synthesisWithout,
    createSession, dispatch, retryPersona, synthesize, checkAmbiguity, runSimulation, commitDecision, reset, clearError,
  } = useSessionStore();

  // Loader keyed on the route id (C-107): navigating A → B must not render A's
  // data under B's URL, and leaving the page must abort any in-flight stream.
  useEffect(() => {
    if (isNew) {
      // Arriving at /decisions/new always starts from a clean slate.
      reset();
      return () => { reset(); };
    }
    if (!id) return;

    let cancelled = false;
    setEditing(false);
    const autoDispatch = (location.state as SessionRouteState | null)?.autoDispatch === true;
    const { currentSession: existing } = useSessionStore.getState();
    if (existing?.id !== id) {
      reset();
      api.getSession(id).then(session => {
        if (cancelled) return;
        const personaResponses = (session.personaResponses ?? {}) as Record<string, PersonaResponse>;
        useSessionStore.setState({
          currentSession: { id: session.id, question: session.question, mode: session.mode },
          personaResponses,
          synthesis: session.ceoSynthesis as ExtendedSynthesisReport | null,
          sufficiency: session.sufficiencyScore as SufficiencyScore | null,
        });
        // Analyze created this session and navigated here: run it now, once.
        // The state is consumed first so a reload shows the question instead of re-running it.
        if (autoDispatch && Object.keys(personaResponses).length === 0 && !session.ceoSynthesis) {
          navigate(location.pathname, { replace: true, state: null });
          void useSessionStore.getState().dispatch();
        }
        // A session that already committed a decision shows the success state, not the form.
        if (session.decisionId) {
          const decisionId = session.decisionId;
          api.getDecisions().then(decisions => {
            if (cancelled) return;
            const found = decisions.find(d => d.id === decisionId) ?? null;
            if (found && useSessionStore.getState().currentSession?.id === id) {
              useSessionStore.setState({ committedDecision: found });
            }
          }).catch(() => { /* non-fatal: the form stays available; server answers 409 if re-submitted */ });
        }
      }).catch(() => {
        if (!cancelled) navigate('/decisions/new', { replace: true });
      });
    }

    return () => {
      cancelled = true;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // The synthesis sheet opens once, when a synthesis finishes streaming in this
  // visit (not for a report that was already there on load); the inline panel
  // stays on the page, and the header button can reopen the sheet any time.
  const [synthesisSheetOpen, setSynthesisSheetOpen] = useState(false);
  const wasSynthesizing = useRef(false);
  useEffect(() => {
    if (wasSynthesizing.current && !isSynthesizing && synthesis) setSynthesisSheetOpen(true);
    wasSynthesizing.current = isSynthesizing;
  }, [isSynthesizing, synthesis]);

  const hasPersonas = Object.keys(personaResponses).length > 0 || streamingPersonas.size > 0 || Object.keys(personaErrors).length > 0;
  const allPersonasDone = currentSession
    ? !isDispatching && Object.keys(personaResponses).length > 0 && streamingPersonas.size === 0
    : false;

  // One polite live region announces advisors as they finish or fail (not every token).
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef<Set<string>>(new Set());
  const announcedFor = useRef<string | null>(null);
  const sessionKey = currentSession?.id ?? null;
  useEffect(() => {
    const keys = [...Object.keys(personaResponses).map((pid) => `ok:${pid}`), ...Object.keys(personaErrors).map((pid) => `err:${pid}`)];
    // What a session already held when it loaded is not news; only what arrives afterwards is.
    if (announcedFor.current !== sessionKey) { announcedFor.current = sessionKey; announced.current = new Set(keys); return; }
    // Forget keys that went away (a retried error), so a second failure is announced again.
    announced.current = new Set([...announced.current].filter((k) => keys.includes(k)));
    const fresh = keys.filter((k) => !announced.current.has(k));
    if (fresh.length === 0) return;
    for (const k of fresh) announced.current.add(k);
    const nameOf = (k: string) => { const pid = k.slice(k.indexOf(':') + 1); return PERSONA_CONFIGS[pid]?.name ?? pid; };
    const done = fresh.filter((k) => k.startsWith('ok:')).map(nameOf);
    const failed = fresh.filter((k) => k.startsWith('err:')).map(nameOf);
    setAnnouncement([
      done.length ? `${done.join(' and ')} finished.` : '',
      failed.length ? `${failed.join(' and ')} couldn't finish. Retry is available.` : '',
    ].filter(Boolean).join(' '));
  }, [personaResponses, personaErrors, sessionKey]);

  // `loading`: an existing id whose session has not arrived yet (never flash the blank composer).
  // `review`: an existing, undispatched session — its question read-only, with Analyze / Edit.
  // `input`: the composer — `/decisions/new`, or an existing session the user chose to edit.
  const phase: 'loading' | 'input' | 'review' | 'personas' | 'synthesis' =
    synthesis ? 'synthesis' :
    hasPersonas || isDispatching ? 'personas' :
    isNew || editing ? 'input' :
    currentSession ? 'review' :
    'loading';

  // The tab title says what the H1 says: "New Decision", "Edit Decision", or the question itself.
  const pageTitle = isNew ? 'New Decision' : editing ? 'Edit Decision' : currentSession?.question ?? 'Decision';
  usePageTitle(truncate(pageTitle, TAB_TITLE_MAX, '\u2026'));

  const modeConfig = (currentSession ? CLIENT_MODE_CONFIGS[currentSession.mode] : CLIENT_MODE_CONFIGS[mode]) ?? CLIENT_MODE_CONFIGS.decide;
  const personaIds: PersonaId[] = modeConfig.personas;

  // M1-C2 — an advisor with no answer is a failure, never an endless "Thinking...":
  // either the server said so (`persona_error`), or the dispatch that should have
  // run it is over (a reload, a stream that closed early, a retry of someone else).
  function advisorError(pid: string): string | undefined {
    if (personaErrors[pid]) return personaErrors[pid];
    if (phase !== 'personas' && phase !== 'synthesis') return undefined;
    if (personaResponses[pid] || streamingPersonas.has(pid)) return undefined;
    const queued = isDispatching && (!dispatchScope || dispatchScope.includes(pid));
    return queued ? undefined : 'No answer arrived from this advisor.';
  }
  const advisorIds = [...personaIds, ...customPersonas.map((cp) => cp.personaId)];
  const failedIds = advisorIds.filter((pid) => advisorError(pid));
  /** "The Critic" → "Critic" for the CTA ("Synthesize without Critic"). */
  const shortName = (pid: string) => (PERSONA_CONFIGS[pid]?.name ?? customPersonas.find((cp) => cp.personaId === pid)?.name ?? pid).replace(/^The /, '');
  const failedNames = failedIds.map(shortName);
  const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
  const retryDisabled = isDispatching || isSynthesizing;
  // "What changed since last time" matches the question against known entities
  const whatChangedQuestion = currentSession?.question ?? debouncedQuestion;

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCheckingClarity, setIsCheckingClarity] = useState(false);

  async function handleAnalyze() {
    const trimmed = question.trim();
    if (!trimmed || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      // Editing an undispatched session without changing it: run it in place.
      if (!isNew && currentSession && currentSession.question === trimmed && currentSession.mode === mode) {
        setEditing(false);
        await dispatch();
        return;
      }
      // Otherwise a new session, addressed by its own URL so a reload finds it again.
      // The page for that URL loads the session and dispatches it (router state `autoDispatch`).
      await createSession(trimmed, mode);
      const created = useSessionStore.getState().currentSession;
      if (created) {
        const state: SessionRouteState = { autoDispatch: true };
        navigate(`/decisions/${created.id}`, { replace: isNew, state });
      }
    } catch {
      // error handled by store
    } finally {
      setIsAnalyzing(false);
    }
  }

  /** Read-only question → Analyze: dispatch the stored session as it is. */
  async function handleAnalyzeStored() {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      await dispatch();
    } finally {
      setIsAnalyzing(false);
    }
  }

  function startEditing() {
    if (!currentSession) return;
    setQuestion(currentSession.question);
    setMode(currentSession.mode);
    setEditing(true);
  }

  async function handleCheckClarity() {
    if (!question.trim() || isCheckingClarity) return;
    setIsCheckingClarity(true);
    try {
      if (!currentSession) await createSession(question.trim(), mode);
      await checkAmbiguity();
    } catch {
      // error handled by store
    } finally {
      setIsCheckingClarity(false);
    }
  }

  async function handleSynthesize() {
    await synthesize({ without: failedNames });
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
        {/* Error (C-104: 402 → upgrade CTA, 503 → at capacity) */}
        {error && (
          <div className="space-y-2">
            <ErrorBanner message={error} onDismiss={clearError} />
            {errorStatus === 402 && (
              <div className="text-sm text-muted-foreground px-1">
                <Link to={BILLING_SETTINGS_PATH} className="text-primary underline font-medium">
                  Upgrade your plan
                </Link>
                {' '}to keep analyzing decisions.
              </div>
            )}
          </div>
        )}

        {/* What changed since last time — first card when the question maps to a known entity */}
        {whatChangedQuestion.trim().length >= 4 && (
          <WhatChangedCard question={whatChangedQuestion} currentSessionId={currentSession?.id ?? null} />
        )}

        {/* Phase 1: Input (composer), review (stored question), or loading */}
        <AnimatePresence mode="wait">
          {phase === 'loading' && (
            <div key="loading" className="max-w-3xl mx-auto space-y-4" data-testid="session-loading" aria-busy="true">
              <Skeleton className="h-9 w-3/4" />
              <Skeleton className="h-5 w-24" />
            </div>
          )}

          {phase === 'review' && currentSession && (
            <motion.div key="review" {...slideUp} className="max-w-3xl mx-auto space-y-6" data-testid="session-review">
              <PageHeader
                className="mb-0"
                title={currentSession.question}
                subtitle="Not analyzed yet. Run your advisors on this question, or edit it first."
              />
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="accent">{modeConfig.label}</Badge>
                <span className="text-sm text-muted-foreground">
                  {modeConfig.personas.length > 0
                    ? `${modeConfig.personas.length} advisors${modeConfig.includesCEO ? ' + CEO synthesis' : ''}`
                    : 'CEO quick take'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="primary" size="lg" onClick={handleAnalyzeStored} disabled={isAnalyzing}>
                  {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                </Button>
                <Button variant="ghost" onClick={startEditing}>Edit</Button>
              </div>
            </motion.div>
          )}

          {phase === 'input' && (
            <motion.div key="input" {...slideUp} className="space-y-6">
              {/* 768 px: wide enough for the seven-mode segmented control on one line. */}
              <div className="max-w-3xl mx-auto space-y-6">
                <PageHeader
                  align="center"
                  className="mb-0"
                  title={pageTitle}
                  subtitle={editing ? 'Change the question or the mode, then analyze. A changed question starts a new session.' : 'Describe your question, choose a mode, then analyze.'}
                />

                <div>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={4}
                    placeholder="What decision are you wrestling with?"
                    className="w-full bg-background border border-border rounded-lg p-4 text-lg text-foreground placeholder:text-muted-foreground hover:border-hairline-strong focus:border-primary/40 focus:ring-1 focus:ring-ring/30 outline-none resize-y transition-[border-color,box-shadow] duration-fast ease-out"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-3">
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
                  <Button variant="primary" size="lg" onClick={handleAnalyze} disabled={!question.trim() || isAnalyzing}>
                    {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                  </Button>
                  {editing ? (
                    <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                  ) : (
                    <Button variant="ghost" onClick={handleCheckClarity} disabled={!question.trim() || isCheckingClarity}>
                      {isCheckingClarity ? 'Checking...' : 'Check Clarity'}
                    </Button>
                  )}
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
                <h1 className="text-lg font-semibold text-foreground">
                  {currentSession?.question}
                </h1>
                <Badge variant="accent" className="mt-1">
                  {(CLIENT_MODE_CONFIGS[currentSession?.mode ?? 'decide'] ?? CLIENT_MODE_CONFIGS.decide).label}
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
                    without={synthesisWithout}
                    onExpand={synthesis ? () => setSynthesisSheetOpen(true) : undefined}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {synthesis && (
              <SynthesisSheet report={synthesis} question={currentSession?.question} isOpen={synthesisSheetOpen} onClose={() => setSynthesisSheetOpen(false)} />
            )}

            {/* Decision commit (Phase 6) — shown once synthesis is complete */}
            {phase === 'synthesis' && synthesis && !isSynthesizing && (
              <motion.div {...slideUp}>
                <DecisionCommitCard
                  report={synthesis}
                  personaResponses={personaResponses}
                  committed={committedDecision}
                  isCommitting={isCommitting}
                  onCommit={commitDecision}
                />
              </motion.div>
            )}

            {/* Action bar */}
            {phase === 'synthesis' && synthesis && (
              <div className="material sticky bottom-0 z-10 -mx-6 rounded-none border-t border-hairline !shadow-none px-6 py-3 flex items-center gap-3">
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

            {/* AI Nudge: suggest simulation after synthesis */}
            {phase === 'synthesis' && synthesis && !simulation && !isSimulating && (
              <AINudge
                title="Consider running a simulation on your chosen path"
                description="Simulations reveal resource impact, timeline risks, and stakeholder effects before you commit."
                action={{
                  label: 'Run Simulation',
                  onClick: () => document.querySelector('[data-simulation-button]')?.scrollIntoView({ behavior: 'smooth' }),
                }}
                dismissKey={`nudge-simulation-${currentSession?.id}`}
                variant="suggestion"
              />
            )}

            {/* Persona grid */}
            <motion.div
              {...staggerContainer}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {personaIds.map((pid) => (
                <motion.div key={pid} {...staggerItem} className="flex">
                  <PersonaCard
                    personaId={pid}
                    response={personaResponses[pid]}
                    streamingText={personaStreaming[pid]}
                    isStreaming={streamingPersonas.has(pid)}
                    isRebutting={rebuttingPersonas.has(pid)}
                    rebuttal={rebuttals[pid]}
                    error={advisorError(pid)}
                    onRetry={() => { void retryPersona(pid); }}
                    retryDisabled={retryDisabled}
                  />
                </motion.div>
              ))}
              {customPersonas.map((cp) => (
                <motion.div key={cp.personaId} {...staggerItem} className="relative flex">
                  <Badge variant="accent" className="absolute top-2 right-2 z-10">Custom</Badge>
                  <PersonaCard
                    personaId={cp.personaId as PersonaId}
                    response={personaResponses[cp.personaId]}
                    streamingText={personaStreaming[cp.personaId]}
                    isStreaming={streamingPersonas.has(cp.personaId)}
                    isRebutting={rebuttingPersonas.has(cp.personaId)}
                    rebuttal={rebuttals[cp.personaId]}
                    error={advisorError(cp.personaId)}
                    onRetry={() => { void retryPersona(cp.personaId); }}
                    retryDisabled={retryDisabled}
                  />
                </motion.div>
              ))}
            </motion.div>

            {/* Footer: dispatch status, then the CEO step. Below the grid and sticky, one constant
                height, so the call to action appearing never moves the cards (M1-C1). */}
            {phase === 'personas' && (
              <div
                className="material sticky bottom-0 z-10 -mx-6 rounded-none border-t border-hairline !shadow-none px-6 h-16 flex items-center justify-center gap-3"
                data-testid="session-footer"
              >
                {isDispatching ? (
                  <span className="text-sm text-muted-foreground">
                    {rebuttingPersonas.size > 0 ? 'Advisors are debating…' : 'Dispatching personas...'}
                    <span className="tnum ml-2">
                      {Object.keys(personaResponses).length} of {personaIds.length + customPersonas.length} done
                    </span>
                  </span>
                ) : allPersonasDone && modeConfig.includesCEO ? (
                  <motion.div {...scaleIn} className="w-full max-w-md">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleSynthesize}
                      disabled={isSynthesizing}
                      className="w-full"
                    >
                      {isSynthesizing
                        ? 'Synthesizing...'
                        : failedNames.length > 0
                          ? `Synthesize without ${joinNames(failedNames)}`
                          : '\u2728 Synthesize with CEO'}
                    </Button>
                  </motion.div>
                ) : failedIds.length > 0 ? (
                  <span className="text-sm text-muted-foreground">No advisor answered. Retry an advisor to continue.</span>
                ) : (
                  <span className="text-sm text-muted-foreground">All advisors have answered.</span>
                )}
              </div>
            )}
          </motion.div>
        )}

        <div aria-live="polite" role="status" className="sr-only" data-testid="persona-announcer">{announcement}</div>
      </div>
    </PageWrapper>
  );
}
