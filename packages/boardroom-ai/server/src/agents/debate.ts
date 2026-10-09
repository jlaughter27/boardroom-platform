// Phase 6 — debate protocol primitives (pure, deterministic, no I/O).
//
// Round 1 stays independent and parallel (anti-sycophancy). Afterwards:
//   1. clusterByMajority  — group recommendations by Jaccard token overlap ≥ 0.4
//   2. selectRebutters    — dissentFlag personas + personas outside the majority (≤ MAX_REBUTTALS)
//   3. anonymizeViews     — "Advisor A/B/C" views for the round-2 user message
//   4. buildDisagreementLedger — machine-built rows handed to the CEO
//   5. computeDroppedConsiderations — round-1 sourceMemoryIds the CEO no longer cites
//
// See docs/contracts/PHASE-6-CONTRACTS.md → "Debate protocol".

import type {
  PersonaId, PersonaResponse, Rebuttal, DisagreementLedger, DisagreementLedgerEntry, SynthesisReport,
} from '@boardroom/shared';

export const JACCARD_THRESHOLD = 0.4;
export const DEFAULT_MAX_REBUTTALS = 3;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'his', 'her', 'i', 'my', 'me',
  'do', 'does', 'did', 'should', 'would', 'could', 'can', 'will', 'may', 'might', 'must',
  'not', 'no', 'yes', 'if', 'then', 'than', 'so', 'into', 'over', 'under', 'about', 'before', 'after',
  'first', 'now', 'also', 'only', 'very', 'more', 'most', 'less', 'least', 'any', 'all', 'some',
  'what', 'which', 'who', 'when', 'where', 'how', 'why', 'there', 'here', 'has', 'have', 'had',
]);

/** Lower-cased, punctuation-stripped content tokens (len ≥ 3, stopwords removed). */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9$%]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface ClusterResult {
  /** Clusters sorted by size desc, then by first member id asc; members sorted asc. */
  clusters: PersonaId[][];
  /** Largest cluster when it has ≥ 2 members; otherwise [] (no detectable majority). */
  majority: PersonaId[];
  /** dissentFlag personas ∪ personas outside the majority (sorted asc). */
  dissenters: PersonaId[];
}

/**
 * Majority-cluster heuristic (no embeddings on this side of the seam): union-find
 * over pairwise Jaccard(recommendation tokens) ≥ JACCARD_THRESHOLD.
 */
export function clusterByMajority(responses: Map<PersonaId, PersonaResponse>): ClusterResult {
  const ids = Array.from(responses.keys()).sort();
  const tokens = new Map<PersonaId, Set<string>>(ids.map(id => [id, tokenize(responses.get(id)!.recommendation)]));

  const parent = new Map<PersonaId, PersonaId>(ids.map(id => [id, id]));
  const find = (x: PersonaId): PersonaId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: PersonaId, b: PersonaId) => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (jaccard(tokens.get(ids[i])!, tokens.get(ids[j])!) >= JACCARD_THRESHOLD) union(ids[i], ids[j]);
    }
  }

  const groups = new Map<PersonaId, PersonaId[]>();
  for (const id of ids) {
    const root = find(id);
    const g = groups.get(root) ?? [];
    g.push(id);
    groups.set(root, g);
  }
  const clusters = Array.from(groups.values())
    .map(g => g.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const majority = clusters.length > 0 && clusters[0].length >= 2 ? clusters[0] : [];
  const majoritySet = new Set(majority);
  const dissenters = ids.filter(id => responses.get(id)!.dissentFlag || (majority.length > 0 && !majoritySet.has(id)));

  return { clusters, majority, dissenters };
}

/**
 * Which dissenters get a round-2 call, capped at `max`. Priority: explicit
 * dissentFlag first, then lowest overlap with the majority; ties by id.
 */
