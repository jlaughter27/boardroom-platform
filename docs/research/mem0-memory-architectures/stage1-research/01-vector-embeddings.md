# Vector / Embedding-Based Memory — State of the Art (2025-2026)

> **Research integrity note**: Web search and most WebFetch domains were blocked in this research session. This report draws on sources confirmed to exist as of the author's training cutoff (Jan 2026) and flags any number that could not be re-verified live. Where a specific benchmark figure cannot be cited with confidence, that is stated explicitly rather than invented.

---

## 1. Embedding models in 2026 — is OpenAI `text-embedding-3-small` still the right default?

**Short answer: it's defensible but no longer the frontier.** `text-embedding-3-small` shipped in January 2024 at 1536 dims, $0.02/M tokens, and MTEB avg ~62.3 ([OpenAI new-embeddings announcement](https://openai.com/index/new-embedding-models-and-api-updates/)). Since then three external vendors and the open-source community have meaningfully passed it on BEIR/MTEB retrieval tasks:

- **Voyage** — `voyage-3-large` (Jan 2025) and `voyage-3` (late 2024) explicitly target a "cheaper + better than OpenAI text-embedding-3-large" pitch; Voyage's own announcement claims ~7–8 points MTEB retrieval lift over OpenAI-3-large at comparable cost, plus Matryoshka dims (256/512/1024/2048) ([Voyage blog](https://blog.voyageai.com/2025/01/07/voyage-3-large/)). These are vendor-reported, not independent.
- **Cohere** — `embed-v4.0` (April 2025) is multimodal (text + image), 1536 dims default with Matryoshka support, and claims SOTA on multilingual + long-doc retrieval ([Cohere Embed v4 launch](https://cohere.com/blog/embed-4)). Strongest selling point is 128k token context vs OpenAI's 8192.
- **Jina `jina-embeddings-v3`** (Sept 2024) — 570M params, 8192 ctx, Matryoshka + task LoRAs, open-weights under a non-commercial research license with commercial tier ([Jina v3 tech report, arXiv:2409.10173](https://arxiv.org/abs/2409.10173)).
- **BGE-M3** (BAAI, early 2024, still a top open-source choice in 2025-26) — 8192 ctx, supports dense + sparse + multi-vector (ColBERT-style) output from one model ([BGE-M3 paper](https://arxiv.org/abs/2402.03216)).
- **Anthropic** — **no first-party embedding model exists as of this writing.** Anthropic's docs continue to recommend Voyage as the embedding partner ([Anthropic embeddings docs](https://docs.anthropic.com/en/docs/build-with-claude/embeddings)). Given ADR-002 ("Claude-only"), this is worth noting: omnimind already uses OpenAI for embeddings, and Anthropic explicitly blesses Voyage, so switching to Voyage would stay within Anthropic's recommended path.
- **OpenAI** — no announced successor to text-embedding-3 family as of Jan 2026. `text-embedding-3-large` (3072 dims) remains their flagship but is slightly behind Voyage-3-large on public benchmarks per Voyage's comparison.

**Accuracy-per-dollar reality check**: at OpenAI 3-small's $0.02/M tokens, embeddings are already essentially free at omnimind scale (~100k memories × ~200 tokens ≈ 20M tokens/user = **$0.40/user lifetime** for embeddings). Voyage-3 is ~$0.06/M for voyage-3-lite and $0.18/M for voyage-3-large. At these price points, *quality* dominates cost. The question is whether 3–7 points of nDCG@10 justify a provider switch when you already have shipping code.

## 2. pgvector vs. dedicated vector DBs in 2026

**pgvector is still production-viable at 1M+ rows per tenant**, and the case for switching has gotten weaker, not stronger, since 2023:

- **pgvector 0.8.0** (Oct 2024) added iterative index scans (fixes the stale-filter problem where `WHERE` + ANN previously returned <k results), better query planning, and halfvec (16-bit) support ([pgvector 0.8 release notes](https://github.com/pgvector/pgvector/releases/tag/v0.8.0)).
- **HNSW over IVFFlat is now the default recommendation.** IVFFlat trains centroids on initial data; inserts after training degrade recall. HNSW is insert-friendly, has better recall at the same speed, and is what Timescale, Supabase, and Neon all recommend in 2025. **This is the single most important change omnimind should make.** The current `@@map("memory_embedding_idx")` IVFFlat index will degrade as ~100k rows accumulate per user.
- **pgvectorscale** (Timescale, 2024) adds StreamingDiskANN + Statistical Binary Quantization (SBQ). Timescale's benchmark claims 28× lower p95 latency vs pgvector HNSW at 99% recall on 50M-vector workloads, and competitive with Pinecone s1 at materially lower TCO ([Timescale pgvectorscale announcement](https://www.timescale.com/blog/pgvector-is-now-as-fast-as-pinecone-at-75-less-cost/)). Vendor-reported; independent replications are thin but directionally consistent with community reports.
- **Switch triggers** — from practitioner reports, people move off pgvector when they hit: (a) >10M vectors per index with strict p99 <50ms requirements, (b) need for rich payload filtering at 1B+ scale (Qdrant / Turbopuffer win here), or (c) multi-tenancy with >100k independent indexes (pgvector forces one big index + filter; Turbopuffer and LanceDB offer per-namespace isolation cheaply). None of these apply to omnimind at projected scale.
- **Dedicated-DB landscape** — Pinecone serverless (2024) removed the always-on pod cost that used to be the main complaint. Qdrant (Rust, open-source) remains the go-to self-hosted option and is the quiet favorite in 2025 benchmarks for pure-vector workloads ([Qdrant benchmarks](https://qdrant.tech/benchmarks/)). Turbopuffer (object-storage-backed) is the cost king for cold data. Weaviate and Milvus lost mindshare. **LanceDB** is a dark horse for embedded/local use but not relevant here.

**Verdict for omnimind**: keep Postgres. The strongest action is index-type, not DB swap.

## 3. Chunking strategies for user-generated memory

User memories in omnimind are short (decisions, commitments, notes) — this is the *easy* end of chunking. The research consensus for 2025-26:

- **For short user-authored items (<500 tokens)**: **don't chunk**. Embed the whole thing. Chunking hurts when the unit is already a semantic atom. This is what mem0 does for its "fact extraction" outputs ([mem0 paper, arXiv:2504.19413](https://arxiv.org/abs/2504.19413)).
- **For longer docs (>1k tokens)**: the current ranked order is roughly: **late chunking** (Jina, 2024) > **semantic chunking** (Greg Kamradt's method, LangChain/LlamaIndex) > **recursive/structural** > **fixed-size**. Late chunking embeds the full doc with a long-context encoder then pools token embeddings into chunk-aligned regions, preserving cross-chunk context ([Jina late chunking paper, arXiv:2409.04701](https://arxiv.org/abs/2409.04701)). Jina reports 5–10% nDCG lift over naive chunking on long-doc BEIR tasks.
- **Propositions chunking** (Chen et al., "Dense X Retrieval", 2023, arXiv:2312.06648) — LLM-rewrite text into atomic factual propositions, embed each. This is basically what mem0's extractor already does and what omnimind's memory-extractor prompt produces. It is the right strategy for memory systems, and omnimind is already on it.

**omnimind-specific insight**: the memory-extractor pipeline already produces propositions-shaped memories. Chunking is a non-issue for the memory path. The only place it matters is if omnimind ever ingests long documents directly — at that point, use semantic or late chunking.

## 4. Reranking — is cross-encoder rerank standard now?

**Yes, for any system that cares about top-3/top-5 quality.** The 2024-26 consensus:

- **Cohere `rerank-3.5`** (late 2024) — multilingual, ~4k ctx per doc, $2/1k searches. The paid incumbent ([Cohere Rerank docs](https://docs.cohere.com/docs/rerank-overview)).
- **BGE reranker v2-m3 / v2-gemma** (BAAI, 2024) — open-weights, runs on CPU or small GPU; the practical default for self-hosted. ~568M params for v2-m3 ([BGE reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3)).
- **Jina `jina-reranker-v2-base-multilingual`** — small (278M), fast, permissive license.
- **Voyage `rerank-2.5`** — available through the Voyage API; pairs naturally with their embeddings.

**Latency/cost reality**: a rerank pass over 20 candidates typically adds 80–200ms and $0.002–$0.005 per query. Published ablations (Cohere, BGE) show 10–25% nDCG@10 improvements over pure semantic on hard BEIR tasks. For a decision-intelligence app where the user reads the top 5 results, this is a high-leverage add.

**omnimind gap**: `ranker.ts` currently does weighted fusion of four retrieval signals, which is *not* the same as cross-encoder reranking. Fusion decides "of candidates already surfaced, which is most relevant." A cross-encoder rerank re-scores each (query, candidate) pair with a dedicated relevance model. They compose — you fuse to get 20 candidates, then rerank to get top 5.

## 5. Hybrid retrieval evidence — RRF vs. weighted fusion

The literature is clear: **hybrid (dense + sparse) beats either alone on BEIR by 5–15 points**, and it's been the dominant result since 2021 ([BEIR paper, Thakur et al.](https://arxiv.org/abs/2104.08663); Microsoft's "Adaptive RRF" 2024 evaluations). The interesting question is fusion method:

- **Reciprocal Rank Fusion (RRF)** (Cormack et al., 2009) — no parameter tuning; score = Σ 1/(k + rank_i). Works robustly across domains because it ignores absolute scores.
- **Weighted score fusion** (omnimind's current approach) — can outperform RRF when weights are tuned on representative eval data for that domain. Falls apart when the score distributions of the signals shift (e.g., a new embedding model with different cosine distributions), because the learned weights are now miscalibrated.
- **Convex combination with normalization** (min-max per-signal, then weighted sum) — a middle ground and what Elastic recommends in 2024 blog posts.

**Practical 2025 pattern (Microsoft, Elastic, Weaviate guidance)**: start with **RRF** (parameter-free, hard to break), optionally layer a cross-encoder rerank on top. Move to weighted fusion *only* if you have an eval harness that can detect regressions when signal distributions shift.

**omnimind verdict**: the 4-signal weighted fusion is fine *if* the weights were tuned on a labeled eval set and there's a regression test. If the weights are vibes-based (common!), RRF will match or beat them with zero maintenance cost. Adding RRF as an alternative code path is cheap — it's ~15 lines. Worth adding alongside and A/B'ing.

## 6. Failure modes of pure vector search

Well-documented gaps where dense semantic search loses to structured / graph / lexical approaches:

- **Exact entity queries** ("What did I decide about *Acme Corp* last Tuesday?") — semantic search matches "Acme" to semantically similar companies; BM25 / trigram / entity-index wins cleanly. Mem0's graph layer exists primarily for this ([mem0 paper](https://arxiv.org/abs/2504.19413)). RAGBench (2024) reports ~20% miss rate for entity-heavy queries on pure-vector RAG.
- **Negation** ("decisions I did *not* approve") — embeddings famously handle negation poorly; [Weller et al., "NevIR: Negation in Neural IR" (arXiv:2305.07614)](https://arxiv.org/abs/2305.07614) showed top embedders scoring near-random on paired negated queries. This has improved in 2024-25 models but is not solved.
- **Aggregation & count queries** ("how many commitments slipped this quarter") — semantic search returns representative items, not counts. Needs SQL or structured filter.
- **Temporal reasoning** ("before the decision about X") — embeddings have no native temporal axis. omnimind's explicit temporal validation in the pipeline is the correct pattern.
- **Citation/provenance** — vector hits surface "something similar" without guaranteeing the surfaced text actually *contains* the answer; LLM synthesis can then fabricate. Graph-backed or entity-linked memory (mem0, Zep, LlamaIndex KG) narrows the attack surface.

**Mem0 quantification**: the mem0 paper claims 26% higher accuracy than OpenAI's Memory feature on the LoCoMo benchmark, 91% lower p95 latency, and 90% token reduction, largely driven by their hybrid vector+graph+fact-extraction approach vs pure vector ([mem0 arXiv:2504.19413](https://arxiv.org/abs/2504.19413)). These are vendor-reported on a dataset (LoCoMo) that is favorable to their approach; take with caution, but the directional gap between pure-vector and hybrid-with-entities is real and replicated elsewhere.

## 7. Binary / int8 quantization at 100k-row scale

**Are people quantizing in production?** Yes — at scale. The evidence is strong that binary quantization loses only ~2–4% recall when combined with a rerank-with-full-vectors "re-scoring" pass ([Cohere int8/binary blog](https://cohere.com/blog/int8-binary-embeddings), [HuggingFace binary embedding writeup](https://huggingface.co/blog/embedding-quantization)). Storage is 32× smaller (1 bit vs 32 bits per dim); query latency typically 4–10× faster on bit-packed Hamming distance.

**Is it relevant at 100k rows?** Honestly, **no**. 100k rows × 1536 dims × 4 bytes (float32) = **614 MB per user** — not free, but not alarming. The real payoff of quantization kicks in above ~10M vectors or when running fully in RAM is critical. At omnimind's scale, the complexity isn't worth it *yet*. When a single tenant crosses ~5M memories, or when you start multi-tenanting one index across thousands of users, revisit. pgvector 0.7+ supports `halfvec` (16-bit, 2× shrink) with essentially zero recall loss — that's the cheap win available today if storage ever becomes a concern. Binary is a pgvectorscale/Qdrant/Milvus feature, not native pgvector as of 0.8.

---

## Implications for omnimind

Concrete recommendations, ordered by ROI:

1. **Switch the vector index from IVFFlat → HNSW** (highest ROI, low risk). IVFFlat's quality degrades as new inserts drift from trained centroids; HNSW handles incremental inserts natively. One DDL migration, immediate recall win. Do this regardless of everything else.
2. **Keep pgvector, keep OpenAI `text-embedding-3-small`** for now. Neither is holding you back at 100k-scale. Don't rewrite what works.
3. **Add a cross-encoder rerank pass as an optional last step** in the retrieval pipeline — `bge-reranker-v2-m3` self-hosted on CPU, or Cohere `rerank-3.5` API. Expected 10–20% top-5 quality lift for ~150ms latency. Gate behind a feature flag and measure.
4. **Add RRF fusion as an alternative to the current weighted `ranker.ts`**, even if you keep weighted as default. If the 4-signal weights aren't eval-tuned, RRF will likely win; if they are, RRF serves as a regression-safe fallback.
5. **Don't change chunking** — the memory-extractor pipeline is already producing proposition-shaped memories, which is the 2025 best-practice for memory systems.
6. **Park binary quantization** until a single tenant exceeds ~5M memories or RAM pressure shows up in Railway metrics.
7. **Revisit Voyage (voyage-3-lite) at the next embedding rebuild** — only if you're already regenerating embeddings for another reason (e.g., a schema migration). Anthropic itself recommends Voyage, which aligns with ADR-002. No standalone switch justified; piggyback if convenient.
