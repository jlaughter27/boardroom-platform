# Phase Progress Tracker

**Audience:** Claude or human at the start of any session, wanting to know what's actually done and what's next.
**Purpose:** Per-task tracker across all phases. Initially empty. Updated by every session that completes a task.
**Format:** Append-only edits within rows. Don't delete rows; if a task is dropped, mark `done` with a note explaining the cut and link to the DECISIONS-LOG entry.

**State legend (from 2026-10-22; source: `docs/roadmap/PHASE-8-ROADMAP.md` → "How to run a lane"):** `todo → in-progress → in-review → merged → done`

| State | Meaning | Who sets it |
|---|---|---|
| `todo` | Not started | — |
| `in-progress` | A lane session has claimed it | The lane session, after its dependency check |
| `in-review` | PR open | The session that opens the PR (with the PR link in Notes) |
| `merged` | PR merged to `main` and the CI run on the merge SHA is all-green | Whoever merges; otherwise the next lane session, after `gh pr view <n> --json state,mergeCommit` and `gh run list --commit <sha>` |
| `done` | `merged`, plus, for items whose acceptance includes production behaviour, a green post-deploy-verify run on that SHA (or the named founder evidence) | The founder, for founder items and production-acceptance items |

**Dependency rule:** an agent dependency is satisfied at `merged` or `done`; a founder dependency only at `done`, with its evidence in `CHANGELOG.md` / `docs/03-operations/BACKUP-DRILLS.md`. A session whose dependency is unmet stops, reports the item as blocked, and records why in Notes (and in `BLOCKERS.md` if it needs the founder).

**Legacy rows:** the Phase 0–19 sections below date from the 2026-04-18 roadmap scaffold and were never updated as work shipped; they still use the old `todo` / `wip` / `done` / `blocked` vocabulary (`wip` = `in-progress`). Read them through "Shipped phases → roadmap phases" below rather than at face value.

> **This tracker is the canonical "which task am I on" source for cold-start sessions.** Pair it with `STATUS/CURRENT-PHASE.md` "Active task (within current phase)" line.

---

## Shipped phases → roadmap phases (as of 2026-10-22)

**Two numbering schemes.** "Phase 5.5 … 7.5" and "Phase 8 — Dev roadmap" are *delivery* phases, named in `CHANGELOG.md` and `CURRENT-PHASE.md`. The numbered sections below (Phase 0 … 19) are the 2026-04-18 *memory-system roadmap* (`docs/roadmap/04-roadmap/`). They are different things: roadmap "Phase 8" is the deferred cross-encoder reranker, unrelated to delivery Phase 8. Keep/park/kill status for roadmap phases 10–19 is in `DECISIONS-LOG.md` DEC-004.

SHAs are the commits on `main` (`git log --first-parent main`). PR #20 and #21 were merge commits, so their branch commits are also on `main`; PR #22–#24 were squashed.

