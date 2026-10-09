import Anthropic from '@anthropic-ai/sdk';
import type { PersonaConfig, PersonaResponse, PersonaId, ToolResult, Rebuttal } from '@boardroom/shared';
import type { ContextItem } from '@boardroom/shared';
import { PersonaResponseSchema, RebuttalSchema } from '@boardroom/shared';
import { MODEL_IDS } from '@boardroom/shared';
import type { Response } from 'express';
import type { AnthropicToolDef } from '../tools/tool-registry';
import { sendSSE } from './streaming';
import { buildSystemBlocks, stripJsonFences, firstText, assertNotTruncated, EFFORT, type Effort } from '../lib/llm-request';
import { recordUsage } from '../lib/llm-usage';

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

/**
 * Phase 6 — per-dispatch options. `coreContext` is the shared, deterministic
 * block fetched ONCE per dispatch and passed byte-identical to every persona so
 * all calls share a single prompt-cache entry.
 */
export interface AgentOptions {
  coreContext?: string | null;
  /** Trailing cached system blocks (pre-mortem framing). */
  extraSystemBlocks?: Array<string | null | undefined>;
  /** Defaults to `low` (personas / extractors). */
  effort?: Effort;
  /** LlmUsage purpose; defaults to `persona:<id>`. */
  purpose?: string;
  sessionId?: string;
  userId?: string;
}

/**
 * R-B-04 — round-2 rebuttal output cap per model tier. Sonnet 5.5 with
 * adaptive thinking spends part of `max_tokens` on reasoning, so the old flat
 * 800 cap truncated its JSON; Haiku 4.5 (no thinking) keeps the tight budget.
 */
export const REBUTTAL_MAX_TOKENS: Readonly<Record<'haiku' | 'sonnet', number>> = {
  haiku: 800,
  sonnet: 2000,
};

export class Agent {
  constructor(
    private config: PersonaConfig,
    private client: Anthropic,
    private systemPrompt: string,
    private options: AgentOptions = {},
  ) {}

  /** Cached system blocks: `[core context, persona prompt(, extra…)]`. */
  get systemBlocks(): Anthropic.TextBlockParam[] {
    return buildSystemBlocks({
      coreContext: this.options.coreContext,
      prompt: this.systemPrompt,
      extra: this.options.extraSystemBlocks,
    });
  }

  private get model(): string {
    return MODEL_IDS[this.config.model];
  }

  private get purpose(): string {
    return this.options.purpose ?? `persona:${this.config.id}`;
  }

  /** Common Sonnet 5.5 / Haiku 4.5 request shape: no temperature, no thinking override, no tool_choice. */
  private baseParams(system: Anthropic.TextBlockParam[] = this.systemBlocks) {
    return {
      model: this.model,
      max_tokens: this.config.maxOutputTokens,
      system,
      output_config: { effort: this.options.effort ?? EFFORT.persona },
    };
  }

  private track(usage: Anthropic.Usage | undefined, startedAt: number, purpose: string = this.purpose): void {
    recordUsage({
      purpose,
      model: this.model,
      usage,
      durationMs: Date.now() - startedAt,
      sessionId: this.options.sessionId,
      userId: this.options.userId,
    });
  }

  /**
   * Non-streaming reasoning. Returns validated PersonaResponse.
   */
  async reason(question: string, context: ContextItem[], signal?: AbortSignal): Promise<PersonaResponse> {
    const userMessage = this.buildUserMessage(question, context);
    const startedAt = Date.now();

    const response = await this.client.messages.create({
      ...this.baseParams(),
      messages: [{ role: 'user', content: userMessage }],
    }, { signal });
    this.track(response.usage, startedAt);

    // R-B-03: first TEXT block (a leading `thinking` block is skipped), and a
    // max_tokens cut-off fails loudly before JSON.parse.
    const text = firstText(response);
    if (text === null) throw new Error('Empty response from LLM');
    assertNotTruncated(response);

    const parsed = JSON.parse(stripJsonFences(text));
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
    let fullText = '';
    const startedAt = Date.now();

    try {
      sendSSE(res, { type: 'persona_start', personaId, model: this.config.model });

      const stream = await this.client.messages.stream({
        ...this.baseParams(),
        messages: [{ role: 'user', content: userMessage }],
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sendSSE(res, { type: 'delta', personaId, text: event.delta.text });
        }
      }

      // Usage lives on the final assembled message (message_delta carries it).
      if (typeof (stream as { finalMessage?: unknown }).finalMessage === 'function') {
        const final = await stream.finalMessage();
        this.track(final.usage, startedAt);
        assertNotTruncated(final); // R-B-03
      }

      const parsed = JSON.parse(stripJsonFences(fullText));
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
   * `tool_choice` is left at the default (`auto`) — forced tool use is a 400 on Sonnet 5.5.
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
    const allInvocations: ToolResult[] = [];

    let messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    for (let round = 0; round <= maxToolRounds; round++) {
      const startedAt = Date.now();
      const response = await this.client.messages.create({
        ...this.baseParams(),
        messages,
        ...(tools.length > 0 ? { tools: tools as Anthropic.Tool[] } : {}),
      }, { signal });
      this.track(response.usage, startedAt);

      // Check for tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        // No tool use — extract text response (R-B-03: first TEXT block, not [0])
        const textBlock = firstText(response);
        if (textBlock === null) throw new Error('Empty response from LLM');
        assertNotTruncated(response);

        const parsed = JSON.parse(stripJsonFences(textBlock));
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

      // Continue conversation with tool results (thinking blocks, if any, are
      // passed back unchanged inside assistantContent).
      messages = [
        ...messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      ];
    }

    throw new Error('Max tool rounds exceeded');
  }

  /**
   * Phase 6 debate protocol — round-2 call. The rebuttal prompt is appended as
   * a further cached system block AFTER the persona's own blocks, so the
   * `[core, persona]` prefix from round 1 is a cache hit. Returns the
   * Zod-validated Rebuttal with personaId attached.
   */
  async rebut(userMessage: string, rebuttalPrompt: string, signal?: AbortSignal): Promise<Rebuttal> {
    const system = buildSystemBlocks({
      coreContext: this.options.coreContext,
      prompt: this.systemPrompt,
      extra: [...(this.options.extraSystemBlocks ?? []), rebuttalPrompt],
    });
    const startedAt = Date.now();
    const response = await this.client.messages.create({
      ...this.baseParams(system),
      max_tokens: Math.min(this.config.maxOutputTokens, REBUTTAL_MAX_TOKENS[this.config.model] ?? REBUTTAL_MAX_TOKENS.haiku),
      messages: [{ role: 'user', content: userMessage }],
    }, { signal });
    this.track(response.usage, startedAt, `rebuttal:${this.config.id}`);

    const text = firstText(response);
    if (text === null) throw new Error('Empty rebuttal response from LLM');
    assertNotTruncated(response); // R-B-03
    const parsed = RebuttalSchema.parse(JSON.parse(stripJsonFences(text)));
    return { personaId: this.config.id, ...parsed };
  }

  private buildUserMessage(question: string, context: ContextItem[]): string {
    const contextBlock = context.map(item =>
      `<user_memory source="${item.source}" relevance="${item.relevanceScore}">\n[${item.type.toUpperCase()}] ${escapeMemoryContent(item.content)}\n</user_memory>`
    ).join('\n\n');

    return `## Context\n${contextBlock || '(No context available)'}\n\n## Question\n${question}\n\nRespond with valid JSON matching the required output format. No markdown wrapping.`;
  }
}
