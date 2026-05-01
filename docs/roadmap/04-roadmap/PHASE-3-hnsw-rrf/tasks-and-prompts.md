# Phase 3 — Tasks and Prompts

Six atomic tasks; ~23 hours over 1.5 weeks calendar.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 3.1 | HNSW build CONCURRENTLY + drop IVFFlat | one-shot `psql` script `scripts/migrate-to-hnsw.sql` | EXPLAIN shows HNSW; old index gone | 4h |
| 3.2 | RRF implementation behind flag | `packages/omnimind-api/src/retrieval/ranker.ts`, `lib/env.ts` | `RANKER_MODE=rrf` flips to RRF; default unchanged | 6h |
| 3.3 | Eval both modes + document winner | `docs/eval-results/phase-3.md` (new) | Winner declared with metrics | 4h |
| 3.4 | Rollback scripts | `scripts/rollback-hnsw-to-ivfflat.sql` | Verified on staging | 2h |
| 3.5 | Tests | `tests/unit/retrieval/ranker.test.ts` | RRF math + both modes covered | 4h |
| 3.6 | Verify + deploy + measure latency | n/a | p95 latency reduction documented | 3h |

---

## Task 3.1 — HNSW build with CONCURRENTLY

**Prompt:**

> Per `docs/research/omnimind-roadmap-2026/wave1-research/03-data-architecture.md` §5, build an HNSW index alongside the existing IVFFlat, validate, then drop the old.
>
> **Step 1.** Verify pgvector version one more time: `psql -c "SELECT extversion FROM pg_extension WHERE extname='vector'"`. Must be ≥0.5.0. If not, STOP and resolve via Phase 0 task 0.3.
>
> **Step 2.** Verify backup is fresh: re-run `scripts/backup-prod-postgres.sh` from Phase 1 task 1.A2. The dump should be <24h old.
>
> **Step 3.** Verify Railway's Postgres has enough RAM headroom. HNSW index for 100k 1536-dim vectors will be ~1.5-2GB. Run `psql -c "SELECT pg_size_pretty(pg_relation_size('memory_entries'))"` for context. If the database tier is tight, upgrade Railway Postgres BEFORE the build (cheaper than a failed build).
>
> **Step 4.** During a low-traffic window (Sat 03:00 UTC suggested), connect to the production database and run:
>
> ```sql
> -- Boost work mem for the build session only
> SET maintenance_work_mem = '4GB';
>
> -- Build new index without blocking reads or writes
> CREATE INDEX CONCURRENTLY memory_entry_embedding_hnsw_idx
>   ON memory_entries
>   USING hnsw (embedding vector_cosine_ops)
>   WITH (m = 16, ef_construction = 64);
>
> -- Reset (will reset on disconnect anyway)
> RESET maintenance_work_mem;
> ```
>
> Watch the build. Per research §5: ~8-15 minutes for ~100k rows. Monitor Railway dashboard for CPU and disk usage spikes.
>
> **Step 5.** Validate the new index is being used:
>
> ```sql
> EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM memory_entries
>   WHERE deleted_at IS NULL
>   ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector  -- use a real query embedding
>   LIMIT 10;
> ```
>
> The plan output MUST contain `Index Scan using memory_entry_embedding_hnsw_idx`. If it falls back to a sequential scan, something is wrong — STOP, do not drop the IVFFlat.
>
> **Step 6.** Compare top-10 recall against IVFFlat. Run 100 sample queries against both indexes (force IVFFlat with `SET LOCAL enable_indexscan = off; SET LOCAL enable_seqscan = on;` or by building a temporary script that hints the planner). Verify ≥95% overlap in top-10 results between the two. If recall drops noticeably, raise `hnsw.ef_search` from default 40 to 100.
>
> **Step 7.** Drop the old index:
>
> ```sql
> DROP INDEX CONCURRENTLY IF EXISTS memory_entries_embedding_idx;  -- or whatever the IVFFlat index is named
> ```
>
> Save the full sequence as `scripts/migrate-to-hnsw.sql` for repeatability.

---

## Task 3.2 — RRF implementation behind flag

**Prompt:**

