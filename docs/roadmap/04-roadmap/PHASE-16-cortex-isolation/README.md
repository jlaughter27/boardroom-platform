# PHASE 16 — Cortex Isolation

**Time budget:** 2 weeks
**Sequence:** After Phase 14 (observability — needed to debug the new service) and Phase 15 (migration history — needed because two services now share the schema). May ship in parallel with Phase 17 if focus allows.
**Owner:** dev
**Confidence:** MED (operationally well-understood; risk is in subtle in-process assumptions that don't survive process splits)

---

## What this is

Move all cortex jobs (weekly memos, pattern detection, contradiction alerts, simulation) from the in-process `cortex-scheduler.ts` running inside `omnimind-api` into a **dedicated Railway service** (`omnimind-cron`) that shares the same monorepo, same Postgres, same env conventions, but runs as a separate process.

Concretely:

- **Same monorepo, separate Dockerfile entry.** `packages/omnimind-cron/` contains a thin `index.ts` that boots, connects to Postgres, registers cron schedules, and runs forever. Reuses every service from `packages/omnimind-api/src/services/` and `packages/omnimind-api/src/cortex/` without copy-paste — these are imported via the workspace.
- **Single replica.** No coordination needed; one process, one cron firing, no leader election required (a second replica would need Postgres advisory locks, which is Phase 19 territory).
- **Same DB, separate connection pool.** New Prisma client instance with `connection_limit=5` (lower because cortex is bursty, and we want the API to keep its share of the 100-connection cap).
- **Cron jobs migrated:** weekly memo (Sunday 6pm UTC), pattern detection (Monday 3am UTC), contradiction alerts (Tuesday 9pm UTC), nightly outcome reviews. Plus the embedding queue worker (moves from in-process `setInterval` to a cortex-service node-cron job).
- **API keeps zero cron.** After cutover, `packages/omnimind-api/src/jobs/cortex-scheduler.ts` is removed. The API process becomes purely request/response, dramatically simplifying its event-loop story.
- **Observability inherited from Phase 14.** Cortex traces appear in the same vendor; a cortex job's spans link back to the originating user/memory via the `userId` attribute.
- **Outbox emit unchanged.** Cortex jobs write `OutboxEvent` rows in the same DB; the in-process delivery worker (still in `omnimind-api` for v1) drains them — same as before.

---

## Why now

1. **Event-loop relief.** Today, a long cortex job blocks the API's event loop and spikes p99 latency for every user. The Wave 1 audit estimated 10-15 min p95 windows of degradation per cortex run at 2000 users. Splitting eliminates this entirely.
2. **Independent scaling.** Cortex needs more memory (cumulative LLM context); API needs more CPU. Splitting lets each scale on its own dimension.
3. **Independent deployment cadence.** Cortex changes (prompt tweaks, new patterns) ship without redeploying the API. Faster iteration on the intelligence layer without touching the user-facing surface.
4. **Failure isolation.** A cortex bug that crashes the process no longer takes down the API. (Today, an OOM in cortex restarts the API.)

## Prerequisites

- Phase 14 (observability) complete — must be able to debug the new service in production
- Phase 15 (migration history) complete — two services sharing a schema demand migration discipline
- Decision: keep the `OutboxEvent` delivery worker in `omnimind-api` for v1. Phase 18 may move it to cortex if delivery throughput demands it.

## Exit criteria

- [ ] New `packages/omnimind-cron/` exists with its own `package.json`, `tsconfig.json`, `Dockerfile`, `docker-entrypoint.sh`
- [ ] All 4+ cortex jobs (weekly memo, pattern detection, contradiction alerts, outcome reviews) run from `omnimind-cron` and NOT from `omnimind-api`
- [ ] `packages/omnimind-api/src/jobs/cortex-scheduler.ts` deleted (or guarded by `CORTEX_IN_API=true` flag for emergency rollback)
- [ ] `packages/omnimind-api/src/index.ts` no longer imports cortex-scheduler
- [ ] Embedding queue worker moved to `omnimind-cron` (was an in-process `setInterval` in the API)
- [ ] Railway has TWO services deploying from the same monorepo: `omnimind-api` (existing) and `omnimind-cron` (new)
- [ ] Both services share `DATABASE_URL`, `OMNIMIND_API_KEY`, etc.; cortex service additionally has `CORTEX_PRISMA_CONNECTION_LIMIT=5`
- [ ] Cron jobs visible in observability (Phase 14) with traces and metrics
- [ ] Eval scenario: trigger a long cortex run; assert API p95 latency unaffected
- [ ] `docs/contracts/cortex-isolation.contract.md` documents the boundary (what cortex owns, what it shares with API)
- [ ] `docs/DEPLOYMENT-RUNBOOK.md` updated for the second service: how to deploy, how to roll back independently, how to inspect cron schedules

## Dependencies

- **Upstream:** Phase 14 (observability), Phase 15 (migrations)
- **Downstream blocks:** Phase 18 (multi-tenant fairness — easier to enforce per-tenant token budget when cortex spend is isolated); Phase 19 (horizontal scale — API scaling separable from cortex)
- **Concurrency:** Can ship in parallel with Phase 17 (persona marketplace) — no shared files

## Blast radius

- **New deploy target.** The Railway monorepo deploy needs to be configured for two services from one repo. Railway supports this; verify configuration before starting.
- **Schema sharing.** Two services writing to the same DB. Mitigation: cortex writes only to cortex-owned tables (`ThinkingPattern`, `ContradictionAlert`, `WeeklyMemo`, `OutcomeReviewNudge`, `OutboxEvent`); cortex reads from many tables. Document the boundary in the contract.
- **Risk:** in-process state (cortex feature flags, cached prompt loads) becomes per-service. If a flag is set in API but cortex doesn't see it, behavior diverges. Mitigation: every flag reads from env or DB, never in-memory.
- **Rollback:** `CORTEX_IN_API=true` env flag re-enables the in-process scheduler in `omnimind-api`. Cortex service can be paused; jobs continue from API. Verify both code paths in staging before relying on this.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