| Delivery phase | PRs → `main` SHA | Merged | Roadmap phases it advanced (evidence) | Still open in those roadmap phases |
|---|---|---|---|---|
| 5.5 — Post-Hermes fix-everything | #10 `21493ef`, #11 `56a4f60`, #12 `57c0aba`, #13 `60e4017`, #14 `bcbe1d1`, #15 `8b57f50`; closeout #16 `0475664` | 2026-05-14/15 | **7a** partial — exponential-decay recall strength driven by `recallCount` (#10, migration `20260514_recall_count`). **10** partial — agent context (`agentId`, `tenantId`, `sourceWeight`) propagated end to end (#11); `agent_id` NOT NULL and the embedding outbox (#13, migrations `20260515_agent_id_required`, `20260515_embedding_outbox`). | 7a has no eval-measured ranker change recorded. |
| 5.6 — Test infra + bug audit | #17 `284c54c`, #18 `930273d` | 2026-05-15 | None (green test suite, outbox retry scheduler wiring, an audit report). | — |
| 5.7 — Audit remediation (82 findings) | commits `fea0e4e`…`d77d932`, merged with PR #20 as `89fad1d` | 2026-10-09 (work dated 2026-10-02) | **15** — baseline migration `0_init` added in `e28f397`; `docker-entrypoint.sh` runs `prisma migrate deploy` with baseline detection; no `--accept-data-loss` remains in the entrypoint. CI gate `.github/workflows/ci.yml` (`f165bcb`; no roadmap phase). | 15: a migration-drift guard (Phase 8 M0-A3). |
| 6 — Research backlog (8 moves) + pre-merge review | commits `d12181d`…`cf0ffd2` (graph view `d3b5c7c` before them), merged with PR #20 as `89fad1d` | 2026-10-09 (work dated 2026-10-02/03) | **0.5** — 114-query labeled retrieval gold set, recall@k / MRR / nDCG runner, gated in the CI `retrieval-eval` job (`c8d8178`). **4** — `graph_neighborhood` BFS over backlinks, ≤2 hops, 60 nodes (`2ae9cdf`; not a recursive CTE). **10** — MCP conformance: annotations, structured output, cursor pagination, `idempotencyKey`, resources, prompts (`2ae9cdf`). **14** partial — OTel behind `OTEL_EXPORTER_OTLP_ENDPOINT` (`a5e8047`, `b6902d9`). | 3: no HNSW index and no RRF fusion in `retrieval/`. 14: no alerts or metrics export (Phase 8 M3-A1, M3-F1). |
| 7 — Universal memory MCP front door | #21 `77607bf` (branch commits `ad957c6` research, `7fce388`, `6758cc1`, `c87a5ab`, `97bfbca`) | 2026-10-20 (UTC) | **10** — hosted Streamable HTTP gateway (`packages/omnimind-mcp`, third Railway service), per-user `omt_` tokens, OAuth resource-server mode (RFC 9728 PRM, RFC 8707 audience), delegated identity, 20 tools, migrations `20261018000000_mcp_tokens` and `20261018000001_mcp_identity_hardening`. | 10: issuer selection (ADR-016, M1-F6/M2-F1), tenant-isolation of entity tools (ADR-017, M1-B4/M1-B1, E2E-9), Connector Directory submission (not scheduled). The service has never been launched (M1-F1). |
| 7.5 — Visualization + Apple-grade UI (ADR-015), live e2e, go-live script | #22 `cdef1ef` | 2026-10-22 | None of 0–19 (UI work is outside the memory-system roadmap). Operational support for **10**: `scripts/mcp-go-live.sh` one-command go-live. | — |
| 8 kickoff — MCP SDK security bump | #23 `fc19563` | 2026-10-22 | Maintenance of **10** (`@modelcontextprotocol/sdk` `^1.32.1`). | — |
| 8 — Dev roadmap (docs) | #24 `c2c6fca` | 2026-10-22 | Plan only: `docs/roadmap/PHASE-8-ROADMAP.md`; items tracked in § Phase 8 below. | — |

