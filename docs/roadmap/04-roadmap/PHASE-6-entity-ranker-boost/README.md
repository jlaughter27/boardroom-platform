# Phase 6 — Entity-Aware Ranker Boost

**Time budget:** 0.5 weeks (2-3 days)
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** Low — additive ranker term behind a flag, A/B'd

---

## What this phase is

Add a 5th signal to `retrieval/ranker.ts`: if a retrieved memory links to an `ExtractedEntity` whose `canonicalName` matches the query (trigram similarity ≥ 0.6), add `+0.15` boost. Only reads `EntityRelationship.confidence ≥ 0.7` (status `ACTIVE`).

Behind `RANKER_ENTITY_BOOST_ENABLED=false` default. Eval harness must show ≥3% lift on multi-entity slice OR no regression overall.

A/B testing pattern (per validator §7): bucket by `userId.hashCode() % 4 === 0` (deterministic per-user, NOT per-request — avoids mid-session inconsistency). Roll forward only if eval + sampled-user feedback both green.

## Why now

This is where entity extraction (Phase 2 + Phase 5a) actually pays off in retrieval quality. The graph traversal (Phase 4) and confidence-scored relationships (Phase 5a) are inputs; the ranker term is the consumer.

Per validator §2 row 6: SHIP. Confidence HIGH. Trigger to defer: eval shows boost regresses single-hop slice by >2%.

## Prereqs

- Phase 2 (`ExtractedEntity` rows from pattern extraction)
- Phase 5a (`EntityRelationship` rows from LLM with confidence scores)
- Phase 0.5 eval (the ≥3% multi-entity lift OR no overall regression is the ship gate)
- Phase 3 (RRF mode coexists; this boost adds a term to whichever ranker is active)

## Exit criteria

| Criterion | How to verify |
|---|---|
| Trigram similarity check on query vs entity canonical name | Test: query "stripe pricing" + memory linked to `ExtractedEntity {canonicalName: 'Stripe'}` returns trigram match |
| Boost applied only when confidence ≥ 0.7 | Test: low-confidence relationship → no boost |
| `+0.15` weight added to weighted score; same for RRF (re-rank by adjusted score) | Both modes tested |
| Behind feature flag default OFF | `RANKER_ENTITY_BOOST_ENABLED=false` is the deploy default |
| A/B bucketing by `userId.hashCode() % 4 === 0` | 25% of users get the boost; deterministic per-user |
| Eval multi-entity slice ≥3% lift OR overall ≤3% regression | `npm run eval:retrieval` confirms |
| Single-hop slice not regressed by >2% | Per validator's flip-trigger |
| Performance: extra trigram query adds <50ms p95 | Measured |

## Dependencies

- **Upstream:** Phase 2, 5a, 0.5, 3
- **Downstream:** Phase 7a runs in same sprint (parallel)

## Time budget detail

| Task | Hours |
|---|---|
| 6.1 — Trigram match query against ExtractedEntity | 3 |
| 6.2 — Boost integration into both ranker modes | 2 |
| 6.3 — A/B bucketing by userId hash | 1 |
| 6.4 — Tests (unit + integration + perf) | 3 |
| 6.5 — Eval + flag flip + monitor | 2 |
| **Total** | **~11 hours / 2-3 days** |

## Risks accepted

- **Trigram threshold of 0.6** is a starting point. If too many false-positive boosts (e.g., "stripe" matches "stride"), raise to 0.7. Tune via eval.
- **Adds a database round-trip per query.** Bounded — cap at top-30 candidates after Phase 3 ranking; lookup entities for those 30. <50ms p95 even at 1000 entities/user.
- **A/B mid-session safety.** Per-user bucketing means a user's session is consistent — they don't get jarring rank changes mid-conversation.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 6, §7 (A/B pattern)
- Used by: PHASE-7a (ships in same sprint)
- A/B pattern documented in: `docs/architecture/ab-testing.md` (new file, created here)

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
