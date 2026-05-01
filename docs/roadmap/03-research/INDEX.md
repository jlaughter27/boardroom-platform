# Research Index

**Audience:** Anyone planning, debating, or executing a phase in this roadmap.
**Rule:** Cite, don't re-derive. The research below is committed to the repo. Pointing at it is faster, cheaper, and lower-risk than re-running the search.

---

## How to use this folder

When you need to justify a roadmap decision (a phase scope, a defer, an ADR), pull the citation from these files. Each `docs/research/**` artifact is full-text in the repo at the path shown. The four synthesis docs in this folder (`ai-memory-sota.md`, `mem0-decomposition.md`, `obsidian-patterns.md`, `benchmarks-and-evidence.md`) compress the underlying research into roadmap-ready form. `sources.md` is the bibliography.

Two pipelines produced this corpus:

- **mem0-architecture** (5-stage research → debate → review → validation pipeline). Output: a recommendation that supersedes the earlier `MEM0_RE_INTEGRATION_PLAN.md`.
- **omnimind-roadmap-2026 wave 1** (4 research reports + 4 audits). Output: scope and risk feeders for the ops/security/data/interfaces dimensions of the larger 2026 roadmap.

When the two pipelines disagree, `final-recommendation.md` (Stage 5 of the mem0 pipeline) wins for memory-stack questions; the wave-1 reports win for ops/security/data/interface questions outside the memory stack.

---

## mem0-architecture pipeline (11 files)

### Stage 1 — Research reports (`docs/research/mem0-memory-architectures/stage1-research/`)

| File | One-liner |
|---|---|
| `01-vector-embeddings.md` | Embedding model landscape, pgvector vs. dedicated vector DBs, chunking, reranking, RRF vs. weighted fusion, binary quantization. **Headline:** keep pgvector, switch IVFFlat→HNSW, add a cross-encoder reranker. |
| `02-graph-memory.md` | Zep/Graphiti, Cognee, mem0-graph, Neo4j vs. Postgres-native, entity extraction quality, multi-hop retrieval, when NOT to use a graph, pronoun resolution. **Headline:** enhance existing link tables with bi-temporal columns; recursive CTE over Neo4j. |
| `03-hierarchical-temporal.md` | MemGPT/Letta hierarchical tiers, working/long-term split, consolidation/compaction, recency decay, bi-temporal models, contradiction detection, sleeptime compute. **Headline:** skip MemGPT tiers; adopt mem0 ADD/UPDATE/DELETE write-loop; add `superseded_by` rather than full bi-temporal. |
| `04-hybrid-retrieval.md` | mem0 deep dive, HippoRAG 1/2, Microsoft GraphRAG, Self-RAG/CRAG, RRF vs. weighted vs. LTR, reranking, query expansion, cost analysis. **Headline:** RRF over text signals + weighted structured; cherry-pick mem0's write-loop; reranker is the single biggest gap. |
| `05-agent-framework-patterns.md` | OpenAI Assistants/Responses, Claude Agent SDK, LangGraph (checkpointer/store), CrewAI, Letta/MemGPT, Zep, Semantic Kernel, durable execution, IDE assistants, MCP memory servers, multi-agent shared memory, 1M-context implications. **Headline:** keep shared-entity-graph (omnimind's pattern); borrow LangGraph's semantic/episodic/procedural vocabulary. |

### Stage 2 — Audit (`docs/research/mem0-memory-architectures/stage2-audit/`)

| File | One-liner |
|---|---|
| (audit reports referenced by Stage 3+) | Codebase audit of the existing memory stack; surfaced facts re-cited downstream (e.g., "no retrieval eval exists," "ranker weights are designed not EV-tuned"). |

### Stage 3 — Debate (`docs/research/mem0-memory-architectures/stage3-debate/`)

| File | One-liner |
|---|---|
| `position-aggressive.md` | Maximum-value-capture position. HNSW now, reranker now, RRF now, bi-temporal-lite, ADD/UPDATE/DELETE loop, `memoryType` enum. |
| `position-conservative.md` | Minimum-viable-change position. Build the eval harness first; everything else is unfalsifiable until then. |
| `position-synthesis.md` | Reconciliation of aggressive + conservative. Eval harness as Phase 0.5 keystone; outcome-feedback loop named as omnimind's moat. |

### Stage 4 — Review (`docs/research/mem0-memory-architectures/stage4-review/`)

| File | One-liner |
|---|---|
| `architectural-review.md` | ADR-compliance pass on the synthesis. Catches: `search_vector` is dead code (not a missing trigger), `memoryType` was silently downgraded, prompt files + Zod schemas under-specified, EntityRelationship vs. typed link tables conflict not addressed. |
| `pragmatic-review.md` | Feasibility/ops/cost pass. Catches: `DecisionOutcome` doesn't exist as a table (it's `Decision.outcome` free-text); 12-week estimate is ~40% light; reranker needs Railway RAM bump; backfill must be chunked + resumable. |

