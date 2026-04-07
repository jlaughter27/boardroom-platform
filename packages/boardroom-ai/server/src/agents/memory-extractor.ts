import Anthropic from '@anthropic-ai/sdk';
import type { MemoryProposal, PersonaResponse, SynthesisReport } from '@boardroom/shared';
import { MemoryProposalSchema } from '@boardroom/shared';
import { MODEL_MAP, PERSONA_CONFIGS } from '@boardroom/shared';
import { loadPrompt } from '../lib/prompt-loader';
import { z } from 'zod';

export interface ExtractionResult {
  proposals: MemoryProposal[];
  proposalCount: number;
  categories: {
    facts: number;
    commitments: number;
    personMentions: number;
    profileObservations: number;
  };
}

export async function extractMemories(
  question: string,
  personaResponses: Map<string, PersonaResponse>,
  synthesis: SynthesisReport | null,
  client: Anthropic
): Promise<ExtractionResult> {
  const prompt = loadPrompt('memory-extractor' as any);
  const model = MODEL_MAP[PERSONA_CONFIGS.doer.model]; // Haiku for extraction

  // Build extraction context
  const perspectivesSummary = Array.from(personaResponses.entries())
    .map(([id, resp]) => `## ${id}\nRecommendation: ${resp.recommendation}\nKey assumptions: ${resp.keyAssumptions.join(', ')}`)
    .join('\n\n');

  const synthesisSummary = synthesis
    ? `## CEO Synthesis\nRecommendation: ${synthesis.recommendation}\nNext actions: ${synthesis.nextActions.join(', ')}\nAssumptions: ${synthesis.assumptionsToMonitor.map(a => a.assumption).join(', ')}`
    : '(No synthesis available)';

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: prompt,
    messages: [{
      role: 'user',
      content: `## Session Question\n${question}\n\n## Persona Perspectives\n${perspectivesSummary}\n\n${synthesisSummary}\n\nExtract memory proposals. Return JSON array of MemoryProposal objects.`,
    }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') {
    return { proposals: [], proposalCount: 0, categories: { facts: 0, commitments: 0, personMentions: 0, profileObservations: 0 } };
  }

  const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const rawProposals = JSON.parse(jsonStr);

  // Validate each proposal
  const proposalArraySchema = z.array(MemoryProposalSchema);
  const validated = proposalArraySchema.parse(rawProposals);

  // Categorize
  const categories = { facts: 0, commitments: 0, personMentions: 0, profileObservations: 0 };
  for (const p of validated) {
    if (p.tags.includes('commitment')) categories.commitments++;
    else if (p.tags.includes('person')) categories.personMentions++;
    else if (p.tags.includes('profile') || p.tags.includes('pattern')) categories.profileObservations++;
    else categories.facts++;
  }

  return {
    proposals: validated as MemoryProposal[],
    proposalCount: validated.length,
    categories,
  };
}
