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

// WS-3: when two results have effectively equal raw scores, sourceWeight
// breaks the tie. Scores within this delta are considered "equal" for
// ranking purposes. 0.05 ≈ one importance-tier step in our 0..1 score range.
const TIEBREAKER_SCORE_DELTA = 0.05;

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

  // Apply boosts. NOTE: WS-3 removed the `* sourceWeight` multiplier from the
  // score computation. Trust was previously suppressing semantically relevant
  // results from lower-trust agents below garbage from high-trust agents.
  // sourceWeight is now used only as a tiebreaker in the sort below.
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
  }

  // WS-3: Sort by raw weighted score; only invoke sourceWeight as a
  // tiebreaker when scores are within TIEBREAKER_SCORE_DELTA of each other.
  // A meaningful score gap (> delta) wins regardless of trust — high-trust
  // garbage no longer outranks low-trust gold.
  return Array.from(merged.values())
    .sort((a, b) => {
      const scoreDiff = b.weightedScore - a.weightedScore;
      if (Math.abs(scoreDiff) > TIEBREAKER_SCORE_DELTA) return scoreDiff;
      const aw = a.sourceWeight ?? 1.0;
      const bw = b.sourceWeight ?? 1.0;
      return bw - aw;
    })
    .slice(0, maxItems)
    .map(({ weightedScore, ...result }) => ({
      ...result,
      relevanceScore: Math.min(weightedScore, 1.0),
    }));
}
