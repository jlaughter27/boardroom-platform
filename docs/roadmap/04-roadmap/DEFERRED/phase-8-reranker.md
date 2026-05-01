# DEF-002 — Cross-Encoder Reranker (Phase 8)

**Capability:** A small cross-encoder model (e.g., `bge-reranker-base` or a Cohere/Voyage rerank API call) reranks the top-30 hybrid retrieval results down to the top-10 served to the persona. Cross-encoders score (query, document) pairs jointly, producing higher-quality ordering than independent embedding similarity.

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE (all three must be true):**
- Eval harness shows top-5 MRR < 0.6 sustained across the labeled query set
- Railway plan ≥ 4 GB RAM (cross-encoder hosting requires this even for the smallest viable models if self-hosted)
- 24-hour soak test passes on the rerank inference endpoint without OOM or latency regression

**Work estimate when triggered:** 3 weeks.

Breakdown:
- 0.5 week: choose self-hosted vs API. Self-hosted: `bge-reranker-base` via TGI or vLLM, ~500MB model, latency ~50-200ms per batch of 30. API: Cohere `rerank-english-v3.0` ($1/1k searches), Voyage `rerank-2`, both no-infra but cost-per-call. Decision drives the rest of the phase.
- 1 week: integrate. Add a new step in `retrieval/context-packager.ts` after the hybrid-retrieval merge: take top-30, batch-call the reranker, sort by rerank score, take top-10. Behind feature flag `RERANK_ENABLED`.
- 1 week: evals. Run the labeled query set with rerank on/off; measure MRR, NDCG@10, latency. Pass criteria: MRR lift ≥10% AND p95 retrieval latency increase ≤30%.
- 0.5 week: rollout + observability dashboards.

**Why deferred:**

Per the wave 1 research, hybrid retrieval (semantic + FTS + trigram with RRF — Phase 3) plus the entity boost (Phase 6) and recency boost (Phase 7a) cover most of the lift you'd otherwise get from a reranker, at zero added latency and zero added cost. Cross-encoders shine when the underlying retrieval is weak; they're a band-aid for poor first-stage retrieval. Better to invest in first-stage quality first.

If first-stage retrieval is genuinely the bottleneck (MRR < 0.6 on real workload), the reranker becomes worth its operational cost. Until then, it's premature optimization.

**References:**
- `docs/research/omnimind-roadmap-2026/wave1-research/` — research-validated deferral
- `packages/omnimind-api/src/retrieval/ranker.ts` and `context-packager.ts` — integration sites
- `eval/scenarios/` — where the MRR measurement lives

**Dependencies on other phases:**
- Phase 0.5 (eval harness) — must be live to measure MRR
- Phase 3 (HNSW + RRF) — must ship first; reranker reranks RRF output
- Phase 6 + 7a (existing boosts) — must be evaluated and tuned first
- Phase 14 (observability) — for latency dashboards

**Operational notes when triggered:**
- If self-hosted, the model lives on the cortex Railway service (Phase 16) since it's batched, not request-path
- If API, latency budget on the BoardRoom→OmniMind seam tightens; ensure the rerank call is parallel with other retrieval, not sequential
- Rerank failures should fall back to first-stage ordering, not error the request
