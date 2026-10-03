import Anthropic from '@anthropic-ai/sdk';
import { modelTierOf } from '@boardroom/shared';

/**
 * Single construction point for the Anthropic client in BoardRoom.
 *
 * Guard: `output_config.effort` is accepted on Sonnet 5.5 but returns a 400 on
 * Haiku 4.5 (Claude API reference, "Thinking & Effort": effort errors on
 * Sonnet 4.5 / Haiku 4.5). Call sites set effort uniformly via EFFORT; this
 * wrapper drops `output_config` whenever the model resolves to the Haiku tier
 * so the rule lives in one place instead of at seven call sites.
 */
export function sanitizeParamsForModel<T extends { model: string; output_config?: unknown }>(params: T): T {
  if (modelTierOf(params.model) === 'haiku' && params.output_config !== undefined) {
    const { output_config: _dropped, ...rest } = params;
    return rest as T;
  }
  return params;
}

export function createAnthropicClient(apiKey: string): Anthropic {
  const client = new Anthropic({ apiKey });
  const messages = client.messages;
  const originalCreate = messages.create.bind(messages);
  const originalStream = messages.stream.bind(messages);
  // Typed loosely on purpose: the SDK overloads (streaming / non-streaming)
  // are preserved because we pass the (possibly trimmed) params straight through.
  (messages as unknown as { create: unknown }).create = (params: Parameters<typeof originalCreate>[0], options?: Parameters<typeof originalCreate>[1]) =>
    originalCreate(sanitizeParamsForModel(params) as Parameters<typeof originalCreate>[0], options);
  (messages as unknown as { stream: unknown }).stream = (params: Parameters<typeof originalStream>[0], options?: Parameters<typeof originalStream>[1]) =>
    originalStream(sanitizeParamsForModel(params) as Parameters<typeof originalStream>[0], options);
  return client;
}