Not checked against any shipped work: roadmap phases 1, 2, 5a, 5b, 6, 9 (the `_disabled/` trees still exist under `packages/`), 11, 12, 13, 16, 17, 18, 19. Pre-5.5 work (for example PR #5 `a210a3a`, "Phase 0.25 — 29 adversarial audit fixes", 2026-05-08, and the MCP layer Phases 1–4 of 2026-05-09) is not mapped here.

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

## Phase 8 — Dev roadmap (docs/roadmap/PHASE-8-ROADMAP.md, from 2026-10-22)

States: `todo` → `in-progress` → `in-review` → `merged` → `done` (see the roadmap's "How to run a lane"). Lane `founder` items need the founder's evidence before they count as `done`.

| ID | Task | Milestone | Lane | Depends on | Status | Date | Notes |
|---|---|---|---|---|---|---|---|
| M0-A1 | Add qs/ip-address overrides, main-aware cancel-in-progress, weekly scheduled audit (main already green on fc19563) | M0 | A | — | merged | 2026-10-23 | Lane A `e95fdc9`; PR #25 `d9a5bf3` |
| M0-A2 | /health version field (stays 200) + /ready 503 on all three services | M0 | A | — | merged | 2026-10-23 | Lane A `d8fcc3f`; PR #25 `d9a5bf3` |
| M0-A3 | Migration drift guard against a separate omnimind_shadow DB + detect-baseline tests | M0 | A | M0-A1 | merged | 2026-10-23 | Lane A `35448a5`; known drift baselined in `prisma/known-drift.sql`; PR #25 `d9a5bf3` |
| M0-D1 | Status truth pass, tracker state legend, model count 43, ADR-016 (Proposed) OAuth issuer | M0 | D | — | merged | 2026-10-23 | Lane D `282d289`, `6fd5371`; ADR refs repointed `f7a9a19`; PR #25 `d9a5bf3` |
| M0-D2 | Phase 10-19 keep/park/kill + do-not-build list in DECISIONS-LOG | M0 | D | — | merged | 2026-10-23 | Lane D `447c7cd` (DEC-004); PR #25 `d9a5bf3` |
| M0-F1 | Manual production pg_dump + restore drill row | M0 | founder | — | todo | — | — |
| M0-F2 | Rotate the five R-103 secrets and record it | M0 | founder | M0-F1 | todo | — | — |
| M0-F3 | Branch protection on main + Railway wait-for-CI | M0 | founder | M0-A1 | todo | — | — |
| M0-F4 | Hand-verify the live deploy (migrations, /health, three PR #22 probes) | M0 | founder | — | todo | — | — |
| M1-A1 | Automatic post-deploy-verify workflow + scripts/verify-prod.sh with mock-server tests | M1 | A | M0-A2 | todo | — | — |
| M1-A2 | Harden mcp-go-live.sh: PORT resolution, async extract, bogus-token upstream probe, CI-green and backup preconditions | M1 | A | — | merged | 2026-10-23 | Lane B `008d549`; workflow inputs/permissions `5566f49`; PR #25 `d9a5bf3` |
| M1-A3 | CI e2e job, playwright devDependency, journey --browser flag and checks/ autoloader | M1 | A | M0-A1 | todo | — | — |
| M1-B0 | ADR-017 entity tenancy decision (tenantId on entity models, agent-scoped filtering) | M1 | B | — | in-review | 2026-10-22 | ADR-017 recorded as Proposed (Lane D); acceptance waits on founder M1-F7 |
| M1-B4 | Migration adding tenantId to decisions/commitments/tasks/people/projects/goals + tenant-scoped entity routes | M1 | B | M1-B0, M1-F7, M0-F1, M0-A3 | todo | — | — |
| M1-B1 | Re-point MCP entity tools at tenant-scoped first-class routes + E2E-9 same-user two-tenant roundtrip | M1 | B | M1-B4 | todo | — | — |
| M1-B2 | Sync memory_write stores row and defers extraction instead of refusing | M1 | B | — | merged | 2026-10-23 | Lane B `3784839`; retries at 5 s / 30 s / 120 s; PR #25 `d9a5bf3` |
| M1-B3 | Idempotent backfill of tagged MCP memories into entity tables, in source memory tenant | M1 | B | M1-B1 | todo | — | — |
| M1-C1 | Stream situationReading/analysis prose via partial-JSON parser, rAF batching, CLS check | M1 | C | M1-A3 | merged | 2026-10-23 | Lane C `7ea7342`; CLS 0.0092 (budget 0.05); ships a minimal journey checks/ autoloader ahead of M1-A3; PR #25 `d9a5bf3` |
| M1-C2 | Failed persona error card + personaIds retry without re-running debate round | M1 | C | M1-C1 | merged | 2026-10-23 | Lane C `96ca814`; unknown persona → 400 `unknown_persona` from the route (validateBody stays 422); PR #25 `d9a5bf3` |
| M1-C3 | Hydrate reloaded/undispatched decision session question | M1 | C | — | merged | 2026-10-23 | Lane C `cf2d57a`; PR #25 `d9a5bf3` |
| M1-C4 | Real dashboard actions, dismissedSuggestions persisted in OmniMind, first-run nudge, single load warning | M1 | C | M0-F1, M0-A3, M1-B4 | todo | — | — |
| M1-D1 | Brand gold passes AA (two variants) + token-pair contrast test | M1 | D | — | todo | — | — |
| M1-D2 | MotionConfig reducedMotion, smooth-scroll helper, motion guard rules | M1 | D | M1-C2, M1-C4 | todo | — | — |
| M1-D3 | OnboardingGate redirects only on 404; token reveal no overflow | M1 | D | — | todo | — | — |
| M1-D4 | Keyboard-reachable Card (as button/Link) + guard rule | M1 | D | M1-C4 | todo | — | — |
| M1-F7 | Approve ADR-017 and pick BoardRoom's default entity tenant | M1 | founder | M1-B0 | todo | — | — |
| M1-F1 | Run MCP go-live; connect Claude Code and Cursor; verify and revoke | M1 | founder | M0-A1, M0-F1, M0-F2, M1-A2 | todo | — | — |
| M1-F2 | Connect omnimind-mcp to GitHub, set config-as-code path, confirm replicas=1 | M1 | founder | M1-F1, M1-A1 | todo | — | — |
| M1-F3 | Deploy services/backup and log a restore drill | M1 | founder | M0-F1 | todo | — | — |
| M1-F4 | Benchmark production write and status_get p95 | M1 | founder | M1-F1 | todo | — | — |
| M1-F5 | Pick the brand-gold variant | M1 | founder | M1-D1 | todo | — | — |
| M1-F6 | Pick the OAuth issuer against ADR-016 criteria | M1 | founder | M0-D1 | todo | — | — |
| M2-A1 | Read-only /admin/dogfood scorecard (per tenant), cost-report, dogfood-report, DOGFOOD-SCORECARD.md | M2 | A | M1-B1 | todo | — | — |
| M2-A2 | scripts/verify-oauth.sh with in-process issuer test | M2 | A | M0-D1 | todo | — | — |
| M2-B1 | status_get gains tenant-scoped pendingOutcomeReviews/openContradictions/latestMemo; decision_log forecast | M2 | B | M1-B1 | todo | — | — |
| M2-B2 | User-scoped /mcp/identities/mine + Connected sign-ins panel | M2 | B | — | todo | — | — |
| M2-C1 | One entity cache with dedupe/TTL, Zod-parsed pagination, widget error boundaries, request-budget check | M2 | C | M1-C4 | todo | — | — |
| M2-C2 | Onboarding Connect your AI step with owner-checked activity poll | M2 | C | M1-D3, M2-B2 | todo | — | — |
| M2-D1 | WebKit + iPhone/iPad viewports in visual-preview; CI webkit-visual job | M2 | D | M1-A3 | todo | — | — |
| M2-D2 | iOS layout fixes (dvh, viewport-fit, 16px inputs, header) + DEVICE-PASS-CHECKLIST | M2 | D | M2-D1 | todo | — | — |
| M2-D3 | Re-derive persona palette per theme with contrast and CVD checks; labels in charts | M2 | D | M1-D1, M1-F5, M1-C2 | todo | — | — |
| M2-F1 | Configure OAuth issuer, connect ChatGPT and claude.ai, ADR-016 Accepted | M2 | founder | M1-F1, M1-F6, M2-A2, M2-B2 | todo | — | — |
| M2-F2 | Production backfill dry-run then apply | M2 | founder | M1-B3, M1-F3 | todo | — | — |
| M2-F3 | Run dogfood report on prod, sign thresholds, declare day 1 | M2 | founder | M1-F1, M1-F4, M1-B2, M1-C2, M1-C4, M2-A1, M2-B1, M2-F2 | todo | — | — |
| M2-F4 | Device pass #1 on iOS and macOS Safari | M2 | founder | M2-D2 | todo | — | — |
| M3-A1 | /admin/outbox-depth, OBSERVABILITY.md for three services with /ready, llm-spend-check | M3 | A | M0-A2 | todo | — | — |
| M3-A2 | pg_try_advisory_lock in createJobGuard; document numReplicas=1 | M3 | A | — | todo | — | — |
| M3-A3 | Private-API readiness: verify scripts off public host, BoardRoom /admin/dogfood proxy, --via boardroom scripts, service-shell runbook, REQUIRE_AGENT_KEY CI leg | M3 | A | M1-A1, M1-A3, M2-A1 | todo | — | — |
| M3-A4 | Triage rotted root suites; real-DB D9 isolation test; orphan-test guard | M3 | A | M1-A3, M3-A3 | todo | — | — |
| M3-A5 | Node 22 images and CI, ubuntu-24.04, de-flake ConnectedToolsPanel test | M3 | A | M0-A1, M1-A1, M3-A4 | todo | — | — |
| M3-A6 | Wire bundle-size budget into CI | M3 | A | M3-D2, M3-A5 | todo | — | — |
| M3-B1 | Supersede-aware ranking + nightly real-embedding eval | M3 | B | M0-A1 | todo | — | — |
| M3-B2 | Command palette Capture via POST /memories with optional decision/commitment typing | M3 | B | M1-B1 | todo | — | — |
| M3-C1 | Today view from the shared cache | M3 | C | M2-C1 | todo | — | — |
| M3-C2 | Nightly e2e:live with account variants, test-mode limiter guard, truncation and empty-chart fixes | M3 | C | M1-A3, M2-D1 | todo | — | — |
| M3-D1 | Replace emoji/glyph icons with lucide; icon buttons for dismiss/close; guards | M3 | D | M2-D3 | todo | — | — |
| M3-D2 | Cold start: chunk split, parallel auth/profile, shell skeleton, prefetch, check-bundle-size script | M3 | D | M2-D2 | todo | — | — |
| M3-D3 | Copy voice: remove testimonials and jargon, sentence case, one CTA in empty states | M3 | D | M3-C1 | todo | — | — |
| M3-F1 | OTel + five alerts + backup dead-man + /ready uptime checks | M3 | founder | M0-A2, M3-A1, M1-F1 | todo | — | — |
| M3-F2 | Private URL switch, 7-day soak, OMNIMIND_REQUIRE_AGENT_KEY=true (keep public domain) | M3 | founder | M1-F1, M1-A1, M3-A3 | todo | — | — |
| M3-F3 | Weekly scorecard reviews W4-W7 | M3 | founder | M2-F3 | todo | — | — |
| M3-F4 | Device pass #2 with zero P0 | M3 | founder | M2-F4, M3-D1, M3-D2 | todo | — | — |
| M4-A1 | Per-user monthly LLM budget (warn 80%, 402 at 100%) + COST-MODEL update | M4 | A | M2-A1 | todo | — | — |
| M4-B1 | Whole-account export zip (JSON with tenantId + Markdown) | M4 | B | M1-B4 | todo | — | — |
| M4-C1 | Dashboard hierarchy remainder: insights below cockpit, grouped questions, no decorative stripes | M4 | C | M3-C1 | todo | — | — |
| M4-D1 | Forms pass: Base UI Select for 9 native selects, RadioGroup, remove allow-comments | M4 | D | M2-D2 | todo | — | — |
| M4-D2 | Type scale wired into Tailwind, palette/hex/type guard rails | M4 | D | M1-D1 | todo | — | — |
| M4-F1 | Write the dogfood verdict | M4 | founder | M3-F3 | todo | — | — |
| M4-F2 | Remove omnimind-api public domain after verdict; verify and re-run reports via BoardRoom | M4 | founder | M4-F1, M3-F2, M3-A3 | todo | — | — |

---

**Reminder:** A row marked `done` should also have a corresponding entry in `CHANGELOG.md` for the phase as a whole, not for each task.
