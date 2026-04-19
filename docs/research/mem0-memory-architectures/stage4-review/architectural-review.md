# Stage 4 — Architectural Review of the Synthesis Position

**Reviewer:** Architectural Reviewer
**Date:** 2026-04-18
**Reviewing:** `docs/research/mem0-memory-architectures/stage3-debate/position-synthesis.md`
**Against:** ADRs 001-011, CLAUDE.md service boundaries, stage3 aggressive/conservative positions, current schema.

---

## 1. Verdict summary

**APPROVE-WITH-CHANGES.** The synthesis is directionally sound and the sequencing (eval harness as Phase 0.5, outcome-feedback loop as the keystone, HNSW + RRF in Phase 1, reranker in Phase 3, ADD/UPDATE/DELETE async in Phase 5) respects every ADR and correctly identifies omnimind's unfair advantage. But three specific issues must be fixed before execution: (a) the `search_vector` trigger claim is wrong — that column is dead code, not a maintenance gap; (b) bi-temporal link columns plus MEM0-style async writes will break the existing `MemoryEntityLink` query surface and the ranker.test.ts expectations, and the plan doesn't budget for that; (c) relationship-extraction prompts are not specified as `docs/prompts/*.system.md` assets, which risks burying persona logic in TypeScript.

---

## 2. ADR compliance check

| ADR | Claim | Assessment |
|---|---|---|
| **001 — No agent frameworks** | Custom TS runtime only. | **Respected.** Synthesis explicitly rejects mem0 wholesale, HippoRAG PPR machinery, Graphiti Neo4j coupling, MemGPT tiers, and LangGraph Store runtime (§2 HippoRAG, §2 MemGPT, §2 LangGraph). ONNX-local `bge-reranker-v2-m3` is a model file loaded by existing TS code — it's inference hosting, not an orchestration framework. Safe. |
| **002 — Anthropic only** | No multi-model routing. | **Respected.** Every proposed LLM call uses Claude Haiku 4.5 (ADD/UPDATE/DELETE, relationship inference, HyDE-if-ever). Reranker is encoder-only, not an LLM, so ADR-002 doesn't apply. OpenAI embeddings already grandfathered under ADR-011. |
| **003 — pgvector only** | No Pinecone/Weaviate. | **Respected.** HNSW is a pgvector index type; no external vector store. |
| **004 — No KG in v1** | Flat link tables; revisit at 500+ memories/user. | **Boundary, but honest.** Synthesis explicitly keeps graph traversal at 1-2 hops via PL/pgSQL on existing link tables and defers HippoRAG / deeper graph with a named trigger (>15% multi-hop). That's exactly what ADR-004 says to do. The bi-temporal-lite additions extend link tables but do not introduce graph machinery, so ADR-004 still holds. |
| **008 — Native tool_use, no MCP** | Anthropic SDK tool blocks. | **Respected.** ADD/UPDATE/DELETE call uses "constrained tool schema" on Haiku — standard tool_use, not MCP. No new tool transport introduced. |
| **009 — node-cron, no Redis/BullMQ** | In-process scheduler. | **Boundary.** The async ADD/UPDATE/DELETE path piggybacks on the existing `embedding-queue` (in-process, non-durable per audit E.6) plus the nightly cortex cron for relationship batch. That is node-cron-native. **However**, note that audit §E.6 flags the embedding queue as "not durable — process crash loses queued items." Adding another class of write (the consolidation decision) to the same non-durable queue doubles the crash-loss blast radius. This is a real gray area — the synthesis ships to an unsolved durability weakness. Should be called out in risks. |
| **011 — OpenAI text-embedding-3-small** | Don't swap embedder. | **Respected.** Synthesis explicitly defers Voyage behind a trigger ("already-planned embedding rebuild for another reason"). |

Overall: no outright ADR violations. The ADR-009 durability caveat is a risk the synthesis inherits, not one it creates.

---

## 3. Service boundary check (CLAUDE.md §Service Boundaries)

- **BoardRoom → DB direct access:** None proposed. All new surfaces (reranker, ADD/UPDATE/DELETE loop, graph traversal, outcome scoring, memory-health routes) live in omnimind-api. BoardRoom consumes via existing HTTP client. **PASS.**
- **Business logic in `packages/shared/`:** None proposed. Synthesis adds Zod schemas for new models (ExtractedEntity, EntityRelationship, etc.) and enums (`memoryType` if adopted), which are type-only. **PASS.**
- **OmniMind owns all persistent data:** Every new column (`validFrom`, `validTo`, `supersededBy` on link tables, `access_count`, `last_retrieved_at` on MemoryEntry, `outcome_quality`) lands in the omnimind Prisma schema. **PASS.**

