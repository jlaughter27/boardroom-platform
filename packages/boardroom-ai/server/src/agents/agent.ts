import Anthropic from '@anthropic-ai/sdk';
import type { PersonaConfig, PersonaResponse, PersonaId, ToolResult } from '@boardroom/shared';
import type { ContextItem } from '@boardroom/shared';
import { PersonaResponseSchema } from '@boardroom/shared';
import { MODEL_MAP } from '@boardroom/shared';
import type { Response } from 'express';
import type { AnthropicToolDef } from '../tools/tool-registry';
import { sendSSE } from './streaming';

/**
 * B-120 — Memory content is untrusted (Gmail imports, API writes). Neutralise
 * any closing/opening tag sequences so content cannot break out of the
 * <user_memory> envelope or forge sibling tags. Only `</` and `<user_memory`
 * are rewritten; everything else is preserved verbatim.
 */
export function escapeMemoryContent(content: string): string {
  return String(content)
    .replace(/<\//g, '&lt;/')
    .replace(/<user_memory/gi, '&lt;user_memory');
}

export class Agent {
  constructor(
    private config: PersonaConfig,
    private client: Anthropic,
    private systemPrompt: string
  ) {}

  /**
   * Non-streaming reasoning. Returns validated PersonaResponse.
   */
  async reason(question: string, context: ContextItem[], signal?: AbortSignal): Promise<PersonaResponse> {
    const userMessage = this.buildUserMessage(question, context);
    const model = MODEL_MAP[this.config.model];

    const response = await this.client.messages.create({
      model,
      max_tokens: this.config.maxOutputTokens,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }, { signal });

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
    personaId: PersonaId,
    signal?: AbortSignal
  ): Promise<PersonaResponse | null> {
    const userMessage = this.buildUserMessage(question, context);
    const model = MODEL_MAP[this.config.model];
    let fullText = '';

    try {
      sendSSE(res, { type: 'persona_start', personaId, model: this.config.model });

      const stream = await this.client.messages.stream({
        model,
        max_tokens: this.config.maxOutputTokens,
        system: this.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sendSSE(res, { type: 'delta', personaId, text: event.delta.text });
        }
      }

      const jsonStr = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const validated = PersonaResponseSchema.parse(parsed) as PersonaResponse;

      sendSSE(res, { type: 'persona_complete', personaId, response: validated });
      return validated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendSSE(res, { type: 'persona_error', personaId, error: message });
      return null;
    }
  }

  /**
   * Non-streaming reasoning with tool use support. Runs tool loop up to maxToolRounds.
   */
  async reasonWithTools(
    question: string,
    context: ContextItem[],
    tools: AnthropicToolDef[],
    toolExecutor: (name: string, input: Record<string, unknown>) => Promise<ToolResult>,
    maxToolRounds: number = 3,
    signal?: AbortSignal
  ): Promise<{ response: PersonaResponse; toolInvocations: ToolResult[] }> {
    const userMessage = this.buildUserMessage(question, context);
    const model = MODEL_MAP[this.config.model];
    const allInvocations: ToolResult[] = [];

    let messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    for (let round = 0; round <= maxToolRounds; round++) {
      const response = await this.client.messages.create({
        model,
        max_tokens: this.config.maxOutputTokens,
        system: this.systemPrompt,
        messages,
        ...(tools.length > 0 ? { tools: tools as Anthropic.Tool[] } : {}),
      }, { signal });

      // Check for tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        // No tool use — extract text response
        const textBlock = response.content.find(
          (b): b is Anthropic.TextBlock => b.type === 'text'
        );
        if (!textBlock) throw new Error('Empty response from LLM');

        const jsonStr = textBlock.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        const validated = PersonaResponseSchema.parse(parsed) as PersonaResponse;
        return { response: validated, toolInvocations: allInvocations };
      }

      // Execute tools and build tool_result messages
      const assistantContent = response.content;
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const result = await toolExecutor(block.name, block.input as Record<string, unknown>);
        allInvocations.push(result);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.output,
        });
      }

      // Continue conversation with tool results
      messages = [
        ...messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      ];
    }

    throw new Error('Max tool rounds exceeded');
  }

  private buildUserMessage(question: string, context: ContextItem[]): string {
    const contextBlock = context.map(item =>
      `<user_memory source="${item.source}" relevance="${item.relevanceScore}">\n[${item.type.toUpperCase()}] ${escapeMemoryContent(item.content)}\n</user_memory>`
    ).join('\n\n');

    return `## Context\n${contextBlock || '(No context available)'}\n\n## Question\n${question}\n\nRespond with valid JSON matching the required output format. No markdown wrapping.`;
  }
}
