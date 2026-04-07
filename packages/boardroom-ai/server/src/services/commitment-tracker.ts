import Anthropic from '@anthropic-ai/sdk';
import type { SynthesisReport, PersonaResponse } from '@boardroom/shared';
import { MODEL_MAP } from '@boardroom/shared';
import type { OmniMindClient } from './omnimind-client';

interface DetectedCommitment {
  description: string;
  stakeholder: string | null;
  deadline: string | null;
}

/**
 * Detect commitments from session content using Haiku.
 */
export async function detectCommitments(
  question: string,
  personaResponses: Map<string, PersonaResponse>,
  synthesis: SynthesisReport | null,
  client: Anthropic
): Promise<DetectedCommitment[]> {
  const context = synthesis
    ? `Recommendation: ${synthesis.recommendation}\nActions: ${synthesis.nextActions.join(', ')}`
    : Array.from(personaResponses.values()).map(r => r.recommendation).join('\n');

  const response = await client.messages.create({
    model: MODEL_MAP.haiku,
    max_tokens: 500,
    system: `Extract commitments (promises, deadlines, action items with owners) from decision session content.
Return JSON array: [{"description": "...", "stakeholder": "name or null", "deadline": "ISO date or null"}]
Only include clear, explicit commitments. If none found, return [].`,
    messages: [{
      role: 'user',
      content: `## Question\n${question}\n\n## Context\n${context}\n\nExtract commitments.`,
    }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') return [];

  try {
    const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}

/**
 * Get overdue commitments for a user from OmniMind.
 */
export async function getOverdueCommitments(
  userId: string,
  omnimind: OmniMindClient
): Promise<unknown[]> {
  return omnimind.getCommitments(userId, { status: 'OPEN', overdue: 'true' }) as Promise<unknown[]>;
}
