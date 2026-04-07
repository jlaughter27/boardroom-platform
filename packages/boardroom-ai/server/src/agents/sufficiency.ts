import Anthropic from '@anthropic-ai/sdk';
import type { SufficiencyScore } from '@boardroom/shared';
import { MODEL_MAP } from '@boardroom/shared';

export async function checkSufficiency(
  question: string,
  client: Anthropic
): Promise<SufficiencyScore> {
  const response = await client.messages.create({
    model: MODEL_MAP.haiku,
    max_tokens: 500,
    system: `You assess whether a user's question has enough context for multi-perspective analysis.
Rate from 0 (fully clear) to 1 (extremely ambiguous).
Return JSON: { "score": number, "missingDimensions": string[], "suggestedQuestions": string[], "inferredIntent": string, "canProceed": boolean }
canProceed = true if score < 0.6.`,
    messages: [{ role: 'user', content: question }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') {
    return { score: 0, missingDimensions: [], suggestedQuestions: [], inferredIntent: question, canProceed: true };
  }

  const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr) as SufficiencyScore;
}
