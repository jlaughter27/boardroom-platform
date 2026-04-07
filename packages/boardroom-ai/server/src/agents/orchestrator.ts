import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import type { PersonaId, BuiltInPersonaId, PersonaResponse, SynthesisReport, QuestionnaireResponse, CustomPersona } from '@boardroom/shared';
import { SynthesisReportSchema, QuestionnaireResponseSchema } from '@boardroom/shared';
import { PERSONA_CONFIGS, MODEL_MAP } from '@boardroom/shared';
import { MODE_CONFIGS, type UserMode } from '@boardroom/shared';
import { Agent } from './agent';
import { initSSE } from './streaming';
import { loadPrompt } from '../lib/prompt-loader';
import type { OmniMindClient } from '../services/omnimind-client';
import { toolRegistry } from '../tools';
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

  async dispatch(session: SessionState, res: Response): Promise<void> {
    initSSE(res);
    const start = Date.now();
    const modeConfig = MODE_CONFIGS[session.mode];
    const personaIds = modeConfig.personas as PersonaId[];

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
      const contextRes = await this.omnimind.getContextForPersona({
        query: session.question,
        persona: personaId,
        userId: session.userId,
      }) as { items: import('@boardroom/shared').ContextItem[] };

      const config = PERSONA_CONFIGS[personaId];
      const prompt = loadPrompt(personaId);
      const agent = new Agent(config, this.client, prompt);

      // Check if this persona has tool permissions
      const tools = toolRegistry.getToolsForPersona(personaId);
      if (tools.length > 0) {
        // Use tool-enabled non-streaming path
        const toolExecutor = (name: string, input: Record<string, unknown>) =>
          toolRegistry.execute(name, input, session.id);

        res.write(`data: ${JSON.stringify({ type: 'persona_start', personaId, model: config.model })}\n\n`);
        try {
          const { response, toolInvocations } = await agent.reasonWithTools(
            session.question, contextRes.items, tools, toolExecutor
          );
          res.write(`data: ${JSON.stringify({ type: 'persona_complete', personaId, response, toolInvocations })}\n\n`);
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          res.write(`data: ${JSON.stringify({ type: 'persona_error', personaId, error: message })}\n\n`);
          return null;
        }
      }

      // No tools — use existing streaming path (unchanged)
      return agent.reasonStreaming(session.question, contextRes.items, res, personaId);
    });

    // Custom persona promises
    const customPromises = activeCustom.map(async (cp: CustomPersona) => {
      const contextRes = await this.omnimind.getContextForPersona({
        query: session.question,
        persona: cp.personaId,
        userId: session.userId,
      }) as { items: import('@boardroom/shared').ContextItem[] };

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

        res.write(`data: ${JSON.stringify({ type: 'persona_start', personaId: cp.personaId, model: cp.modelTier, isCustom: true })}\n\n`);
        try {
          const { response, toolInvocations } = await agent.reasonWithTools(
            session.question, contextRes.items, allowedTools, toolExecutor
          );
          res.write(`data: ${JSON.stringify({ type: 'persona_complete', personaId: cp.personaId, response, toolInvocations, isCustom: true })}\n\n`);
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          res.write(`data: ${JSON.stringify({ type: 'persona_error', personaId: cp.personaId, error: message, isCustom: true })}\n\n`);
          return null;
        }
      }

      return agent.reasonStreaming(session.question, contextRes.items, res, cp.personaId as PersonaId);
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
    res.write(`data: ${JSON.stringify({ type: 'dispatch_complete', personaCount, durationMs })}\n\n`);
    res.end();
  }

  async synthesize(session: SessionState, res: Response): Promise<void> {
    initSSE(res);

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

    res.write(`data: ${JSON.stringify({ type: 'synthesis_start', model: 'sonnet' })}\n\n`);

    // CEO has tool access — use tool-enabled path if tools available
    const ceoTools = toolRegistry.getToolsForPersona('ceo');
    const userContent = `## Original Question\n${session.question}\n\n## Persona Perspectives\n${formattedOutputs}${outcomeContext}${patternContext}\n\nSynthesize into a SynthesisReport JSON. No markdown wrapping.`;

    try {
      if (ceoTools.length > 0) {
        // Tool-enabled non-streaming synthesis
        const ceoConfig = PERSONA_CONFIGS.ceo;
        const agent = new Agent(ceoConfig, this.client, prompt);
        const toolExecutor = (name: string, input: Record<string, unknown>) =>
          toolRegistry.execute(name, input, session.id);

        // Build context items from persona outputs for the agent interface
        const contextItems: import('@boardroom/shared').ContextItem[] = [{
          source: 'persona_synthesis',
          type: 'decision',
          content: formattedOutputs,
          relevanceScore: 1.0,
        }];

        const { response } = await agent.reasonWithTools(
          session.question, contextItems, ceoTools, toolExecutor
        );

        // The CEO reasonWithTools returns PersonaResponse — we need SynthesisReport
        // Fall back to direct API call for proper schema validation
        // For v1, use streaming path with tools disabled for synthesis
        // (CEO tool_use is primarily valuable in dispatch, not synthesis)
        throw new Error('FALLBACK_TO_STREAMING');
      }
    } catch (toolErr) {
      // Fall through to streaming path (either intentional fallback or tool error)
    }

    // Streaming synthesis path (existing behavior)
    try {
      const stream = await this.client.messages.stream({
        model,
        max_tokens: PERSONA_CONFIGS.ceo.maxOutputTokens,
        system: prompt,
        messages: [{
          role: 'user',
          content: userContent,
        }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
        }
      }

      const jsonStr = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const report = SynthesisReportSchema.parse(parsed) as SynthesisReport;
      session.synthesis = report;

      const qualityScore = scoreSynthesisQuality(report, Array.from(session.personaResponses.values()));
      logger.info('[Synthesis] Quality score', { sessionId: session.id, qualityScore });

      res.write(`data: ${JSON.stringify({ type: 'synthesis_complete', report, qualityScore })}\n\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synthesis failed';
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
    }

    res.end();
  }

  async runQuestionnaire(session: SessionState): Promise<QuestionnaireResponse> {
    const config = PERSONA_CONFIGS.questionnaire;
    const prompt = loadPrompt('questionnaire');

    const response = await this.client.messages.create({
      model: MODEL_MAP[config.model],
      max_tokens: config.maxOutputTokens,
      system: prompt,
      messages: [{ role: 'user', content: `## Question\n${session.question}\n\nReturn QuestionnaireResponse JSON.` }],
    });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty questionnaire response');
    const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return QuestionnaireResponseSchema.parse(JSON.parse(jsonStr)) as QuestionnaireResponse;
  }

  async runDoer(session: SessionState): Promise<unknown> {
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
    });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty doer response');
    const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  }
}
