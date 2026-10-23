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

export interface RankOptions {
  /**
   * Add RECENCY_BOOST to items whose `lastAccessedAt` is within the last
   * RECENCY_WINDOW_DAYS. Default true (persona context, WS-3 reinforcement).
   * RD-2: `POST /memories/search` passes false — `last_accessed_at` is written
   * by OTHER reads (for-persona recall reinforcement), so with the boost an
   * agent's search reordered whenever a persona call had run in between.
   */
  recencyBoost?: boolean;
}

type Merged = ScoredResult & {
  weightedScore: number;
  /** Index (in LAYER_ORDER) of the first layer that returned this id. */
  firstLayer: number;
  /** relevanceScore the item had in that first layer. */
  firstLayerScore: number;
};

/** Fixed layer priority: lexical evidence first, semantic last. */
const LAYER_ORDER: ReadonlyArray<keyof typeof LAYER_WEIGHTS> = ['structured', 'fts', 'trigram', 'semantic'];

const byId = (a: Merged, b: Merged): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * RD-2: a deterministic total order that keeps the WS-3 intent ("within
 * TIEBREAKER_SCORE_DELTA, sourceWeight decides; a bigger gap wins regardless
 * of trust").
 *
 * The previous comparator (`|diff| > delta ? diff : bw - aw`) was not
 * transitive: A≈B and B≈C but A≫C. Array.prototype.sort with such a
 * comparator returns an order that depends on the INPUT order — here the Map
 * insertion order, i.e. which layer saw an id first and the order rows came
 * back from SQL (heap order on ties). With flat scores (a single keyword that
 * every note mentions: ~0.42 across the top 10, all within 0.05) and equal
 * source weights, every pair compared as "equal", so the result simply kept
 * the arbitrary input order and identical queries could reorder.
 *
 * Now: sort by score (id breaks exact ties), walk the list in bands — a band
 * starts at the highest remaining score and holds everything within delta of
 * it — and order inside a band by
 *   1. sourceWeight (WS-3),
 *   2. the earliest layer in LAYER_ORDER that found the item, then its score
 *      in that layer — the old comparator effectively kept arrival order
 *      inside a band, and arrival order was structured → fts → trigram →
 *      semantic; this keeps that "lexical evidence first" preference, which
 *      stops an item lifted only by the flat importance boost (+0.1 on a
 *      near-zero semantic score) from jumping a real full-text hit in the same
 *      band (measured: IR eval, docs/runbooks/retrieval-eval.md),
 *   3. score, then id.
 * The output depends only on what each layer returned (ids, scores, source
 * weights), never on the order or timing in which it arrived.
 */
function deterministicOrder(items: Merged[]): Merged[] {
  const byScore = [...items].sort((a, b) => b.weightedScore - a.weightedScore || byId(a, b));
  const out: Merged[] = [];
  let i = 0;
  while (i < byScore.length) {
    const top = byScore[i].weightedScore;
    let j = i;
    while (j < byScore.length && top - byScore[j].weightedScore <= TIEBREAKER_SCORE_DELTA) j++;
    const band = byScore.slice(i, j).sort((a, b) =>
      (b.sourceWeight ?? 1.0) - (a.sourceWeight ?? 1.0)
      || a.firstLayer - b.firstLayer
      || b.firstLayerScore - a.firstLayerScore
      || b.weightedScore - a.weightedScore
      || byId(a, b));
    out.push(...band);
    i = j;
  }
  return out;
}

export function rankAndDeduplicate(
  resultsByLayer: { layer: keyof typeof LAYER_WEIGHTS; results: ScoredResult[] }[],
  maxItems: number,
  options: RankOptions = {}
): ScoredResult[] {
  const applyRecency = options.recencyBoost ?? true;
  // Merge all results, tracking best score per ID
  const merged = new Map<string, Merged>();

  for (const { layer, results } of resultsByLayer) {
    const weight = LAYER_WEIGHTS[layer];
    for (const result of results) {
      const existing = merged.get(result.id);
      const layerScore = result.relevanceScore * weight;

      if (existing) {
        existing.weightedScore += layerScore;
        const layerIdx = LAYER_ORDER.indexOf(layer);
        if (layerIdx < existing.firstLayer) {
          existing.firstLayer = layerIdx;
          existing.firstLayerScore = result.relevanceScore;
        }
        // Keep the highest individual relevance score (ties: the layer listed
        // first keeps it — the layer order is fixed, so this is deterministic).
        if (result.relevanceScore > existing.relevanceScore) {
          existing.relevanceScore = result.relevanceScore;
          existing.source = result.source;
          existing.whyIncluded = result.whyIncluded;
        }
      } else {
        merged.set(result.id, {
          ...result,
          weightedScore: layerScore,
          firstLayer: LAYER_ORDER.indexOf(layer),
          firstLayerScore: result.relevanceScore,
        });
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
    if (applyRecency && item.lastAccessedAt && (now - new Date(item.lastAccessedAt).getTime()) < recencyThreshold) {
      item.weightedScore += RECENCY_BOOST;
    }
    // Importance boost
    if (item.importance && item.importance >= 0.8) {
      item.weightedScore += IMPORTANCE_BOOST;
    }
  }

  // WS-3: a meaningful score gap (> delta) wins regardless of trust — high-
  // trust garbage no longer outranks low-trust gold; within delta,
  // sourceWeight breaks the tie. RD-2: as a deterministic total order.
  return deterministicOrder(Array.from(merged.values()))
    .slice(0, maxItems)
    .map(({ weightedScore, firstLayer: _l, firstLayerScore: _s, ...result }) => ({
      ...result,
      relevanceScore: Math.min(weightedScore, 1.0),
    }));
}
