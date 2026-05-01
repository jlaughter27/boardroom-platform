# Phase Progress Tracker

**Audience:** Claude or human at the start of any session, wanting to know what's actually done and what's next.
**Purpose:** Per-task tracker across all phases. Initially empty. Updated by every session that completes a task.
**Format:** Append-only edits within rows. Don't delete rows; if a task is dropped, mark `done` with a note explaining the cut and link to the DECISIONS-LOG entry.

**Status legend:** `todo` = not started · `wip` = in progress this session · `done` = completed and signed off · `blocked` = waiting on something (see notes column + BLOCKERS.md)

**How to update:** When you start a task, change `todo` → `wip` and put your session date in `Date`. When you finish, change `wip` → `done` and update `Notes` with a one-line outcome (commit SHA, eval delta, etc.). When blocked, change to `blocked` and open or reference an entry in `BLOCKERS.md`.

> **This tracker is the canonical "which task am I on" source for cold-start sessions.** Pair it with `STATUS/CURRENT-PHASE.md` "Active task (within current phase)" line.

---

## Phase 0 — Foundation cleanup

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 0 | Drop dead code identified by audit | todo | dev | — | — |
| 0 | Wire log drain to Railway dashboard | todo | dev | — | — |
| 0 | Confirm `git status` clean baseline | todo | dev | — | — |

## Phase 0.25 — Critical fixes

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 0.25.1 | OAuth state signing (security A1) | todo | dev | — | — |
| 0.25.2 | Stripe webhook fix — raw body + above auth wall + idempotency (security A2 + data A4) | todo | dev | — | — |
| 0.25.3 | Mass-assignment Zod on `PATCH /user-profile` (security A3) | todo | dev | — | — |
| 0.25.4 | Delete RLS facade (`db-audit.ts`) and add CI grep gate (security A4) | todo | dev | — | — |
| 0.25.5 | `ENCRYPTION_KEY` fail-closed across all envs (security A5) | todo | dev | — | — |
| 0.25.6 | `MemoryEntry.version` race fix — `If-Match` + 409 (data B1) | todo | dev | — | — |
| 0.25 | Per-tenant token meter (`User.tokensUsedToday`) — initial cap | todo | dev | — | — |
| 0.25 | `?connection_limit=25&pool_timeout=15` on DATABASE_URL | todo | dev | — | — |
| 0.25 | `p-limit` wrappers on Sonnet (20) and Haiku (50) | todo | dev | — | — |

## Phase 0.5 — Eval harness

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 0.5 | Hand-label 35 baseline queries | todo | dev | — | — |
| 0.5 | Implement MRR / nDCG / P@5 runner | todo | dev | — | — |
| 0.5 | Wire non-regression check into pre-deploy script | todo | dev | — | — |
| 0.5 | Define phase-specific eval slices (3, 5a, 6, 7a) | todo | dev | — | — |

## Phase 1 — Schema alignment

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 1 | Add 4 entity tables to Prisma schema | todo | dev | — | — |
| 1 | Add bi-temporal-lite cols to 6 link tables | todo | dev | — | — |
| 1 | Add `memoryType` enum + backfill heuristic | todo | dev | — | — |
| 1 | Add new Zod schemas in shared/ (`*.schema.ts`) | todo | dev | — | — |
| 1 | Add new types in shared/ (`*.types.ts`) | todo | dev | — | — |

## Phase 2 — Pattern extraction + write loop

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 2 | `MemoryWriteEvent` table + intent log | todo | dev | — | — |
| 2 | Async pattern extractor (off request path) | todo | dev | — | — |
| 2 | Deterministic ADD / UPDATE / DELETE / NOOP rules | todo | dev | — | — |
| 2 | Replay test for durability | todo | dev | — | — |
| 2 | Flag-off baseline equivalence test | todo | dev | — | — |

## Phase 3 — HNSW + RRF

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 3 | Build HNSW index on MemoryEntry.embedding | todo | dev | — | — |
| 3 | Implement RRF fusion in retrieval/ | todo | dev | — | — |
| 3 | A/B RRF vs weighted; document winner | todo | dev | — | — |

## Phase 4 — Graph traversal

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 4 | Recursive CTE for `findRelatedEntities` | todo | dev | — | — |
| 4 | Endpoint + tests | todo | dev | — | — |
| 4 | p95 latency check on seeded data | todo | dev | — | — |

## Phase 5a — LLM augmentation

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 5a | Cost-tracker counter (per-user + global) | todo | dev | — | — |
| 5a | Nightly entity + relationship batch job | todo | dev | — | — |
| 5a | Spend circuit breaker | todo | dev | — | — |
| 5a | Precision evaluation on labeled sample | todo | dev | — | — |

