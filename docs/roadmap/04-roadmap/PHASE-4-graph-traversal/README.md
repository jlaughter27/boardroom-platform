# Phase 4 — Graph Traversal (TS Service over Recursive CTE)

**Time budget:** 1 week
**Confidence:** MED
**Owner:** Solo dev
**Blast radius:** Low — read-only addition, doesn't replace existing functionality

---

## What this phase is

Build a thin TypeScript service that exposes `findRelatedEntities(entityId, hops=2)` over the existing typed link tables, implemented via a PostgreSQL recursive CTE.

The graph: `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`. These are the canonical structured relationships. The new service queries them transitively up to a configurable depth.

Three deliverables:

1. **`relationship.service.ts::findRelatedEntities(entityId, hops)`** — recursive CTE query, depth-capped at 2 (configurable but warns at higher), bi-temporal filter applied (per Phase 1's `withTemporalFilter()` helper).
2. **`/relationships/related/:id` endpoint** — exposes the service via OmniMind HTTP API. Pagination, max-depth validation, response envelope per `06-references/api-conventions.md`.
3. **Eval harness extension** — multi-entity query slice should pick up the lift if any. The Phase 0.5 multi-entity slice (10 queries) acts as the regression gate.

Per validator §2 row 4: "thin TS wrapper, no PL/pgSQL." The recursive CTE is plain SQL inside a Prisma `$queryRaw`. No PL/pgSQL functions. Defer multi-hop beyond 2 until production logs show >15% of queries are multi-hop (the eval-trigger).

## Why now

The graph is implicitly there — `Goal → Project → Task` chains exist and are the foundation of the entity hierarchy from CLAUDE.md. But nothing actually queries it transitively. Personas analyze a single entity at a time; the roadmap-aware context fix from CLAUDE.md needs cross-entity walks.

This is where the persona-to-persona context-sharing pattern from CLAUDE.md "Module Integration Gaps §1" gets its data layer. Phase 6 (entity ranker boost) builds on top.

## Prereqs

- Phase 1 schema (bi-temporal columns on link tables)
- Phase 0.5 eval (multi-entity slice as the gate)
- Phase 2 NOT required — graph traversal works on existing typed links, doesn't need entity extraction

## Exit criteria

| Criterion | How to verify |
|---|---|
| `findRelatedEntities(id, hops)` returns nodes + edges | Test: a Goal with 2 linked Projects and 5 linked Tasks returns 7 nodes at depth=2 |
| Bi-temporal filter applied | Inserting a `validTo` in the past on a link → that link no longer appears |
| Depth cap of 2 enforced | Calling with `hops=10` either errors or warns + caps at 2 |
| Recursive CTE runs in <300ms p95 | Measured at 100 entities/user using EXPLAIN ANALYZE |
| `/relationships/related/:id` endpoint works | `curl /relationships/related/goal_xxx?hops=2` returns JSON envelope |
| Eval multi-entity slice within 3% of baseline | `npm run eval:retrieval` shows multi-entity MRR within ±3% |
| Tests cover both directions of each link table | unit + integration |

## Dependencies

- **Upstream:** Phase 1 (bi-temporal columns + helper)
- **Downstream:** Phase 6 (entity-aware ranker boost can read from this)
- **Optional downstream:** Phase 16 (knowledge graph deep) — re-evaluate when this CTE p99 exceeds 500ms

## Time budget detail

| Task | Hours |
|---|---|
| 4.1 — Recursive CTE design + helper functions | 5 |
| 4.2 — `relationship.service.ts::findRelatedEntities` | 4 |
| 4.3 — `/relationships/related/:id` route + Zod | 2 |
| 4.4 — Bi-temporal filter helper extracted | 2 |
| 4.5 — Tests (unit + integration + perf) | 4 |
| 4.6 — Eval verification | 1 |
| **Total** | **~18 hours / 1 week at solo cadence** |

## Risks accepted

- **Recursive CTE performance.** At 100 entities/user, CTE p95 should be <300ms. If a power user hits 1000+ entities, performance degrades quadratically. Mitigation: depth cap, `LIMIT` on result size, future Phase 16 evaluation of materialized graph.
- **Bi-temporal filter discipline (validator §1 risk).** Forgetting the filter at a query site silently degrades retrieval. Mitigation: `withTemporalFilter()` helper that wraps the raw SQL, plus a code-review checklist in `docs/architecture/entity-graph.md`.
- **No PL/pgSQL means complex graph patterns get hairy in TS.** Acceptable per ADR-001 spirit (custom runtime, minimal infra). If patterns get hairy enough, that's the trigger to evaluate Phase 16 (Apache AGE / Neo4j).
- **Soft-delete on link tables (data audit B3).** Link tables don't have `deletedAt`. The graph walks live links — if a parent is soft-deleted, the link still appears. Mitigation: filter parent `deletedAt: null` in the post-CTE join.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 4
- Risk register: `06-risks-and-mitigations/RISK-REGISTER.md` (bi-temporal discipline)
- CLAUDE.md "Module Integration Gaps §1" (cross-persona context)
- Used by: PHASE-6 (ranker entity boost)
- Eval-trigger to extend: PHASE-16 (deep graph) when production queries are >15% multi-hop

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