> Reciprocal Rank Fusion (RRF) is an alternative to weighted score combination. Formula: `RRF_score(d) = sum over rankers r of 1 / (k + rank_r(d))` where `k = 60` is the standard constant.
>
> **Step 1.** Add to `packages/omnimind-api/src/lib/env.ts`:
>
> ```ts
> RANKER_MODE: z.enum(['weighted', 'rrf']).default('weighted'),
> ```
>
> Document in `.env.example` and `docs/DEPLOYMENT-RUNBOOK.md`.
>
> **Step 2.** Open `packages/omnimind-api/src/retrieval/ranker.ts`. The current code does weighted fusion: `score = w1*semantic + w2*fts + w3*trigram + w4*recency`. Refactor:
>
> ```ts
> import { env } from '../lib/env';
>
> type Candidate = { id: string; semanticRank: number; ftsRank: number; trigramRank: number; recency: number };
>
> function weightedScore(c: Candidate): number {
>   return env.WEIGHT_SEMANTIC * (1 / c.semanticRank)
>        + env.WEIGHT_FTS * (1 / c.ftsRank)
>        + env.WEIGHT_TRIGRAM * (1 / c.trigramRank)
>        + env.WEIGHT_RECENCY * c.recency;
> }
>
> function rrfScore(c: Candidate): number {
>   const k = 60;
>   return 1 / (k + c.semanticRank)
>        + 1 / (k + c.ftsRank)
>        + 1 / (k + c.trigramRank);
>   // Note: RRF intentionally ignores recency — pure rank fusion across the 3 retrievers
> }
>
> export function rankCandidates(candidates: Candidate[]): Candidate[] {
>   const scoreFn = env.RANKER_MODE === 'rrf' ? rrfScore : weightedScore;
>   return [...candidates].sort((a, b) => scoreFn(b) - scoreFn(a));
> }
> ```
>
> **Step 3.** Add unit tests in `packages/omnimind-api/tests/unit/retrieval/ranker.test.ts`:
>
> - Both modes return arrays of the same length as input
> - Weighted mode: a candidate with rank 1 in all 3 retrievers ranks higher than one with rank 5 in all 3
> - RRF mode: same property
> - RRF math: known input → expected score (sanity check the formula)
> - Mode switches based on env var
>
> Run `npm run test -w packages/omnimind-api`. All green.

---

## Task 3.3 — Eval both modes and document winner

**Prompt:**

> Run the Phase 0.5 eval harness twice — once per mode.
>
> ```bash
> RANKER_MODE=weighted npm run eval:retrieval -- --json > /tmp/eval-weighted.json
> RANKER_MODE=rrf npm run eval:retrieval -- --json > /tmp/eval-rrf.json
> ```
>
> Run each 3 times to smooth out noise (the underlying retrieval is deterministic but cold-cache effects exist; average the 3 runs).
>
> Create `docs/eval-results/phase-3.md`:
>
> ```md
> # Phase 3 Eval Results — RRF vs Weighted
>
> Captured: 2026-04-XX
> Commit: <git rev-parse HEAD>
> Scenarios: 35 (20 single-hop, 10 multi-entity, 5 temporal)
>
> ## Overall metrics
>
> | Metric | Weighted (default) | RRF | Delta |
> |---|---|---|---|
> | MRR | 0.XX | 0.XX | +X.X% |
> | nDCG@10 | 0.XX | 0.XX | +X.X% |
> | P@5 | 0.XX | 0.XX | +X.X% |
>
> ## Per-slice metrics
>
> [tables per category]
>
> ## Decision
>
> Weighted wins by X% on overall MRR / RRF wins by X% on multi-entity slice / etc.
>
> Default ranker mode set to `<weighted|rrf>`.
>
> ## Notes
>
> [observations: which slice each mode is better at, any surprises]
> ```
>
> **Decision rule (per validator §2 row 3):**
>
> - If weighted wins by >3% on overall MRR → keep `weighted` as default; ship RRF as off-by-default option for future use
> - If RRF wins by >3% on overall MRR → flip default to `rrf`; document in ADR-014
> - If within 3% → keep `weighted` as default (no reason to switch)

