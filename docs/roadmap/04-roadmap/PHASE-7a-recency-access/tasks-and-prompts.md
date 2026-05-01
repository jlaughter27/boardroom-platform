# Phase 7a — Tasks and Prompts

Six atomic tasks; ~11 hours over 2-3 days.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 7a.1 | Verify / add `lastAccessedAt` + `accessCount` | `packages/omnimind-api/prisma/schema.prisma` | Both columns exist; defaults sensible | 1h |
| 7a.2 | Async post-retrieval update | `src/retrieval/context-packager.ts`, `src/services/memory-access.service.ts` (new) | Update happens fire-and-forget; doesn't slow retrieval | 2h |
| 7a.3 | `usage_signal` ranker term | `src/retrieval/ranker.ts` | Both modes incorporate the term; weight tunable | 2h |
| 7a.4 | Exponential recency replacement | `src/retrieval/ranker.ts` | Binary cliff replaced; unit test asserts the math | 1h |
| 7a.5 | Tests | `tests/unit/retrieval/ranker.test.ts`, `tests/integration/access-tracking.test.ts` | Async update verified; ranker math verified | 3h |
| 7a.6 | Eval + flag + monitor | `docs/eval-results/phase-7a.md` (new) | Eval improves OR neutral; deploy 25% then 100% | 2h |

---

## Task 7a.1 — Verify / add columns

**Prompt:**

