import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import type { PersonaId, BuiltInPersonaId, PersonaResponse, SynthesisReport, QuestionnaireResponse, CustomPersona } from '@boardroom/shared';
import { SynthesisReportSchema, QuestionnaireResponseSchema, DoerTaskBreakdownSchema } from '@boardroom/shared';
import { PERSONA_CONFIGS, MODEL_MAP } from '@boardroom/shared';
import { MODE_CONFIGS, type UserMode } from '@boardroom/shared';
import { Agent } from './agent';
import { initSSE, sendSSE } from './streaming';
import { loadPrompt } from '../lib/prompt-loader';
import type { OmniMindClient } from '../services/omnimind-client';
import { toolRegistry } from '../tools';
import { getContextRequest } from '../personas/context-strategy';
import { logger } from '../lib/logger';

function formatPersonaForCEO(name: string, response: PersonaResponse, isCustom: boolean = false): string {
  const confidenceLabel = response.confidence >= 0.7 ? 'high' : response.confidence >= 0.4 ? 'medium' : 'low';
  const customLabel = isCustom ? ' (custom)' : '';
  return `## ${name}${customLabel} (${confidenceLabel} confidence)
**Reading:** ${response.situationReading}
**Recommendation:** ${response.recommendation}
**Key Assumptions:** ${response.keyAssumptions.join('; ')}
**Uncertainties:** ${response.uncertainties.join('; ')}
${response.dissentFlag ? '⚠️ DISSENT: This persona fundamentally disagrees with the emerging consensus.' : ''}`;
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
}

export class CEOOrchestrator {
  private client: Anthropic;

  constructor(
    private omnimind: OmniMindClient,
    apiKey: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async dispatch(session: SessionState, res: Response, signal?: AbortSignal): Promise<void> {
    initSSE(res);
    const start = Date.now();
    const modeConfig = MODE_CONFIGS[session.mode];
    const personaIds = modeConfig.personas as PersonaId[];

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

    // Built-in persona promises
    const builtInPromises = personaIds.map(async (personaId) => {
      // B-114 — per-persona context strategy (maxItems cap + entity focus) is
      // now actually sent to OmniMind instead of being computed and dropped.
      const contextRes = await this.omnimind.getContextForPersona(
        getContextRequest(personaId, session.question, session.userId),
      ) as { items: import('@boardroom/shared').ContextItem[] };

      const config = PERSONA_CONFIGS[personaId];
      const prompt = loadPrompt(personaId);
      const agent = new Agent(config, this.client, prompt);

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
        getContextRequest(cp.personaId as PersonaId, session.question, session.userId),
      ) as { items: import('@boardroom/shared').ContextItem[] };

      const config = {
        id: cp.personaId as PersonaId,
        name: cp.name,
        model: cp.modelTier as 'haiku' | 'sonnet',
        maxOutputTokens: cp.maxOutputTokens,
        systemPromptPath: '',
      };

      // Append output schema instruction to custom prompt
      const promptWithSchema = `${cp.systemPrompt}\n\nRespond with valid JSON matching this schema:\n{"personaId":"${cp.personaId}","situationReading":"...","keyAssumptions":["..."],"analysis":"...","recommendation":"...","uncertainties":["..."],"sourceMemoryIds":["..."],"confidence":0.0-1.0,"dissentFlag":false}`;

      const agent = new Agent(config, this.client, promptWithSchema);

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

    // Combine all promises
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

    const durationMs = Date.now() - start;
    sendSSE(res, { type: 'dispatch_complete', personaCount, durationMs });
    res.end();
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
   */
  private async runSynthesis(session: SessionState, res: Response, signal?: AbortSignal): Promise<void> {
    const formattedOutputs = Array.from(session.personaResponses.entries())
      .map(([id, resp]) => {
        const config = PERSONA_CONFIGS[id as BuiltInPersonaId];
        const name = config?.name ?? id;
        const isCustom = !config;
        return formatPersonaForCEO(name, resp, isCustom);
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
    const model = MODEL_MAP[PERSONA_CONFIGS.ceo.model];
    let fullText = '';

    sendSSE(res, { type: 'synthesis_start', model: 'sonnet' });

    const perspectives = formattedOutputs
      || '(No persona perspectives — this is a quick take. Analyze the question directly and still complete every SynthesisReport field.)';
    const userContent = `## Original Question\n${session.question}\n\n## Persona Perspectives\n${perspectives}${outcomeContext}${patternContext}\n\nSynthesize into a SynthesisReport JSON. No markdown wrapping.`;

    try {
      const stream = await this.client.messages.stream({
        model,
        max_tokens: PERSONA_CONFIGS.ceo.maxOutputTokens,
        system: prompt,
        messages: [{
          role: 'user',
          content: userContent,
        }],
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sendSSE(res, { type: 'delta', text: event.delta.text });
        }
      }

      const jsonStr = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const report = SynthesisReportSchema.parse(parsed) as SynthesisReport;
      session.synthesis = report;

      const qualityScore = scoreSynthesisQuality(report, Array.from(session.personaResponses.values()));
      logger.info('[Synthesis] Quality score', { sessionId: session.id, qualityScore });

      sendSSE(res, { type: 'synthesis_complete', report, qualityScore });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synthesis failed';
      sendSSE(res, { type: 'error', error: message });
    }
  }

  async runQuestionnaire(session: SessionState, signal?: AbortSignal): Promise<QuestionnaireResponse> {
    const config = PERSONA_CONFIGS.questionnaire;
    const prompt = loadPrompt('questionnaire');

    const response = await this.client.messages.create({
      model: MODEL_MAP[config.model],
      max_tokens: config.maxOutputTokens,
      system: prompt,
      messages: [{ role: 'user', content: `## Question\n${session.question}\n\nReturn QuestionnaireResponse JSON.` }],
    }, { signal });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty questionnaire response');
    const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return QuestionnaireResponseSchema.parse(JSON.parse(jsonStr)) as QuestionnaireResponse;
  }

  async runDoer(session: SessionState, signal?: AbortSignal): Promise<unknown> {
    const config = PERSONA_CONFIGS.doer;
    const prompt = loadPrompt('doer');

    const synthesisContext = session.synthesis ? JSON.stringify(session.synthesis) : 'No synthesis available';

    const response = await this.client.messages.create({
      model: MODEL_MAP[config.model],
      max_tokens: config.maxOutputTokens,
      system: prompt,
      messages: [{
        role: 'user',
        content: `## Original Question\n${session.question}\n\n## CEO Synthesis\n${synthesisContext}\n\nGenerate task breakdown JSON.`,
      }],
    }, { signal });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty doer response');
    const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return DoerTaskBreakdownSchema.parse(JSON.parse(jsonStr));
  }
}
