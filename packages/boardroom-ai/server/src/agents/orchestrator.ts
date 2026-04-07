import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import type { PersonaId, PersonaResponse, SynthesisReport, QuestionnaireResponse } from '@boardroom/shared';
import { SynthesisReportSchema, QuestionnaireResponseSchema } from '@boardroom/shared';
import { PERSONA_CONFIGS, MODEL_MAP } from '@boardroom/shared';
import { MODE_CONFIGS, type UserMode } from '@boardroom/shared';
import { Agent } from './agent';
import { initSSE } from './streaming';
import { loadPrompt } from '../lib/prompt-loader';
import type { OmniMindClient } from '../services/omnimind-client';

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

    const results = await Promise.allSettled(
      personaIds.map(async (personaId) => {
        const contextRes = await this.omnimind.getContextForPersona({
          query: session.question,
          persona: personaId,
          userId: session.userId,
        }) as { items: import('@boardroom/shared').ContextItem[] };

        const config = PERSONA_CONFIGS[personaId];
        const prompt = loadPrompt(personaId);
        const agent = new Agent(config, this.client, prompt);

        return agent.reasonStreaming(session.question, contextRes.items, res, personaId);
      })
    );

    let personaCount = 0;
    for (let i = 0; i < personaIds.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        session.personaResponses.set(personaIds[i], result.value);
        personaCount++;
      }
    }

    const durationMs = Date.now() - start;
    res.write(`data: ${JSON.stringify({ type: 'dispatch_complete', personaCount, durationMs })}\n\n`);
    res.end();
  }

  async synthesize(session: SessionState, res: Response): Promise<void> {
    initSSE(res);

    const personaOutputs = Array.from(session.personaResponses.entries())
      .map(([id, resp]) => `## ${PERSONA_CONFIGS[id].name}\n${JSON.stringify(resp, null, 2)}`)
      .join('\n\n');

    const prompt = loadPrompt('ceo');
    const model = MODEL_MAP[PERSONA_CONFIGS.ceo.model];
    let fullText = '';

    res.write(`data: ${JSON.stringify({ type: 'synthesis_start', model: 'sonnet' })}\n\n`);

    try {
      const stream = await this.client.messages.stream({
        model,
        max_tokens: PERSONA_CONFIGS.ceo.maxOutputTokens,
        system: prompt,
        messages: [{
          role: 'user',
          content: `## Original Question\n${session.question}\n\n## Persona Perspectives\n${personaOutputs}\n\nSynthesize into a SynthesisReport JSON. No markdown wrapping.`,
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

      res.write(`data: ${JSON.stringify({ type: 'synthesis_complete', report })}\n\n`);
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
