/**
 * Pure IR metrics for the retrieval evaluation (no I/O, no deps).
 *
 * Conventions:
 *   - `ranked` is the ordered list of memory KEYS (or ids) the system returned,
 *     best first. `relevant` is the gold set for the query.
 *   - Gains are binary (a memory is relevant or not), so DCG uses gain 1 and
 *     IDCG is the DCG of min(|relevant|, k) perfect hits.
 *   - Abstention queries (empty gold set) are scored separately via
 *     `abstentionScore`: 1 when nothing above the score threshold came back,
 *     else 0. The per-query metric record then carries that 0/1 in every
 *     metric column so abstention queries weigh into the overall averages.
 */

export interface QueryMetrics {
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  /** Only meaningful for abstention queries; null otherwise. */
  abstention: number | null;
  /** Update slice: 1 when a superseded (stale) memory appeared in top-10, else 0; null if not applicable. */
  staleHit: number | null;
}

export interface MetricSummary {
  count: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  abstentionAccuracy: number | null;
  staleHitRate: number | null;
}

export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) return 1; // vacuous: nothing to recall
  const top = ranked.slice(0, k);
  let hits = 0;
  for (const r of relevant) if (top.includes(r)) hits++;
  return hits / relevant.size;
}

export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  if (relevant.size === 0) return 1;
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}

export function dcgAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  let dcg = 0;
  const top = ranked.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i])) dcg += 1 / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) return 1;
  const ideal = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  if (idcg === 0) return 0;
  return dcgAtK(ranked, relevant, k) / idcg;
}

/**
 * Abstention: correct when the system returned nothing, or nothing with a
 * score at/above `threshold`. Scores are the API's relevanceScore / score.
 */
export function abstentionScore(scores: readonly number[], threshold: number): number {
  return scores.some(s => s >= threshold) ? 0 : 1;
}

export function scoreQuery(
  ranked: readonly string[],
  scores: readonly number[],
  relevant: readonly string[],
  opts: { abstentionThreshold: number; staleKeys?: readonly string[] },
): QueryMetrics {
  const rel = new Set(relevant);
  if (rel.size === 0) {
    const a = abstentionScore(scores, opts.abstentionThreshold);
    return { recallAt5: a, recallAt10: a, mrr: a, ndcgAt10: a, abstention: a, staleHit: null };
  }
  const stale = opts.staleKeys && opts.staleKeys.length > 0 ? new Set(opts.staleKeys) : null;
  const staleHit = stale ? (ranked.slice(0, 10).some(k => stale.has(k)) ? 1 : 0) : null;
  return {
    recallAt5: recallAtK(ranked, rel, 5),
    recallAt10: recallAtK(ranked, rel, 10),
    mrr: reciprocalRank(ranked, rel),
    ndcgAt10: ndcgAtK(ranked, rel, 10),
    abstention: null,
    staleHit,
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function meanOrNull(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : mean(v);
}

export function summarize(rows: readonly QueryMetrics[]): MetricSummary {
  return {
    count: rows.length,
    recallAt5: round(mean(rows.map(r => r.recallAt5))),
    recallAt10: round(mean(rows.map(r => r.recallAt10))),
    mrr: round(mean(rows.map(r => r.mrr))),
    ndcgAt10: round(mean(rows.map(r => r.ndcgAt10))),
    abstentionAccuracy: roundOrNull(meanOrNull(rows.map(r => r.abstention))),
    staleHitRate: roundOrNull(meanOrNull(rows.map(r => r.staleHit))),
  };
}

export function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[keyOf(r)] ??= []).push(r);
  return out;
}

export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function roundOrNull(x: number | null): number | null {
  return x === null ? null : round(x);
}

export interface GateResult {
  pass: boolean;
  failures: Array<{ metric: string; observed: number; threshold: number }>;
}

export function evaluateGates(summary: MetricSummary, gates: Record<string, number>): GateResult {
  const failures: GateResult['failures'] = [];
  for (const [metric, threshold] of Object.entries(gates)) {
    const observed = (summary as unknown as Record<string, number | null>)[metric];
    if (typeof observed !== 'number') continue; // unknown/absent metric never gates
    if (observed < threshold) failures.push({ metric, observed, threshold });
  }
  return { pass: failures.length === 0, failures };
}
