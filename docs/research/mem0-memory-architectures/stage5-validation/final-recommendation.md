# Stage 5 — Final Recommendation: Memory Stack Evolution

**Author:** Final Validation agent
**Date:** 2026-04-18
**Status:** OPERATOR-READY. Execute from this document.
**Supersedes:** `docs/MEM0_RE_INTEGRATION_PLAN.md`, `stage3-debate/position-synthesis.md`

This document is the go-forward plan after research, debate, two reviewers, and one verified-correctness pass on the actual Prisma schema. Everything below has been reconciled against ADRs 001–011, CLAUDE.md service boundaries, and the live `schema.prisma` as of 2026-04-18.

---

## 1. Executive decision

Ship a **scoped 8-phase upgrade** to omnimind's memory stack over **16–22 calendar weeks** (solo founder, ~60% sustained focus on this effort, balance on product + support). The shippable backbone is: foundation cleanup, a small-but-honest retrieval eval harness, schema alignment with bi-temporal-lite link columns, pattern-only entity extraction with the mem0-style ADD/UPDATE/DELETE/NOOP write-decision loop running async, an HNSW index migration with an RRF fusion experiment, a thin graph traversal over existing typed link tables, an LLM augmentation pass for entities and relationships running as a nightly batch with hard cost caps, an entity-aware ranker boost, and an immediate access-count + recency refinement to the ranker. The cross-encoder reranker and the outcome-weighted ranker term are **explicitly deferred** with named, measurable triggers — both require infrastructure (Railway RAM upgrade; populated `Decision.outcome` data) that does not exist today. Top-3 risks accepted: (1) the in-process embedding queue remains non-durable through Phase 5 unless we add a `MemoryWriteEvent` persistence layer first; (2) LLM fallback extraction at >20% trigger rate breaks the per-100-memory cost target; (3) bi-temporal link columns add a query-site filter requirement that will silently degrade retrieval if any call site forgets the predicate.

---

## 2. What we're building, ordered

