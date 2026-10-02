import type { ModelTier } from '../types/persona.types';

/**
 * Single source of truth for Anthropic model identifiers (ADR-002: Claude only).
 *
 * 2026-10-02: Sonnet tier moved from the dated 4.5/4.6 pins to `claude-sonnet-5-5`
 * ($2/$10 per MTok, 1M context). Haiku stays on 4.5. Request-shape rules for
 * Sonnet 5.5 that callers MUST respect: no `thinking: {type:'disabled'}`
 * (omit `thinking` or use `{type:'between_tools'}`), no forced `tool_choice`
 * (`any` / `tool`), no assistant prefill, no non-default `temperature`.
 * Prompt caching minimum prefix: 512 tokens on Sonnet 5.5, 4,096 on Haiku 4.5.
 */
export const MODEL_IDS = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
} as const;

/** USD per million tokens — used by LlmUsage cost accounting. */
export const MODEL_PRICING_USD_PER_MTOK: Record<ModelTier, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  sonnet: { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  haiku: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
} as const;

export function modelTierOf(modelId: string): ModelTier {
  return modelId.includes('haiku') ? 'haiku' : 'sonnet';
}

export function estimateCostUsd(modelId: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }): number {
  const p = MODEL_PRICING_USD_PER_MTOK[modelTierOf(modelId)];
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

/** Minimum cacheable prefix per model (tokens). Below this the API silently skips caching. */
export const CACHE_MIN_PREFIX_TOKENS: Record<ModelTier, number> = { sonnet: 512, haiku: 4096 };
