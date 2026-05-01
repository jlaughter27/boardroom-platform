# Phase 6 — Tasks and Prompts

Five atomic tasks; ~11 hours over 2-3 days.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 6.1 | Trigram match query | `packages/omnimind-api/src/retrieval/entity-boost.ts` (new) | Query produces correct boost candidates | 3h |
| 6.2 | Boost integration in ranker | `src/retrieval/ranker.ts` | Both modes apply boost when flag on | 2h |
| 6.3 | A/B bucketing helper | `src/lib/ab-bucket.ts` (new), `docs/architecture/ab-testing.md` | 25% of users see boost; deterministic per-user | 1h |
| 6.4 | Tests | `tests/unit/retrieval/{entity-boost,ranker}.test.ts` | All branches covered; perf <50ms | 3h |
| 6.5 | Eval + flag flip + monitor | `docs/eval-results/phase-6.md` (new) | Multi-entity ≥3% lift OR overall ≤3% regression | 2h |

---

## Task 6.1 — Trigram match against ExtractedEntity

**Prompt:**

> Create `packages/omnimind-api/src/retrieval/entity-boost.ts`. Function: given a query string and a set of memory IDs, return a map `memoryId → boost` where boost = +0.15 if any linked entity has a trigram-matching canonical name to the query.
>
> ```ts
> import { prisma } from '../lib/db';
>
> const BOOST_AMOUNT = 0.15;
> const TRIGRAM_THRESHOLD = 0.6;
> const ACTIVE_CONFIDENCE = 0.7;
>
> export async function computeEntityBoosts(
>   userId: string,
>   query: string,
>   memoryIds: string[],
> ): Promise<Map<string, number>> {
>   if (memoryIds.length === 0) return new Map();
>
>   // Find all entities linked to these memories with high-confidence relationships
>   // Then trigram-match their canonical names against the query
>   const rows = await prisma.$queryRaw<Array<{ memory_id: string; canonical_name: string; sim: number }>>`
>     SELECT mel.memory_id, ee.canonical_name,
>            similarity(ee.canonical_name, ${query}) AS sim
>     FROM memory_entity_links mel
>     JOIN extracted_entities ee ON ee.id = mel.entity_id
>     LEFT JOIN entity_relationships er ON er.source_id = ee.id AND er.user_id = ${userId}
>     WHERE mel.user_id = ${userId}
>       AND mel.memory_id = ANY(${memoryIds}::text[])
>       AND ee.deleted_at IS NULL
>       AND (er.id IS NULL OR (er.confidence >= ${ACTIVE_CONFIDENCE} AND er.status = 'ACTIVE'))
>       AND similarity(ee.canonical_name, ${query}) >= ${TRIGRAM_THRESHOLD}
>   `;
>
>   const boosts = new Map<string, number>();
>   for (const row of rows) {
>     // Each matched entity contributes +BOOST_AMOUNT; cap at 2x boost for multiple matches
>     const current = boosts.get(row.memory_id) ?? 0;
>     boosts.set(row.memory_id, Math.min(current + BOOST_AMOUNT, BOOST_AMOUNT * 2));
>   }
>   return boosts;
> }
> ```
>
> Note: cap at 2× boost so a memory linked to 5 query-matching entities doesn't dominate. Document the cap.

---

## Task 6.2 — Boost integration in ranker

**Prompt:**

> Open `packages/omnimind-api/src/retrieval/ranker.ts`. Modify both `weightedScore` and `rrfScore` paths.
>
> ```ts
> import { computeEntityBoosts } from './entity-boost';
> import { isInABBucket } from '../lib/ab-bucket';
>
> export async function rankCandidates(input: {
>   userId: string;
>   query: string;
>   candidates: Candidate[];
> }): Promise<Candidate[]> {
>   const useBoost = env.RANKER_ENTITY_BOOST_ENABLED && isInABBucket(input.userId, 4, 0);
>
>   const boosts = useBoost
>     ? await computeEntityBoosts(input.userId, input.query, input.candidates.map(c => c.id))
>     : new Map<string, number>();
>
>   const scoreFn = env.RANKER_MODE === 'rrf' ? rrfScore : weightedScore;
>   return [...input.candidates].sort((a, b) => {
>     const scoreA = scoreFn(a) + (boosts.get(a.id) ?? 0);
>     const scoreB = scoreFn(b) + (boosts.get(b.id) ?? 0);
>     return scoreB - scoreA;
>   });
> }
> ```
>
> The function signature now requires `userId` and `query`. Update all call sites in `context-packager.ts` to pass them.
>
> Add unit test: same input with boost-on vs boost-off → boost-on places a query-matching memory higher in the result.

---

## Task 6.3 — A/B bucketing helper

**Prompt:**

