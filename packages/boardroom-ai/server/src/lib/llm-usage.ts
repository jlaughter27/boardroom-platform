// Phase 6 — LlmUsage recorder. Every Anthropic response in BoardRoom is
// reported to OmniMind (`POST /usage/llm`) fire-and-forget; OmniMind computes
// cost with `estimateCostUsd`. Failures are logged, never thrown.

import type Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';
import { omnimindClient } from '../services/omnimind-client';

export interface LlmUsageBody {
  service: 'boardroom-ai';
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  sessionId?: string;
  userId?: string;
}

export interface UsageSink {
  postLlmUsage(body: LlmUsageBody): Promise<unknown>;
}

export interface RecordUsageArgs {
  /** `persona:<id>` | `ceo` | `premortem` | `rebuttal:<id>` | `extraction` | `sufficiency` | `questionnaire` | `doer` | … */
  purpose: string;
  model: string;
  /** `response.usage` (or `(await stream.finalMessage()).usage`). Missing usage → no-op. */
  usage: Anthropic.Usage | Partial<Anthropic.Usage> | null | undefined;
  durationMs?: number;
  sessionId?: string;
  userId?: string;
  /** Test seam — defaults to the OmniMind singleton. */
  sink?: UsageSink;
}

export function toUsageBody(args: RecordUsageArgs): LlmUsageBody | null {
  const u = args.usage;
  if (!u || typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return null;
  const body: LlmUsageBody = {
    service: 'boardroom-ai',
    purpose: args.purpose,
    model: args.model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  if (typeof args.durationMs === 'number') body.durationMs = Math.max(0, Math.round(args.durationMs));
  if (args.sessionId) body.sessionId = args.sessionId;
  if (args.userId) body.userId = args.userId;
  return body;
}

/**
 * Fire-and-forget. Logs `cache_read_input_tokens` at debug level so cache
 * hit/miss can be verified per call (`LOG_LEVEL=debug`).
 */
export function recordUsage(args: RecordUsageArgs): void {
  try {
    const body = toUsageBody(args);
    if (!body) return;
    logger.debug('[LlmUsage]', {
      purpose: body.purpose,
      model: body.model,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
      cache_read_input_tokens: body.cacheReadTokens,
      cache_creation_input_tokens: body.cacheWriteTokens,
      durationMs: body.durationMs,
      sessionId: body.sessionId,
    });
    const sink: UsageSink = args.sink ?? omnimindClient;
    void Promise.resolve()
      .then(() => sink.postLlmUsage(body))
      .catch((err: unknown) => {
        logger.warn('[LlmUsage] post failed', {
          purpose: body.purpose,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  } catch (err) {
    logger.warn('[LlmUsage] record failed', { message: err instanceof Error ? err.message : String(err) });
  }
}
