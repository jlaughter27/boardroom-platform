# Phase 5b — LLM Consolidation Upgrade for Write-Loop

**Time budget:** 1 week
**Confidence:** MED
**Owner:** Solo dev
**Blast radius:** Low — only affects boundary cases the deterministic loop already flagged as PENDING_REVIEW

---

## What this phase is

Upgrades Phase 2's deterministic ADD/UPDATE/DELETE/NOOP write-decision loop with a Haiku 4.5 confidence check on UPDATE / NOOP boundary cases. Concretely:

- Phase 2 returns `{ action: 'PENDING_REVIEW', reason: 'boundary_case_trigram_0.72' }` for the gray zone.
- Phase 5b picks up those PENDING_REVIEW events asynchronously and asks Haiku to make the call.
- Haiku response Zod-validated against `MemoryConsolidationActionSchema` (created in Phase 1.B3): `{ action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP', targetMemoryId?, reason, confidence }`.
- Fallback-to-NOOP after 3 retries — if the model fails to produce a valid action, the write becomes a no-op (preserving both the new and old memory; user-side deduplication later if needed).
- Idempotent replay key `${memoryId}:${version}:${action}` (already established in Phase 1) — re-runs are safe.
- Runs on the embedding-queue worker, NOT blocking the write path.

Prompts in markdown: `docs/prompts/mem0-consolidation.system.md` (validator §4.4).

## Why now

Phase 2's deterministic loop covers the easy cases. The boundary cases sit as PENDING events forever — useful as a backlog metric but not actionable. Phase 5b makes them resolvable.

Per validator §2 row 5b: "Defer indefinitely if Phase 2 + cortex-contradictions surfaces fewer than 5 duplicate-memory pairs per user per month." Track this metric in Phase 2 testing; if it's below 5/user/month after Phase 2 has been live for 4+ weeks, skip 5b entirely.

## Prereqs

- Phase 2 (deterministic loop produces PENDING_REVIEW events)
- Phase 5a (`cost-tracker.ts`, prompt-loader pattern, sanitization helper — all reused)
- Phase 0.5 eval (gate)

## Exit criteria

| Criterion | How to verify |
|---|---|
| PENDING_REVIEW events get picked up by 5b worker | Force a PENDING_REVIEW event, run worker, confirm event transitions to APPLIED with action recorded |
| Haiku call uses `mem0-consolidation.system.md` prompt | `docs/prompts/mem0-consolidation.system.md` exists and is loaded; logs show prompt version |
| Output Zod-validated against `MemoryConsolidationActionSchema` | Test: malformed model output → fallback-to-NOOP after retries |
| Cost cap reused | Same `checkBudget` from Phase 5a; mocked over-cap user → consolidation skipped |
| Idempotent replay key | Re-running same key is no-op (already enforced in Phase 1's `replayKey @unique`) |
| Fallback-to-NOOP after 3 retries | Test asserts after 3 schema-failed responses, action becomes NOOP |
| Worker runs as-is (no new infrastructure) | No new cron, no new queue — drains via existing embedding-queue worker on each tick |
| Eval within 3% of baseline | `npm run eval:retrieval` shows no regression with flag ON |

## Dependencies

- **Upstream:** Phase 2, Phase 5a, Phase 0.5
- **Downstream:** Phase 6 (entity ranker) and Phase 7a (recency boost) are unblocked by this — both can ship in same calendar window

## Time budget detail

| Task | Hours |
|---|---|
| 5b.1 — Worker logic for PENDING_REVIEW events | 4 |
| 5b.2 — Haiku call with Zod-validated tool response | 4 |
| 5b.3 — `mem0-consolidation.system.md` prompt | 2 |
| 5b.4 — Retry + fallback-to-NOOP logic | 2 |
| 5b.5 — Cost-cap integration (reuse 5a) | 1 |
| 5b.6 — Tests (unit + integration + retry behavior) | 4 |
| 5b.7 — Eval + deploy + monitor | 2 |
| **Total** | **~19 hours / 1 week at solo cadence** |

## Risks accepted

- **LLM might produce wrong consolidation decisions.** Acceptable because the original memory is preserved (copy-on-write from Phase 2). User can manually reverse via the Phase 2 `rollback-mem0-supersession.sql` script.
- **Trigger metric:** if Phase 2's PENDING_REVIEW count is <5/user/month after 4 weeks, skip this phase. Validator's call.
- **Confidence in `MemoryConsolidationActionSchema` is bounded by training data.** Haiku 4.5 hasn't been specifically tuned for memory-consolidation decisions. Expect ~70-80% precision; refine via prompt iteration.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 5b, §4.4, §7 (rollback)
- Reuses: PHASE-5a (cost tracker, prompt loader, sanitizer)
- Used by: PHASE-6 (cleaner entity graph), PHASE-7a (cleaner ranker inputs)

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