---

## Task 3.4 — Rollback scripts

**Prompt:**

> If HNSW turns out to have a problem in production (unexpected recall drop, query plan regression on edge cases), we need to revert to IVFFlat fast.
>
> Create `scripts/rollback-hnsw-to-ivfflat.sql`:
>
> ```sql
> -- Rollback HNSW to IVFFlat
> -- Estimated time: ~5 minutes at 100k rows
> SET maintenance_work_mem = '4GB';
>
> -- Rebuild IVFFlat
> CREATE INDEX CONCURRENTLY memory_entries_embedding_idx
>   ON memory_entries
>   USING ivfflat (embedding vector_cosine_ops)
>   WITH (lists = 100);
>
> -- Drop HNSW
> DROP INDEX CONCURRENTLY IF EXISTS memory_entry_embedding_hnsw_idx;
>
> RESET maintenance_work_mem;
> ```
>
> Test on staging. Run `EXPLAIN ANALYZE` to confirm IVFFlat is back. Then HNSW-restore via task 3.1's script.
>
> Document in `docs/runbooks/rollback-hnsw.md`.
>
> For RRF rollback: just set `RANKER_MODE=weighted` in Railway env and restart. ~2 minutes.

---

## Task 3.5 — Tests

**Prompt:**

> Add comprehensive tests in `packages/omnimind-api/tests/unit/retrieval/ranker.test.ts`. (Already partially built in task 3.2; expand here.)
>
> Coverage:
>
> 1. **RRF math** — known small input (5 candidates with known ranks across 3 retrievers), assert exact RRF scores. Verifies the `1 / (k + rank)` formula.
> 2. **Weighted math** — same input, assert weighted scores match the configured weights.
> 3. **Mode switching** — set `process.env.RANKER_MODE = 'rrf'`, call `rankCandidates`, assert RRF formula wins; switch to `weighted`, assert weighted wins.
> 4. **Stability** — same input twice in same mode produces identical output.
> 5. **Large input** — 1000 candidates, both modes complete in <100ms.
> 6. **Single retriever** — if only semantic results (FTS and trigram empty), both modes return semantic-rank order.
>
> Add integration test in `tests/integration/retrieval-modes.test.ts` that hits the full retrieval pipeline (semantic + FTS + trigram + ranker) against seeded test data, in both modes, asserts non-empty results.

---

## Task 3.6 — Verify + deploy + measure latency

**Prompt:**

> 1. Take a baseline measurement BEFORE HNSW deploys: log 100 sample retrieval queries from the `eval/scenarios/retrieval-set.json` against the current IVFFlat-backed index. Capture wall-clock time per query. Compute p50, p95, p99.
> 2. Deploy task 3.1 (HNSW build + drop IVFFlat) during the low-traffic window.
> 3. Run the same 100 queries against HNSW. Capture latencies. Compare.
>
> Add to `docs/eval-results/phase-3.md` a "Latency comparison" section:
>
> ```md
> ## Latency comparison (100 sample queries)
>
> | Percentile | IVFFlat | HNSW | Delta |
> |---|---|---|---|
> | p50 | XXms | XXms | -XX% |
> | p95 | XXms | XXms | -XX% |
> | p99 | XXms | XXms | -XX% |
> ```
>
> Expect 30-60% reduction at p95 per research §5.
>
> 4. Run `npm run eval:retrieval` against production with HNSW. Confirm metrics within 3% of pre-HNSW baseline (HNSW should not change MRR significantly — same neighbors, faster lookup).
>
> 5. Deploy task 3.2 (RRF behind flag) any time after HNSW is stable. Default flag stays `weighted`.
>
> 6. Run task 3.3 to determine the winner, deploy the chosen default.
>
> Commit message:
>
> ```
> feat(phase-3): HNSW migration + RRF fusion experiment
>
> - Replace IVFFlat with HNSW (m=16, ef_construction=64) on memory_entries.embedding
> - p95 query latency reduced from XXms to XXms (-XX%)
> - RRF fusion implemented behind RANKER_MODE flag (default: <winner>)
> - Eval results in docs/eval-results/phase-3.md
> ```