One subtle concern: the plan's Phase 7 says "`access_count` and `last_retrieved_at` update async post-retrieval." The retrieval path runs inside omnimind-api, so the write stays inside omnimind. Good. But if a tempting refactor later tries to log retrieval events from BoardRoom (e.g., "user viewed this memory in the UI"), that would need to go *back* through the omnimind HTTP surface, not direct DB. Worth calling out in Phase 7 so it isn't quietly violated later.

---

## 4. State-management rules

| Rule | Check |
|---|---|
| **Single source of truth** | `DecisionOutcome` and `MemoryEntry.lastAccessedAt` already live in omnimind. Phase 7 adds signals there. **PASS.** |
| **Session state in BoardRoom** | No new cross-session state proposed. **PASS.** |
| **Entity consistency via Prisma** | New models are Prisma-native. `supersededBy` follows the same pattern as existing `MemoryEntry.supersededBy`. **PASS.** |
| **Cache invalidation** | The synthesis adds `access_count` writes post-retrieval. This is a write caused by a read, and there is currently no retrieval-result cache (audit B.72). Fine for today, but if anyone later adds the `search-cache.service.ts` (dropped in current plan), this becomes a stale-cache vector. Flag in Phase 7. |

---

## 5. Synthesis accuracy audit (now that aggressive/conservative exist)

The synthesis acknowledges it wrote without the debate positions and reconstructed them. Comparing reconstructions vs. actual positions:

**Adjudication count — synthesis claims 7 aggressive, 4 conservative, 1 neutral.** By my count across §2:

1. HNSW → aggressive wins ✓
2. Cross-encoder reranker → aggressive wins ✓
3. RRF vs. weighted → aggressive wins ✓
4. Bi-temporal link cols → aggressive wins (trimmed) ✓
5. ADD/UPDATE/DELETE → aggressive wins ✓
6. Graph traversal beyond ranker boost → conservative wins ✓
7. LLM relationship inference batch → aggressive wins ✓
8. MemGPT-style tiers → conservative wins ✓
9. HyDE → conservative wins ✓
10. Outcome feedback loop → aggressive wins ✓
11. Retrieval eval harness → conservative wins ✓
12. LangGraph vocab → neutral ✓

Total: **7 aggressive, 4 conservative, 1 neutral** — self-reported count is right.

**Fair representation?** Mostly yes. Points that check out against the actual positions:

- Conservative's "build retrieval eval first" framing (§3 of their position) is faithfully elevated to Phase 0.5.
- Conservative's "skip HyDE broadly, opt-in for specific query classes" is accurately captured.
- Aggressive's HNSW "do regardless" is correctly stated.
- Aggressive's "the meaningful mem0 innovation is ADD/UPDATE/DELETE" is correctly identified as the engine, not the body.

**Where the synthesis mis-reads the aggressive position:**

- Aggressive §2f argues for a **`memoryType: 'semantic' | 'episodic' | 'procedural'` enum column on `MemoryEntry`** — an actual schema change. Synthesis treats LangGraph vocabulary as "internal vocabulary, docs-only" (§2, LangGraph line, and the confidence register "adopt as docs only"). That is a **real difference** that the synthesis glides over: the aggressive ask is a migration + Zod schema change, not a doc update. The synthesis should either (a) accept the enum and schedule it in Phase 2 schema work, or (b) explicitly refuse with reasoning (e.g., "not worth a migration without downstream retrieval logic"). Silently downgrading it to docs-only is the kind of edit that loses the actual disagreement.

- Aggressive §2e proposes ADD/UPDATE/DELETE as "sync from the async worker" (i.e., same queue as embedding, fire after embedding lands but fired inline from the worker). Synthesis phrases it as "async post-extraction step." These are compatible wordings, but the risk profile is different: running the consolidation call on the same worker means a slow Haiku response blocks subsequent embedding jobs. The synthesis doesn't name this; aggressive §4 ("Write-path decision loop adds an LLM dependency to every memory write") does. **Phase 5 should reference aggressive's fallback-to-NOOP-after-3-retries pattern explicitly.**

**Where the synthesis mis-reads the conservative position:**

- Conservative §2d on HNSW is "park until retrieval eval shows recall drift *or* a user exceeds 50k memories" — a prove-it-first stance, not a reject-forever stance. Synthesis says "conservative counter is weaker than it looks." Fine, but the conservative position's actual threshold ("50k memories per user, or sentinel recall <0.90") is a gate the synthesis could *adopt* as a post-HNSW health check to placate both sides. It doesn't. Minor miss.