export function selectRebutters(
  cluster: ClusterResult,
  responses: Map<PersonaId, PersonaResponse>,
  max: number = DEFAULT_MAX_REBUTTALS,
): PersonaId[] {
  if (max <= 0) return [];
  const majorityTokens = cluster.majority.map(id => tokenize(responses.get(id)!.recommendation));
  const overlap = (id: PersonaId): number => {
    const t = tokenize(responses.get(id)!.recommendation);
    return majorityTokens.length ? Math.max(...majorityTokens.map(m => jaccard(t, m))) : 0;
  };
  return [...cluster.dissenters]
    .sort((a, b) => {
      const da = responses.get(a)!.dissentFlag ? 0 : 1;
      const db = responses.get(b)!.dissentFlag ? 0 : 1;
      if (da !== db) return da - db;
      const oa = overlap(a); const ob = overlap(b);
      if (oa !== ob) return oa - ob;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .slice(0, max);
}

const ADVISOR_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Other advisors' round-1 views with identities removed ("Advisor A/B/C").
 * Order is by persona id (deterministic) but the label never reveals it.
 */
export function anonymizeViews(others: Array<[PersonaId, PersonaResponse]>): string {
  const sorted = [...others].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted.map(([, r], i) => {
    const label = ADVISOR_LABELS[i] ?? `#${i + 1}`;
    return [
      `### Advisor ${label} (confidence ${r.confidence.toFixed(2)})`,
      `Recommendation: ${r.recommendation}`,
      `Key assumptions: ${r.keyAssumptions.join('; ') || '(none)'}`,
      `Uncertainties: ${r.uncertainties.join('; ') || '(none)'}`,
      `Cited memory ids: ${r.sourceMemoryIds.join(', ') || '(none)'}`,
    ].join('\n');
  }).join('\n\n');
}

export function buildRebuttalUserMessage(
  question: string,
  own: PersonaResponse,
  others: Array<[PersonaId, PersonaResponse]>,
): string {
  return [
    `## Original Question\n${question}`,
    `## Your Round-1 Position\nRecommendation: ${own.recommendation}\nKey assumptions: ${own.keyAssumptions.join('; ') || '(none)'}\nConfidence: ${own.confidence.toFixed(2)}\nCited memory ids: ${own.sourceMemoryIds.join(', ') || '(none)'}`,
    `## Other Advisors (anonymized)\n${anonymizeViews(others) || '(no other advisors responded)'}`,
    'Defend or concede. Return the Rebuttal JSON. No markdown wrapping.',
  ].join('\n\n');
}

function uniqSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort();
}

/**
 * Deterministic ledger: one row per recommendation cluster whose claim is still
 * held after round 2 (conceders drop out of `heldBy`) and is opposed by someone.
 * Falls back to one row per dissentFlag persona when clustering finds no split.
 */
export function buildDisagreementLedger(
  responses: Map<PersonaId, PersonaResponse>,
  rebuttals: Map<PersonaId, Rebuttal> = new Map(),
  cluster: ClusterResult = clusterByMajority(responses),
): DisagreementLedger {
  const all = Array.from(responses.keys()).sort();
  if (all.length < 2) return [];

  const conceded = (id: PersonaId) => rebuttals.get(id)?.stance === 'concede';
  const claimOf = (id: PersonaId) => rebuttals.get(id)?.revisedRecommendation?.trim() || responses.get(id)!.recommendation;
  const confidenceOf = (id: PersonaId) => rebuttals.get(id)?.revisedConfidence ?? responses.get(id)!.confidence;

  const rows: DisagreementLedgerEntry[] = [];
  for (const members of cluster.clusters) {
    const holders = members.filter(id => !conceded(id));
    if (holders.length === 0) continue;
    const opposedBy = all.filter(id => !holders.includes(id));
    if (opposedBy.length === 0) continue;
    const representative = [...holders].sort((a, b) => confidenceOf(b) - confidenceOf(a) || (a < b ? -1 : 1))[0];
    rows.push({
      claim: claimOf(representative),
      heldBy: holders,
      opposedBy,
      citedMemoryIds: uniqSorted(holders.flatMap(id => responses.get(id)!.sourceMemoryIds)),
    });
  }

  if (rows.length === 0) {
    for (const id of all) {
      if (!responses.get(id)!.dissentFlag || conceded(id)) continue;
      rows.push({
        claim: claimOf(id),
        heldBy: [id],
        opposedBy: all.filter(x => x !== id),
        citedMemoryIds: uniqSorted(responses.get(id)!.sourceMemoryIds),
      });
    }
  }

  return rows;
}

/** Round-1 sourceMemoryIds (union, sorted) that the CEO's report no longer cites. */
export function computeDroppedConsiderations(
  responses: Iterable<PersonaResponse>,
  report: Pick<SynthesisReport, 'sourceMemoryIds'>,
): string[] {
  const kept = new Set(report.sourceMemoryIds ?? []);
  const round1 = new Set<string>();
  for (const r of responses) for (const id of r.sourceMemoryIds ?? []) round1.add(id);
  return Array.from(round1).filter(id => !kept.has(id)).sort();
}

/** Markdown rendering of the ledger for the CEO user block. */
export function formatLedgerForCEO(ledger: DisagreementLedger): string {
  if (ledger.length === 0) return '';
  const rows = ledger.map((row, i) => [
    `${i + 1}. **Claim:** ${row.claim}`,
    `   - Held by: ${row.heldBy.join(', ')}`,
    `   - Opposed by: ${row.opposedBy.join(', ') || '(nobody)'}`,
    `   - Cited memory ids: ${row.citedMemoryIds.join(', ') || '(none)'}`,
  ].join('\n'));
  return `## Disagreement Ledger\nAddress every row in \`ledgerResolutions\` (same order, quote the claim).\n\n${rows.join('\n')}`;
}

export function formatRebuttalForCEO(rebuttal: Rebuttal): string {
  const revised = rebuttal.revisedRecommendation ? ` Revised recommendation: ${rebuttal.revisedRecommendation}` : '';
  return `**Round 2:** ${rebuttal.stance.toUpperCase()} (revised confidence ${rebuttal.revisedConfidence.toFixed(2)}). ${rebuttal.reason}${revised}`;
}

/** Env-driven switches (read at call time so tests can toggle them). */
export function debateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.DEBATE_ROUND2 ?? 'true').trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
}

export function maxRebuttals(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MAX_REBUTTALS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX_REBUTTALS;
}
