# Benchmarks and Evidence — What's Real, What's Vendor-Framed

**Sources:** Numbers cited across all five `docs/research/mem0-memory-architectures/stage1-research/` reports and the four `docs/research/omnimind-roadmap-2026/wave1-research/` reports. Where a claim has a primary source, it's linked. Where it doesn't, that's flagged.

This document exists because **every benchmark in the corpus is vendor-framed unless explicitly noted otherwise.** The research reports flag this themselves; this file consolidates the receipts so roadmap decisions don't get made on numbers that don't transfer.

---

## The honest table

| Claim | Source | Independent verification status |
|---|---|---|
| HNSW outperforms IVFFlat on insert-heavy workloads at the same recall target | pgvector docs, Supabase HNSW guide | **Replicated** by Supabase, Timescale, Neon engineering blogs. Algorithmic property — IVFFlat trains centroids once on initial data; insert drift is real. |
| pgvectorscale 28× lower p95 latency vs. pgvector HNSW at 99% recall on 50M-vector workloads | Timescale announcement | **Vendor-reported.** No independent replication paper. Directionally consistent with community reports. |
| Cohere `rerank-3.5` lifts nDCG@10 by 5-15% over hybrid retrieval | Cohere docs, BGE reranker ablations | **Replicated across BEIR/MTEB**, but on benchmarks that don't look like solo-founder decision history. Lift on omnimind's actual workload is unknown until measured. |
| Voyage `voyage-3-large` ~7-8 points MTEB retrieval lift over OpenAI `text-embedding-3-large` | Voyage blog | **Vendor-reported.** Not independently replicated. Anthropic's docs do recommend Voyage as the embedding partner, which is at least third-party validation of competence. |
| Mem0 "26% more accurate than OpenAI memory" on LOCOMO | mem0 paper, [arXiv:2504.19413](https://arxiv.org/abs/2504.19413) | **Vendor-framed on vendor-chosen terrain.** LOCOMO is well-suited to mem0's architecture (long dialogs where fact extraction + dedup shines). Comparison surface is OpenAI's closed memory product without published retrieval parameters. LLM-as-judge grading. **No third-party replication exists.** ([04-hybrid-retrieval.md §8](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)) |
| Zep/Graphiti "94.8% on Deep Memory Retrieval (DMR) vs. MemGPT's 93.4%" + ~90% latency reduction | Zep paper, [arXiv:2501.13956](https://arxiv.org/abs/2501.13956) | **Vendor-framed.** DMR is Zep's own benchmark. No independent replication. Direction (bi-temporal + graph > flat vector for temporal queries) is consistent with qualitative argument; magnitude is uncertain. ([02-graph-memory.md §1](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md)) |
| HippoRAG 1 ~20% improvement over vanilla RAG on multi-hop QA | HippoRAG paper, [arXiv:2405.14831](https://arxiv.org/abs/2405.14831) | **Replicated qualitatively** in the AI-research community, but **lift concentrates on multi-hop benchmarks (MuSiQue, 2WikiMultiHopQA, HotpotQA) constructed to require multi-hop reasoning.** Real agent workloads are 70-90% single-hop where graph expansion adds noise. ([02-graph-memory.md §7](../../research/mem0-memory-architectures/stage1-research/02-graph-memory.md)) |
| Microsoft GraphRAG indexing cost: $5-50 per million tokens at scale | Microsoft cost numbers + community engineering blogs | **Independently confirmed** via "we tried GraphRAG and went back to hybrid" post-mortems from Neo4j and LlamaIndex communities. Brittleness is real, especially with domain-specific jargon. ([04-hybrid-retrieval.md §3](../../research/mem0-memory-architectures/stage1-research/04-hybrid-retrieval.md)) |
| Cross-encoder rerank latency: 30-200ms on 50-100 candidates | Multiple sources (Cohere, BGE, mxbai, Jina docs) | **Replicated** across implementations. CPU vs. GPU varies by 3-5×. ONNX/INT8 quantization is the production default. |
| Bi-encoder vs. cross-encoder cost ratio | Folk knowledge + ablations in BGE/Cohere blogs | Bi-encoder: amortizes embedding cost across all queries. Cross-encoder: pays per (query, candidate) pair. **Replicated principle**, exact ratio depends on candidate count (50-100 candidates × cross-encoder ≈ 1 LLM call cost). |
| Embeddings can be partially inverted (Morris et al. 2023, "Text Embeddings Reveal (Almost) As Much As Text") — 92% recovery of 32-token inputs | [arXiv:2310.06816](https://arxiv.org/abs/2310.06816) | **Peer-reviewed** academic result. Implication: embeddings of PII are PII. Drives Phase 5a's PII redaction step. |
| Long-context Claude 1M recall degradation past ~500k tokens on multi-hop reasoning | [RULER benchmark](https://github.com/hsiehjackson/RULER) (independent), Anthropic's own needle-in-a-haystack | **Independently replicated.** "It's all in context" ≠ "it's all used." Justifies omnimind's 7-10 items per persona cap remaining the right design even with 1M context. ([05-agent-framework-patterns.md §12](../../research/mem0-memory-architectures/stage1-research/05-agent-framework-patterns.md)) |
| Relation extraction F1 on DocRED for GPT-4-class models: 0.55-0.70 | Published RE leaderboards on [paperswithcode.com](https://paperswithcode.com/sota/relation-extraction-on-docred) | **Replicated.** Noticeably worse than NER (0.85+ F1). Drives the 25-40% wrong-edge expectation for LLM-inferred relationships and the `confidence ≥ 0.7 → ACTIVE` gating in Phase 5a. |
| OpenAI `text-embedding-3-small` cost: $0.02/M tokens | [OpenAI new-embeddings announcement](https://openai.com/index/new-embedding-models-and-api-updates/) | **Verified pricing.** Stable since launch (Jan 2024). |
| Anthropic Message Batches API: 50% cost reduction for ≤24h-latency-tolerant work | [Anthropic batches docs](https://docs.anthropic.com/en/docs/build-with-claude/message-batches) | **Verified pricing.** Direct fit for cortex jobs (weekly memo, pattern detection, contradiction sweeps). |
| OpenTelemetry + Pino → Axiom (free 0.5TB/mo) or Better Stack (free 1GB/mo) | Vendor pricing pages | **Verified pricing**, prices subject to change. Vendor-portable via OTel standard. |

---

## Where the evidence is strongest

These are the conclusions where multiple independent sources converge:

- **HNSW > IVFFlat for insert-heavy workloads.** Algorithmic, not benchmark-dependent. Every modern pgvector deployment uses HNSW.
- **Hybrid (dense + sparse) > pure dense.** 5-15 nDCG points on BEIR, replicated across many years.
- **Cross-encoder rerank lifts top-K precision.** 5-15% nDCG@10 on BEIR, replicated. **Whether it lifts persona-answer quality on omnimind's workload** is the open question — Phase 0.5 eval harness must include a downstream persona-eval gate ([pragmatic-review.md §6](../../research/mem0-memory-architectures/stage4-review/pragmatic-review.md)).
- **RRF as default fusion.** Adopted by Elastic, OpenSearch, Weaviate, Qdrant, Vespa, Azure AI Search. Convergent industry practice.
- **mem0's ADD/UPDATE/DELETE write-loop is the genuinely novel idea.** Multiple research reports independently identify this as the engine, not the body, of mem0's value proposition.
- **MemGPT-style hierarchical tiers haven't been shown to beat well-tuned RAG+summary** on a realistic agent task. No public paper produces a clean head-to-head win.

## Where the evidence is weak

These are the conclusions where you should distrust the headline numbers and measure locally:

- **Mem0's 26% LoCoMo win** — vendor-framed, vendor-chosen benchmark, LLM-as-judge grading, no third-party replication. Direction (consolidation > append-only) is right; magnitude on omnimind's workload is unknown.
- **Zep/Graphiti's DMR win** — vendor-framed, vendor-chosen benchmark.
- **HippoRAG's lift** — concentrated on multi-hop-by-construction benchmarks. Most real agent workloads don't have 15%+ multi-hop queries.
- **Voyage embedding "lift"** — vendor-reported, no independent replication paper. Anthropic's recommendation is third-party validation of competence, not of the specific lift number.
- **GraphRAG quality wins** — real on global/thematic questions, brutal on cost. Single-fact retrieval is comparable to hybrid RAG at 10-100× cost ratio.
- **HyDE / multi-query / step-back** — partially superseded by modern embedders for personal-memory workloads where vocabulary overlap is high.

## Reranker latency cost — the receipt

Production-relevant numbers:

| Reranker | Params | Latency on 100 candidates (CPU INT8) | Cost (per 1k queries) |
|---|---|---|---|
| `BAAI/bge-reranker-v2-m3` | 568M | 50-150ms | self-hosted: $0 marginal |
| `BAAI/bge-reranker-v2-gemma` | 2.5B | 200-500ms | self-hosted: $0 marginal |
| Jina `jina-reranker-v2-base-multilingual` | 278M | 30-100ms | self-hosted: $0 marginal |
| Cohere `rerank-3.5` | n/a (hosted) | 100-200ms | ~$2/1k searches |
| Voyage `rerank-2.5` | n/a (hosted) | 100-200ms | ~$0.05/1k searches |
| `mixedbread-ai/mxbai-rerank-large-v2` | n/a | 80-200ms | self-hosted: $0 marginal |

**Memory footprint for self-hosted on Railway** (the number that makes Phase 8 a deferred capability):
- `bge-reranker-v2-m3` FP16: ~1.1GB resident
- `bge-reranker-v2-m3` INT8 ONNX: ~0.6GB resident + 200-400MB ONNX runtime working memory

Current Railway plan is 1GB. Reranker requires bump to ≥4GB. That's the prerequisite gate in Phase 8 of `final-recommendation.md`.

## Cross-encoder vs. bi-encoder cost ratio

- **Bi-encoder** (the embedding-based default): pay $0.02/M tokens at write time once; retrieval is free pgvector lookup.
- **Cross-encoder rerank**: pay 30-200ms CPU per query × 50-100 candidates. Self-hosted = no marginal API cost. Hosted (Cohere) ≈ $0.002 per query.

At 500 queries/user/month and 1000 users = 500k queries/month. Hosted Cohere rerank = $1,000/month. Self-hosted = Railway RAM bump (~$5-20/month flat) + the 120ms CPU time per query (free at idle, contended under load).

**Conclusion:** at omnimind scale, self-host. Hosted only makes sense above 10M queries/month where the Railway RAM cost amortizes worse than Cohere's per-query rate.

---

## Cost benchmarks — per-message, per-user, per-tenant

From `final-recommendation.md` §6 and `04-hybrid-retrieval.md` §9. Assumes Haiku 4.5 at ~$1/M input + $5/M output, OpenAI `text-embedding-3-small` at $0.02/M.

| Pipeline component | $/user/month @ 50 writes/mo | @ 1000 users |
|---|---|---|
| Embedding generation (existing) | $0.001 | $1 |
| Phase 5a entity extraction LLM (~20% trigger rate) | $0.42 | $420 |
| Phase 5a relationship inference (~200 pairs/user/mo) | $0.42 | $420 |
| Phase 5b consolidation LLM (boundary cases, ~5% trigger rate) | $0.08 | $80 |
| **Subtotal LLM pipeline** | **~$0.93** | **~$920/mo** |

At 1000 users on a $20/month tier, the pipeline is 4.6% of revenue — manageable. Hard caps (`$2/user/month`, `$50/day` global) prevent runaway. Above $1.50/100 messages, the per-user cap fires and writes degrade to pattern-only.

---

## What this means for the roadmap

Three rules that fall out:

1. **Don't trust vendor benchmarks; build the eval harness.** Phase 0.5 of `final-recommendation.md` is the structural precondition for every other capability claim. Without it, "RRF wins," "HNSW improves recall," "reranker lifts nDCG" are unfalsifiable on omnimind's actual workload.

2. **The strongest evidence supports the cheapest changes first.** HNSW (algorithmic), RRF (industry-convergent), bi-temporal-lite (additive migration), pattern-only entity extraction (deterministic), `MemoryWriteEvent` persistence (correctness fix). All of these compound and none require vendor benchmarks to justify.

3. **The expensive changes are gated on local measurement.** Reranker (Phase 8): trigger = eval shows top-5 MRR <0.6 AND Railway upgraded. Outcome-weighted ranker (Phase 7b): trigger = ≥200 decisions with populated outcomes AND `MemoryCitation` table exists. HyDE: trigger = a specific query class shows ≥10% MRR lift. **Without these triggers, we'd be shipping infrastructure complexity for unmeasured product wins** — exactly the failure mode the conservative debate position warned about ([position-conservative.md §6](../../research/mem0-memory-architectures/stage3-debate/position-conservative.md)).

The eval harness is not optional. It is the receipt that the rest of the roadmap is allowed to spend.
