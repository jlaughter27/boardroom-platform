# Stage 4 Review — Pragmatic Reviewer

**Reviewer:** Pragmatic (feasibility, ops, cost, rollout)
**Target:** `stage3-debate/position-synthesis.md`
**Date:** 2026-04-18
**Companion review:** Architecture reviewer (ADR compliance) handled separately.

---

## 1. Verdict (≈100 words)

**APPROVE-WITH-CHANGES.** The synthesis is directionally right on four key calls (eval harness first, HNSW, RRF-over-text-signals, ADD/UPDATE/DELETE loop as *async*). But it quietly assumes infrastructure that doesn't exist (a `DecisionOutcome` model — there isn't one; `Decision.outcome` is a free-text string), under-prices solo-founder bandwidth, and stacks three net-new capabilities (reranker hosting, LLM write-loop, outcome scoring) onto one Railway instance that already runs Node+Prisma+node-cron+embedding queue with no monitoring. The 12-week estimate is ~40% light. Ship Phases 0 → 0.5 → 1 → 4 → 5 (eval + hygiene + index/fusion + pattern extraction + mem0 loop). Defer 3, 6, 7, 8 behind named triggers. Details below.

---

## 2. Timeline reality check

**Headline: 12 weeks by one engineer is optimistic-to-fantasy.** Realistic range is **16–22 weeks** if the engineer is also shipping product, fielding support, and running ops. The synthesis treats weeks as "focused engineering weeks" — that's not what a solo founder has. Confidence intervals below assume 60% calendar-time spent on this effort (a generous estimate).

| Phase | Synthesis est. | Realistic p50 | p90 | Notes |
|---|---|---|---|---|
| 0 — Cleanup + `search_vector` trigger | 3 days | 3 days | 5 days | Agreed. Small and mechanical. |
| 0.5 — Eval harness + baseline | 1 week | **2.5 weeks** | 4 weeks | Under-estimated. See below. |
| 1 — HNSW + RRF + search_vector | 1 week | 1.5 weeks | 2.5 weeks | HNSW is 1 DDL; RRF branch + flag + A/B plumbing + eval regeneration is the long pole. |
| 2 — Schema + bi-temporal-lite | 1 week | 1.5 weeks | 2.5 weeks | Six link tables × new columns × updating write paths is real work. |
| 3 — Cross-encoder reranker | 1 week | **3 weeks** | 5 weeks | Self-hosted ONNX on a Railway Node container is not a 5-day task. See §4. |
| 4 — Entity extraction MVP | 2 weeks | 2.5 weeks | 4 weeks | Reasonable if pattern-only. |
| 5 — ADD/UPDATE/DELETE + LLM fallback + nightly relationships | 2 weeks | **4 weeks** | 6 weeks | This phase is three features disguised as one. |
| 6 — Graph traversal + 5th ranker signal | 1 week | 1 week | 2 weeks | PL/pgSQL already exists; port is fine. |
| 7 — Outcome feedback loop | 2 weeks | **4+ weeks** | ∞ | Requires schema the plan assumes exists. See §2b. |
| 8 — Backfill + health + purge + ADRs | 2 weeks | 2.5 weeks | 4 weeks | Backfill runtime alone is 1–2 days of babysitting. |
| **Total** | **~12 weeks** | **~22 weeks** | **~35 weeks** | Roughly 2× the stated estimate. |

### 2a. Phase 0.5 — what's the actual scope of the eval harness?

Synthesis: "Seed with 30–50 hand-labeled queries from the author's own session history." In principle, 1 week. In practice:

- You need **corpora** for each query — the set of memories that *should* be retrievable. A solo-founder corpus has at best a few hundred real memories across a few domains. Synthetic augmentation (generating plausible distractors) is fine but adds ~2 days.
- Hand-labeling top-3 from ~20-candidate pools per query is ~3 min/query. 50 queries × 3 min = ~2.5 hours of pure labeling, but calibration + disagreement with an auto-labeler will easily 3× that.
- **The harder part is query diversity.** You want slices: single-hop factual, multi-entity, temporal (`before X`), recency-sensitive, ambiguous. Each slice wants ≥10 queries. That's 50 queries minimum, really 80–100 for statistical stability on deltas under 5%.
- Wiring MRR / nDCG@10 / P@5 / Recall@20 computation is ~1 day. Gating `pre-deploy.sh` on non-regression is ~0.5 day plus tuning the variance-allowance.

