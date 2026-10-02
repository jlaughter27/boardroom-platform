import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicClient } from '../lib/anthropic-client';
import type { Response } from 'express';
import type {
  PersonaId, BuiltInPersonaId, PersonaResponse, SynthesisReport, QuestionnaireResponse, CustomPersona,
  ContextItem, Rebuttal, DisagreementLedger,
} from '@boardroom/shared';
import { SynthesisReportSchema, QuestionnaireResponseSchema, DoerTaskBreakdownSchema } from '@boardroom/shared';
import { PERSONA_CONFIGS, MODEL_IDS } from '@boardroom/shared';
import { MODE_CONFIGS, type UserMode } from '@boardroom/shared';
import { Agent } from './agent';
import { initSSE, sendSSE } from './streaming';
import { loadPrompt, loadSystemPrompt } from '../lib/prompt-loader';
import type { OmniMindClient } from '../services/omnimind-client';
import { toolRegistry } from '../tools';
import { getContextRequest } from '../personas/context-strategy';
import { logger } from '../lib/logger';
import { buildSystemBlocks, stripJsonFences, EFFORT } from '../lib/llm-request';
import { recordUsage } from '../lib/llm-usage';
import {
  clusterByMajority, selectRebutters, buildRebuttalUserMessage, buildDisagreementLedger,
  computeDroppedConsiderations, formatLedgerForCEO, formatRebuttalForCEO, debateEnabled, maxRebuttals,
} from './debate';

function formatPersonaForCEO(name: string, response: PersonaResponse, isCustom: boolean = false, rebuttal?: Rebuttal): string {
  const confidenceLabel = response.confidence >= 0.7 ? 'high' : response.confidence >= 0.4 ? 'medium' : 'low';
  const customLabel = isCustom ? ' (custom)' : '';
  return `## ${name}${customLabel} (${confidenceLabel} confidence)
**Reading:** ${response.situationReading}
**Recommendation:** ${response.recommendation}
**Key Assumptions:** ${response.keyAssumptions.join('; ')}
**Uncertainties:** ${response.uncertainties.join('; ')}
**Cited memory ids:** ${response.sourceMemoryIds.join(', ') || '(none)'}
${response.dissentFlag ? '⚠️ DISSENT: This persona fundamentally disagrees with the emerging consensus.' : ''}${rebuttal ? `\n${formatRebuttalForCEO(rebuttal)}` : ''}`;
}

function scoreSynthesisQuality(report: SynthesisReport, personaResponses: PersonaResponse[]): number {
  let score = 5;
  if (report.disagreementMap && report.disagreementMap.length > 50) score += 1;
  if (report.nextActions && report.nextActions.length >= 3) score += 1;
  if (report.topRisks && report.topRisks.length >= 2) score += 0.5;
  if (report.assumptionsToMonitor && report.assumptionsToMonitor.length >= 2) score += 0.5;
  if (report.recommendation && report.recommendation.length < 50) score -= 1;
  const hasDissenters = personaResponses.some(r => r.dissentFlag);
  if (hasDissenters && report.disagreementMap && !report.disagreementMap.toLowerCase().includes('dissent')) score -= 1;
  return Math.max(0, Math.min(10, score));
}

export interface SessionState {
  id: string;
  userId: string;
  question: string;
  mode: UserMode;
  personaResponses: Map<PersonaId, PersonaResponse>;
  synthesis: SynthesisReport | null;
  questionnaireAnswers?: { question: string; answer: string }[];
  // ── Phase 6 ──
  /** Deterministic core block fetched once per dispatch (shared cache prefix). */
  coreContext?: string;
  /** Temporal validity cut-off forwarded to retrieval (ISO). */
  asOf?: string;
  /** Round-2 outcomes keyed by persona id. */
  rebuttals?: Map<PersonaId, Rebuttal>;
  /** Machine-built ledger handed to the CEO. */
  ledger?: DisagreementLedger;
  /** Project ids surfaced by round-1 retrieval (used by POST /sessions/:id/decide to link). */
  projectIds?: string[];
  /** Set once the user commits via POST /sessions/:id/decide. */
  decisionId?: string;
}

interface Participant {
  agent: Agent;
  name: string;
  isCustom: boolean;
}

export class CEOOrchestrator {
  private client: Anthropic;

  constructor(
    private omnimind: OmniMindClient,
    apiKey: string
  ) {
    this.client = createAnthropicClient(apiKey);
  }

