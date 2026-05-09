import type { ScoredResult } from './structured-filter';

const LAYER_WEIGHTS = {
  structured: 0.3,
  fts: 0.25,
  trigram: 0.2,
  semantic: 0.25,
} as const;

const RECENCY_BOOST = 0.1;
const IMPORTANCE_BOOST = 0.1;
const RECENCY_WINDOW_DAYS = 7;

export function rankAndDeduplicate(
  resultsByLayer: { layer: keyof typeof LAYER_WEIGHTS; results: ScoredResult[] }[],
  maxItems: number
): ScoredResult[] {
  // Merge all results, tracking best score per ID
  const merged = new Map<string, ScoredResult & { weightedScore: number }>();

  for (const { layer, results } of resultsByLayer) {
    const weight = LAYER_WEIGHTS[layer];
    for (const result of results) {
      const existing = merged.get(result.id);
      const layerScore = result.relevanceScore * weight;

      if (existing) {
        existing.weightedScore += layerScore;
        // Keep the highest individual relevance score
        if (result.relevanceScore > existing.relevanceScore) {
          existing.relevanceScore = result.relevanceScore;
          existing.source = result.source;
          existing.whyIncluded = result.whyIncluded;
        }
      } else {
        merged.set(result.id, { ...result, weightedScore: layerScore });
      }
    }
  }

  // Apply boosts + sourceWeight multiplier
  const now = Date.now();
  const recencyThreshold = RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const item of merged.values()) {
    // Recency boost
    if (item.lastAccessedAt && (now - new Date(item.lastAccessedAt).getTime()) < recencyThreshold) {
      item.weightedScore += RECENCY_BOOST;
    }
    // Importance boost
    if (item.importance && item.importance >= 0.8) {
      item.weightedScore += IMPORTANCE_BOOST;
    }
    // sourceWeight: trust multiplier from originating agent (1.0 = full trust)
    const sw = item.sourceWeight ?? 1.0;
    if (sw !== 1.0) {
      item.weightedScore *= Math.max(0, Math.min(1.5, sw));
    }
  }

  // Sort by weighted score, take top N
  return Array.from(merged.values())
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, maxItems)
    .map(({ weightedScore, ...result }) => ({
      ...result,
      relevanceScore: Math.min(weightedScore, 1.0),
    }));
}