**Realistic: 2–3 weeks, not 1.** And it's fragile — labels bit-rot as the corpus changes. Budget 0.5 days/month to maintain it.

### 2b. Phase 3 — cross-encoder reranker on Railway

Three issues the synthesis glosses:

1. **Memory footprint.** `bge-reranker-v2-m3` (568M params) in FP16 is ~1.1GB. INT8-quantized ONNX is ~0.6GB resident, plus ONNX Runtime working memory (~200–400MB for token buffers). Railway's default container is 512MB–1GB for the starter plans; omnimind-api also runs Prisma client (~100MB), Node runtime, node-cron, the in-process embedding worker, and Express. **You will need to bump Railway RAM to at least 2GB, probably 4GB.** That's a $5–$20/month cost bump per instance plus a sizing migration (not a 1-liner).
2. **Cold start.** First query after deploy loads the model → ~3–8s delay for the first request. Railway redeploys on every push to `main`. No mitigation proposed. Options: lazy-load and accept the cost, or eager-load in a pre-warm step that extends boot (which Railway's health check may fail during).
3. **Language runtime.** ONNX Runtime for Node exists (`onnxruntime-node`) but cross-encoder tokenizers are typically Python-native. Getting `bge-reranker-v2-m3`'s tokenizer into Node means either shipping a pre-converted tokenizer.json (works) or running an ad-hoc Python sidecar (bad — another service). Plan on ~3 days just for the tokenizer packaging and validation against reference Python outputs.

**Realistic: 3 weeks.** Add a 4th week if you want an eval-validated default-on rollout rather than flag-gated opt-in.

### 2c. Phase 5 — ADD/UPDATE/DELETE + LLM extraction + nightly relationships

This is three features. The synthesis collapses them into one 2-week phase. That's under-priced:

- ADD/UPDATE/DELETE loop: async consumer, needs a durability story (see §4), needs a UI path to see what got superseded, needs a rollback path. 2 weeks alone.
- Pattern-first-LLM-fallback entity extraction: tool-use schema, Zod validation, dedupe-against-canonical-name, retry/fallback. ~1 week.
- Nightly batch relationship inference via `cortex-scheduler`: pair generation over co-occurring entities, Haiku call, confidence gating, `PENDING_REVIEW` state. ~1 week. Plus a decision about who reviews `PENDING_REVIEW` — solo founder, almost certainly nobody, which means the queue either grows unbounded or auto-ages-out (needs design).

**Realistic: 4 weeks minimum.** Highly recommend splitting: 5a (ADD/UPDATE/DELETE + LLM extraction), 5b (nightly relationships).

### 2d. Phase 7 — outcome feedback loop — critical data-model gap

**The synthesis references `DecisionOutcome` as if it were a schema entity. It isn't.** The schema (`packages/omnimind-api/prisma/schema.prisma` lines 254–279) has `Decision` with `outcome: String?` (free-text) and `outcomeRating: Int?`. There's also `OutcomeReviewNudge` (a scheduling table, not an outcome store). The "join memories cited in decisions that shipped vs. reversed" operation requires at minimum:

- A structured `DecisionOutcome` table (shipped/reversed/neutral status, timestamp, maybe text)
- A traceable **link from retrieved-memory → decision** at retrieval time. Today, context-packager returns memories; there's no persisted record of "this persona invoked on this decision used these memory IDs."
- A schema for `MemoryCitation` or `DecisionMemoryCitation` to persist that trace
- Cortex job to compute `outcome_quality` per memory, which means either an aggregate column on `MemoryEntry` or a denormalized scoring table

None of that plumbing exists. Phase 7 is really: design new schema (2–3 days), migrate and backfill (2 days), retrofit context-assembler to persist citations (1 week), build the cortex job (1 week), wire into ranker (3 days), eval impact. **Realistic: 4–6 weeks, not 2.** And the signal is only meaningful once decisions *have* outcomes — for a pre-PMF product with a few users, most decisions will be `outcome: null` for months. The usage-weighted signal (`access_count × recency`) is implementable today. The outcome-weighted term is **six months out at best**.

---

## 3. Cost reality check

Back-of-envelope, using Claude Haiku 4.5 at ~$1/M input + $5/M output tokens and OpenAI `text-embedding-3-small` at $0.02/M tokens.

Assume a "real" user writes 50 memories/day = 1,500/month. Current scale (~low-double-digit users) = ~30k memories/month. 1,000-user scale = 1.5M memories/month.

| Pipeline addition | Tokens/call (in+out) | $/call | Frequency | $/user/month | @1000 users |
|---|---|---|---|---|---|
| Entity extraction LLM fallback (triggered ~20% of writes) | 400 in + 200 out | $0.0014 | 300/mo | $0.42 | $420 |
| ADD/UPDATE/DELETE decision call (every write) | 500 in + 100 out | $0.001 | 1,500/mo | $1.50 | $1,500 |
| Nightly relationship inference (pairs) | 600 in + 300 out | $0.0021 | ~200 pairs/mo | $0.42 | $420 |
| HyDE (opt-in, ~3% of queries) | 300 in + 200 out | $0.0013 | ~15/mo | $0.02 | $20 |
| Reranker inference (local, ~120ms CPU/query) | — | $0 direct | 500 queries/mo | $0 | ~$50 Railway bump |
| Embeddings (entity text) | ~100 tokens × 3/memory | $0.000006 | 1,500/mo | $0.01 | $9 |
| **Subtotal LLM pipeline** | | | | **~$2.40/user** | **~$2,400/mo** |

Plus Railway RAM bump (reranker) = ~$20/month flat per instance.

**At today's scale (10 users): ~$25/month in pipeline LLM costs.** Tolerable.
**At 1000 users: ~$2,400/month** plus generation costs (which dwarf pipeline costs at 3–5× ratio). **Per-user gross cost of memory pipeline alone ≈ $2.40**; on a $10/month tier that's 24% of revenue *before* generation costs (which can be $5–15/user/month for active use). **Unit economics start to hurt around $10–20 tiers.**

The synthesis claims "≤$1 per 100 memories documented." The math above puts the mem0 ADD/UPDATE/DELETE loop at about **$0.67 per 100 writes** (good), but once you add LLM-fallback extraction + nightly relationships it's **~$1.50/100**. The synthesis's exit criterion will fail if extraction fallback triggers >20% of writes, which is plausible on a realistic corpus where pattern-based regex misses context.

**Backfill blast radius.** If you have ~500 existing memories/user × 50 users = 25,000 memories, full backfill at $0.0014/memory for LLM extraction = **$35 one-off**. Fine. At 1000 users × 500 memories = 500k memories = **$700**. Plan hard caps *per user* and *global*, not just global.

**Reranker CPU.** Railway's shared-CPU plan throttles under sustained load. 120ms/query is "CPU time" on unloaded hardware; on a busy container with Node, Prisma, and the cortex scheduler running nightly, it will spike to 300–500ms. That's still under the 3–8s LLM generation budget, but it is *not* free and needs monitoring.

---

## 4. Operational risks not named by the synthesis

1. **In-memory queue + new pipelines = correlated failure on restart.** Today the embedding queue loses queued work on Railway restart (audit F.6). Adding an ADD/UPDATE/DELETE async worker onto the same in-process queue means a Railway restart during a consolidation burst orphans two classes of work. Recovery story today: manual backfill. **Proposed mitigation (not in synthesis): persist a `MemoryWriteEvent` row at write time with `consolidationStatus: PENDING`. On boot, drain `PENDING` rows into the in-memory queue.** This is ~1 day of work and should be a hard prerequisite for Phase 5.

2. **Reranker cold-start.** First query after deploy pays the 3–8s model load. Mitigation: eager-load in a `setImmediate` during boot, and either accept the extended-boot behavior or bypass the reranker while `RERANKER_READY=false`. Neither is in the plan. Document it.

3. **Backfill runtime.** 25k memories at ~600ms/memory (LLM extraction + write) = **~4 hours**. 500k memories = **~3.5 days**. Railway one-off jobs have timeouts. Current plan says "runs as Railway one-off job." Won't work at scale — needs to be chunked + resumable, with a cursor in Postgres. Add `~2 days of engineering` to Phase 8 for this.

4. **Feature flag via env var requires Railway restart to flip.** This is fine until you need to roll back a bad reranker or ADD/UPDATE/DELETE decision loop *during an incident* — a restart cycle is 30–90s and disrupts in-flight sessions. Since synthesis accepts no runtime config (CLAUDE.md compliant), document a **per-request header override for admin users** as the emergency rollback path (~1 hour of code). Without it, "feature-flagged" is theoretical safety.

5. **node-cron + reranker + Express in one process.** When the Monday 3am pattern job runs against a user with 10k+ memories, it can pin a CPU for minutes. During that time, the reranker path on any user's query will thrash. This is already a known limitation (CLAUDE.md known-limitations #6, #7). Adding a cross-encoder makes the collision harsher. Mitigation: at minimum, the weekly cortex run should back off if query QPS > threshold. Not in the plan.

6. **No monitoring beyond `/health`.** You are about to add three new failure classes (reranker OOM, LLM timeout in ADD/UPDATE/DELETE, relationship extraction errors). Without at minimum a `console.error`-tail-to-alert pipeline, you will ship silent regressions. The synthesis exit criterion "eval shows no regression" runs once at phase-end, not continuously. **Propose: add a Railway log drain to an external service (Better Stack, Axiom — free tiers exist) *before* Phase 3, not after.** That's a day of setup and saves a week of debugging later.

7. **Subscription-middleware fails-open (CLAUDE.md known-limitation #5).** New capabilities added to OmniMind → more failure modes that trigger fail-open. Worth revisiting in the context of this plan — if the reranker OOMs and crashes the container, every subscribed user gets free access until Railway restarts. Probably fine for pre-PMF; flag it.

---

## 5. Rollout & safety

Per-capability rollback analysis — synthesis is thin here.

| Capability | Rollback plan | Clean? |
|---|---|---|
| HNSW migration | `DROP INDEX + CREATE USING ivfflat`. Minutes. | Yes |
| RRF fusion | Env flag `RANKER_MODE=weighted`. Requires restart. | Yes |
| Bi-temporal-lite columns | Columns nullable; old queries ignore. No rollback needed. | Yes (additive) |
| Cross-encoder reranker | Env flag + RAM-footprint rollback also means downsize container. | **Partial** (needs RAM re-sizing) |
| ADD/UPDATE/DELETE loop | **Problem: already-superseded memories don't auto-un-supersede.** `supersededBy` is stored; un-winding means a reverse script. The good news: nothing is hard-deleted. The bad news: recent "updates" replaced memory content via `UPDATE` — the original text may be lost if not stored as `version` history. Confirm `MemoryEntry.version` already persists old content (audit A notes "version increments on update" — verify content is also preserved). If not, **`UPDATE` is destructive and must be changed to always-create-new-+-supersede-old**. Synthesis doesn't specify. | **Maybe not** — requires schema-level audit. |
| Entity extraction | Soft-delete `ExtractedEntity` rows; orphan `MemoryEntityLink` rows. Clean in principle; need a `deletedAt` on both. | Yes if added from day one |
| Ranker boost | Env flag. Clean. | Yes |
| Outcome feedback | Ranker term flag. Clean. | Yes |

**Concrete gap:** Phase 5 ADD/UPDATE/DELETE must use copy-on-write (new row + supersede old) rather than in-place UPDATE. If it doesn't, rollback is one-way. This needs to be spelled out in the exit criteria.

**Bi-temporal migration with 100k rows/user.** At current scale (few users × few thousand memories), migration is under a minute. At 1000 users × 100k memories = 100M rows across six link tables: Postgres `ALTER TABLE ADD COLUMN` with a default `NULL` is near-instant (metadata-only). With non-null defaults it rewrites. **Use `NULL` defaults, backfill in a background job.** Synthesis doesn't specify — add to Phase 2 exit criteria.

---

## 6. Measurability — the eval-harness bet

The synthesis makes Phase 0.5 the keystone: "every subsequent decision depends on it." That's correct as architecture and worrying as pragmatics.

**Where do labels come from?** In a pre-PMF product with ~10 real users, the honest answer is: the founder. That means:

- ~50 queries manually labeled against the founder's own session history. **This is a founder working as a ground-truth-generator for a week.** It's do-able but eats directly into feature velocity. The synthesis should name this as "founder labor, not engineering labor" — they're separable budgets.
- **Auto-labeling via Claude Haiku is circular.** If the eval measures "does our retrieval surface what Haiku thinks is relevant," and Haiku also powers extraction and ADD/UPDATE/DELETE, we're measuring a self-consistent loop that can degrade in lockstep without registering. Use Claude **Sonnet 4.6 as the judge** (different model family, stronger), and human-review a 20% sample.
- **Synthetic queries against synthetic corpora** are cheap and catch big regressions but miss the actual failure modes (domain jargon, name disambiguation, recency surprises).

**Minimum viable eval.** For go/no-go on phases, you don't need 100 queries across 5 slices. You need:

- 20 queries, single-hop factual, with unambiguous top-3.
- 10 multi-entity queries.
- 5 temporal ("what did I decide about X before April?").

**That's 35 queries. Labeling takes 2–3 hours. Maintenance is <1 hour/month.** Aim for this as the MVP eval; scale up only if a go/no-go decision hinges on a sub-5% delta.

**Is retrieval eval even the right target?** Legitimate concern. A retrieval lift of 5% doesn't necessarily produce a user-visible persona answer improvement — Claude Sonnet 4.6's 1M context means "somewhat-wrong top-5 but right top-15" often produces an equivalent persona response. **The downstream eval (persona-response quality on decision scenarios) is the signal that actually matters for product.** The synthesis should add a lightweight e2e persona eval as a secondary gate: "if retrieval improves X% but persona-eval doesn't move, we're optimizing for the wrong thing." This already partly exists in `eval:personas`.

---

## 7. Simplification proposals

A version of the plan that ships ~80% of value in ~50% of time:

**Ship this (6–8 weeks):**
- Phase 0 — cleanup + `search_vector` trigger (3 days)
- Phase 0.5-lite — 35-query eval, baseline, CI gate (1.5 weeks)
- Phase 1 — HNSW migration + RRF behind flag + eval validation (1 week)
- Phase 2 — schema + bi-temporal-lite on links (1.5 weeks)
- Phase 4 — pattern-only entity extraction + ranker boost (entity-match, no traversal) (2 weeks)

**Defer everything else behind named triggers:**
- **Cross-encoder reranker:** defer until eval shows top-5 MRR < 0.7 on labeled set. (The conservative's gate — adopted.)
- **Mem0 ADD/UPDATE/DELETE:** defer until a user or the cortex contradiction scan surfaces ≥5 duplicate-memory pairs in 30 days. Today's cortex layer already catches contradictions weekly; wait for volume.
- **LLM relationship inference:** defer until pattern-only hits <50% of what Haiku would extract on a 100-memory hand-labeled sample.
- **Outcome feedback loop:** defer until `Decision.outcome` is non-null on ≥50 decisions across the user base. Today it's near-null.
- **Graph traversal multi-hop:** defer per the synthesis's own logic (>15% multi-hop trigger).

This cuts ~14 weeks of work, delivers the measurability gate, HNSW, RRF, bi-temporal-lite, and pattern extraction with entity boost. That's 80% of the measurable retrieval lift. The remaining 20% is exactly the speculative, cost-heavy stuff that a pre-PMF product should prove demand for before building.

---

## 8. Concrete changes required before APPROVE

1. **Replace the 12-week total with a 16–22 week range** and note the "real calendar time" vs. "engineering time" distinction. A solo founder does not have 12 focused engineering weeks.
2. **Call out the `DecisionOutcome` schema gap explicitly** in Phase 7 and either (a) design the schema as part of Phase 7 (adding ~2 weeks) or (b) split Phase 7 into 7a (access-count + recency ranker term — ships today) and 7b (outcome-weighted — gated on `Decision.outcome` coverage ≥ threshold). Option (b) is cleaner.
3. **Split Phase 5** into 5a (ADD/UPDATE/DELETE + LLM extraction, 2.5 weeks) and 5b (nightly relationship inference, 1.5 weeks).
4. **Add RAM-sizing and cold-start plan to Phase 3.** Specify Railway container bump target (4GB), eager-load strategy, health-check behavior during load.
5. **Add a "write-event persistence" prerequisite to Phase 5.** Memory-write events must persist to Postgres before being queued, so Railway restarts don't orphan consolidation work.
6. **Add a log-drain step to Phase 0** — Better Stack or Axiom free tier, <1 day, unblocks observability for every subsequent phase.
7. **Clarify ADD/UPDATE/DELETE is copy-on-write,** not in-place update. Explicit exit criterion.
8. **Downscope the MVP eval to 35 queries** in Phase 0.5. Scale up only if a go/no-go delta is sub-5%.
9. **Add a secondary persona-response eval gate** alongside retrieval eval — "retrieval improved, did persona improve?" is the question that matters for product.
10. **Per-user + global LLM spend caps on backfill**, not just global. And chunked/resumable backfill, not a single Railway one-off.
11. **Admin-header feature override** for emergency rollback without restart. 1 hour of code, saves a real incident.

---

## 9. Counter-proposal

**Reorder around the coupled "eval-harness + access-count feedback" pair, not eval-harness + outcome-feedback.** The synthesis correctly identifies that the eval harness and a feedback loop are the keystone. But it reaches for `DecisionOutcome` scoring, which doesn't have schema, won't have data for 6+ months, and requires retrieval-citation plumbing that doesn't exist.

**Instead:** Phase 7 ships **access-count + recency-weighted ranker term** immediately (no LLM cost, no schema change — just two columns on `MemoryEntry` updated async post-retrieval). This is the "cheap, self-correcting proxy" the hierarchical-temporal §4 endorsed. It captures 60–70% of the outcome-feedback value at 5% of the effort.

The "true" outcome-weighted term becomes a future Phase 7b, gated on:
- `Decision.outcome` populated on ≥50 decisions across the user base
- Retrieval citation-persistence (new `MemoryCitation` table) shipped
- `DecisionOutcome` structured entity (new model)

This is ~8 weeks of work that cannot start until enough product usage exists to have outcomes — which means a product-usage milestone gates it, not an engineering phase. That's actually liberating: it means Phase 7b is **the right work when the data justifies it**, and right now the data doesn't. Be honest about that and ship access-count today.

Corollary: **drop Phase 3 reranker from the core plan** and move it into "deferred with named trigger" alongside HyDE. The 1M-context Claude argument from the conservative (§6.1) is real — a 5–15% retrieval nDCG lift doesn't always translate to persona-response lift when the generator can reason over a much wider context. Measure it first, then ship.

Net result: **8 weeks of work** ships the measurable differentiators (eval harness, HNSW, RRF, bi-temporal-lite, pattern entity extraction, access-count scoring), with the speculative/expensive stuff explicitly gated on evidence that doesn't yet exist. That matches what a pre-PMF solo founder can actually operate.

---

*Word count: ~2,050.*
