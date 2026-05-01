# Mem0 — What Omnimind Takes, What It Rejects

**Sources:** `docs/research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md` (mem0 deep dive), `02-graph-memory.md` (mem0-graph), `03-hierarchical-temporal.md` (mem0 ADD/UPDATE pipeline), `05-agent-framework-patterns.md` (mem0 MCP), and `stage5-validation/final-recommendation.md` (the canonical disposition).

Mem0 is the most cited reference architecture in the research corpus. The honest read across stage 1 is that **its retrieval side is competently assembled stock components, and its one genuinely novel idea is the ADD/UPDATE/DELETE/NOOP write-decision loop.** Everything else is take-it-or-leave-it. Below: the per-component disposition.

---

## ADOPT

### The ADD/UPDATE/DELETE/NOOP write-loop — Phase 2 + 5b

**What mem0 does.** On every `add()`, mem0 runs an LLM "fact extractor" on the raw turn, then a second LLM call retrieves the top-k existing memories most similar to each extracted fact and emits one of `ADD | UPDATE | DELETE | NOOP` per candidate. Mutations applied to the vector store. This turns an append-only log into a memory *system* with deduplication and contradiction resolution baked in ([04-hybrid-retrieval.md §1](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Why it's the engine, not the body.** Every other piece of mem0 — the embeddings, the optional Neo4j graph layer, the simple cosine retrieval — exists in any modern RAG stack. The write-decision loop is the one piece that actually changes the data model semantics from "log" to "memory."

**Cost (real numbers).** ~$0.001 per write at Haiku rates including the decision call. At 50 writes/day × 1000 users = 50k writes/day = ~$50/day fleet-wide. Tolerable on a $20-50/month tier ([04-hybrid-retrieval.md §9](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md), [final-recommendation.md §6](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md)).

**Omnimind's adaptation.** Two-phase rollout to keep cost and risk bounded:
- **Phase 2** ships a deterministic version: pattern + canonical-name dedup, no LLM. ADD/UPDATE/NOOP only (no DELETE; copy-on-write supersession via `supersededBy`).
- **Phase 5b** layers Haiku on the boundary cases (when the deterministic decision is below confidence threshold). Prompt lives in `docs/prompts/mem0-consolidation.system.md`. Output Zod-validated against `MemoryConsolidationActionSchema`. Idempotent replay key `${memoryId}:${version}:${action}`.

### Entity extraction patterns — Phase 5a

**What mem0 does.** Extracts atomic facts from turns via prompted LLM with a JSON-mode/tool-use schema ("User prefers dark mode", "User's dog is named Max"). No fine-tuned NER model; just prompt engineering with constrained output.

**Why adopt.** Schema-aware LLM extraction beats classical NER for agent memory because the entity vocabulary changes per product. Cost is ~$0.0003 per extraction at Haiku rates ([04-hybrid-retrieval.md §1](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Omnimind's adaptation.** Pattern-first (regex + heuristics for person, org, URL, date, @mention) ships in Phase 2 as the deterministic floor. LLM extraction (Phase 5a) lifts coverage on the long tail; runs as a nightly batch via cortex-scheduler with hard cost caps (`$2/user/month`, `$50/day` global). Prompt in `docs/prompts/entity-extractor.system.md`. Aliasing/canonicalization handled via fuzzy match (pg_trgm) + LLM disambiguation against existing entity set.

### Provenance per fact

**What mem0 does.** Every memory stores its source memory ID. mem0-graph stores the source span on every edge. Enables "why do you think this?" queries and trust signals.

**Omnimind's adaptation.** Already partially in `MemoryEntry` via `sourceType` and `sourceUrl`. Phase 5a's `EntityExtractionEvent` and `RelationshipEvidence` models extend this to the entity/relationship layer.

---

## CHERRY-PICK

### Hybrid scoring with entity boost — Phase 6, NOT parallel `hybrid_search()`

**What mem0 (and most production stacks) does.** When retrieving, return vector-similar facts and optionally expand one hop in the graph for context. Entities matched in the query get a relevance boost.

**What omnimind takes.** A 5th ranker signal: if a retrieved memory links to an `ExtractedEntity` whose `canonicalName` matches the query (trigram similarity ≥0.6), add +0.15 boost. Reads only `EntityRelationship.confidence ≥ 0.7`. Behind `RANKER_ENTITY_BOOST_ENABLED=false` default.

**What omnimind rejects.** The earlier `MEM0_RE_INTEGRATION_PLAN.md` proposed a parallel PL/pgSQL `hybrid_search()` function that duplicated `ranker.ts`. Stage-3 conservative + stage-5 final recommendation both kill this — the existing 4-signal weighted ranker is architecturally equivalent, in TypeScript we can read and modify, and extending it with the entity boost is strictly better than forking into a parallel SQL path ([position-conservative.md §5](../../research/mem0-memory-architectures/stage3-debate/position-conservative.md)).

### Graph layer — Phase 4 (recursive CTE), NOT Neo4j

**What mem0 does.** Optional `mem0[graph]` add-on writes `(subject, predicate, object)` triples to Neo4j or Memgraph on each write. Retrieval optionally expands one hop.

**What omnimind takes.** The *concept* of typed entity relationships, but in PostgreSQL link tables. `relationship.service.ts` exposes `findRelatedEntities(entityId, hops=2)` via PostgreSQL recursive CTE on the existing typed link tables (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`).

**What omnimind rejects.** Neo4j as a sidecar service. Operationally it's a second stateful container, separate backups, separate auth, separate scaling, AuraDB free tier capped at 200k nodes. For <100k entities and ≤3-hop queries, recursive CTEs beat Neo4j on cold-start latency, cost, and operational surface ([02-graph-memory.md §4](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md), [final-recommendation.md §2 Phase 4](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md)). The breakpoint is "I need Cypher pattern matching, not just traversals" — and at that point ADR-004 gets re-opened, not now.

### Mem0 MCP server — study, build our own — Phase 10

**What mem0 ships.** `mem0ai/mem0-mcp` exposes `add_memories`, `search_memory`, `get_all_memories`, `delete_memory` tools. Heavily used in Cursor + Claude Desktop. Auth via `MEM0_API_KEY` env in stdio mode; bearer over Streamable HTTP for hosted ([wave1-research/04-external-interfaces.md §2](../../research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md)).

**What omnimind takes.** The interface shape (thin tool surface, OAuth for hosted) and the MCP spec compliance bar (Streamable HTTP, OAuth 2.1 + PKCE + DCR + RFC 8707). Tools to expose first: `search_memory`, `add_memory`, `list_decisions`, `invoke_persona`, `get_weekly_memo`. Resources (read-only data with URIs): `memory://{id}`, `decision://{id}`, `persona://{name}`.

**What omnimind rejects.** mem0's own MCP server. We're not mem0; we're omnimind. Building our own keeps the entity model, persona system, and outcome data first-class in the tool surface — none of which mem0 has.

---

## REJECT

### Pronoun resolution — DEFERRED

**What mem0 (and Graphiti) does.** Solves pronoun reference inline by passing the full conversation turn to the LLM extractor. This works within a single turn; it does NOT cross session boundaries.

**Why omnimind defers.** The graph-memory research is explicit: "nobody is nailing this for agent memory, and it probably isn't worth the complexity" ([02-graph-memory.md §9](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md)). The `_disabled/query-understanding.service.ts` artifact is 30% complete and solves the problem at the wrong layer. The right answer is: pass a larger context window to the extractor at write time.

**Trigger to reopen.** A specific persona's eval shows >10% answer-quality regression traceable to pronoun ambiguity.

### Mem0 cloud — REJECTED via ADR-001

**What mem0 offers.** Hosted memory service with Platform-tier reranking, multi-tenant isolation, observability dashboard.

**Why omnimind rejects.** ADR-001 (no frameworks, no third-party agent infrastructure) and ADR-003 (all data in our Postgres). Adopting mem0 cloud means Python stack + Qdrant + their reranker + their observability + their pricing model. Every pattern they invented can be replicated in ~200 lines of TypeScript on the existing custom runtime ([final-recommendation.md §3](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md)).

**Trigger to reopen.** Series A. Until then, replicate the patterns; don't import the platform.

### MemGPT-style hierarchical tiers — REJECTED

**What mem0 doesn't do, but Letta does.** Main context / recall / archival, paged via tool calls. The LLM is the memory manager.

**Why omnimind rejects.** Wrong product, wrong scale. Omnimind already has a working/archival distinction via session scope (ephemeral) + `MemoryEntry` (persistent) + `context-packager.ts` (per-call repack). MemGPT-style tool-call paging would slow every persona invocation for marginal benefit at <1M memories ([03-hierarchical-temporal.md §1](../../research/mem0-memory-architectures/stage1-research/03-hierarchical-temporal.md), [05-agent-framework-patterns.md §5](../../research/mem0-memory-architectures/stage1-research/05-agent-framework-patterns.md)). No published benchmark shows tier-paging beating well-tuned RAG+summary on a realistic agent task.

**Trigger to reopen.** Never, for this product.

### Full bi-temporal (transaction-time axis) — REJECTED, bi-temporal-lite adopted

**What Graphiti (mem0's spiritual cousin) does.** Every edge has `valid_from / valid_to` (world time) + `created_at / expired_at` (system time). Answers "what did the system *believe* on date Y."

**Why omnimind rejects the full version.** Audit + research consensus: `validAt / invalidAt / supersededBy` already on `MemoryEntry` capture 80% at 20% cost. Transaction-time is for financial-audit systems ([03-hierarchical-temporal.md §6](../../research/mem0-memory-architectures/stage1-research/03-hierarchical-temporal.md)).

**What omnimind takes instead.** Bi-temporal-lite: add `validFrom`, `validTo`, `supersededBy` (nullable) to the six link tables. Captures "John used to work at Acme but now works at Anthropic" without the find-and-expire LLM ingestion budget Graphiti spends most of its time on. Phase 1.

**Trigger to reopen full bi-temporal.** A user files a real "what did the system believe about X on date Y" support ticket, ≥3 times.

---

## Where the synthesis was wrong about mem0

Two corrections from the Stage-4 reviewers and Stage-5 validation that matter for downstream work:

### 1. `DecisionOutcome` is not a table

The stage-3 synthesis cited `DecisionOutcome` as if it were a Prisma model. **It is not.** The schema has `Decision.outcome: String?` (free-text) and `Decision.outcomeRating: Int?`, plus an `OutcomeReviewNudge` scheduling table. The "join memories cited in decisions that shipped vs. reversed" operation requires building a `MemoryCitation` (or equivalent) link table to trace which retrieved memories were used in which decision, then a structured `DecisionOutcome` table ([pragmatic-review.md §2d](../../research/mem0-memory-architectures/stage4-review/pragmatic-review.md), [final-recommendation.md §appendix](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md)).

**Resolution:** the outcome-feedback loop is real long-term differentiation, but it's a **months-out** capability gated on populated outcome data. Phase 7a ships immediately with access-count + recency (cheap proxy, no schema gap, captures 60-70% of the value). Phase 7b is deferred behind a ≥200-decisions-with-outcome trigger.

### 2. `search_vector` is not a missing trigger

The synthesis claimed `MemoryEntry.searchVector` was a "3-line trigger" gap. **It is dead code.** The column exists in `schema.prisma`, but `src/retrieval/fulltext-search.ts` computes `to_tsvector('english', title || ' ' || content)` inline at query time and never reads the column. The migration `20250410_add_search_indexes` builds **functional** indexes against the inline expression, not against `search_vector` ([architectural-review.md §7](../../research/mem0-memory-architectures/stage4-review/architectural-review.md)).

**Resolution:** Phase 0 deletes the column as dead-code cleanup. Revisit a `GENERATED ALWAYS AS (...) STORED` tsvector only if FTS query latency becomes a measured problem.

---

## Net disposition

| Mem0 component | Disposition | Phase |
|---|---|---|
| ADD/UPDATE/DELETE/NOOP write-loop | **ADOPT** (deterministic + LLM boundary) | 2 + 5b |
| LLM-prompted entity extraction | **ADOPT** (with pattern-first floor) | 5a |
| Provenance per fact | **ADOPT** (extend existing) | 5a |
| Entity-aware retrieval boost | **CHERRY-PICK** (5th ranker signal, no parallel SQL fork) | 6 |
| Graph layer | **CHERRY-PICK** (recursive CTE, not Neo4j) | 4 |
| Mem0 MCP server | **CHERRY-PICK** (study, build our own) | 10 |
| Pronoun resolution | **REJECT** (defer; solve at extraction time) | — |
| Mem0 cloud | **REJECT** (ADR-001) | — |
| MemGPT-style tiers | **REJECT** (wrong product) | — |
| Full bi-temporal | **REJECT**; bi-temporal-lite adopted | 1 |

This is the operator-facing reconciliation. When in doubt, the canonical disposition is `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md`.