> Create `packages/omnimind-api/src/lib/ab-bucket.ts`:
>
> ```ts
> import { createHash } from 'crypto';
>
> /**
>  * Deterministic per-user A/B bucketing.
>  *
>  * Returns true if the user is in bucket `bucketIndex` of `bucketCount` total.
>  * Same user always returns the same answer for the same (bucketCount, bucketIndex).
>  *
>  * Critical: per-user, NOT per-request. Avoids mid-session inconsistency.
>  */
> export function isInABBucket(userId: string, bucketCount: number, bucketIndex: number): boolean {
>   const hash = createHash('sha256').update(userId).digest();
>   const value = hash.readUInt32BE(0);
>   return value % bucketCount === bucketIndex;
> }
> ```
>
> Use SHA-256 (deterministic, evenly distributed) over JS string `hashCode` (uneven distribution on common ID patterns).
>
> Add unit tests:
>
> - Same userId returns same bucket
> - Distribution: 1000 random userIds → ~250 in bucket 0 of 4 (25% ± a few)
> - All buckets get hits
>
> Create `docs/architecture/ab-testing.md`:
>
> ```md
> # A/B Testing Pattern
>
> All ranker / retrieval changes that we want to validate in production ship behind a deterministic per-user A/B bucket using `isInABBucket(userId, bucketCount, bucketIndex)`.
>
> ## Why per-user, not per-request
>
> Mid-session inconsistency is jarring. If user X gets the boost on query 1 and not on query 2 of the same session, results shuffle unpredictably. Per-user bucketing means a user's behavior is consistent throughout — they're either in the experiment or not.
>
> ## Why SHA-256
>
> Even distribution. Naïve string hashing biases by character position; cuids have predictable prefixes that throw off the bucket.
>
> ## How to roll forward
>
> Once eval + sampled-user feedback are both green, expand from `bucketIndex: 0` (25%) to setting the env flag globally true for all users. Leave the bucket helper in code for the next experiment.
> ```

---

## Task 6.4 — Tests

**Prompt:**

> `tests/unit/retrieval/entity-boost.test.ts`:
>
> - Empty memoryIds → empty Map
> - Memory with no linked entities → no boost
> - Memory linked to entity with low-confidence relationship → no boost
> - Memory linked to entity with `confidence ≥ 0.7` AND `canonicalName` trigram-matches query at ≥0.6 → boost = 0.15
> - Memory linked to 3 query-matching entities → boost = 0.30 (capped at 2× single boost)
> - Trigram below threshold → no boost
>
> `tests/unit/retrieval/ranker.test.ts` (extension):
>
> - Boost flag OFF → no DB call, behavior identical to Phase 3
> - Boost flag ON + user IN bucket → boost applied
> - Boost flag ON + user NOT IN bucket → no boost
> - Both ranker modes (weighted + RRF) apply boost correctly
>
> Performance test in `tests/integration/ranker-perf.test.ts`:
>
> - Seed 1000 entity-linked memories for one user
> - Run rankCandidates with boost on
> - Assert p95 < 200ms across 50 sequential calls
> - Compare to boost-off baseline; assert delta < 50ms p95

---

## Task 6.5 — Eval + flag flip + monitor

**Prompt:**

> 1. Run eval with flag OFF — should match current baseline.
> 2. Run eval with flag ON for ALL users (force `isInABBucket` to return true) — capture metrics.
>
> ```bash
> RANKER_ENTITY_BOOST_ENABLED=true RANKER_BOOST_FORCE_ALL=true npm run eval:retrieval -- --json > /tmp/eval-boost-on.json
> RANKER_ENTITY_BOOST_ENABLED=false npm run eval:retrieval -- --json > /tmp/eval-boost-off.json
> ```
>
> Add a `RANKER_BOOST_FORCE_ALL` env var that overrides bucketing for eval purposes — never set in production.
>
> 3. Compare results in `docs/eval-results/phase-6.md`:
>
> ```md
> # Phase 6 Eval Results — Entity Ranker Boost
>
> ## Decision criteria
> - SHIP if multi-entity slice MRR lift ≥ 3% AND single-hop slice MRR not regressed by >2%
> - DEFER if either fails
>
> ## Results
> | Metric | Boost OFF | Boost ON | Delta |
> |---|---|---|---|
> | Overall MRR | 0.XX | 0.XX | +X.X% |
> | Single-hop MRR | 0.XX | 0.XX | +X.X% |  ← must not be < -2%
> | Multi-entity MRR | 0.XX | 0.XX | +X.X% |  ← must be > +3%
> | Temporal MRR | 0.XX | 0.XX | +X.X% |
>
> ## Decision: <SHIP | TUNE | DEFER>
> ```
>
> 4. If SHIP: deploy with flag ON for 25% bucket. Monitor for 7 days.
>    - Better Stack saved query: `event:ranker AND boost_applied:true`
>    - Compare retrieval p95 latency for boost-on vs boost-off cohort
>    - If green at 7 days, expand to 100% (flip env flag globally on, A/B helper still works for next experiment)
> 5. If TUNE: adjust trigram threshold (try 0.7 instead of 0.6) or boost amount (try 0.10 instead of 0.15); re-run eval.
> 6. If DEFER: leave flag OFF; document the failure mode.
>
> Commit:
>
> ```
> feat(phase-6): entity-aware ranker boost
>
> - +0.15 boost when memory links to ExtractedEntity with canonical name trigram-matching query
> - Only reads EntityRelationship.confidence >= 0.7
> - Caps at 2x for multi-match memories
> - Behind RANKER_ENTITY_BOOST_ENABLED flag
> - A/B by isInABBucket(userId, 4, 0) — 25% rollout
> - Multi-entity MRR +X.X%, single-hop ±X.X%
> ```
