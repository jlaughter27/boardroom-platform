import type { ScoredResult } from './structured-filter';
import type { PersonaId, ContextPackage } from '@boardroom/shared';
import { RETRIEVAL_CONFIG } from '@boardroom/shared';
import { estimateTokens } from '@boardroom/shared';

export type { ContextPackage };

const PERSONA_TAG_BOOSTS: Record<string, string[]> = {
  optimist: ['success', 'opportunity', 'resource', 'strength', 'win'],
  critic: ['risk', 'failure', 'constraint', 'blocker', 'concern'],
  alternate: ['alternative', 'competitor', 'unexplored', 'pivot', 'option'],
  technician: ['technical', 'implementation', 'timeline', 'architecture', 'stack'],
  ceo: [], // No tag filtering for CEO
  questionnaire: [],
  doer: ['task', 'action', 'deadline', 'commitment'],
};

const TAG_BOOST_AMOUNT = 0.15;

export function packageForPersona(
  results: ScoredResult[],
  persona: PersonaId,
  totalCandidates: number,
  layersUsed: string[]
): ContextPackage {
  const isCEO = persona === 'ceo';
  const maxItems = isCEO ? RETRIEVAL_CONFIG.maxItemsCEO : RETRIEVAL_CONFIG.maxItemsPerPersona;
  const tokenBudget = isCEO ? RETRIEVAL_CONFIG.tokenBudgetCEO : RETRIEVAL_CONFIG.tokenBudgetPerPersona;

  // Apply persona-specific tag boosts
  const boostTags = PERSONA_TAG_BOOSTS[persona] ?? [];
  const boosted = results.map(r => {
    let score = r.relevanceScore;
    if (boostTags.length > 0 && r.tags) {
      const hasBoostTag = r.tags.some(t => boostTags.includes(t.toLowerCase()));
      if (hasBoostTag) score += TAG_BOOST_AMOUNT;
    }
    return { ...r, relevanceScore: Math.min(score, 1.0) };
  });

  // Re-sort after boosting
  boosted.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Take top N within token budget
  const selected: typeof boosted = [];
  let totalTokens = 0;

  for (const item of boosted) {
    if (selected.length >= maxItems) break;
    const itemTokens = estimateTokens(item.content);
    if (totalTokens + itemTokens > tokenBudget) break;
    selected.push(item);
    totalTokens += itemTokens;
  }

  return {
    items: selected.map(({ tags, importance, lastAccessedAt, title, ...rest }) => rest),
    tokenEstimate: totalTokens,
    retrievalMetadata: {
      totalCandidates,
      layersUsed,
    },
  };
}