  /**
   * Fetch the core context block ONCE per dispatch. Identical bytes go to
   * every persona (and the CEO) so all calls share a single cache entry.
   * Failure degrades to an empty block — never blocks a session.
   */
  private async ensureCoreContext(session: SessionState, force: boolean = false): Promise<string> {
    if (!force && typeof session.coreContext === 'string') return session.coreContext;
    try {
      const core = await this.omnimind.getCoreContext(session.userId);
      session.coreContext = typeof core?.block === 'string' ? core.block : '';
      logger.debug('[CoreContext] fetched', { sessionId: session.id, hash: core?.hash, tokensEstimate: core?.tokensEstimate });
    } catch (err) {
      logger.warn('[CoreContext] unavailable — continuing without shared block', {
        sessionId: session.id, message: err instanceof Error ? err.message : String(err),
      });
      session.coreContext = '';
    }
    return session.coreContext;
  }

  private premortemBlock(session: SessionState): string | null {
    return session.mode === 'premortem' ? loadSystemPrompt('premortem') : null;
  }

  private rememberProjectIds(session: SessionState, items: ContextItem[]): void {
    const ids = new Set(session.projectIds ?? []);
    for (const item of items) if (item.type === 'project' && item.id) ids.add(item.id);
    session.projectIds = Array.from(ids);
  }

  async dispatch(session: SessionState, res: Response, signal?: AbortSignal): Promise<void> {
    initSSE(res);
    const start = Date.now();
    const modeConfig = MODE_CONFIGS[session.mode];
    const personaIds = modeConfig.personas as PersonaId[];

    // Phase 6 — one core-context fetch per dispatch, shared by every call below.
    const coreContext = await this.ensureCoreContext(session, true);
    const premortem = this.premortemBlock(session);

    // B-112 — quick-take: no persona fan-out; the CEO synthesises directly over
    // the question. Emits the SAME `synthesis_complete` event the synthesize
    // route emits, then `dispatch_complete` (CONTRACT with QuickTakeWidget).
    if (personaIds.length === 0 && modeConfig.includesCEO) {
      await this.runSynthesis(session, res, signal);
      sendSSE(res, { type: 'dispatch_complete', personaCount: 0, durationMs: Date.now() - start });
      res.end();
      return;
    }

    // Fetch custom personas for this user
    let activeCustom: CustomPersona[] = [];
    try {
      const customPersonas = await this.omnimind.getCustomPersonas(session.userId) as CustomPersona[];
      activeCustom = customPersonas.filter((p: CustomPersona) => p.isActive);
    } catch {
      // If custom personas fetch fails, continue with built-in only
    }

    const participants = new Map<PersonaId, Participant>();
    const agentOptions = {
      coreContext,
      extraSystemBlocks: premortem ? [premortem] : [],
      sessionId: session.id,
      userId: session.userId,
    };

    // Built-in persona promises
    const builtInPromises = personaIds.map(async (personaId) => {
      // B-114 — per-persona context strategy (maxItems cap + entity focus) is
      // now actually sent to OmniMind instead of being computed and dropped.
      // Phase 6 — persona-specific query rewrite, Critic archived/DECISION, asOf.
      const contextRes = await this.omnimind.getContextForPersona(
        getContextRequest(personaId, session.question, session.userId, { asOf: session.asOf }),
      ) as { items: ContextItem[] };
      this.rememberProjectIds(session, contextRes.items ?? []);

      const config = PERSONA_CONFIGS[personaId];
      const prompt = loadPrompt(personaId);
      const agent = new Agent(config, this.client, prompt, agentOptions);
      participants.set(personaId, { agent, name: config.name, isCustom: false });

      // Check if this persona has tool permissions
      const tools = toolRegistry.getToolsForPersona(personaId);
      if (tools.length > 0) {
        // Use tool-enabled non-streaming path
        const toolExecutor = (name: string, input: Record<string, unknown>) =>
          toolRegistry.execute(name, input, session.id);

        sendSSE(res, { type: 'persona_start', personaId, model: config.model });
        try {
          const { response, toolInvocations } = await agent.reasonWithTools(
            session.question, contextRes.items, tools, toolExecutor, 3, signal
          );
          sendSSE(res, { type: 'persona_complete', personaId, response, toolInvocations });
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          sendSSE(res, { type: 'persona_error', personaId, error: message });
          return null;
        }
      }

      // No tools — use existing streaming path (unchanged)
      return agent.reasonStreaming(session.question, contextRes.items, res, personaId, signal);
    });

    // Custom persona promises
    const customPromises = activeCustom.map(async (cp: CustomPersona) => {
      const contextRes = await this.omnimind.getContextForPersona(
        getContextRequest(cp.personaId as PersonaId, session.question, session.userId, { asOf: session.asOf }),
      ) as { items: ContextItem[] };
      this.rememberProjectIds(session, contextRes.items ?? []);

      const config = {
        id: cp.personaId as PersonaId,
        name: cp.name,
        model: cp.modelTier as 'haiku' | 'sonnet',
        maxOutputTokens: cp.maxOutputTokens,
        systemPromptPath: '',
      };

      // Append output schema instruction to custom prompt
      const promptWithSchema = `${cp.systemPrompt}\n\nRespond with valid JSON matching this schema:\n{"personaId":"${cp.personaId}","situationReading":"...","keyAssumptions":["..."],"analysis":"...","recommendation":"...","uncertainties":["..."],"sourceMemoryIds":["..."],"confidence":0.0-1.0,"dissentFlag":false}`;

      const agent = new Agent(config, this.client, promptWithSchema, agentOptions);
      participants.set(cp.personaId as PersonaId, { agent, name: cp.name, isCustom: true });

      // Check tool permissions — custom personas only get tools they've been granted
      const tools = toolRegistry.getToolsForPersona(cp.personaId as PersonaId);
      const allowedTools = tools.filter(t => cp.toolPermissions.includes(t.name));

      if (allowedTools.length > 0) {
        const toolExecutor = (name: string, input: Record<string, unknown>) =>
          toolRegistry.execute(name, input, session.id);

        sendSSE(res, { type: 'persona_start', personaId: cp.personaId, model: cp.modelTier, isCustom: true });
        try {
          const { response, toolInvocations } = await agent.reasonWithTools(
            session.question, contextRes.items, allowedTools, toolExecutor, 3, signal
          );
          sendSSE(res, { type: 'persona_complete', personaId: cp.personaId, response, toolInvocations, isCustom: true });
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          sendSSE(res, { type: 'persona_error', personaId: cp.personaId, error: message, isCustom: true });
          return null;
        }
      }

      return agent.reasonStreaming(session.question, contextRes.items, res, cp.personaId as PersonaId, signal);
    });

    // Combine all promises — round 1 is fully independent and parallel.
    const results = await Promise.allSettled([...builtInPromises, ...customPromises]);

    let personaCount = 0;
    // Map built-in results
    for (let i = 0; i < personaIds.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        session.personaResponses.set(personaIds[i], result.value);
        personaCount++;
      }
    }
    // Map custom persona results
    for (let i = 0; i < activeCustom.length; i++) {
      const result = results[personaIds.length + i];
      if (result.status === 'fulfilled' && result.value) {
        session.personaResponses.set(activeCustom[i].personaId as PersonaId, result.value);
        personaCount++;
      }
    }

