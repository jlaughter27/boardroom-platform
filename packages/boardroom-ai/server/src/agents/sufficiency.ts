import Anthropic from '@anthropic-ai/sdk';
import type { SufficiencyScore } from '@boardroom/shared';
import { MODEL_MAP, SufficiencyScoreLLMSchema } from '@boardroom/shared';
import { loadSystemPrompt } from '../lib/prompt-loader';

export async function checkSufficiency(
  question: string,
  client: Anthropic
): Promise<SufficiencyScore> {
  const response = await client.messages.create({
    model: MODEL_MAP.haiku,
    max_tokens: 500,
    system: loadSystemPrompt('sufficiency-check'),
    messages: [{ role: 'user', content: question }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') {
    return { score: 0, missingDimensions: [], suggestedQuestions: [], inferredIntent: question, canProceed: true };
  }

  const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return SufficiencyScoreLLMSchema.parse(JSON.parse(jsonStr));
}