### Stage 5 — Validation (`docs/research/mem0-memory-architectures/stage5-validation/`)

| File | One-liner |
|---|---|
| `final-recommendation.md` | Operator-ready 8-phase plan. ~16-22 calendar weeks. Defers reranker (Phase 8) and outcome-weighted ranker (Phase 7b) behind named, measurable triggers. **This is the canonical output of the mem0 research pipeline.** |

---

## omnimind-roadmap-2026 wave 1 (8 files)

### Wave-1 research (`docs/research/omnimind-roadmap-2026/wave1-research/`)

| File | One-liner |
|---|---|
| `01-ops-scaling.md` | Horizontal scaling, PgBouncer, durable job queues (graphile-worker), read replicas, embedding-batch backpressure, cron isolation, backups/PITR, observability stack on a solo-founder budget, rate-limiting without Redis, LLM cost containment. |
| `02-security-best-practices.md` | RLS for multi-tenancy, JWT secret rotation, service-to-service auth ladder, prompt-injection defenses, PII in embeddings, LLM tool-use validation, rate-limit/abuse, secret-leakage paths, SOC 2 Type 1 audit logging, subscription-fail-open abuse vectors. |
| `03-data-architecture.md` | Migration baseline after `prisma db push`, expand-contract zero-downtime migrations, soft-delete enforcement (views/RLS/generated columns), embedding model versioning, IVFFlat→HNSW migration SOP, backups/PITR, bi-temporal modeling in Postgres, audit log design, GDPR export/delete, schema drift detection. |
| `04-external-interfaces.md` | MCP server design (Streamable HTTP, OAuth 2.1 + DCR), memory-as-MCP examples, Obsidian-style markdown patterns, git-as-sync, TypeScript SDK design, persona marketplace, file+DB coexistence, webhooks/event bus, BYO-model patterns at the interface layer. |

### Wave-1 audits (`docs/research/omnimind-roadmap-2026/wave1-audit/`)

| File | One-liner |
|---|---|
| `code-quality-audit.md` | Code-level health pass over the existing repo. |
| `data-integrity-audit.md` | Schema-, FK-, and soft-delete-level integrity findings. |
| `scalability-audit.md` | Throughput, latency, and bottleneck findings against the existing single-instance Railway deploy. |
| `security-audit.md` | Surface-area pass for prompt-injection, RLS gaps, secret leakage, fail-open vectors. |

---

## Synthesis files in this folder

| File | What it answers |
|---|---|
| `ai-memory-sota.md` | "What's the 2025-2026 state of the art for AI memory, and which omnimind phase delivers each piece?" |
| `mem0-decomposition.md` | "What does omnimind take from mem0, and what does it explicitly reject?" |
| `obsidian-patterns.md` | "What does omnimind take from Obsidian for export/portability, and what doesn't fit?" |
| `benchmarks-and-evidence.md` | "Which numbers are vendor-framed vs. independently replicated?" |
| `sources.md` | Bibliography of every cited primary source. |