- Conservative §6.1 makes a structural argument I think the synthesis underweights: **"1M-context Claude changed the game — retrieval is now an optimization problem, not a correctness one."** The synthesis accepts the reranker, HNSW, and RRF without engaging this claim. If true, the marginal value of all retrieval work is lower than pre-1M-context papers claim. The synthesis should answer it — even briefly — because if conservative is right on this point, Phase 3's reranker elevation is oversold.

**Adjudication correctness:** I can't find an adjudication that flips based on the actual debate texts. The synthesis's reasoning on each item stands up. But two items (memoryType enum, 1M-context argument) deserve explicit answers, not silent dismissal.

---

## 6. Architectural anti-patterns check (CLAUDE.md §Anti-Patterns)

1. **Direct DB access from BoardRoom** — none proposed. **PASS.**
2. **Bypassing Zod validation** — The synthesis says the ADD/UPDATE/DELETE loop is "post-validation enrichment, not validation itself." Good framing. But it needs to be explicit: the *output* of the Haiku ADD/UPDATE/DELETE call must itself be Zod-validated before applying mutations. The synthesis does not name the Zod schema for the `{action, targetId?, reason}` tool response. **REQUIRED CHANGE: Phase 5 must specify `MemoryConsolidationActionSchema` in `packages/shared/src/validation/` as the contract between the LLM tool call and the DB mutation.** Without it, we're shipping an LLM → DB write path with no parser at the seam.
3. **Hardcoded persona logic in TS** — The synthesis mentions LLM calls for ADD/UPDATE/DELETE and relationship inference, but does not name a `docs/prompts/mem0-consolidation.system.md` or `docs/prompts/relationship-extractor.system.md` file. Per CLAUDE.md rule 5, these prompts **must** live in markdown and be loaded at runtime. **REQUIRED CHANGE: Phase 5 must produce two new prompt files under `docs/prompts/`.**
4. **Ignoring Goal→Project→Task DAG** — Entity extraction in Phase 4 (persons/orgs/URLs/dates/@mentions) does not touch Goal/Project/Task. Relationship inference in Phase 5 could pollute this — e.g., inferring "TaskA depends_on TaskB" duplicates the existing `TaskDependency` table. **REQUIRED CHANGE: Phase 5 relationship predicates list must explicitly exclude or reconcile with the existing typed link tables (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`). Otherwise Extraction writes `EntityRelationship(subjectId=TaskA, predicate='depends_on', objectId=TaskB)` while the Goal→Project→Task DAG is source of truth in TaskDependency, and we end up with two sources of truth.**
5. **Siloed persona analysis** — The synthesis preserves the context-packager + persona-aware tag boosts. Phase 3 (reranker) happens *before* the context-packager, so per-persona packing is preserved. **PASS**, but the confidence register should note that reranker operates on top-50 generic results, and persona-specific tag boosts happen on the reranked top-10 in the packager — this ordering is load-bearing and should be diagrammed before implementation.

---

## 7. The `search_vector` trigger claim — **INCORRECT DIAGNOSIS**

Synthesis §3 says: *"`search_vector` tsvector column maintenance... this is a 3-line trigger and a silent quality drag."*

Reality from the schema and code:

- `schema.prisma:202`: `searchVector Unsupported("tsvector")? @map("search_vector")` — the column exists, marked Prisma-opaque, with a comment that calls it a "Generated column for full-text search."
- `prisma/migrations/20250410_add_search_indexes/migration.sql` — creates GIN indexes on `to_tsvector('english', content)` and `to_tsvector('english', title)` as **functional** indexes. Does NOT create the `search_vector` column, does NOT install a trigger, does NOT declare it `GENERATED ALWAYS AS`.
- `src/retrieval/fulltext-search.ts:27-33` — actual FTS query computes `to_tsvector('english', title || ' ' || content)` **inline at query time**, reading `title` and `content` columns, not `search_vector`.

**Diagnosis:** the `search_vector` column is **dead code**. It exists in the Prisma schema but is never written, never read, and the existing FTS works fine without it via functional indexes. Adding a trigger "fixes" a column nobody uses.

**Required synthesis change:** Phase 0 should either (a) **delete the `searchVector` field from `MemoryEntry` and the `search_vector` column from the DB** as dead-code cleanup (one-line schema change + one-line SQL `ALTER TABLE ... DROP COLUMN`), or (b) if we want a materialized tsvector for perf (to move from per-query compute to stored index), then it's actually a `GENERATED ALWAYS AS (to_tsvector('english', title||' '||content)) STORED` column plus an index on it plus a rewrite of `fulltext-search.ts` to `WHERE search_vector @@ to_tsquery(...)`. That is NOT a 3-line trigger. That is a schema change + rewriter + index migration + benchmark — not Phase 0 hygiene.

The "silent quality drag" framing is also wrong: FTS is **correct today**, it just recomputes the tsvector per query. The cost is latency-in-query, not correctness.

The synthesis confidence register rates this "HIGHEST confidence, nothing would flip it." That is the weakest part of the synthesis — it's a misdiagnosis stated with false confidence. Drop or rewrite.

---

## 8. The "DecisionOutcome already exists but unused for memory scoring" claim — **CORRECT, BUT NEEDS PRECISION**

Grep results from `packages/omnimind-api/src/`:

- `decision.outcome` / `outcomeRating` referenced in:
  - `services/outcome-review.service.ts` (CRUD — writes the value).
  - `routes/outcome-review.routes.ts` (accepts user input).
  - `services/cortex-patterns.service.ts:28` — **rendered into an LLM prompt** for pattern detection.
  - `services/simulation.service.ts:43` — **rendered into an LLM prompt** for simulation.
- **Not** referenced in any file under `src/retrieval/` (ranker, structured-filter, semantic-search, fulltext-search, trigram-search, context-packager, semantic-search).

So `outcome` IS used — but only as **LLM prompt context for the cortex layer**, never as a retrieval scoring signal. The synthesis's framing ("exists but unused for *memory scoring*") is precisely accurate, and the "unfair advantage" claim holds: no off-the-shelf memory system has `Decision.outcome` / `outcomeRating` as a typed field to feed into a retrieval ranker.

Note for precision: synthesis §5 register says "Data showing `DecisionOutcome` sparsity >80% null — would pull back to access-count-only for 6 months." The audit didn't measure current `outcome`/`outcomeRating` sparsity. Phase 0.5 eval-harness work should include a sparsity probe — if ~90% of decisions have no outcome recorded (plausible for a pre-PMF product), the outcome signal will be starved, and the ranker term needs a sparsity-aware weighting. **Required change: Phase 7 exit criteria must include a sparsity measurement, not just "eval shows meaningful lift."**

---

## 9. Concrete architectural changes required before approval

1. **Phase 0: drop the `search_vector` line item** (it's a misdiagnosis — §7 above). Replace with either "delete `searchVector` column as dead code" or a properly scoped Phase 1 item for a `GENERATED ALWAYS AS STORED` tsvector migration. Do NOT frame it as a 3-line trigger.

2. **Phase 2 (schema alignment): add `memoryType` enum to `MemoryEntry`.** Aggressive §2f's proposal is a schema change, not vocabulary. Accept it or explicitly reject it with reasoning — don't silently downgrade. Recommended: accept, because the ranker in Phase 7 will want per-type decay curves and per-type retrieval budgets.

3. **Phase 5: specify prompt assets and Zod schemas.** Add two prompt files — `docs/prompts/mem0-consolidation.system.md` (the ADD/UPDATE/DELETE/NOOP decision) and `docs/prompts/relationship-extractor.system.md` (nightly batch). Add a Zod schema `MemoryConsolidationActionSchema` in `packages/shared/src/validation/` to validate the Haiku tool-call response before mutation. CLAUDE.md rules 5 and 10 both require this.

4. **Phase 5: reconcile `EntityRelationship.predicate` with existing typed link tables.** The DAG (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`) is the source of truth for structured relationships. Relationship inference must either (a) skip these predicates and only infer free-form semantic relationships not representable in the typed tables, or (b) synchronize writes back into the typed tables. Currently the synthesis is silent — which means Phase 5 will ship two sources of truth.