## Phase 5b — LLM consolidation

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 5b | Haiku UPDATE/NOOP boundary check | todo | dev | — | — |
| 5b | Idempotent replay key | todo | dev | — | — |

## Phase 6 — Entity ranker boost

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 6 | Add 5th signal to ranker.ts behind flag | todo | dev | — | — |
| 6 | Eval on multi-entity slice | todo | dev | — | — |

## Phase 7a — Recency / access refinement

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 7a | Exp-decay recency in ranker | todo | dev | — | — |
| 7a | log(access_count) factor | todo | dev | — | — |

## Phase 7b — Outcome feedback (DEFERRED)

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 7b | Wait for trigger: ≥200 Decision.outcome + MemoryCitation table | todo | — | — | DEFERRED — see DEFERRED/ |

## Phase 8 — Reranker (DEFERRED)

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 8 | Wait for trigger: eval MRR <0.6 + Railway ≥4GB | todo | — | — | DEFERRED — see DEFERRED/ |

## Phase 9 — Purge `_disabled/` + ADRs

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 9 | Write ADR-014 | todo | dev | — | — |
| 9 | Write ADR-015 | todo | dev | — | — |
| 9 | Write ADR-016 | todo | dev | — | — |
| 9 | Delete `_disabled/` tree | todo | dev | — | — |

## Phase 10 — Memory MCP server

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 10 | Implement MCP server per spec | todo | dev | — | — |
| 10 | Streamable HTTP transport + OAuth 2.1 + DCR + RFC 8707 | todo | dev | — | — |
| 10 | E2E test from Claude Desktop + Cursor | todo | dev | — | — |

## Phase 11 — Markdown export

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 11 | Export Decision/Project/Goal/Memory to .md (vault layout designed) | todo | dev | — | — |
| 11 | Bidirectional git sync (export + reimport) | todo | dev | — | — |
| 11 | Round-trip preservation test | todo | dev | — | — |

## Phase 12 — Webhooks + event bus

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 12 | Webhook endpoints + HMAC signing | todo | dev | — | — |
| 12 | Event bus (Postgres-backed queue) | todo | dev | — | — |
| 12 | Retries + DLQ | todo | dev | — | — |
| 12 | Test receiver integration | todo | dev | — | — |

## Phase 13 — Public TypeScript SDK

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 13 | Build SDK around HTTP API | todo | dev | — | — |
| 13 | Generate from Zod schemas (zod-to-openapi) | todo | dev | — | — |
| 13 | Publish to npm | todo | dev | — | — |
| 13 | Integration test from external workspace | todo | dev | — | — |

## Phase 14 — Observability suite

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 14 | Metrics export (latency, queue, cron) | todo | dev | — | — |
| 14 | Tracing wired across services | todo | dev | — | — |
| 14 | At least 3 alerts configured | todo | dev | — | — |

## Phase 15 — Migration history

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 15 | Baseline migration commit | todo | dev | — | — |
| 15 | Switch entrypoint to `prisma migrate deploy` | todo | dev | — | — |
| 15 | Remove `--accept-data-loss` | todo | dev | — | — |
| 15 | Quarantine 2025-04 orphan migrations | todo | dev | — | — |

## Phase 16 — Cortex isolation

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 16 | Extract cortex to separate Railway service | todo | dev | — | — |
| 16 | Verify API event loop unaffected | todo | dev | — | — |

## Phase 17 — Persona marketplace (optional)

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 17 | Manifest schema + sigstore-compatible verification | todo | dev | — | — |
| 17 | Install endpoint (MCP tool + admin route) | todo | dev | — | — |
| 17 | `CustomPersona` schema extension | todo | dev | — | — |
| 17 | Tool allowlist enforcement | todo | dev | — | See DEF-014 for descope conditions if customer demand <5 |

## Phase 18 — Resilience + multitenant fairness

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 18 | Per-tenant token budget enforcement (full) | todo | dev | — | — |
| 18 | Postgres-backed rate limiter | todo | dev | — | — |
| 18 | Real RLS on user-scoped tables | todo | dev | — | — |
| 18 | Subscription middleware narrowed (ADR-010 update) | todo | dev | — | — |

## Phase 19 — Horizontal API scale

| Phase | Task | Status | Owner | Date | Notes |
|---|---|---|---|---|---|
| 19 | Cron isolated (depends on Phase 16) | todo | dev | — | — |
| 19 | Sticky SSE sessions across replicas | todo | dev | — | — |
| 19 | Shared circuit breaker (cross-replica state) | todo | dev | — | — |
| 19 | PgBouncer in path | todo | dev | — | — |
| 19 | N-replica load test passes | todo | dev | — | — |

---

**Reminder:** A row marked `done` should also have a corresponding entry in `CHANGELOG.md` for the phase as a whole, not for each task.
