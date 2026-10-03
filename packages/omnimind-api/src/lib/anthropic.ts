import Anthropic from '@anthropic-ai/sdk';
import { modelTierOf } from '@boardroom/shared';
import { prisma } from './db';
import { logger } from './logger';
import { recordLlmUsage } from '../services/llm-usage.service';

/**
 * Phase 6 — single shared Anthropic client + usage recording.
 *
 * Every OmniMind Anthropic caller (cortex-*, simulation, session-summarizer,
 * reflection) goes through `createMessage()` so that:
 *   - exactly one SDK client is constructed per process (re-created only when
 *     ANTHROPIC_API_KEY changes — mirrors the F-213 pattern in embedding.service)
 *   - every call records an `llm_usage` row (fire-and-forget, never throws)
 *   - Sonnet 5.5 / Haiku 4.5 request rules are centralised: callers pass the
 *     model via `MODEL_IDS` and an explicit `output_config.effort`; this module
 *     never sets `temperature`, `thinking: {type:'disabled'}` or a forced
 *     `tool_choice` (see docs/contracts/PHASE-6-CONTRACTS.md).
 */

let cachedClient: Anthropic | null = null;
let cachedKey: string | null = null;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new Anthropic({ apiKey });
    cachedKey = apiKey;
  }
  return cachedClient;
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function __resetAnthropicClientForTest(): void {
  cachedClient = null;
  cachedKey = null;
}

export interface UsageMeta {
  /** e.g. `cortex-memo`, `reflection`, `session-summarizer` */
  purpose: string;
  userId?: string | null;
  tenantId?: string | null;
  sessionId?: string | null;
}

/**
 * Record one Anthropic response's `usage` as an `llm_usage` row.
 * Fire-and-forget: failures are logged by the service, never thrown.
 */
export function recordUsage(
  meta: UsageMeta & { model: string; usage: Anthropic.Usage | null | undefined; durationMs?: number },
): void {
  const u = meta.usage;
  if (!u) return;
  void recordLlmUsage(
    {
      service: 'omnimind',
      purpose: meta.purpose,
      model: meta.model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      durationMs: meta.durationMs,
      sessionId: meta.sessionId ?? undefined,
      userId: meta.userId ?? undefined,
      tenantId: meta.tenantId ?? undefined,
    },
    prisma,
  ).catch(() => { /* already logged */ });
}

/**
 * One-line Anthropic call: times the request and records usage.
 * Non-streaming only (OmniMind has no streaming callers).
 */
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  meta: UsageMeta,
): Promise<Anthropic.Message> {
  const client = getAnthropicClient();
  // Haiku 4.5 rejects output_config.effort with a 400; Sonnet 5.5 accepts it.
  if (modelTierOf(params.model) === 'haiku' && params.output_config !== undefined) {
    const { output_config: _dropped, ...rest } = params;
    params = rest as Anthropic.MessageCreateParamsNonStreaming;
  }
  const started = Date.now();
  const response = await client.messages.create(params);
  const durationMs = Date.now() - started;
  recordUsage({ ...meta, model: params.model, usage: response.usage, durationMs });
  if ((response.usage?.cache_read_input_tokens ?? 0) > 0) {
    logger.info('[anthropic] prompt cache hit', {
      purpose: meta.purpose,
      cacheRead: response.usage.cache_read_input_tokens,
    });
  }
  return response;
}

/** Concatenate all text blocks of a response. */
export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

/**
 * Strip ```json fences and parse. R-O-11: when the model adds a preamble or
 * trailer ("Here is the JSON: {...} Let me know…"), fall back to the outermost
 * `{…}` / `[…]` span. Throws a clear Error when no JSON can be recovered.
 */
export function parseJsonFromText(text: string): unknown {
  const jsonStr = text.replace(/```(?:json)?\n?/gi, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch (firstErr) {
    const starts = [jsonStr.indexOf('{'), jsonStr.indexOf('[')].filter(i => i >= 0);
    if (starts.length > 0) {
      const start = Math.min(...starts);
      const close = jsonStr[start] === '{' ? '}' : ']';
      const end = jsonStr.lastIndexOf(close);
      if (end > start) {
        try {
          return JSON.parse(jsonStr.slice(start, end + 1));
        } catch { /* fall through to the clear error below */ }
      }
    }
    throw new Error(`parseJsonFromText: no valid JSON object/array in model output (${(firstErr as Error).message}); head=${JSON.stringify(jsonStr.slice(0, 80))}`);
  }
}
