# Phase 7a — Recency / Access-Count Ranker Refinement

**Time budget:** 0.5 weeks (2-3 days, runs in parallel with Phase 6)
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** Low — additive ranker term behind a flag, no schema change

---

## What this phase is

Two small, additive ranker improvements:

1. **`MemoryEntry.lastAccessedAt`** — already exists in schema. Update async post-retrieval. When a memory is returned in a retrieval result and selected by the persona's context-packager, bump its `lastAccessedAt` to `now()` in a fire-and-forget call.

2. **`usage_signal = log(access_count + 1)`** — add a new term to the ranker. Memories accessed more often score slightly higher.

3. **Replace binary 7-day recency boost with exponential decay** — current ranker likely has `if (createdAt within 7 days) score += 0.1`. Replace with `recency_signal = exp(-Δdays / 30)`. Smooth, no cliff.

Both behind `RANKER_USAGE_SIGNAL_ENABLED=false` default. Eval harness validates.

## Why now

Per validator §2 row 7a: SHIP. Confidence HIGH. Trigger to defer: eval shows current binary recency boost wins (unlikely — exponential decay strictly subsumes).

Ships in same sprint as Phase 6 (per ROADMAP-OVERVIEW T+12.5w). Two small ranker changes are easier to A/B together than separately.

This phase **captures most of the value claimed for "outcome scoring"** (validator §2 row 7b deferred). Access-count is a proxy for "memories the user keeps coming back to" — a strong relevance signal.

## Prereqs

- Phase 0.5 eval (gate)
- `MemoryEntry.lastAccessedAt` and `accessCount` columns must exist (verify in Phase 1; add if missing)
- Phase 3 (ranker structure)

## Exit criteria

| Criterion | How to verify |
|---|---|
| `lastAccessedAt` updated post-retrieval | Run a retrieval call; immediately query the returned memories — `lastAccessedAt` is `now()` ± 5s |
| `accessCount` increments per retrieval | Same memory returned twice → `accessCount` increases by 2 |
| `usage_signal` term in ranker | Code reads from access_count and contributes to score |
| `recency_signal` uses `exp(-Δdays/30)` not binary | Verified in code; unit test asserts the math |
| Behind `RANKER_USAGE_SIGNAL_ENABLED=false` default | Confirmed in `.env.example` |
| A/B bucketed via Phase 6's helper (different bucket index) | 25% rollout independent of Phase 6's bucket |
| Eval improves OR neutral | `npm run eval:retrieval` shows no regression > 3% |
| Async update doesn't slow retrieval | Retrieval p95 latency unchanged |

## Dependencies

- **Upstream:** Phase 0.5, Phase 3
- **Parallel:** Phase 6 (ships in same calendar window)

## Time budget detail

| Task | Hours |
|---|---|
| 7a.1 — Verify / add `lastAccessedAt` + `accessCount` columns | 1 |
| 7a.2 — Async post-retrieval update | 2 |
| 7a.3 — `usage_signal` term in ranker | 2 |
| 7a.4 — Exponential recency replacement | 1 |
| 7a.5 — Tests | 3 |
| 7a.6 — Eval + flag flip + monitor | 2 |
| **Total** | **~11 hours / 2-3 days, parallel with Phase 6** |

## Risks accepted

- **Async update can fail silently.** Use the same `.catch(log)` pattern as embedding queue. Worst case: a memory's `lastAccessedAt` is stale by a few hours. Acceptable.
- **Hot memories dominate.** A memory accessed 1000 times has `log(1001) ≈ 6.9`; a fresh memory has `log(1) = 0`. The weight on `usage_signal` must be small enough not to overwhelm semantic relevance. Start at 0.05; tune via eval.
- **30-day decay constant is arbitrary.** Founder's gut: most memories lose relevance in a month. If eval shows a different constant wins, change it.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 7a, §7 (rollback)
- Outcome-loop deferral context: same doc §2 row 7b
- Reuses A/B helper from PHASE-6
- Used by: closes out the mem0 core ranker

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
