# AI Memory — State of the Art (2025-2026)

**Sources:** All five `docs/research/mem0-memory-architectures/stage1-research/` reports plus all four `docs/research/omnimind-roadmap-2026/wave1-research/` reports. Where the underlying research disagrees with itself, the resolution from `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` is the tiebreaker.

This document compresses ~25,000 words of research into roadmap-ready form. Each section ends with one concrete recommendation tagged with the omnimind phase that delivers it.

---

## 1. Storage — vector, graph, hybrid

**Vector store.** Pgvector remains production-viable through ~10M vectors and 1M+ rows per tenant. The case to switch to a dedicated vector DB (Pinecone/Qdrant/Turbopuffer) has weakened, not strengthened, since 2023: pgvector 0.8 added iterative index scans, halfvec, and better query planning ([01-vector-embeddings.md §2](../../research/mem0-memory-architectures/stage1-research/01-vector-embeddings.md)). The single most important vector-store change is **index type, not engine**: IVFFlat trains centroids on initial data and recall degrades as inserts drift, while HNSW is insert-friendly and is what Supabase, Neon, and Timescale all recommend in 2025-26.

**Graph layer.** Three competing reference architectures: Zep/Graphiti (bi-temporal Neo4j), mem0-graph (lightweight triple store on Neo4j or Memgraph), and Cognee (pipeline orchestrator). Each adds an entire stateful service. For omnimind's scale and entity counts (<100k entities, ≤3-hop queries dominant), recursive CTEs over Postgres link tables outperform Neo4j on cold-start latency, cost, and operational surface ([02-graph-memory.md §4](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md)).