| # | Phase | Weeks | Exit criteria | Confidence | Trigger to defer / accelerate |
|---|---|---|---|---|---|
| 0 | Foundation cleanup | 0.5 | Scratchpads archived; `searchVector` column dropped from schema + DB (dead code); editor files gitignored; typecheck + 708 tests green; log-drain (Better Stack or Axiom free tier) wired with `x-request-id` propagation | HIGH | None — unblocks everything |
| 0.5 | Retrieval eval harness (35 queries) | 2 | `eval/runners/retrieval-eval.ts` produces MRR / nDCG@10 / P@5 against 35 hand-labeled queries (20 single-hop, 10 multi-entity, 5 temporal); baseline snapshot committed; non-regression check in `pre-deploy-check.sh`; secondary lightweight persona-eval gate added | HIGH | Defer to 50+ queries only if a downstream phase needs to detect deltas <5% |
| 1 | Schema alignment + bi-temporal-lite | 1.5 | New Prisma models: `ExtractedEntity`, `EntityRelationship`, `EntityExtractionEvent`, `RelationshipEvidence`. New nullable columns on six link tables: `validFrom`, `validTo`, `supersededBy`. New `MemoryEntry.memoryType` enum (`SEMANTIC` / `EPISODIC` / `PROCEDURAL`). New Zod schemas in `packages/shared/src/validation/`. All 708 existing tests still green. Bi-temporal filter applied via helper, not raw SQL | HIGH | None — additive migration |
| 2 | Pattern-only entity extraction + ADD/UPDATE/DELETE/NOOP write-decision loop (no LLM) | 2.5 | Regex/heuristic extractor for person, org, URL, date, @mention; fire-and-forget from `memory.service.ts::createMemory()`; `MemoryWriteEvent` row persisted at write time so the in-process queue can be drained on boot; deterministic pattern-only ADD/UPDATE/NOOP decision (no LLM yet, just exact + canonical-name dedup); copy-on-write supersession (no in-place mutation); `MEM0_EXTRACTION_ENABLED=false` default; eval harness shows no regression with flag off | HIGH | None |
| 3 | HNSW migration + RRF fusion experiment | 1.5 | `CREATE INDEX CONCURRENTLY` for HNSW on `memory_entries.embedding`; old IVFFlat index dropped after; RRF fusion implemented behind `RANKER_MODE=rrf\|weighted` (default `weighted`); both modes run against eval harness; winner documented in `docs/eval-results/phase-3.md`; verified pgvector version supports `CONCURRENTLY` for HNSW (≥0.5.0) | HIGH | Skip RRF if eval shows weighted wins by >3%; HNSW always ships |
| 4 | Graph traversal (TS service over recursive CTE) | 1 | `relationship.service.ts` exposes `findRelatedEntities(entityId, hops=2)` via PostgreSQL recursive CTE on existing typed link tables (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`); thin TS wrapper, no PL/pgSQL; depth capped at 2; bi-temporal filter applied | MED | Defer multi-hop beyond 2 hops; eval-trigger to extend = >15% of queries are multi-hop in production logs |
| 5a | LLM entity + relationship augmentation (nightly batch, hard cost cap) | 2 | Nightly cortex job: identify memories with no extracted entities → Haiku 4.5 extraction with Zod-validated tool response; identify entity pairs co-occurring in ≥3 memories → Haiku relationship inference; results land in `EntityRelationship` with `confidence`; `confidence ≥ 0.7 → ACTIVE`, `< 0.7 → PENDING_REVIEW`. Per-user spend cap (`$2/user/month`) and global cap (`$50/day`) enforced via cost-tracker counter. Prompts live in `docs/prompts/entity-extractor.system.md` and `docs/prompts/relationship-extractor.system.md`. Reconciliation rule: relationship inference predicates exclude any predicate covered by typed link tables (no inferring `task-depends-on-task` — `TaskDependency` is canonical) | MED | Pull back to pattern-only-with-curated-LLM-set if confidence-ACTIVE precision < 0.6 on hand-labeled 100-pair sample |
| 5b | LLM consolidation upgrade for write-loop | 1 | Phase 2's deterministic ADD/UPDATE/DELETE/NOOP loop gains a Haiku confidence check on UPDATE / NOOP boundary cases (only when pattern decision is below confidence threshold); prompt in `docs/prompts/mem0-consolidation.system.md`; `MemoryConsolidationActionSchema` Zod-validates the response; fallback-to-NOOP after 3 retries; idempotent replay key `${memoryId}:${version}:${action}` so re-runs are safe; runs on the embedding-queue worker, not blocking writes | MED | Defer indefinitely if Phase 2 + cortex-contradictions surfaces fewer than 5 duplicate-memory pairs per user per month |
| 6 | Entity-aware ranker boost (5th signal in ranker) | 0.5 | Extension of `retrieval/ranker.ts`: if a retrieved memory links to an `ExtractedEntity` whose `canonicalName` matches the query (trigram similarity ≥ 0.6), add +0.15 boost; only reads `EntityRelationship.confidence ≥ 0.7`; behind `RANKER_ENTITY_BOOST_ENABLED=false` default; eval harness shows ≥3% lift on multi-entity slice OR no regression overall | HIGH | None |
| 7a | Recency / access-count ranker refinement (no schema change) | 0.5 | `MemoryEntry.lastAccessedAt` updated async post-retrieval (already exists in schema); ranker term `usage_signal = log(access_count + 1)`; replace binary 7-day recency boost with exponential decay `exp(-Δdays / 30)`; behind `RANKER_USAGE_SIGNAL_ENABLED=false` default; eval harness validates | HIGH | None — ship in same sprint as Phase 6 |
| 7b | Outcome-weighted ranker term | DEFERRED | Resume when **≥ 200 decisions across the user base have non-null `Decision.outcome` AND `outcomeRating`**, AND a `MemoryCitation` (or equivalent) link table exists to trace which retrieved memories were used in which decision. Without that trace, outcome data has no path to memory scoring. | LOW (deferred) | Trigger above. Estimated 4–6 weeks of work when triggered: design `MemoryCitation` schema, retrofit `context-assembler.service.ts` to persist citations, build the cortex job, wire into ranker |
| 8 | Reranker (cross-encoder) | DEFERRED | Resume when **eval harness shows top-5 MRR < 0.6 on the labeled set, AND Railway plan is upgraded to ≥4GB RAM AND a 24-hour soak test confirms no OOM and no p99 spike >500ms with rerank on**. Deferral acknowledges the conservative's 1M-context argument: with Sonnet 4.6's 1M context, retrieval lift may not translate to persona-answer lift. | LOW (deferred) | Trigger above. Estimated 3 weeks of work when triggered |
| 9 | Purge `_disabled/`, write ADRs | 0.5 | Delete `src/services/_disabled/` and `src/routes/_disabled/`; write ADR-014 ("Mem0 integration strategy: pattern-first, LLM-augmented, no framework dep"), ADR-015 ("Retrieval eval harness as non-regression gate"), and ADR-016 ("Bi-temporal link tables and supersession semantics") | HIGH | None |

**Total p50 calendar time: ~16 weeks. p90: ~22 weeks.** Excludes Phase 7b (gated, 4–6w when triggered) and Phase 8 (gated, 3w when triggered).

---

## 3. What we're explicitly skipping (with measurable adoption triggers)

| Capability | Reason for skip | Trigger that flips it to "adopt" |
|---|---|---|
| Pronoun resolution | Graph-memory research §9: "nobody is nailing this." `_disabled/query-understanding.service.ts` is 30% complete and solves at the wrong layer. | A specific persona's eval shows >10% answer-quality regression traceable to pronoun ambiguity. Better solved at extraction time with larger context windows. |
| MemGPT-style tiers | Wrong product, wrong scale. Hierarchical-temporal §1: tier-paging hasn't beaten well-tuned RAG+summary. | Never, for this product. |
| HyDE / query expansion (default) | Hybrid-retrieval §7: vocabulary overlap is high in personal-memory; expected value negative for default-on. | Eval harness identifies a specific query class (e.g., onboarding-period) where HyDE lifts MRR by ≥10%. Then ship gated to that class only. |
| Bi-temporal transaction-time axis | Audit + research consensus: `validAt`/`invalidAt`/`supersededBy` capture 80% at 20% cost. Transaction-time is for financial-audit systems. | A user files a real "what did the system *believe* about X on date Y" support ticket, ≥3 times. |
| Feature-flag DB tables | Env vars + Railway redeploys are simpler. CLAUDE.md compliant. | Never until horizontal scaling (CLAUDE.md known-limitation #7). |
| Performance monitoring tables | OTel/Datadog territory. CLAUDE.md known-limitation #6. | Separate observability project; not memory work. |
| Audit tables (memory access log) | No regulatory driver; soft-delete + `version` history covers most needs. | A SOC-2 customer requirement, or a real bug requires forensic reconstruction. |
| Redis (any purpose) | CLAUDE.md known-limitation #2 + ADR-009. | >1 Railway instance (horizontal scaling) OR cron jobs >30s OR >500 active users. |
| Separate vector DB (Pinecone/Weaviate/Qdrant) | ADR-003. pgvector is sufficient at <10M vectors. | >10M vectors total OR pgvector p99 query latency >500ms sustained. |
| Hosted memory service (Zep / Letta / mem0 cloud) | ADR-001 (no frameworks) + cost. We can replicate the patterns in ~200 lines of TypeScript. | Never, in v1. Revisit at Series A. |
| Knowledge graph backend (Neo4j / Apache AGE) | ADR-004; recursive CTE on existing tables sufficient. | Pattern-match queries ("show all people connected via shared goals to stalled projects") become a product feature; AND query latency on recursive CTE exceeds 500ms. |
| LangGraph checkpointer / Store | ADR-001. Custom runtime owns persistence semantics. | Never. We borrow LangGraph's *vocabulary* (semantic/episodic/procedural) only. |

---

## 4. Architectural corrections applied

These are the corrections from Stage 4 reviewers, plus the parent-agent's verified `DecisionOutcome` correction. Each is now reflected in §2.

### 4.1 `search_vector` column — DELETE, do not add a trigger

**Synthesis claim:** "It's a 3-line trigger." **Verified reality:** `MemoryEntry.searchVector` is dead code. The column exists in `schema.prisma` line 202, but the actual FTS code in `src/retrieval/fulltext-search.ts` computes `to_tsvector('english', title || ' ' || content)` inline at query time and never reads the column. Migration `20250410_add_search_indexes` builds **functional** indexes against the inline expression, not against `search_vector`. There is no trigger gap to fix.

**Decision:** Delete the column in Phase 0 as dead-code cleanup. One-line schema change + `ALTER TABLE memory_entries DROP COLUMN search_vector`. **Open question for the user:** if you want a materialized tsvector for query-time perf (move from per-query compute to stored index), that is a *different* change — `GENERATED ALWAYS AS (to_tsvector('english', title||' '||content)) STORED` plus a GIN index plus a rewrite of `fulltext-search.ts`. That is a multi-day project, not Phase 0 hygiene. Default recommendation: delete the column; revisit GENERATED column only if FTS query latency becomes a problem (it isn't today).

### 4.2 Non-durable embedding queue + new ADD/UPDATE/DELETE work — ADR-009 gray area

**Risk:** Phase 2 and Phase 5b add new work classes to the same in-process queue that already loses jobs on Railway restart (audit §E.6). Doubling the blast radius is real.

**Mitigation (idempotent replay key + persisted intent):**
1. At write time, persist a `MemoryWriteEvent` row with `consolidationStatus: PENDING` and a deterministic key `${memoryId}:${version}:${action}`. This is a tiny new Postgres table — not a queue, just an intent log.
2. The in-process queue worker reads from `MemoryWriteEvent` on boot (drains PENDING) and on each cycle.
3. Replay is safe because the key encodes the exact mutation; re-running ADD/UPDATE on the same `memoryId:version` either NOOPs or applies idempotently.
4. A nightly cortex sweep (`Mon 03:00`, slot it next to the existing pattern detection job) re-queues any PENDING rows older than 24 hours.

This is the minimum needed to stay inside ADR-009 (no Redis, no BullMQ) while not silently losing work. **Phase 2 cannot ship without this.**

### 4.3 `memoryType` enum — ACCEPT, not silently downgrade

The aggressive position asked for a real schema enum on `MemoryEntry`; the synthesis silently downgraded it to "internal vocabulary." That was wrong — Phase 7 wants per-type ranking signals, and the enum is the cheap precondition.

**Decision:** Add `memoryType` enum to `MemoryEntry` in Phase 1. Values: `SEMANTIC`, `EPISODIC`, `PROCEDURAL`. Default `SEMANTIC`. Backfill: existing rows default to `SEMANTIC`; a heuristic backfill job tags rows with `sourceType: BOARDROOM_SESSION` as `EPISODIC` and rows linked from `UserProfile`/`ContextCapsule` as `PROCEDURAL`. This piggybacks on the schema migration in Phase 1 — zero added phase cost.

**Note:** the existing `MemoryClass` enum (`WORKING / EPISODIC / SEMANTIC / DECISION`) is a different axis and stays. `memoryType` answers "what kind of fact is this?" and `MemoryClass` answers "what's its lifecycle?" Both are useful.

### 4.4 Prompts must live in markdown — list of files to create

Per CLAUDE.md rule 5, every LLM call needs its prompt in `docs/prompts/*.system.md` loaded at runtime via `prompt-loader.ts`. New prompt files to create:

- `docs/prompts/entity-extractor.system.md` (Phase 5a, nightly batch entity extraction with Zod-constrained tool response)
- `docs/prompts/relationship-extractor.system.md` (Phase 5a, nightly batch relationship inference)
- `docs/prompts/mem0-consolidation.system.md` (Phase 5b, ADD/UPDATE/DELETE/NOOP boundary-case decisions)

No prompt logic in TypeScript. Period.

### 4.5 Zod schemas required — list of files to create

In `packages/shared/src/validation/`:

- `extracted-entity.ts` — `ExtractedEntitySchema`, `EntityType` enum (PERSON / ORG / URL / DATE / MENTION / TOPIC), creation/update DTOs
- `entity-relationship.ts` — `EntityRelationshipSchema`, `RelationshipPredicate` enum, `RelationshipConfidence` enum (ACTIVE / PENDING_REVIEW / REJECTED)
- `memory-consolidation.ts` — `MemoryConsolidationActionSchema` `{ action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP', targetMemoryId?: string, reason: string, confidence: number }`
- `memory-write-event.ts` — `MemoryWriteEventSchema` (the persistence layer for the queue)

Companion TypeScript interfaces in `packages/shared/src/types/`. Per CLAUDE.md rule 10: schema and interface MUST stay structurally synced.

### 4.6 EntityRelationship vs typed link tables — predicate exclusion list

The DAG (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`) is the source of truth for **structured** relationships. `EntityRelationship` covers **soft / inferred / free-form** relationships only.

**Excluded predicates (must never be written to `EntityRelationship`):**
- `task-depends-on-task` — `TaskDependency` is canonical
- `goal-has-project` / `project-belongs-to-goal` — `GoalProjectLink`
- `project-has-task` / `task-belongs-to-project` — `ProjectTaskLink`
- `project-involves-person` / `person-works-on-project` — `ProjectPersonLink`
- `decision-affects-project` / `project-affected-by-decision` — `DecisionProjectLink`
- `commitment-blocks-X` — `CommitmentLink`

**Allowed predicates (free-form, typically inferred from co-occurrence):**
- `mentions`, `references`, `discusses`, `concerns`, `succeeds`, `precedes`, `relates-to`, `contradicts`, `supports`, `clarifies`

A runtime guard in `relationship.service.ts` rejects writes with excluded predicates and logs a warning. Phase 1 schema includes this enum.

---

## 5. Operational prerequisites

**Before Phase 0 ships:** confirm log-drain target chosen (Better Stack or Axiom — both have free tiers). 1 hour.

**Before Phase 1 ships:** verify Railway Postgres + pgvector version is recorded in `docs/DEPLOYMENT-RUNBOOK.md`. Need to know `pgvector >= 0.5.0` for HNSW + `CREATE INDEX CONCURRENTLY` (Phase 3 prereq).

**Before Phase 2 ships:** `MemoryWriteEvent` persistence layer is live (per §4.2). Without it, the new ADD/UPDATE/DELETE work is lost on every Railway restart and we have no recovery path.

**Before Phase 3 ships (HNSW):** tested DB backup + restore path documented in `docs/DEPLOYMENT-RUNBOOK.md`. The HNSW migration is reversible (drop + recreate IVFFlat) but a verified restore is non-negotiable for any production index DDL.

**Before Phase 5a ships (LLM batch):** structured logging with `x-request-id` correlation is live across both services (already partially done per CLAUDE.md changelog 2026-04-15 — verify before depending on it). Cost-tracker counter (`packages/omnimind-api/src/lib/cost-tracker.ts`) implemented to enforce per-user and global spend caps. Admin-header override (`x-admin-override: <signed-token>`) for emergency disable without Railway restart.

**Before Phase 7b is unlocked (outcome loop):** measure `Decision.outcome` non-null rate in production. Threshold: ≥200 decisions across the user base have populated `outcome` AND `outcomeRating`. Until then, the signal is too sparse to feed the ranker.

**Before Phase 8 is unlocked (reranker):** Railway plan upgraded from current tier to ≥4GB RAM. Confirmed cost (~$5–20/month bump). 24-hour soak test plan documented.

---

## 6. Cost envelope (real numbers)

### LLM pipeline costs (Anthropic Haiku 4.5 + OpenAI embeddings)

Assumptions: Haiku 4.5 at ~$1/M input + $5/M output; `text-embedding-3-small` at $0.02/M tokens. A "real" user produces ~50 memory writes/month and ~500 retrievals/month.

| Pipeline component | $/user/month @ 50 writes/mo | @ today's scale (~10 users) | @ 1000 users |
|---|---|---|---|
| Embedding generation (existing) | $0.001 | $0.01 | $1 |
| Phase 5a entity extraction (LLM, ~20% trigger rate) | $0.42 | $4 | $420 |
| Phase 5a relationship inference (~200 pairs/user/mo) | $0.42 | $4 | $420 |
| Phase 5b consolidation LLM (boundary-case only, ~5% trigger rate) | $0.08 | $1 | $80 |
| Phase 7b outcome-cortex job (deferred — when active) | $0.10 | $1 | $100 |
| **Subtotal LLM pipeline (Phase 5 active)** | **~$0.93** | **~$9** | **~$920** |

**Conclusion:** at today's scale (~10 users), the entire pipeline is ~$9/month — fully absorbed. At 1000 users, ~$920/month — manageable on a $20/month tier (4.6% of revenue) but a real line item. **Hard caps in §4 prevent runaway:** `$2/user/month` per-user, `$50/day` global. If those caps are hit, writes degrade to pattern-only and a Slack/email alert fires.

**Backfill blast radius (one-time, when Phase 5a goes live):** ~500 memories/user × 10 users = 5,000 memories × $0.0014 = **~$7 one-off**. At 1000-user scale: $700. Per-user *and* global caps required; backfill must be chunked + resumable with a Postgres cursor.

### Railway RAM/CPU implications

| Phase | RAM impact | CPU impact | Plan upgrade needed? |
|---|---|---|---|
| 0–2 | None | Negligible | No |
| 3 (HNSW) | +~50MB index resident | Index rebuild burns CPU briefly | No |
| 4 (graph traversal) | None | Recursive CTE per-query, capped at 2 hops | No |
| 5a (nightly batch) | +~100MB during cron run | High CPU during nightly window (Mon 04:00 already scheduled) | No |
| 5b (consolidation) | None (queue worker amortized) | +1 Haiku call per 5% of writes | No |
| 6 + 7a | None | Negligible | No |
| **8 (reranker, deferred)** | **+~1GB resident (ONNX model + runtime)** | **+~120ms CPU per query** | **Yes — current 1GB → 4GB** |

**Conclusion:** the core 8-phase plan does not require a Railway upgrade. The reranker is the only item that does, which is part of why it's deferred.

### Engineer-weeks (calendar)

Per the pragmatic reviewer's analysis (which I accept over the synthesis's optimistic 12w):

- Phase 0–2: ~6.5 weeks (cleanup + eval + schema + extraction + write-loop)
- Phase 3–4: ~2.5 weeks (HNSW + RRF + graph)
- Phase 5a + 5b: ~3 weeks (split, sequential)
- Phase 6 + 7a: ~1 week (small, ship together)
- Phase 9: ~0.5 week (purge + ADRs)

**Subtotal: ~13.5 weeks of focused engineering.** With solo-founder context-switching to product/support, **calendar p50: 16 weeks; p90: 22 weeks.**

---

## 7. Rollback plan per phase

| Phase | Rollback procedure |
|---|---|
| 0 | Revert the schema + DB column drop (re-add `searchVector Unsupported("tsvector")?` and `ALTER TABLE memory_entries ADD COLUMN search_vector tsvector`). 5 min. Log-drain disable: remove env var, redeploy. |
| 0.5 | Eval harness is read-only. Disable via removing the `pre-deploy` line. No data impact. |
| 1 | Schema additions are nullable / default-valued. Rollback = drop new tables and columns (`ExtractedEntity`, `EntityRelationship`, etc.) and `memoryType` enum column. ~10 min. Existing data unaffected. |
| 2 | `MEM0_EXTRACTION_ENABLED=false` in Railway env. Restart. Existing extracted entities are orphaned in `ExtractedEntity` table but cause no harm — soft-deleted via `deletedAt`. The ADD/UPDATE/DELETE work is **copy-on-write** (per exit criteria), so superseded memories can be un-superseded by clearing `supersededBy` on the new row and reverting `MemoryEntry.status` from SUPERSEDED back to CONFIRMED. Provide a SQL script `scripts/rollback-mem0-supersession.sql` that does this for any memory updated after a given timestamp. |
| 3 | HNSW: `DROP INDEX memory_embedding_hnsw_idx; CREATE INDEX memory_embedding_idx ON memory_entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`. ~minutes at current scale. RRF: env flag `RANKER_MODE=weighted`. Restart. |
| 4 | Graph traversal is read-only. Disable the route or set timeout to 0; existing functionality unaffected (it doesn't replace anything). |
| 5a | Disable nightly cron job (comment out in `cortex-scheduler.ts`); existing `EntityRelationship` rows soft-delete via `deletedAt`. Cost cap is the safety net during operation. |
| 5b | Disable consolidation LLM via env flag `MEM0_CONSOLIDATION_LLM_ENABLED=false`; deterministic Phase 2 loop continues. |
| 6 | `RANKER_ENTITY_BOOST_ENABLED=false`. Restart. **A/B safely:** run with flag on for 25% of users via `userId.hashCode() % 4 === 0` (deterministic per-user, not per-request, avoids inconsistency within a session). Roll forward only if eval + sampled-user feedback both green. |
| 7a | `RANKER_USAGE_SIGNAL_ENABLED=false`. Restart. Old binary 7-day boost remains operational behind a separate flag if needed. |
| 9 | `_disabled/` directory deletion is in git history; restore via revert. ADRs are append-only. |

**A/B testing pattern:** all ranker changes ship behind a `userId`-bucketed flag (deterministic per-user) so we can compare cohorts without mid-session inconsistency. Document in `docs/architecture/ab-testing.md` (new file).

---

## 8. Decision confidence register

| Decision | Verdict | Confidence | The ONE piece of evidence that would flip it |
|---|---|---|---|
| Drop `search_vector` column in Phase 0 | DELETE | HIGH | User decides they want a stored generated tsvector for FTS perf — flip to a properly-scoped Phase 1 migration |
| Eval harness in Phase 0.5 (35 queries) | SHIP FIRST | HIGHEST | Nothing — structural precondition |
| `memoryType` enum in Phase 1 | SHIP | HIGH | Eval harness in Phase 0.5 shows persona ranking is type-blind today and stays that way under any plausible Phase 7 ranker term |
| Bi-temporal-lite columns on link tables | SHIP in Phase 1 | MED | Data showing <5% of link rows ever get superseded (would trim to just `supersededBy`) |
| Pattern-only ADD/UPDATE/DELETE in Phase 2 (no LLM) | SHIP | HIGH | Pattern-only dedup precision <70% on hand-labeled 100-pair sample — would gate Phase 5b LLM upgrade earlier |
| HNSW migration in Phase 3 | SHIP | HIGH | pgvector version <0.5.0 (no `CONCURRENTLY` for HNSW) — would defer until Railway Postgres upgraded |
| RRF fusion experiment | A/B in Phase 3 | MED-HIGH | Eval shows current weighted weights beat RRF by >3% — would keep weighted as default and ship RRF as off-by-default option |
| Graph traversal in TS (recursive CTE), not PL/pgSQL | SHIP in Phase 4 | HIGH | Recursive CTE p99 latency >300ms at 100 entities/user — would consider PL/pgSQL or materialized graph |
| LLM relationship inference (nightly batch) | SHIP in Phase 5a | MED | Confidence-ACTIVE precision <60% on hand-labeled 100-pair sample — would pull back to pattern-only with curated LLM augmentation per request |
| LLM consolidation (boundary cases only) | SHIP in Phase 5b | MED | Phase 2 deterministic loop catches >80% of duplicates without LLM — would defer 5b indefinitely |
| Entity-aware ranker boost | SHIP in Phase 6 | HIGH | Eval shows boost regresses single-hop slice by >2% — would gate behind per-persona flag |
| Recency / access-count refinement | SHIP in Phase 7a | HIGH | Eval shows current binary recency boost wins — would keep current behavior |
| Outcome-weighted ranker term | DEFER (Phase 7b) | LOW (deferred) | `Decision.outcome` populated on ≥200 decisions AND `MemoryCitation` table exists |
| Cross-encoder reranker | DEFER (Phase 8) | LOW (deferred) | Eval harness shows top-5 MRR <0.6 AND Railway upgraded to ≥4GB RAM |
| Skip pronoun resolution | REJECT | HIGH | Persona eval shows >10% answer-quality regression traceable to pronoun ambiguity |
| Skip MemGPT tiers | REJECT | HIGHEST | Nothing — wrong product |
| Skip HyDE as default | REJECT | HIGH | A specific query class shows ≥10% MRR lift in eval harness |
| Reconcile EntityRelationship vs typed link tables (exclusion list) | ENFORCE in Phase 1 | HIGH | None — required to avoid two sources of truth |
| Persist MemoryWriteEvent before Phase 2 ships | REQUIRED | HIGH | None — without it, ADR-009 gray area becomes a real durability bug |
| Prompts in `docs/prompts/*.system.md` | REQUIRED | HIGHEST | None — CLAUDE.md rule 5 |
| Zod schemas in `packages/shared/src/validation/` | REQUIRED | HIGHEST | None — CLAUDE.md rule 10 |

---

## 9. What to do THIS WEEK (5 actions, each <2 hours)

These build momentum into Phase 0 without committing to anything irreversible.

1. **Archive scratchpads, gitignore editor files, commit clean status.** Move `AUDIT_REPORT.md`, `SCRATCHPAD_AUDIT.md`, `COMMITTEE_PLANNING.md`, `CLAUDE_ARCHITECT.md`, `SEC-004_VERIFICATION.md`, `migration_state.md`, `migration_summary_report.md`, `implementation_state.json`, `migration_artifacts/` into a new `docs/archive/2026-04/` directory. Add `.brv/`, `.claude/launch.json`, `.vscode/settings.json` to `.gitignore`. Commit. **Outcome:** clean `git status`; subsequent phase work has a clear baseline. **Time: ~30 min.**

2. **Verify pgvector version and document it.** Run `SELECT extversion FROM pg_extension WHERE extname='vector';` against Railway Postgres. Record the version in `docs/DEPLOYMENT-RUNBOOK.md` under a new "Database extensions" section. If <0.5.0, file a note that Phase 3 needs a pgvector upgrade first (Railway control panel → addons). **Outcome:** Phase 3 prereq either green or a known prerequisite. **Time: ~30 min.**

3. **Sign up for Better Stack (or Axiom) free tier and wire log drain.** Create account, copy the source token, add to Railway env vars for both services as `LOGTAIL_SOURCE_TOKEN`. Add the SDK call in `packages/omnimind-api/src/lib/logger.ts` and `packages/boardroom-ai/server/src/lib/logger.ts` (already use pino — Better Stack has a pino transport). Verify a log line lands on the dashboard. **Outcome:** Phase 5a prereq complete; debugging across services becomes possible. **Time: ~90 min.**

4. **Drop the `searchVector` dead column** (Phase 0 work, ship now). Edit `prisma/schema.prisma` — remove the `searchVector Unsupported("tsvector")?` line. Add migration: `npx prisma migrate dev --name drop_search_vector_dead_column` (manual SQL: `ALTER TABLE memory_entries DROP COLUMN IF EXISTS search_vector;`). Run typecheck + tests. Deploy. **Outcome:** dead-code cleanup done; one less misconception to step over later. **Time: ~45 min.** *(Skip if you decide instead to keep the column as a future GENERATED ALWAYS AS migration — but commit to one path now.)*

5. **Hand-label 10 retrieval queries against your own session history.** Open the eval scaffolding (any text file works; we'll formalize in Phase 0.5): pick 10 questions you've actually asked the system, list the top-3 memory IDs that *should* come back for each. This is the seed of the eval harness and you are the only ground-truth source today. **Outcome:** real labels exist; Phase 0.5 starts from data, not zero. **Time: ~60 min.**

**After this week**, you have: clean repo, known pgvector version, working log drain, no dead column, and 10 labeled queries. Phase 0 is essentially done. Phase 0.5 is one focused week away.

---

## Appendix: Where I disagree with prior agents

For honesty in the operator-facing record:

1. **Synthesis was wrong about `DecisionOutcome`.** It does not exist as a table. `Decision.outcome` is a free-text string, `Decision.outcomeRating` is an Int, and `OutcomeReviewNudge` is a scheduling table. The "outcome feedback loop is omnimind's unfair advantage" claim *can* hold long-term, but only after a `MemoryCitation` table exists to trace memory→decision usage and outcome data accumulates. That's months out — Phase 7b, deferred behind a real population trigger. Phase 7a (recency + access-count) ships now and captures most of the value claimed for "outcome scoring."
2. **Synthesis was wrong about `search_vector` being a 3-line trigger fix.** That column is dead code. The architectural reviewer's diagnosis is correct; I've adopted "delete the column" as the default Phase 0 action.
3. **Synthesis under-budgeted Phase 5 by ~50%.** The pragmatic reviewer's split into 5a (LLM augmentation) and 5b (LLM consolidation) is correct. Adopted.
4. **Synthesis under-budgeted the eval harness at 1 week.** Realistic is 2 weeks for 35 queries with proper slices and per-deploy gating. Adopted.
5. **Aggressive position over-promised on the cross-encoder reranker.** The conservative's 1M-context argument is real and the synthesis didn't engage with it. Pragmatic reviewer's call to defer is right — without a populated eval harness AND the Railway RAM upgrade, shipping the reranker is shipping infrastructure complexity for an unmeasured product win. Deferred to Phase 8 with explicit triggers.
6. **Aggressive position's `memoryType` enum was right, and the synthesis was wrong to silently downgrade it.** Adopted as a Phase 1 schema change.
7. **Conservative position was right that "build the eval first" is structurally non-negotiable.** Phase 0.5 reflects this.
8. **Conservative position was wrong to defer HNSW indefinitely.** It's one DDL, fully reversible, and IVFFlat drift is an algorithm property, not a TBD measurement. Phase 3 ships it.

This document is the operator-facing reconciliation of all of the above. Execute from §9, then §2 in order.

---

*Word count: ~3,200 (target 2500–3500). Final operator-facing document. Resume from §9 actions this week.*