    // Phase 6 — round 2 (debate protocol) + ledger. Emits rebuttal_* events
    // BEFORE dispatch_complete so the client sees them inside the same stream.
    const rebuttalCount = await this.runDebateRound(session, participants, res, signal);

    const durationMs = Date.now() - start;
    sendSSE(res, { type: 'dispatch_complete', personaCount, durationMs, rebuttalCount });
    res.end();
  }

  /**
   * Debate protocol round 2. Dissenting / minority personas get ONE call each
   * with the other outputs anonymized. Builds `session.ledger` deterministically
   * (also when no rebuttal ran, so the CEO still sees the split). Returns the
   * number of successful rebuttals. Never throws.
   */
  private async runDebateRound(
    session: SessionState,
    participants: Map<PersonaId, Participant>,
    res: Response,
    signal?: AbortSignal,
  ): Promise<number> {
    session.rebuttals = session.rebuttals ?? new Map();
    const responses = session.personaResponses;
    if (responses.size < 2) { session.ledger = []; return 0; }

    const cluster = clusterByMajority(responses);
    let completed = 0;

    if (debateEnabled() && !signal?.aborted) {
      const rebutters = selectRebutters(cluster, responses, maxRebuttals())
        .filter(id => participants.has(id));
      let rebuttalPrompt: string | null = null;
      try { rebuttalPrompt = loadSystemPrompt('rebuttal'); } catch (err) {
        logger.warn('[Debate] rebuttal prompt missing — skipping round 2', { message: err instanceof Error ? err.message : String(err) });
      }

      if (rebuttalPrompt && rebutters.length > 0) {
        const outcomes = await Promise.allSettled(rebutters.map(async (personaId) => {
          const own = responses.get(personaId)!;
          const others = Array.from(responses.entries()).filter(([id]) => id !== personaId);
          sendSSE(res, { type: 'rebuttal_start', personaId });
          try {
            const rebuttal = await participants.get(personaId)!.agent.rebut(
              buildRebuttalUserMessage(session.question, own, others), rebuttalPrompt!, signal,
            );
            session.rebuttals!.set(personaId, rebuttal);
            sendSSE(res, {
              type: 'rebuttal_complete',
              personaId,
              stance: rebuttal.stance,
              reason: rebuttal.reason,
              revisedRecommendation: rebuttal.revisedRecommendation,
              revisedConfidence: rebuttal.revisedConfidence,
            });
            return rebuttal;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Rebuttal failed';
            logger.warn('[Debate] rebuttal failed', { sessionId: session.id, personaId, message });
            sendSSE(res, { type: 'rebuttal_error', personaId, error: message });
            throw error;
          }
        }));
        completed = outcomes.filter(o => o.status === 'fulfilled').length;
      }
    }

    session.ledger = buildDisagreementLedger(responses, session.rebuttals, cluster);
    logger.info('[Debate] round 2 done', {
      sessionId: session.id, majority: cluster.majority, dissenters: cluster.dissenters,
      rebuttals: completed, ledgerRows: session.ledger.length,
    });
    return completed;
  }

  async synthesize(session: SessionState, res: Response, signal?: AbortSignal): Promise<void> {
    initSSE(res);
    await this.runSynthesis(session, res, signal);
    res.end();
  }

  /**
   * CEO synthesis over whatever persona responses the session holds (zero for
   * quick-take). Streams `synthesis_start` → `delta`* → `synthesis_complete`
   * (or `error`). Does NOT init or end the SSE response — callers do that so
   * dispatch (quick-take) and synthesize can share it.
   *
   * B-105: the former `reasonWithTools` CEO pre-pass (which always threw
   * FALLBACK_TO_STREAMING and doubled CEO cost/latency) is gone — synthesis
   * streams exactly once. Tool infrastructure is untouched.
   *
   * Phase 6: system = cached `[core, ceo prompt(, premortem)]`; the
   * DisagreementLedger arrives as a separate user content block; the report
   * gains `ledgerResolutions` (model) and `droppedConsiderations` (computed).
   */
  private async runSynthesis(session: SessionState, res: Response, signal?: AbortSignal): Promise<void> {
    const coreContext = await this.ensureCoreContext(session);
    const premortem = this.premortemBlock(session);
    const rebuttals = session.rebuttals ?? new Map<PersonaId, Rebuttal>();

    const formattedOutputs = Array.from(session.personaResponses.entries())
      .map(([id, resp]) => {
        const config = PERSONA_CONFIGS[id as BuiltInPersonaId];
        const name = config?.name ?? id;
        const isCustom = !config;
        return formatPersonaForCEO(name, resp, isCustom, rebuttals.get(id));
      })
      .join('\n\n');

    // Fetch past outcomes and thinking patterns
    let outcomeContext = '';
    let patternContext = '';

    try {
      const pastDecisions = await this.omnimind.getDecisions(session.userId, { status: 'REVIEWED', limit: '5' }) as any;
      if (pastDecisions?.items?.length > 0) {
        outcomeContext = `\n\n## Past Relevant Outcomes\n${pastDecisions.items.map((d: any) =>
          `- "${d.title}": Chose ${d.chosenPath ?? 'unknown path'}. Outcome: ${d.outcome ?? 'pending'} (${d.outcomeRating ?? '?'}/5)`
        ).join('\n')}`;
      }
    } catch { /* outcome fetch failed — proceed without */ }

    try {
      const patterns = await this.omnimind.getPatterns(session.userId) as any;
      if (patterns?.items?.length > 0) {
        patternContext = `\n\n## Your Thinking Patterns\n${patterns.items.map((p: any) =>
          `- ${p.pattern} (${p.patternType}, confidence: ${p.confidence})`
        ).join('\n')}`;
      }
    } catch { /* pattern fetch failed — proceed without */ }

    const prompt = loadPrompt('ceo');
    const model = MODEL_IDS[PERSONA_CONFIGS.ceo.model];
    const purpose = session.mode === 'premortem' ? 'premortem' : 'ceo';
    let fullText = '';

    sendSSE(res, { type: 'synthesis_start', model: 'sonnet' });

    const perspectives = formattedOutputs
      || '(No persona perspectives — this is a quick take. Analyze the question directly and still complete every SynthesisReport field.)';
    const ledgerText = formatLedgerForCEO(session.ledger ?? []);
    const content: Anthropic.TextBlockParam[] = [
      { type: 'text', text: `## Original Question\n${session.question}\n\n## Persona Perspectives\n${perspectives}${outcomeContext}${patternContext}` },
      ...(ledgerText ? [{ type: 'text' as const, text: ledgerText }] : []),
      { type: 'text', text: `Synthesize into a SynthesisReport JSON${ledgerText ? ' (include one ledgerResolutions entry per ledger row)' : ' (ledgerResolutions: [])'}. No markdown wrapping.` },
    ];

    const startedAt = Date.now();
    try {
      const stream = await this.client.messages.stream({
        model,
        max_tokens: PERSONA_CONFIGS.ceo.maxOutputTokens,
        system: buildSystemBlocks({ coreContext, prompt, extra: [premortem] }),
        output_config: { effort: EFFORT.ceo },
        messages: [{ role: 'user', content }],
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sendSSE(res, { type: 'delta', text: event.delta.text });
        }
      }

      if (typeof (stream as { finalMessage?: unknown }).finalMessage === 'function') {
        const final = await stream.finalMessage();
        recordUsage({ purpose, model, usage: final.usage, durationMs: Date.now() - startedAt, sessionId: session.id, userId: session.userId });
      }

      const parsed = JSON.parse(stripJsonFences(fullText));
      const report = SynthesisReportSchema.parse(parsed) as SynthesisReport;
      // Phase 6 — server-side fact-survival check; never ask the model for it.
      report.droppedConsiderations = computeDroppedConsiderations(session.personaResponses.values(), report);
      report.ledgerResolutions = report.ledgerResolutions ?? [];
      session.synthesis = report;

      const qualityScore = scoreSynthesisQuality(report, Array.from(session.personaResponses.values()));
      logger.info('[Synthesis] Quality score', {
        sessionId: session.id, qualityScore, dropped: report.droppedConsiderations.length, ledgerRows: session.ledger?.length ?? 0,
      });

      sendSSE(res, { type: 'synthesis_complete', report, qualityScore, ledger: session.ledger ?? [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synthesis failed';
      sendSSE(res, { type: 'error', error: message });
    }
  }

  async runQuestionnaire(session: SessionState, signal?: AbortSignal): Promise<QuestionnaireResponse> {
    const config = PERSONA_CONFIGS.questionnaire;
    const prompt = loadPrompt('questionnaire');
    const model = MODEL_IDS[config.model];
    const startedAt = Date.now();

    const response = await this.client.messages.create({
      model,
      max_tokens: config.maxOutputTokens,
      system: buildSystemBlocks({ coreContext: session.coreContext, prompt }),
      output_config: { effort: EFFORT.persona },
      messages: [{ role: 'user', content: `## Question\n${session.question}\n\nReturn QuestionnaireResponse JSON.` }],
    }, { signal });
    recordUsage({ purpose: 'questionnaire', model, usage: response.usage, durationMs: Date.now() - startedAt, sessionId: session.id, userId: session.userId });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty questionnaire response');
    return QuestionnaireResponseSchema.parse(JSON.parse(stripJsonFences(text.text))) as QuestionnaireResponse;
  }

  async runDoer(session: SessionState, signal?: AbortSignal): Promise<unknown> {
    const config = PERSONA_CONFIGS.doer;
    const prompt = loadPrompt('doer');
    const model = MODEL_IDS[config.model];
    const startedAt = Date.now();

    const synthesisContext = session.synthesis ? JSON.stringify(session.synthesis) : 'No synthesis available';

    const response = await this.client.messages.create({
      model,
      max_tokens: config.maxOutputTokens,
      system: buildSystemBlocks({ coreContext: session.coreContext, prompt }),
      output_config: { effort: EFFORT.persona },
      messages: [{
        role: 'user',
        content: `## Original Question\n${session.question}\n\n## CEO Synthesis\n${synthesisContext}\n\nGenerate task breakdown JSON.`,
      }],
    }, { signal });
    recordUsage({ purpose: 'doer', model, usage: response.usage, durationMs: Date.now() - startedAt, sessionId: session.id, userId: session.userId });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty doer response');
    return DoerTaskBreakdownSchema.parse(JSON.parse(stripJsonFences(text.text)));
  }
}