5. **Phase 7: sparsity probe.** Add an exit criterion: measure `DecisionOutcome` null-rate before wiring outcome-quality into the ranker. If >80% sparse, ship access-count-only first and gate the outcome term behind a second flag.

6. **Phase 2 (bi-temporal-lite): risk-budget the query-path impact.** Every existing query against `MemoryEntityLink` and the typed join tables currently has no `valid_to` filter. Adding `valid_to IS NULL OR valid_to > now()` to every query site is mechanical but has ~15 call sites per aggressive's count (§4). The synthesis doesn't budget for this — Phase 2 says "1 week." Recommended: split Phase 2 into 2a (add nullable columns, no query changes) and 2b (update query sites behind a flag `BITEMPORAL_LINK_FILTER_ENABLED`). Otherwise, defaults will break — writing `valid_to` but not filtering means stale links keep getting returned until the flag flips, and flipping the flag silently regresses any call site that forgot the filter.

7. **Phase 3 (reranker): define the Railway resource budget.** `bge-reranker-v2-m3` INT8 quantized claims ~500MB resident per aggressive §4. Audit §F shows single-instance Railway with no horizontal scaling. Before Phase 3, confirm the current Railway container has >500MB free RAM headroom; otherwise the reranker will OOM under load. Required: Phase 3 exit criteria should include a 24-hour soak test at expected QPS with rerank on.

