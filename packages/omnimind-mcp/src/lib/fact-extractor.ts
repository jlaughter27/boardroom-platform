import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODEL_IDS } from '@boardroom/shared';
import type { OmniMindClient } from './client';
import type { AgentContext, FactWithAction } from '../types';

/**
 * WS-2.4 — Thrown when the Haiku extraction call fails (no API key, rate limit,
 * timeout, malformed response). The MCP tool layer catches this and returns
 * `{ error: 'FACT_EXTRACTOR_UNAVAILABLE', message }` to the agent so it can
 * retry rather than silently storing un-deduped raw content.
 */
export class FactExtractorUnavailableError extends Error {
  readonly code = 'FACT_EXTRACTOR_UNAVAILABLE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'FactExtractorUnavailableError';
  }
}

// WS-3: lowered from 0.85 → 0.80. Mem0's default for 1536-dim OpenAI
// text-embedding-3-small is 0.80 — at 0.85 we were missing legitimate
// paraphrases ("I prefer TypeScript strict mode" vs "Josh likes TS strict")
// and creating duplicate rows.
const SIMILARITY_THRESHOLD = 0.80;

const FACT_EXTRACTION_PROMPT = `You are a fact extractor for an agent memory system. Given input text, return a JSON array of atomic facts. Each fact is one self-contained claim.

Examples:
Input: "Josh decided to use Postgres for the memory layer because it already has pgvector and the team knows it."
Output: [
  {"text": "Memory layer storage is Postgres", "type": "decision"},
  {"text": "Decision rationale: existing pgvector + team familiarity", "type": "context"}
]

Rules:
- Atomic. One claim per fact.
- Self-contained. No pronoun ambiguity — use full names/subjects.
- Type: decision | blocker | status | context | preference
- Return empty array [] if input has no extractable facts.
- Return only the JSON array, no explanation.`;

const RawFactSchema = z.array(z.object({
  text: z.string().min(1),
  type: z.enum(['decision', 'blocker', 'status', 'context', 'preference']),
}));

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for fact extraction');
  return new Anthropic({ apiKey });
}

/** Purpose tag for `POST /usage/llm` rows written by this process. */
export const FACT_EXTRACTOR_USAGE_PURPOSE = 'mcp:fact-extractor';

/**
 * Phase 6 — record the Haiku call's token usage via `POST /usage/llm`.
 * Fire-and-forget: never awaited by the write path, never throws (a mock
 * client without `recordLlmUsage` is tolerated too).
 */
function recordUsage(
  omnimind: OmniMindClient,
  response: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } },
  durationMs: number,
  userId: string
): void {
  const usage = response.usage;
  if (!usage) return;
  void Promise.resolve()
    .then(() =>
      omnimind.recordLlmUsage({
        service: 'omnimind-mcp',
        purpose: FACT_EXTRACTOR_USAGE_PURPOSE,
        model: MODEL_IDS.haiku,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        durationMs,
        userId,
      })
    )
    .catch(err => console.error('[usage] fact-extractor usage not recorded:', (err as Error).message));
}

async function extractRawFacts(content: string, omnimind: OmniMindClient, userId: string): Promise<z.infer<typeof RawFactSchema>> {
  const client = getAnthropicClient();
  const startedAt = Date.now();

  // Model id comes from MODEL_IDS (never a literal). Haiku 4.5: no `thinking`,
  // no `temperature` — see docs/contracts/PHASE-6-CONTRACTS.md.
  const response = await client.messages.create({
    model: MODEL_IDS.haiku,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${FACT_EXTRACTION_PROMPT}\n\nInput: ${content}`,
      },
    ],
  });
  recordUsage(omnimind, response, Date.now() - startedAt, userId);

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  // Parse JSON — handle wrapped code blocks gracefully
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  return RawFactSchema.parse(parsed);
}

export async function extractAndDedup(
  content: string,
  ctx: AgentContext,
  client: OmniMindClient,
  userId: string
): Promise<FactWithAction[]> {
  if (!content.trim()) return [];

  let rawFacts: z.infer<typeof RawFactSchema>;

  try {
    rawFacts = await extractRawFacts(content, client, userId);
  } catch (err) {
    // WS-2.4 — Fail loud, do not pollute the store with raw chunks when Haiku is down.
    // Production memory systems (Mem0, Letta, Anthropic Memory tool) refuse the write
    // rather than store unstructured fallback. The MCP tool layer should catch this
    // and surface FACT_EXTRACTOR_UNAVAILABLE to the agent for an explicit retry.
    const message = (err as Error).message;
    throw new FactExtractorUnavailableError(
      `Fact extraction failed (${message}). Memory not written. ` +
        `Retry once Anthropic / fact-extractor is available again.`,
    );
  }

  if (rawFacts.length === 0) return [];

  const results: FactWithAction[] = [];

  for (const fact of rawFacts) {
    let hits: Awaited<ReturnType<OmniMindClient['searchSimilar']>> = [];

    try {
      hits = await client.searchSimilar({
        query: fact.text,
        userId,
        threshold: SIMILARITY_THRESHOLD,
        limit: 1,
      });
    } catch {
      // Search failure → treat as new fact (conservative: never silently drop writes)
    }

    if (hits.length > 0) {
      results.push({ ...fact, supersedes: hits[0].id, action: 'update' });
    } else {
      results.push({ ...fact, action: 'create' });
    }
  }

  return results;
}
