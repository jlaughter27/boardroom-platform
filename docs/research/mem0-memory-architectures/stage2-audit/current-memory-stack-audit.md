# Omnimind Memory Stack — Current State Audit

**Scope:** Baseline report for the Stage 2 debate. Describes what omnimind's memory/retrieval stack does *today* — no recommendations.

## A. Current capability inventory

### Storage layer
- PostgreSQL with pgvector (1536-dim OpenAI `text-embedding-3-small`), pg_trgm (trigram), tsvector (FTS)
- Soft-delete (`deletedAt`) on: MemoryEntry, Decision, Commitment, Person, Goal, Project, Task, Room
- User-scoped isolation: every query filters by `userId` in application code
- MemoryEntry versioning (`version` increments on update)
- Temporal validity fields: `validAt`, `invalidAt`, `supersededBy`
- Memory status lifecycle: `DRAFT → CONFIRMED → SUPERSEDED → ARCHIVED → REJECTED`

### Validation pipeline (write path, synchronous)
- Zod schema validation on all inputs
- Temporal consistency check (`validAt < invalidAt`, `supersededBy` references resolve)
- Per-user per-domain budget enforcement:
  - `ministry: 300`, `business: 400`, `personal: 200`, `ai-systems: 300`, `default: 250`
- No entity extraction on write; entity links are either manually created or LLM-proposed then validated

### Retrieval architecture (read path)
Four layers run in **parallel** via `Promise.all`, each capped at 20 hits:
- **structured-filter** — exact match on `domain`, `tags`, ordered by `importance DESC`
- **fulltext-search** — `tsvector` + `tsquery` (tokens AND-joined, hyphens removed), scored by `ts_rank` (0–1)
- **trigram-search** — `pg_trgm.similarity()` with threshold 0.3, ordered DESC
- **semantic-search** — pgvector cosine distance (inverted to similarity), IVFFlat index with `vector_cosine_ops`

Layer failure is graceful (returns `[]`, other layers continue).

### Ranker fusion (fixed weights)
- `structured: 0.3`, `FTS: 0.25`, `trigram: 0.2`, `semantic: 0.25`
- Recency boost: `+0.1` if accessed within 7 days (binary, not exponential decay)
- Importance boost: `+0.1` if `importance >= 0.8`
- Dedup by ID, keep top-N

### Context packager (persona-aware)
- Per-persona tag boosts (+0.15 amount): optimist → `success/opportunity/resource/strength/win`; critic → `risk/failure/constraint/blocker/concern`; etc.
- Caps: max 10 items per persona (15 for CEO); token budget 2000 (3000 CEO)
- Selection respects both `maxItems` and `tokenBudget` — items excluded if over budget, not truncated

### Entity linking (flat, not graph)
- `MemoryEntityLink(memoryId, entityType, entityId, linkType)` — unique on the 4-tuple
- Join tables: `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`
- All bidirectional; cascade delete on parent removal
- `linkType` is a free-form string (no enum), so semantics are inconsistent

### Background intelligence (cortex) — node-cron
| Job | Schedule | Writes |
|---|---|---|
| Weekly memo | Sun 18:00 | `WeeklyMemo` per user — decisions, patterns, contradictions, thinkingQualityScore, recommendedFocus |
| Pattern detection | Mon 03:00 | `ThinkingPattern` (BIAS / STRENGTH / BEHAVIORAL_CYCLE / DECISION_STYLE) |
| Contradiction scan | Mon 04:00 | `ContradictionAlert` (entityA/entityB JSON, severity, status) |

All jobs iterate users sequentially, fail-safe per-user.

### Embedding queue (in-process, non-durable)
- Priority levels: `high`, `normal`, `low`; max 3 retries
- ~100ms processing interval rate-limits OpenAI
- Fire-and-forget from write path
- Not durable — process crash loses queued items
- Health endpoint exposes `workerRunning`, `queueSize`

## B. Current limitations

- No entity extraction on memory write (manual/LLM-proposed only)
- No multi-hop graph traversal (flat links, no entity↔entity chains)
- No pronoun resolution in retrieved context
- No cross-entity contradiction detection (only within-user, not across linked entities)
- No dynamic context adaptation per query complexity
- No query expansion / reformulation / synonyms / HyDE
- No retrieval result caching (every query runs all 4 layers fresh)
- `search_vector` tsvector column defined but not auto-maintained on update
- No embedding queue backpressure handling or alerting
- No outcome → memory-scoring feedback loop (DecisionOutcome exists but unused for learning)
- Recency boost is **binary** (7-day window), no exponential decay
- No task/project dependency cascade recomputation
- Deadline fields not queried by cortex (no proactive due-date alerts)
- `MemoryEntityLink.linkType` has no enum — inconsistent relation semantics across memories

