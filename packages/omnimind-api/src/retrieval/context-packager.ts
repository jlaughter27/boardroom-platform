import type { ScoredResult } from './structured-filter';
import type { PersonaId, ContextPackage } from '@boardroom/shared';
import { RETRIEVAL_CONFIG } from '@boardroom/shared';
import { estimateTokens } from '@boardroom/shared';
import type { RetrievalLayer } from './forgetting-curve';

export type { ContextPackage };

/**
 * F-204: the packaged context carries a `degraded` flag when any retrieval
 * layer errored (and returned []) so callers can tell "no matches" from
 * "a layer is broken". Declared locally as an optional extension of the
 * shared ContextPackage so it stays compatible whether or not the shared type
 * grows the field.
 */
export interface RetrievalContextPackage extends ContextPackage {
  retrievalMetadata: ContextPackage['retrievalMetadata'] & {
    degraded?: boolean;
    degradedLayers?: RetrievalLayer[];
  };
}

export interface PackageOptions {
  /** Layers that threw during retrieval (F-204). */
  degradedLayers?: RetrievalLayer[];
}

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
  layersUsed: string[],
  options: PackageOptions = {}
): RetrievalContextPackage {
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

  const degradedLayers = options.degradedLayers ?? [];

  return {
    items: selected.map(({ tags, importance, lastAccessedAt, title, ...rest }) => rest),
    tokenEstimate: totalTokens,
    retrievalMetadata: {
      totalCandidates,
      layersUsed,
      ...(degradedLayers.length > 0 ? { degraded: true, degradedLayers } : {}),
    },
  };
}
