# Phase 3 — HNSW Migration + RRF Fusion Experiment

**Time budget:** 1.5 weeks
**Confidence:** HIGH (HNSW); MED-HIGH (RRF A/B)
**Owner:** Solo dev
**Blast radius:** Low for HNSW (CONCURRENTLY, fully reversible); low for RRF (env-flag gated)

---

## What this phase is

Two concurrent improvements to the retrieval engine:

1. **HNSW migration** — replace the existing IVFFlat index on `MemoryEntry.embedding` with HNSW. Build with `CREATE INDEX CONCURRENTLY` (no downtime); validate query plans use it; drop the old IVFFlat after. Per data-architecture research §5: at omnimind's ~100k vectors, HNSW gives 30-60% query latency reduction.

2. **RRF fusion experiment** — implement Reciprocal Rank Fusion as an alternative to the current weighted score combination in `retrieval/ranker.ts`. Ship behind `RANKER_MODE=rrf|weighted` with default `weighted`. Run both modes against the eval harness. Document which wins in `docs/eval-results/phase-3.md`. If weighted wins by >3%, RRF stays as off-by-default option.

## Why now

HNSW has been on the table since Phase 0 as a "should ship eventually" item. Now is the right time because:

- pgvector version verified ≥0.5.0 in Phase 0 (`CREATE INDEX CONCURRENTLY` works)
- Backup + restore drill verified in Phase 1 (rollback floor exists)
- Eval harness in Phase 0.5 lets us measure the lift

RRF is a small experiment riding alongside HNSW because both touch retrieval and both want the eval gate.

## Prereqs

- Phase 0 (pgvector version verified)
- Phase 0.5 (eval harness)
- Phase 1 (backup + restore drill, schema stable)
- Phase 2 NOT required — HNSW is on the embedding column which Phase 2 doesn't change

## Exit criteria

| Criterion | How to verify |
|---|---|
| HNSW index exists on `memory_entries.embedding` | `psql -c "\d memory_entries"` shows `memory_entry_embedding_hnsw_idx` |
| Old IVFFlat index dropped | Same `\d` output shows no IVFFlat index |
| Query plans use HNSW | `EXPLAIN ANALYZE SELECT id FROM memory_entries ORDER BY embedding <=> '[...]'::vector LIMIT 10` shows `Index Scan using memory_entry_embedding_hnsw_idx` |
| p95 query latency drops | Manual measurement before/after via 100 sample queries; expect 30-60% reduction |
| RRF implementation behind flag | `RANKER_MODE=rrf` switches to RRF; default `weighted` stays as today |
| Both modes pass eval | `npm run eval:retrieval` succeeds in both modes; results saved to `docs/eval-results/phase-3.md` |
| Winner documented and shipped | `docs/eval-results/phase-3.md` declares the winner with metrics; default flag matches the winner |
| 708+ tests still green | `npm run test` exit 0 |
| Rollback script verified | `scripts/rollback-hnsw-to-ivfflat.sql` tested on staging |

## Dependencies

- **Upstream:** Phase 0 (pgvector ≥0.5.0), Phase 1 (backup), Phase 0.5 (eval)
- **Downstream:** Phase 6 (entity ranker) extends `ranker.ts`; better to land RRF first so the entity boost can be A/B'd against both modes

## Time budget detail

| Task | Hours |
|---|---|
| 3.1 — HNSW build + validate query plan + drop IVFFlat | 4 |
| 3.2 — RRF implementation in `ranker.ts` behind flag | 6 |
| 3.3 — Eval runs in both modes; document winner | 4 |
| 3.4 — Rollback scripts (HNSW → IVFFlat; flag flip) | 2 |
| 3.5 — Tests (RRF math, both ranker modes) | 4 |
| 3.6 — Verify + deploy + measure latency | 3 |
| **Total** | **~23 hours / 1.5 weeks at solo cadence** |

## Risks accepted

- **HNSW build burns CPU.** ~8-15 minutes per data-architecture research §5 estimate. CONCURRENTLY means no read/write blocking, but query latency can spike. Schedule for a low-traffic window (Sat 03:00 UTC).
- **HNSW index is larger.** ~1.5-2GB vs ~600MB for IVFFlat at 100k vectors. Railway plan has headroom; verify before kicking off.
- **`maintenance_work_mem` must be ≥ index size or build fails.** Set to 4GB+ during build. Reset after.
- **RRF without weighted fallback could change retrieval behavior subtly.** That's why the flag default stays `weighted` until eval explicitly proves RRF wins.
- **HNSW `ef_search` tuning is per-query.** Default 40 is fine for now. If recall is too low, raise to 100 (~2x latency tradeoff).

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 3, §7 (rollback)
- Data-architecture research: `docs/research/omnimind-roadmap-2026/wave1-research/03-data-architecture.md` §5 (HNSW migration SOP)
- Risk register: `06-risks-and-mitigations/RISK-REGISTER.md` (HNSW build window)
- Used by: PHASE-6 (ranker extension), PHASE-7a (further ranker tuning)

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
