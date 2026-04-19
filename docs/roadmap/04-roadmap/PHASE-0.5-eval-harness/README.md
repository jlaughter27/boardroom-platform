# Phase 0.5 — Retrieval Eval Harness

**Time budget:** 2 weeks
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** None — read-only test harness

---

## What this phase is

Build a lightweight, hand-labeled retrieval eval harness that produces MRR / nDCG@10 / P@5 against 35 hand-labeled queries (20 single-hop, 10 multi-entity, 5 temporal). Snapshot a baseline. Wire it into `scripts/pre-deploy-check.sh` as a non-regression gate.

This is structurally non-negotiable per the validator's plan: every later phase (HNSW, RRF, graph, LLM extraction, ranker boosts) needs a deterministic way to answer "did I just regress retrieval quality, or did I improve it?" Without the harness, every later phase ships on vibes.

Three deliverables:

1. **Labeled scenario set** — `eval/scenarios/retrieval-set.json` with 35 queries against Joshua's actual session history. Each query has an `expectedTopK` of 3-5 memory IDs that are correct answers in priority order.
2. **Runner** — `eval/runners/retrieval-eval.ts` that loads scenarios, calls the live OmniMind retrieval pipeline, computes MRR / nDCG@10 / P@5 (overall and per slice: single-hop, multi-entity, temporal).
3. **Gate** — `scripts/pre-deploy-check.sh` runs the harness; fails if any metric regresses by >3% vs the baseline snapshot at `eval/baselines/2026-04.json`.

A secondary lightweight persona-eval gate lives in the same harness — it runs 5 canned persona queries and asserts the response distribution looks sane (no persona returns identical text, no persona errors out). This catches gross persona regressions without becoming a heavyweight LLM-judge gate.

## Why now

Per `final-recommendation.md` §2 and §8: "build the eval first" is a structural precondition for everything downstream. The 2 weeks here pay back across the next 12 weeks of mem0 phases. Skipping it means every Phase 3-7 change becomes "I think this is better" rather than "MRR went from 0.61 to 0.68."

## Prereqs

- Phase 0 complete (clean baseline; log drain wired so eval runs are debuggable)
- Phase 0.25 complete (security/data fixes; otherwise the harness baseline is taken against a leaky system)
- Phase 0 task 0.5 produced 10 seed queries — this phase expands to 35

## Exit criteria

| Criterion | How to verify |
|---|---|
| 35 scenarios labeled and committed | `cat eval/scenarios/retrieval-set.json | jq 'length'` returns 35 |
| Slice distribution is 20/10/5 | `cat eval/scenarios/retrieval-set.json | jq 'group_by(.category) | map({k: .[0].category, n: length})'` returns the expected counts |
| Runner produces metrics | `npm run eval:retrieval` outputs MRR / nDCG@10 / P@5 overall + per slice |
| Baseline committed | `eval/baselines/2026-04.json` exists with the current metric values |
| Pre-deploy gate wired | `scripts/pre-deploy-check.sh` calls the runner; non-zero exit on >3% regression |
| Persona-eval lightweight gate | `eval/runners/persona-smoke.ts` runs 5 canned queries; asserts no errors and 7 distinct outputs |
| Harness runs in <5 min | Real time on local laptop |

## Dependencies

- **Downstream:** every subsequent phase (3, 4, 5a, 5b, 6, 7a) uses this gate as the proof-of-improvement. Without Phase 0.5, those phases land on intuition.

## Time budget detail

| Task | Hours |
|---|---|
| Expand seed queries from 10 to 35; label `expectedTopK` for each | 8 |
| Build runner with metric computation (MRR / nDCG@10 / P@5) | 6 |
| Wire pre-deploy gate with 3% regression threshold | 2 |
| Build persona-smoke runner (5 canned queries, distinctness check) | 3 |
| Capture baseline; document metric definitions in `eval/README.md` | 2 |
| Add CI-friendly JSON output mode for future GitHub Actions | 2 |
| **Total** | **~23 hours / 2 focused days × 7-day calendar = 2 weeks at solo-founder cadence** |

## Risks accepted

- **35 queries is small.** The validator explicitly chose 35 over 50+ as the right cost/value tradeoff for this stage. If a downstream phase needs to detect deltas <5%, the harness expands then.
- **Joshua is the sole labeler.** His judgment IS the ground truth for the foreseeable future. Document this clearly — when a second user joins eval, the harness needs disagreement reconciliation.
- **Eval ground truth drifts as the schema changes.** If Phase 1 introduces `memoryType`, the labels don't change but the retrieval mix might. Re-run the harness after every schema change in Phase 1; regenerate baseline if the change is intentional.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row "0.5"
- Why 35 not 50: same doc, defer trigger
- Persona eval already partially exists in `eval/runners/` (`personas-eval.ts`) — extend, don't rewrite
- Used as the gate for: PHASE-3, PHASE-4, PHASE-5a, PHASE-5b, PHASE-6, PHASE-7a

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
