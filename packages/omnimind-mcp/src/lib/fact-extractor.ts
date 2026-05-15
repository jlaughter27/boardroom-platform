import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { OmniMindClient } from './client';
import type { AgentContext, FactWithAction } from '../types';

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

async function extractRawFacts(content: string): Promise<z.infer<typeof RawFactSchema>> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${FACT_EXTRACTION_PROMPT}\n\nInput: ${content}`,
      },
    ],
  });

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
    rawFacts = await extractRawFacts(content);
  } catch (err) {
    console.warn('[fact-extractor] Extraction failed, falling back to single fact:', (err as Error).message);
    // Graceful fallback: treat the whole content as a single 'context' fact
    rawFacts = [{ text: content.slice(0, 500), type: 'context' }];
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
