import Anthropic from '@anthropic-ai/sdk';
import type { MemoryProposal, PersonaResponse, SynthesisReport } from '@boardroom/shared';
import { MemoryProposalSchema } from '@boardroom/shared';
import { MODEL_IDS, PERSONA_CONFIGS } from '@boardroom/shared';
import { loadPrompt } from '../lib/prompt-loader';
import { buildSystemBlocks, stripJsonFences, firstText, assertNotTruncated, EFFORT } from '../lib/llm-request';
import { recordUsage } from '../lib/llm-usage';
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
  client: Anthropic,
  signal?: AbortSignal,
  meta: { sessionId?: string; userId?: string } = {},
): Promise<ExtractionResult> {
  const prompt = loadPrompt('memory-extractor' as any);
  const model = MODEL_IDS[PERSONA_CONFIGS.doer.model]; // Haiku for extraction

  // Build extraction context
  const perspectivesSummary = Array.from(personaResponses.entries())
    .map(([id, resp]) => `## ${id}\nRecommendation: ${resp.recommendation}\nKey assumptions: ${resp.keyAssumptions.join(', ')}`)
    .join('\n\n');

  const synthesisSummary = synthesis
    ? `## CEO Synthesis\nRecommendation: ${synthesis.recommendation}\nNext actions: ${synthesis.nextActions.join(', ')}\nAssumptions: ${synthesis.assumptionsToMonitor.map(a => a.assumption).join(', ')}`
    : '(No synthesis available)';

  const startedAt = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: buildSystemBlocks({ prompt }),
    output_config: { effort: EFFORT.extractor },
    messages: [{
      role: 'user',
      content: `## Session Question\n${question}\n\n## Persona Perspectives\n${perspectivesSummary}\n\n${synthesisSummary}\n\nExtract memory proposals. Return JSON array of MemoryProposal objects.`,
    }],
  }, { signal });
  recordUsage({ purpose: 'extraction', model, usage: response.usage, durationMs: Date.now() - startedAt, ...meta });

  // R-B-03: first TEXT block (skips a leading `thinking` block); a max_tokens
  // cut-off is reported as such instead of surfacing as a JSON parse error.
  const text = firstText(response);
  if (text === null) {
    return { proposals: [], proposalCount: 0, categories: { facts: 0, commitments: 0, personMentions: 0, profileObservations: 0 } };
  }
  assertNotTruncated(response);

  const rawProposals = JSON.parse(stripJsonFences(text));

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