## C. Architecture (ASCII)

```
WRITE PATH
  POST /memories
    → validateSchema (Zod) → validateTemporal → enforceBudget
    → prisma.memoryEntry.create (status=DRAFT)
    → queueEmbedding (fire-and-forget, high priority)
    → return 201
  [background] embedding-queue worker → OpenAI /embeddings → UPDATE embedding

READ PATH
  assembleContextForPersona(userId, query, persona)
    → generateEmbedding(query)
    → Promise.all([
        structuredFilter, fulltextSearch, trigramSearch, semanticSearch
      ])  ← each limit=20
    → ranker.rankAndDedupe()  ← weights 0.3/0.25/0.2/0.25 + recency/importance boosts
    → contextPackager.pack(persona)  ← tag-boost +0.15, cap 10 items / 2000 tokens
    → ContextPackage { items, tokenEstimate, metadata }

CORTEX (node-cron, in-process)
  Sun 18:00  weekly-memo job
  Mon 03:00  pattern-detection job
  Mon 04:00  contradiction-scan job
  All per-user sequential, fail-safe
```

## D. Non-negotiables (ADRs)

1. **ADR-001** — no agent frameworks (LangChain/CrewAI/LangGraph). Custom ~200-line runtime.
2. **ADR-002** — Anthropic only (Claude Sonnet 4.6 + Haiku 4.5). No multi-model routing.
3. **ADR-003** — pgvector in Postgres. No separate vector DB (Pinecone/Weaviate rejected).
4. **ADR-004** — no knowledge graph in v1. Flat link tables + hybrid retrieval. Revisit at 500+ memories/user.
5. **ADR-009** — background jobs via node-cron in-process. No Redis, no BullMQ.
6. **User scoping** non-negotiable — app-level RLS, every query filters by userId.
7. **Soft delete** on all entity tables — no hard deletes.
8. **Validation is deterministic and synchronous** — no LLM in write path.

## E. Debate-relevant facts (not obvious from code)

1. **Embedding generation is async, non-blocking** — write completes in ~10ms; embedding lands eventually.
2. **Retrieval runs 4 layers in parallel** (Promise.all), not cascade. Layer failure doesn't block.
3. **Ranker weights are *designed, not EV-tuned***. No retrieval eval ever compared alternatives.
4. **No latency assertions in tests**. No p50/p99 retrieval metrics logged.
5. **Token budgets are soft** — over-budget items excluded, not truncated.
6. **Embedding queue is in-memory** — crashes lose queued jobs. Manual backfill for recovery.
7. **Cortex jobs are per-user sequential** — no batching. Scaling ceiling ≈ 1000 users × 30s/user.
8. **No entity co-occurrence analysis** — `MemoryEntityLink` exists but no "people who appear together" queries.
9. **Contradiction detection is user-internal only** — doesn't cross-reference linked entities.
10. **Tag boosts are additive** not multiplicative.

## F. Objective metrics

- **Test files**: 24 (18 unit + 2 integration + 1 debug + 4 in `_disabled/`). 708 tests passing.
- **Coverage**: schema-validator, temporal-validator, budget-enforcer, FTS, context-packer, ranker — covered. Semantic search — not covered (hard to mock pgvector).
- **No retrieval eval**: no MRR / NDCG / P@k / recall measurements exist. No ground-truth labels.
- **Latency**: no SLA in tests, no production metrics logged.
- **Embedding cost**: ~$0.02/1M tokens per ADR-011 (~$0.00002/memory). No cost monitoring.
- **Job success rate**: not tracked; only error logs per user failure.
- **Domain budget utilization**: blocked at limit, but no alerting / reporting at partial usage.

---

## Quick friction-points summary (feeds debate)

| Friction point mem0 might address | Severity today |
|---|---|
| No entity extraction on write | High (all entity links manual) |
| Flat link structure, no graph traversal | Medium (ADR-004 deferred; revisit due) |
| No query expansion / reformulation | Medium |
| Ranker weights never tuned | Medium (unknown lift available) |
| No outcome → memory feedback loop | Medium |
| Embedding queue non-durable | Low (in practice losses are rare) |
| Contradiction scan scope too narrow | Low-Medium |
