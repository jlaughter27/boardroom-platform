import Anthropic from '@anthropic-ai/sdk';
import type { SufficiencyScore } from '@boardroom/shared';
import { MODEL_IDS, SufficiencyScoreLLMSchema } from '@boardroom/shared';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { buildSystemBlocks, stripJsonFences, firstText, assertNotTruncated, EFFORT } from '../lib/llm-request';
import { recordUsage } from '../lib/llm-usage';

export async function checkSufficiency(
  question: string,
  client: Anthropic,
  signal?: AbortSignal,
  meta: { sessionId?: string; userId?: string } = {},
): Promise<SufficiencyScore> {
  const model = MODEL_IDS.haiku;
  const startedAt = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 500,
    system: buildSystemBlocks({ prompt: loadSystemPrompt('sufficiency-check') }),
    output_config: { effort: EFFORT.extractor },
    messages: [{ role: 'user', content: question }],
  }, { signal });
  recordUsage({ purpose: 'sufficiency', model, usage: response.usage, durationMs: Date.now() - startedAt, ...meta });

  const text = firstText(response); // R-B-03
  if (text === null) {
    return { score: 0, missingDimensions: [], suggestedQuestions: [], inferredIntent: question, canProceed: true };
  }
  assertNotTruncated(response);

  return SufficiencyScoreLLMSchema.parse(JSON.parse(stripJsonFences(text)));
}
