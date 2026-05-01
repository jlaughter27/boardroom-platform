# Glossary

**Audience:** Anyone (Claude or human) hitting a domain term they don't recognize.

---

## Product / domain

| Term | Definition |
|---|---|
| **BoardRoom AI** | The frontend + orchestration product. React + Express. Owns UX. |
| **OmniMind API** | The backend memory + intelligence service. Express + Prisma. Owns ALL persistent data. |
| **Persona** | An AI agent with a distinct viewpoint. Default 7: Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO. |
| **CEO persona** | The synthesizer. Runs LAST in any decision flow, sees all other personas' outputs. |
| **Decision Session** | A user-initiated structured decision with question + persona responses + CEO synthesis. |
| **Memory** | A persistent fact / observation / decision. Stored in `MemoryEntry`. Has class (working/episodic/semantic/decision), status (draft/confirmed/superseded/archived), validity window. |
| **Cortex** | The background intelligence layer. Runs node-cron jobs that analyze patterns, detect contradictions, write weekly memos. |
| **Domain** | A scope tag on memories: `ministry`, `business`, `personal`, `ai-systems`, `default`. Each has a budget cap. |
| **Mode** | A flow that routes to a subset of personas: `decide` (all 7), `stress-test` (Critic+Questionnaire+Alternate), `plan` (Doer+Technician), `brainstorm` (Optimist+Alternate). |
| **Custom Persona** | A user-defined persona (model: `CustomPersona`). Schema exists; UX partial. |

## Architecture / infra

| Term | Definition |
|---|---|
| **Service boundary** | The HTTP-only line between BoardRoom and OmniMind. BoardRoom uses `omnimind-client.ts`, never touches Postgres. |
| **Hybrid retrieval** | The 4-signal search: structured filter + tsvector FTS + pg_trgm trigram + pgvector semantic. Currently combined via weighted fusion in `ranker.ts`. |
| **Validation pipeline** | Synchronous chain at write time: Zod schema → temporal consistency → budget enforcement. |
| **Ranker** | `retrieval/ranker.ts`. Fuses the 4 signals with weights `(0.3, 0.25, 0.2, 0.25)` plus recency/importance boosts. Will gain a 5th entity-aware signal in Phase 6. |
| **Context packager** | `retrieval/context-packager.ts`. Persona-aware re-ranking + token budget enforcement (10 items / 2000 tokens default; CEO gets 15 / 3000). |
| **Embedding queue** | In-process priority queue that batches OpenAI embedding calls async after memory writes. NOT durable — restarts lose work. |
| **MemoryEntityLink** | Generic join table connecting memories to entities (Person/Goal/Project/Task). `linkType` is currently free-form string (will become enum). |
| **Soft delete** | Setting `deletedAt: DateTime` instead of removing the row. Every query MUST filter `WHERE deletedAt IS NULL`. |
| **Bi-temporal** | A time model with two axes: valid-time (when it's true in the world) and transaction-time (when we knew it). Omnimind has the first via `validAt`/`invalidAt`/`supersededBy`; the second is deferred. |

## Mem0 + research terms

| Term | Definition |
|---|---|
| **mem0** | Open-source AI memory layer (mem0.ai). Vector + optional graph. Core idea: an ADD/UPDATE/DELETE/NOOP loop decides what to persist on each new fact. |
| **ADD/UPDATE/DELETE/NOOP loop** | mem0's write-decision pattern. New fact arrives → compare to existing → decide whether it's net-new (ADD), refines an existing (UPDATE), contradicts/supersedes (DELETE), or is duplicate (NOOP). |
| **HNSW** | Hierarchical Navigable Small World graph index for vector search. Better recall than IVFFlat at moderate scale. Phase 3 migrates omnimind to HNSW. |
| **IVFFlat** | Inverted File Flat index for vectors. pgvector's default. Recall degrades with continuous inserts (the reason to switch to HNSW). |
| **RRF** | Reciprocal Rank Fusion. A parameter-free way to combine multiple ranked result lists. Alternative to weighted fusion. |
| **Cross-encoder reranker** | A model that takes (query, doc) pairs and re-scores them. Used as a post-retrieval stage. Examples: Cohere Rerank-3.5, BGE-reranker-v2-m3. |
| **HyDE** | Hypothetical Document Embeddings. Have an LLM generate a hypothetical answer, embed THAT, search with the hypothetical embedding. Sometimes lifts retrieval. |
| **GraphRAG** | Microsoft's pattern: extract entities + relationships from corpus, store as graph, retrieve via graph walks + summaries. |
| **HippoRAG** | Single-shot graph indexing for RAG. Builds a personalized PageRank-like graph at ingest time. |
| **MemGPT / Letta** | Hierarchical memory: small "main" context + larger "archival" + tools to page in/out. Omnimind explicitly NOT adopting this. |
| **Knowledge graph** | A graph of entities and typed relationships, queryable via path traversal. Omnimind defers full KG (ADR-004); Phase 4 ships recursive-CTE traversal over existing typed link tables. |
| **Bi-temporal KG** | A KG where edges have valid-time and transaction-time. Zep/Graphiti pattern. |

## Agent pipeline terms (used in `07-claude-instructions/MEMORY-AGENTS-PIPELINE.md`)

| Term | Definition |
|---|---|
| **Wave** | A set of agents that run in parallel. Subsequent waves wait for prior wave to complete. |
| **Synthesizer** | An agent that reads multiple inputs and produces a unified output. |
| **Adversarial debate** | Two agents (aggressive + conservative) argue opposing positions; a synthesizer adjudicates. |
| **Validator** | The final agent that produces operator-ready output after all reviews. |
