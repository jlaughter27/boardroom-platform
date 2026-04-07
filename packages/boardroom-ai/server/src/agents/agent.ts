import Anthropic from '@anthropic-ai/sdk';
import type { PersonaConfig, PersonaResponse, PersonaId } from '@boardroom/shared';
import type { ContextItem } from '@boardroom/shared';
import { PersonaResponseSchema } from '@boardroom/shared';
import { MODEL_MAP } from '@boardroom/shared';
import type { Response } from 'express';

export class Agent {
  constructor(
    private config: PersonaConfig,
    private client: Anthropic,
    private systemPrompt: string
  ) {}

  /**
   * Non-streaming reasoning. Returns validated PersonaResponse.
   */
  async reason(question: string, context: ContextItem[]): Promise<PersonaResponse> {
    const userMessage = this.buildUserMessage(question, context);
    const model = MODEL_MAP[this.config.model];

    const response = await this.client.messages.create({
      model,
      max_tokens: this.config.maxOutputTokens,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0];
    if (!text || text.type !== 'text') throw new Error('Empty response from LLM');

    const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return PersonaResponseSchema.parse(parsed) as PersonaResponse;
  }

  /**
   * Streaming reasoning. Sends SSE events and returns final validated response.
   */
  async reasonStreaming(
    question: string,
    context: ContextItem[],
    res: Response,
    personaId: PersonaId
  ): Promise<PersonaResponse | null> {
    const userMessage = this.buildUserMessage(question, context);
    const model = MODEL_MAP[this.config.model];
    let fullText = '';

    try {
      res.write(`data: ${JSON.stringify({ type: 'persona_start', personaId, model: this.config.model })}\n\n`);

      const stream = await this.client.messages.stream({
        model,
        max_tokens: this.config.maxOutputTokens,
        system: this.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          res.write(`data: ${JSON.stringify({ type: 'delta', personaId, text: event.delta.text })}\n\n`);
        }
      }

      const jsonStr = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const validated = PersonaResponseSchema.parse(parsed) as PersonaResponse;

      res.write(`data: ${JSON.stringify({ type: 'persona_complete', personaId, response: validated })}\n\n`);
      return validated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.write(`data: ${JSON.stringify({ type: 'persona_error', personaId, error: message })}\n\n`);
      return null;
    }
  }

  private buildUserMessage(question: string, context: ContextItem[]): string {
    const contextBlock = context.map(item =>
      `<user_memory source="${item.source}" relevance="${item.relevanceScore}">\n[${item.type.toUpperCase()}] ${item.content}\n</user_memory>`
    ).join('\n\n');

    return `## Context\n${contextBlock || '(No context available)'}\n\n## Question\n${question}\n\nRespond with valid JSON matching the required output format. No markdown wrapping.`;
  }
}