> Open `packages/omnimind-api/prisma/schema.prisma`. Find the `MemoryEntry` model. Verify these columns exist:
>
> ```prisma
> lastAccessedAt DateTime?  @default(now()) @map("last_accessed_at")
> accessCount    Int        @default(0)     @map("access_count")
> ```
>
> If either is missing, add them as nullable / defaulted (so the migration is non-destructive). Run `prisma db push` locally to apply (production already has Phase 1's `MIGRATE_PROTECTION` discipline).
>
> Add a partial index for queries that sort by `accessCount`:
>
> ```prisma
> @@index([userId, accessCount(sort: Desc)])
> ```
>
> Run `npm run typecheck` and `npm run test`. If existing tests break (older fixtures may expect old columns), fix them.

---

## Task 7a.2 — Async post-retrieval update

**Prompt:**

> Create `packages/omnimind-api/src/services/memory-access.service.ts`:
>
> ```ts
> import { prisma } from '../lib/db';
> import { logger } from '../lib/logger';
>
> /**
>  * Fire-and-forget update of access timestamps for a batch of retrieved memories.
>  * Does NOT block the retrieval response.
>  */
> export function trackMemoryAccess(memoryIds: string[]): void {
>   if (memoryIds.length === 0) return;
>   prisma.memoryEntry.updateMany({
>     where: { id: { in: memoryIds } },
>     data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
>   })
>   .catch(err => logger.warn({ err, memoryIds }, 'trackMemoryAccess failed'));
> }
> ```
>
> Open `packages/omnimind-api/src/retrieval/context-packager.ts`. After the final ranked list is computed and right before returning to the caller, call:
>
> ```ts
> import { trackMemoryAccess } from '../services/memory-access.service';
>
> trackMemoryAccess(rankedResults.map(r => r.id));
> // Return to caller without awaiting
> return rankedResults;
> ```
>
> Verify retrieval p95 latency is unchanged in eval — the update is async.

---

## Task 7a.3 — `usage_signal` ranker term

**Prompt:**

> Open `packages/omnimind-api/src/retrieval/ranker.ts`. Add a new term:
>
> ```ts
> import { env } from '../lib/env';
> import { isInABBucket } from '../lib/ab-bucket';
>
> // ... existing weighted/rrf functions ...
>
> function usageSignal(c: Candidate): number {
>   // log(access_count + 1) caps unbounded growth
>   return Math.log((c.accessCount ?? 0) + 1);
> }
>
> function adjustedScore(c: Candidate, base: number, useUsage: boolean): number {
>   if (!useUsage) return base;
>   return base + env.WEIGHT_USAGE * usageSignal(c);
> }
> ```
>
> Add to `env.ts`: `WEIGHT_USAGE: z.coerce.number().default(0.05)`. Document in `.env.example`.
>
> In `rankCandidates`, after computing the base score, apply the usage adjustment:
>
> ```ts
> const useUsage = env.RANKER_USAGE_SIGNAL_ENABLED && isInABBucket(input.userId, 4, 1); // bucket 1 of 4 — independent of Phase 6's bucket 0
> ...
> const scoreA = adjustedScore(a, scoreFn(a) + (boosts.get(a.id) ?? 0), useUsage);
> ```
>
> Bucket 1 (different from Phase 6's bucket 0) means a different 25% of users get this — phase-7a and phase-6 are independently A/B'd.

---

## Task 7a.4 — Exponential recency replacement

**Prompt:**

> The current ranker probably has something like `recency = createdAt within 7 days ? 0.1 : 0`. Find it in `ranker.ts`. Replace with:
>
> ```ts
> function recencySignal(c: Candidate): number {
>   const ageDays = (Date.now() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24);
>   return Math.exp(-ageDays / 30);
> }
> ```
>
> The exponential decay gives:
> - 1 day old: ~0.97
> - 7 days old: ~0.79
> - 30 days old: ~0.37
> - 90 days old: ~0.05
>
> Tunable via `RANKER_RECENCY_DECAY_DAYS` env var, default 30.
>
> Replace the binary recency in `weightedScore` with this function. RRF doesn't use recency directly (per Phase 3 design) — leave RRF unchanged.
>
> Add unit tests:
>
> - Today's memory → recency ~1.0
> - 30 days old → recency ~0.37
> - 90 days old → recency ~0.05
> - 1 year old → near 0
>
> The behavior is gated by the same `RANKER_USAGE_SIGNAL_ENABLED` flag — both refinements ship together.

---

## Task 7a.5 — Tests

**Prompt:**

> `tests/integration/access-tracking.test.ts`:
>
> - Run a retrieval call → returned memories have `lastAccessedAt` updated within 5s
> - Run twice → `accessCount` incremented by 2
> - Async update doesn't block: assert retrieval response time unchanged
> - Update failure (e.g., transient DB error) doesn't propagate to caller
>
> `tests/unit/retrieval/ranker.test.ts` (extension):
>
> - `usageSignal`: `log(1) = 0`, `log(11) ≈ 2.4`, `log(101) ≈ 4.6`. Verify the math.
> - `recencySignal`: assertions per task 7a.4 (`exp(-1/30) ≈ 0.967`, etc.)
> - Flag OFF + bucket-IN: no usage adjustment applied
> - Flag ON + bucket-OUT: no usage adjustment applied
> - Flag ON + bucket-IN: usage adjustment applied
> - Same memory accessed many times ranks higher than fresh memory with same semantic relevance (small effect, hard to assert exactly — assert directional)

---

## Task 7a.6 — Eval + flag + monitor

**Prompt:**

> Run eval in 4 configurations to isolate effects:
>
> 1. Phase 6 OFF + Phase 7a OFF (baseline) → already in `eval/baselines/2026-04.json`
> 2. Phase 6 OFF + Phase 7a ON
> 3. Phase 6 ON + Phase 7a OFF
> 4. Phase 6 ON + Phase 7a ON (target state)
>
> Use the `RANKER_BOOST_FORCE_ALL` and a new `RANKER_USAGE_FORCE_ALL` for forcing all-users-in-bucket during eval.
>
> Save to `docs/eval-results/phase-7a.md`:
>
> ```md
> # Phase 7a Eval Results — Recency + Usage Signal
>
> ## Configurations tested
> | Config | Overall MRR | Single-hop MRR | Multi-entity MRR | Temporal MRR |
> |---|---|---|---|---|
> | Baseline | ... | ... | ... | ... |
> | Phase 7a only | ... | ... | ... | ... |
> | Phase 6 only | ... | ... | ... | ... |
> | Phase 6 + 7a | ... | ... | ... | ... |
>
> ## Decision: SHIP / TUNE / DEFER
>
> ## Notes
> - Phase 7a expected to lift temporal slice most.
> - If usage signal regresses single-hop, lower WEIGHT_USAGE.
> ```
>
> Decision criteria:
>
> - **SHIP** if Phase 7a causes ≥0% lift overall AND no slice regresses by >2%
> - **TUNE** if temporal lift exists but other slice regresses — lower the weight
> - **DEFER** only if 7a-on consistently regresses (unlikely given the math is strictly more flexible than the binary boost)
>
> If SHIP: deploy with 25% A/B bucket (`isInABBucket(userId, 4, 1)`). Monitor for 7 days. If green, expand to 100%.
>
> Commit:
>
> ```
> feat(phase-7a): recency + access-count ranker refinement
>
> - lastAccessedAt updated async post-retrieval (fire-and-forget)
> - usage_signal = log(access_count + 1) added to ranker (weight 0.05)
> - Binary 7-day recency boost replaced with exp(-Δdays/30)
> - Behind RANKER_USAGE_SIGNAL_ENABLED + 25% A/B bucket 1 of 4
> - Independent of Phase 6 A/B (bucket 0 of 4)
> - Eval: overall MRR ±X.X%, temporal MRR +X.X%
> ```
