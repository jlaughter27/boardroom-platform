# Phase Completion Criteria — The Signoff Checklists

**Audience:** Claude or human at the end of any phase, deciding "is this actually done?"
**Purpose:** Each phase has a checklist with verification commands. If a row isn't checked with evidence, the phase isn't done. No vibes-based completion.
**Source:** Distilled from [`01-foundations/SUCCESS-METRICS.md`](../01-foundations/SUCCESS-METRICS.md) and each phase's `README.md`.

---

## Cross-cutting gates (apply to EVERY phase)

These run on every phase before it can be marked done. Failure on any → phase stays in WIP.

- [ ] `npm run typecheck` — green across all packages
- [ ] `npm run test` — pass rate ≥99% (current baseline 708/708)
- [ ] Coverage ≥80% per CLAUDE.md (run package-level coverage)
- [ ] `npm run pre-deploy` — `scripts/pre-deploy-check.sh` exits 0
- [ ] Eval harness — no regression on standard 35 queries (post-Phase 0.5)
- [ ] LLM cost during phase work — within phase-specific cap; global $50/day rolling-7-day max not breached
- [ ] Auto-deploy to Railway — green, `/health` 200 within 60s on both services
- [ ] CHANGELOG.md updated with phase completion entry
- [ ] CURRENT-PHASE.md updated to next phase
- [ ] PHASE-PROGRESS-TRACKER.md — all rows for this phase set to `done`

---

## Phase 0 — Foundation cleanup