8. **Risk register: embedding-queue durability.** The synthesis adds the ADD/UPDATE/DELETE call to the same non-durable in-process queue as embeddings (audit §E.6). This doubles the crash-loss blast radius. Add a mitigation: the consolidation decision is **idempotent** — if it's re-run on the same memory, the LLM will either NOOP or re-apply the same mutation. So a recovery pass (nightly cron "rerun consolidation on any memory where `consolidationAt` is null") closes the loop without requiring a durable queue. Must be named, not assumed.

---

## 10. Risks the synthesis does not name

1. **Reranker as CPU-bound inference in Node + Railway single-container.** Node is single-threaded for JS, and ONNX Runtime runs inference on worker threads — but a rerank storm during peak retrieval still contends for the same vCPUs that serve HTTP. No horizontal scaling per CLAUDE.md. This is a latency-tail risk, not a p50 risk: p99 rerank under load could be 10x p50. Phase 3 exit criteria should measure p99, not just p95.

2. **ranker.test.ts rewrite.** Current ranker test (`tests/unit/retrieval/ranker.test.ts`) asserts a 4-layer fusion shape. Phase 7's new `usage_signal` (outcome × access_count) is the 5th additive term; Phase 6's entity-match is another. The test file will need restructure, not extension. The synthesis says "no regression" but that test will fail by construction and need rewrites — budget a day per phase for test reshape.

3. **MemoryEntityLink bi-temporal explosion of rows.** If Phase 5 ADD/UPDATE/DELETE correctly supersedes links, a link updated 10 times creates 10 rows with `valid_from` / `valid_to` chains. Retrieval queries must filter `valid_to IS NULL` — but queries that aggregate (counts, top-N entities per user) can double-count if they forget. Eval harness queries must include an "aggregation correctness under supersession" test.

4. **pgvector HNSW build time on production.** Synthesis says "minutes, not hours at current scale." Audit didn't log row counts. If a single power-user has 50k+ memories (not impossible mid-Phase), the build blocks the `memory_entries` table until done. Phase 1 must check `CREATE INDEX CONCURRENTLY` support in the Railway Postgres pgvector version, and abort the migration if unavailable.

5. **Cortex-contradiction signal already exists — does the ADD/UPDATE/DELETE loop duplicate it?** The current `cortex-contradictions` weekly job detects contradictions across a user's corpus. The synthesis's Phase 5 ADD/UPDATE/DELETE loop also detects contradictions (synchronous at write time). These can disagree: the cron job finds contradictions the write-path loop missed; the write-path loop supersedes memories the cron job was about to flag. Required: define precedence — is the write-path loop canonical, and does the cron job now *validate* its work instead of re-doing it? Currently the plan runs both with no integration story.

6. **Relationship inference poisoning the ranker.** Phase 5 writes `EntityRelationship` rows (some at confidence <0.5 marked `PENDING_REVIEW`). Phase 6's entity-match ranker boost operates on memories linked to entities. If the boost reads from `EntityRelationship` at any confidence level — including PENDING_REVIEW — noisy relationships silently poison retrieval. Required: Phase 6 boost must explicitly filter `confidence ≥ ACTIVE_THRESHOLD`, and the threshold must be flag-configurable.

7. **Conservative's 1M-context argument is not addressed.** If the product is Sonnet 4.6 + 1M-context, then rerank lift may transfer poorly from BEIR benchmarks to "does the decision-intelligence answer get better." Eval harness (Phase 0.5) should include a "rerank-on vs. rerank-off" end-to-end test that measures downstream *persona answer quality*, not just nDCG@10. nDCG is a proxy; answer quality is the product metric.

---

**Bottom line:** the synthesis's sequencing and ADR discipline are strong; it correctly identifies the outcome-feedback loop as omnimind's moat, and it correctly keeps graph machinery modest. But it overstates its confidence on the `search_vector` trigger (that's a misdiagnosis), quietly downgrades the aggressive `memoryType` enum, and under-specifies the Zod + prompt-asset + typed-link-table reconciliation that CLAUDE.md explicitly requires at integration seams. Fix those, and Phase 0.5 through Phase 7 are an approvable plan.

*Word count: ~1,990.*