**Hybrid.** "Vector + structured filter + entity link tables" is the dominant production pattern. Multi-modal hybrid retrieval (vector + BM25/FTS + trigram + structured) beats any single signal by 5-15 nDCG points on BEIR ([04-hybrid-retrieval.md §5](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Recommendation:** Keep pgvector + Postgres. Migrate IVFFlat → HNSW. Use recursive CTE for graph traversal capped at 2 hops. Defer Neo4j/AGE behind a "pattern-match queries become a product feature" trigger.
**Phase:** HNSW lands in Phase 3 of `final-recommendation.md`. Recursive-CTE traversal in Phase 4.

---

## 2. Retrieval — signals, fusion, reranking

**Signals.** A 2026 production retrieval pipeline has four signals: dense (vector), sparse (BM25/FTS), lexical-fuzzy (trigram), and structured (filters/joins). Omnimind already ships all four ([04-hybrid-retrieval.md §10](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Fusion.** RRF (Reciprocal Rank Fusion, `score = Σ 1/(k+rank_i)`) has won the "good default" slot. Elastic, OpenSearch, Weaviate, Qdrant, Vespa, and Azure AI Search all ship RRF as the blessed fusion method. Hand-tuned weighted fusion is fine when validated against an offline eval set; without one, the weights silently drift as corpus distributions shift. Omnimind's current weights (`semantic 0.25 / FTS 0.25 / trigram 0.20 / structured 0.30`) were designed, not eval-tuned ([04-hybrid-retrieval.md §5](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)). The structured signal at 0.30 is genuinely distinctive — most public benchmarks don't reward structured filters, so RRF over the three text signals + weighted-combine with structured preserves the secret sauce.

**Reranking.** Cross-encoder rerank after hybrid fetch is the 2026 consensus. `BAAI/bge-reranker-v2-m3` (568M, multilingual) self-hosted via ONNX/INT8 on CPU adds 50-150ms for top-100 → top-10 and lifts nDCG@10 by 5-15% on BEIR ([01-vector-embeddings.md §4](../../research/mem0-memory-architectures/stage1-research/01-vector-embeddings.md), [04-hybrid-retrieval.md §6](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Query understanding.** HyDE / multi-query / step-back are partially superseded by modern embedders for personal-memory workloads where vocabulary overlap is high. Net expected value is negative as a default; positive as an opt-in for domain-jargon edge cases ([04-hybrid-retrieval.md §7](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Recommendation:** Add RRF behind a flag (`RANKER_MODE=rrf|weighted`); A/B against the eval harness; preserve structured-as-weighted. Defer the cross-encoder reranker until (a) the eval harness shows top-5 MRR <0.6 AND (b) Railway is upgraded to ≥4GB RAM (the Stage-5 recommendation gates this explicitly because the conservative 1M-context argument is real). HyDE: defer entirely; opt-in per query class only when eval shows ≥10% lift.
**Phase:** RRF in Phase 3. Reranker DEFERRED to Phase 8 (gated). HyDE DEFERRED indefinitely.

---

## 3. Write decisions — ADD/UPDATE/DELETE/NOOP

**The one genuinely novel mem0 idea.** On every write, mem0 retrieves top-k similar memories and asks an LLM to emit `ADD | UPDATE | DELETE | NOOP` per candidate, applying the mutation. This is what turns an append-only log into a memory *system* with deduplication and contradiction resolution baked in ([04-hybrid-retrieval.md §1](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md), [03-hierarchical-temporal.md §3](../../research/mem0-memory-architectures/stage1-research/03-hierarchical-temporal.md)).

**Cost.** ~$0.001 per message at Haiku rates (one decision call + one optional LLM extraction). Tolerable at $20-50/month SaaS pricing ([04-hybrid-retrieval.md §9](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).

**Architecture.** Must be **async post-validation enrichment**, not synchronous validation. Runs on the existing embedding-queue worker. Output Zod-validated against `MemoryConsolidationActionSchema` before any DB mutation. Copy-on-write supersession (never in-place UPDATE) so rollback is possible. Idempotent replay key `${memoryId}:${version}:${action}` so re-runs are safe — needed because the in-process queue is non-durable ([final-recommendation.md §4.2](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md)).

**Recommendation:** Ship a deterministic pattern-only loop first (Phase 2). Layer Haiku on boundary cases only (Phase 5b). Persist `MemoryWriteEvent` rows to Postgres before Phase 2 ships so the queue is recoverable on Railway restart.
**Phase:** Phase 2 (deterministic), Phase 5b (LLM augmentation).

---

## 4. Consolidation — mem0 vs. MemGPT vs. Graphiti

**Mem0.** Synchronous LLM-as-consolidator on write. Captures contradiction resolution at write time. Best fit for omnimind because it composes with the existing validation pipeline and async embedding queue.

**MemGPT/Letta.** Hierarchical tiers: main context / recall / archival, paged via tool calls. Productized by Letta with stateful agents, editable memory blocks, sleep-time agents. Widely imitated, **not shown to beat well-tuned RAG+summary on a realistic agent task** ([03-hierarchical-temporal.md §1](../../research/mem0-memory-architectures/stage1-research/03-hierarchical-temporal.md), [05-agent-framework-patterns.md §5](../../research/mem0-memory-architectures/stage1-research/05-agent-framework-patterns.md)). Omnimind already has an equivalent via session-scope (ephemeral) + `MemoryEntry` (persistent) + `context-packager.ts` (per-call repack).

**Graphiti.** Bi-temporal knowledge graph in Neo4j. Every edge has `valid_from / valid_to` (world time) and `created_at / expired_at` (system time). Strong on temporal reasoning ("what did the system believe about X on date Y"). Operationally heavy: Neo4j sidecar, ingestion budget dominated by find-and-expire LLM passes ([02-graph-memory.md §1, §10](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md)).

**Sleep-time / sleeptime compute.** Background agents that re-summarize, detect contradictions, enrich facts during idle inference budget. Ancient pattern (ETL, materialized views) with a new name. Omnimind's node-cron cortex jobs already implement this ([03-hierarchical-temporal.md §10](../../research/mem0-memory-architectures/stage1-research/03-hierarchical-temporal.md)).

**Recommendation:** Adopt mem0's write-loop (Phase 2 + 5b). Skip MemGPT tiers entirely. Borrow Graphiti's bi-temporal *concept* by adding `validFrom / validTo / supersededBy` to existing link tables (bi-temporal-lite); skip the full transaction-time axis. Keep cortex as the async pass that catches what the synchronous loop misses.
**Phase:** Bi-temporal-lite columns in Phase 1. Mem0 loop in Phase 2/5b.

---

## 5. Evaluation — the structural precondition

**The dominant truth in every research report.** Every benchmark cited in stage 1 is vendor-framed and not independently replicated:
- mem0's "26% better than OpenAI memory" is on LOCOMO, a benchmark favorable to mem0 ([04-hybrid-retrieval.md §8](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)).
- Zep/Graphiti's 18-point DMR win is on Zep's own benchmark.
- HippoRAG's lift is on multi-hop-by-construction sets (MuSiQue, HotpotQA), and real agent workloads are 70-90% single-hop ([02-graph-memory.md §7](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md)).
- Microsoft GraphRAG indexing is brutally expensive; community post-mortems "we tried GraphRAG and went back to hybrid" are common.

**Implication.** No external claim transfers to omnimind's workload (solo-founder decision intelligence) without local measurement. A retrieval eval harness is the **structural precondition** for every other capability claim. Without one, RRF/reranker/HNSW/graph "wins" are unfalsifiable.

**Minimum viable eval.** 35 hand-labeled queries across slices: 20 single-hop factual, 10 multi-entity, 5 temporal. Compute MRR / nDCG@10 / P@5. Snapshot baseline. Gate `pre-deploy.sh` on non-regression. Use Claude Sonnet 4.6 (or human) as judge — never the same Haiku that powers extraction (avoids self-consistent-loop measurement) ([pragmatic-review.md §6](../../research/mem0-memory-architectures/stage4-review/pragmatic-review.md)).

**Recommendation:** Eval harness is the keystone Phase 0.5. Add a secondary persona-response quality eval — retrieval lift that doesn't translate to persona-answer lift is not a product win.
**Phase:** Phase 0.5. Becomes ADR-015.

---

## 6. Ops & scaling

**Horizontal vs. vertical.** Vertical-scale a single Railway instance to ~400-800 concurrent users; split workloads (cortex into its own service) before splitting replicas. Sticky-session multi-instance Express is the third move, not the second ([wave1-research/01-ops-scaling.md §1](../../research/omnimind-roadmap-2026/wave1-research/01-ops-scaling.md)).

**Connection pooling.** Direct Postgres connection is fine to ~100 active users on one instance. Add PgBouncer in transaction-pooling mode (with `?pgbouncer=true&connection_limit=1` per Prisma instance) when crossing two instances or >50 sustained connections per instance.

**Durable job queues.** The current `node-cron + in-process` pattern loses jobs on Railway redeploy mid-execution. **graphile-worker** (MIT, MIT, 5+ years) is the right Postgres-native upgrade: `LISTEN/NOTIFY` wakeup gives sub-100ms latency, cron is built-in, runs on the same Postgres. Adopt at Phase 13 of the larger 2026 roadmap.

**Backups.** Railway's bundled snapshots are plan-dependent and shallow. Production-grade = nightly `pg_dump -Fc -Z9` to off-Railway storage (Cloudflare R2 at $0.015/GB-mo, no egress) plus weekly automated restore drill. Migrate to Neon or Crunchy Bridge before paid public launch for true PITR.

**Observability.** Pino → OpenTelemetry → Axiom (free 0.5TB/mo) or Better Stack (free 1GB/mo) gives a vendor-portable stack at $0/month at current scale. **Configure redaction before turning observability on**, not after — Sentry's default capture leaks env vars and headers.

**LLM cost containment.** Three layers: per-tenant `LlmUsage(userId, model, inputTokens, outputTokens, costCents)` table; circuit breaker on token-spend velocity (5× hourly average for 5 min → degraded mode); Anthropic Message Batches API for cortex jobs (50% cost reduction for ≤24h-latency-tolerant work).

**Recommendation:** Sequence ops upgrades by user-count threshold:
- Phase 13 (≤500 users): graphile-worker + LlmUsage + Pino→Axiom + weekly pg_dump to R2.
- Phase 14 (~500-1k users): isolate cortex into separate Railway service + PgBouncer + Postgres-backed rate limiter (`rate-limiter-flexible`) + Cloudflare WAF in front.
- Phase 15 (~1-2k users): Anthropic Batches for cortex; per-tenant spend circuit breaker.
- Phase 16+: read replicas + horizontal scaling with sticky-session SSE.

---

## 7. Security

**RLS for multi-tenant Postgres.** Defense-in-depth: keep app-layer `WHERE userId = $1` as primary, add Row-Level Security as the backstop that catches the day a developer forgets. Use `SET LOCAL app.user_id` in a transaction set by middleware; policies include `AND deleted_at IS NULL` so soft-deleted rows are hidden by default ([wave1-research/02-security-best-practices.md §1](../../research/omnimind-roadmap-2026/wave1-research/02-security-best-practices.md)). The pgvector raw-SQL path in `src/retrieval/semantic-search.ts` is the highest-risk cross-tenant leak vector.

**Prompt injection.** No purely-input solution exists. Defenses are layered: spotlighting (delimited memory blocks + system prompt warning), regex-strip prompt-injection markers at write time, output filtering with a small classifier, privilege separation (CEO synthesis persona must not have destructive tools; memory-extractor must not have outbound HTTP), provenance tags (`source: 'user_typed' | 'document_upload' | 'extracted_from_email'`).

**PII in embeddings.** Embeddings *are* personal data under GDPR/CCPA when joined with `userId`. Morris et al. (2023) demonstrated 92% recovery of 32-token inputs from black-box embeddings. Redact SSNs, credit cards, phone numbers, emails before embedding. Soft-delete is **not GDPR-compliant** by itself — hard-delete cron must remove embeddings within 30 days.

**JWT rotation.** Single static `JWT_SECRET` is the "fix later" choice. Dual-secret rotation with `kid` header is a half-day refactor, mandatory before SOC 2 work.

**LLM tool use.** Anthropic's `tool_use` is trained, not guaranteed. Always re-validate `userId` ownership inside every tool handler — don't trust the agent runtime to have done it. Cap tool calls per user message (~10).

**Per-user cost ceilings.** Single most important pre-PMF control. Track input + output tokens × current price → reject when user exceeds plan budget. Anthropic billing API doesn't support per-user attribution; omnimind tracks it itself.

**Recommendation:** Per-user cost caps + JWT rotation + subscription-fail-open audit log before any paid customer (Phase 13). Prompt-injection scrub step in `validation/pipeline.ts` (Phase 5a). PII redaction before embed before any document-upload feature ships. RLS rollout as a new Phase 13b.

---

## 8. External interfaces

**MCP servers.** Spec is on revision `2025-06-18` with Streamable HTTP (replacing HTTP+SSE) + OAuth 2.1 with PKCE + RFC 8707 audience binding + Dynamic Client Registration as the production design ([wave1-research/04-external-interfaces.md §1](../../research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md)). DCR is make-or-break: without it, every user manually copies a `client_id` into Claude Desktop. With it, "paste a URL and authorize" works.

**Memory-as-MCP examples.** mem0-mcp, Letta MCP, Zep/Graphiti MCP all live in production. Common gap: tool-name conflicts (everyone exports `search_memory`). Opportunity, not solved problem.

**Markdown-as-data (Obsidian convention).** Frontmatter (YAML between `---`) for metadata, wikilinks (`[[Project Q2 Pricing]]`) for entity references, vault layout `memories/`, `decisions/`, `entities/{people,goals,projects,tasks}/` plus `.omnimind/` for app metadata. Lossless round-trip is a portability promise; embeddings excluded but their hash recorded.

**Webhooks / event bus.** Outbox pattern: write the event to a Postgres `outbox` table in the same transaction as the memory write; a worker drains to webhooks/bus. Event taxonomy: noun-verb past-tense (`memory.created`, `decision.synthesized`). Stripe is the gold standard for signed payloads + at-least-once + dead-letter + replay UI; Svix is the OSS+managed shortcut.

**Persona marketplace.** Borrow Claude Code Plugins shape: persona = directory with `prompt.system.md` + `manifest.json`, distribution = git URL (`omnimind persona install github:user/repo@v1.2`), sandbox = existing validation pipeline + manifest-declared tool restrictions, signed-manifest verification for "verified" personas.

**Recommendation:** Sequence external surfaces:
- Phase 10: MCP server (Streamable HTTP, OAuth 2.1 + DCR via WorkOS or Ory Hydra — do NOT roll your own OAuth provider). Tools: `search_memory`, `add_memory`, `list_decisions`, `invoke_persona`, `get_weekly_memo`. Submit to Anthropic Connector Directory.
- Phase 11: Markdown export to user-owned GitHub repo via OAuth. Conflict-folder pattern for re-import.
- Phase 12: TypeScript SDK (`@omnimind/sdk`) codegen from Zod-derived OpenAPI spec; resource-namespaced (`omnimind.memories.*`); header-based versioning.
- Phase 13 (new): Webhooks + outbox pattern. Unlocks Zapier/n8n/Make integrations.
- Phase 17: Persona marketplace via git-installable personas.

---

## Tying it together

Every recommendation above maps to a phase in `final-recommendation.md` (memory stack, Phases 0-9) or to the larger 2026 ops/security/data/interfaces roadmap (Phases 10-17). The non-negotiable sequencing:

1. **Phase 0.5 — eval harness**, before any retrieval change.
2. **Phase 0 / Phase 13 — observability** (log drain), before any new failure class ships.
3. **Phase 13 — per-user cost caps**, before any paid customer.
4. **Phase 5a — prompt-injection scrub + PII redaction**, before document-upload ships.

Everything else is iterative; these four are runway-extinction or product-extinction risks.