- [ ] `git status` clean (all intentional changes committed)
- [ ] Dead code dropped — `_disabled/` not yet purged (that's Phase 9), but no new orphans
- [ ] Log drain wired (basic structured logs visible in Railway dashboard)
- [ ] All cross-cutting gates pass

## Phase 0.25 — Critical fixes (defuse-first)

- [ ] Per-tenant token meter implemented and tested (`User.tokensUsedToday`)
- [ ] `?connection_limit=25&pool_timeout=15` appended to `DATABASE_URL` in env.example + Railway
- [ ] `p-limit` wrappers around Anthropic Sonnet (20) and Haiku (50) in agent runtime
- [ ] All cross-cutting gates pass

## Phase 0.5 — Eval harness

- [ ] 35 hand-labeled queries committed under `eval/scenarios/`
- [ ] Baseline MRR / nDCG / P@5 numbers committed under `docs/eval-results/baseline.md`
- [ ] `npm run eval:retrieval` reports the metrics in <2 minutes
- [ ] Non-regression check wired into `scripts/pre-deploy-check.sh`
- [ ] Phase-specific eval slices defined for Phases 3, 5a, 6, 7a (even if empty stubs)
- [ ] All cross-cutting gates pass

## Phase 1 — Schema alignment

- [ ] 4 new entity tables present in `prisma/schema.prisma` and pushed to DB
- [ ] Bi-temporal-lite columns (`validAt`, `invalidAt`, `supersededBy`) on the 6 link tables identified in mem0 final-recommendation
- [ ] `memoryType` enum (SEMANTIC / EPISODIC / PROCEDURAL) added; backfill heuristic ran
- [ ] New Zod schemas in `packages/shared/src/validation/`
- [ ] Companion TypeScript interfaces in `packages/shared/src/types/`
- [ ] `npm run test` still 708+/708+
- [ ] All cross-cutting gates pass

## Phase 2 — Pattern extraction + write loop

- [ ] Pattern extractor running async post-write (off the request path)
- [ ] ADD / UPDATE / DELETE / NOOP rules deterministic — same input twice = same action
- [ ] `MemoryWriteEvent` table + intent-log durability working (replay test passes)
- [ ] Phase 2 is FLAG-OFF by default; flag-on shows no eval regression
- [ ] All cross-cutting gates pass

## Phase 3 — HNSW + RRF

- [ ] HNSW index live on `MemoryEntry.embedding` (verify with `\d+ MemoryEntry` in psql)
- [ ] RRF fusion implementation present in `retrieval/`
- [ ] A/B comparison run: RRF vs weighted fusion on full eval; winner documented at `docs/eval-results/phase-3.md`
- [ ] p95 retrieval latency ≤300ms on the eval set
- [ ] All cross-cutting gates pass

## Phase 4 — Graph traversal

- [ ] `findRelatedEntities(id, hops=2)` implemented as a recursive CTE
- [ ] New endpoint test green
- [ ] Query p95 <500ms on a representative seeded dataset
- [ ] No new infra introduced (per principle 3 — Postgres-native)
- [ ] All cross-cutting gates pass

## Phase 5a — LLM augmentation

- [ ] Nightly cortex job extracts entities + relationships
- [ ] $/user/month within $2 cap (cost-tracker meter confirms)
- [ ] Per-100-pair extraction precision ≥0.6 on labeled sample
- [ ] Circuit breaker on global daily spend ($50) tested by simulated overrun
- [ ] Flag defaults OFF; eval shows no regression with flag off
- [ ] All cross-cutting gates pass

## Phase 5b — LLM consolidation

- [ ] Haiku check on UPDATE / NOOP boundary cases implemented
- [ ] Idempotent replay key prevents double-write (test verifies)
- [ ] Latency added by Haiku check ≤200ms p95
- [ ] All cross-cutting gates pass

## Phase 6 — Entity ranker boost

- [ ] 5th signal added to `ranker.ts` behind a feature flag
- [ ] Eval slice "multi-entity queries" shows ≥3% lift OR no regression overall
- [ ] Flag-off baseline matches pre-phase eval exactly
- [ ] All cross-cutting gates pass

## Phase 7a — Recency / access refinement

- [ ] Exp-decay recency formula in ranker
- [ ] `log(access_count)` factor in ranker
- [ ] Eval slice "recent-bias queries" shows lift OR neutral
- [ ] All cross-cutting gates pass

## Phase 7b — Outcome feedback (DEFERRED)

- [ ] Trigger fired: `Decision.outcome` populated on ≥200 decisions AND `MemoryCitation` table exists
- [ ] DECISIONS-LOG entry recording the un-deferral
- [ ] Phase promoted to active in ROADMAP-OVERVIEW.md
- [ ] (then standard phase criteria apply)

## Phase 8 — Reranker (DEFERRED)

- [ ] Trigger fired: eval MRR <0.6 AND Railway plan ≥4GB RAM AND 24h soak passes
- [ ] DECISIONS-LOG entry recording the un-deferral
- [ ] (then standard phase criteria apply)

## Phase 9 — Purge `_disabled/` + ADRs

- [ ] ADR-014, ADR-015, ADR-016 written and merged into `docs/DECISIONS.md`
- [ ] `_disabled/` directory deleted
- [ ] `rg -l _disabled` returns nothing
- [ ] All cross-cutting gates pass

## Phase 10 — Memory MCP server

- [ ] MCP server implementation matches spec at `05-features-to-10/memory-mcp-server.md`
- [ ] End-to-end test from Claude Desktop: read memory + write memory
- [ ] Auth surface documented (API key flow)
- [ ] All cross-cutting gates pass

## Phase 11 — Markdown export + git sync

- [ ] `.md` export per Decision / Project / Goal / Memory
- [ ] Round-trip test: export → reimport preserves all fields
- [ ] User-facing setup doc written
- [ ] All cross-cutting gates pass

## Phase 12 — Webhooks + event bus

- [ ] Webhook subscription endpoints (POST /webhooks, GET, DELETE) live
- [ ] HMAC-SHA256 signature header on every delivery
- [ ] Postgres-backed delivery queue with retries (exponential backoff) and DLQ
- [ ] Test receiver gets `MemoryWriteEvent` and entity events within 5s
- [ ] Replay protection (event_id idempotency on receiver side documented)
- [ ] All cross-cutting gates pass

## Phase 13 — Public TypeScript SDK

- [ ] Published to npm under chosen scope
- [ ] Integration test (separate repo or test workspace) consumes published package and exercises CRUD
- [ ] Versioning + changelog policy documented
- [ ] OpenAPI spec generated from Zod schemas (zod-to-openapi)
- [ ] All cross-cutting gates pass

## Phase 14 — Observability suite

- [ ] Metrics export (p50/p99 retrieval latency, queue lag, cron success rate) live
- [ ] Tracing wired across BoardRoom → OmniMind seam (using existing `x-request-id`)
- [ ] At least 3 alerts configured (queue lag >5min, cron failure, p99 latency >1s)
- [ ] Dashboard URL documented in DEPLOYMENT-RUNBOOK
- [ ] All cross-cutting gates pass

## Phase 15 — Migration history

- [ ] Baseline migration committed
- [ ] `prisma migrate deploy` working in entrypoint
- [ ] `--accept-data-loss` removed from `docker-entrypoint.sh`
- [ ] 6 orphan 2025-04 migrations quarantined
- [ ] Rollback procedure tested on staging
- [ ] All cross-cutting gates pass

## Phase 16 — Cortex isolation

- [ ] Cortex extracted to its own Railway service with its own Dockerfile
- [ ] API service no longer imports cortex job code
- [ ] Verified API event loop unaffected during a forced cortex run
- [ ] All cross-cutting gates pass

## Phase 17 — Persona marketplace (optional)

- [ ] Manifest schema in `packages/shared/src/validation/persona-manifest.schema.ts`
- [ ] Install endpoint (MCP tool `installPersona` + admin route `POST /admin/personas/install`)
- [ ] sigstore-compatible signature verification
- [ ] `CustomPersona` schema extended with `sourceUrl`, `version`, `manifestSignatureStatus`, `installedAt`, `installedBy`
- [ ] Tool allowlist enforcement (denied tool → 403 from agent runtime)
- [ ] Test persona installs from a public repo, verifies, runs sandbox-bound
- [ ] All cross-cutting gates pass

## Phase 18 — Resilience + multitenant fairness

- [ ] Real Postgres RLS on user-scoped tables (`SET LOCAL app.user_id` per request)
- [ ] Postgres-backed rate limiter (replaces in-memory Map)
- [ ] Per-tenant token budget enforcement (full — extends Phase 0.25 quick win)
- [ ] Subscription middleware narrowed (ADR-010 updated; fail-open only on transient network errors)
- [ ] Synthetic abuse user blocked at cap; rate limit survives redeploy
- [ ] All cross-cutting gates pass

## Phase 19 — Horizontal API scale

- [ ] API runs N≥2 replicas safely under load (load test documented)
- [ ] Cron isolated to its own service (Phase 16 prereq verified)
- [ ] SSE sessions sticky across replicas (or migrate to long-poll fallback for non-sticky proxies)
- [ ] Circuit breaker state shared across replicas (DB-backed or distributed)
- [ ] PgBouncer in connection path
- [ ] All cross-cutting gates pass

---

**How to use this file:** At end of every phase, copy the relevant section into a comment in the merge commit (or a phase-completion note in CHANGELOG.md). Each unchecked box is a blocker. Don't move on until every box is checked with evidence.
