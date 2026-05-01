# PHASE 18 — Resilience & Multi-Tenant Fairness

**Time budget:** 2 weeks
**Sequence:** After Phase 16 (cortex isolation) and Phase 17 (marketplace). Before any horizontal scale work — Phase 19 depends on the durable rate limiter and outbox shipped here.
**Owner:** dev
**Confidence:** HIGH (well-trodden patterns; biggest risk is migration of in-memory state to Postgres without losing in-flight work)

---

## What this is

Three intertwined investments to ship **before** the user count crosses ~500:

1. **Per-tenant token budget enforcement** — the highest-ROI fix per the audit. Without it, one runaway user can burn $50+/day on Anthropic spend. Adds a `LlmUsage` table, per-request accounting, midnight reset cron, middleware that blocks requests once daily cap is hit.
2. **DB-backed rate limiter** — replaces the in-memory `Map<string, RateBucket>` with a Postgres token-bucket table. Survives restarts; coordinates across instances (necessary for Phase 19); keeps ADR-009 alive (no Redis).
3. **Postgres-locked cron** — even though cortex is isolated (Phase 16), if we ever scale cortex to >1 replica, two processes firing the same cron is a duplicate-write bug. Add Postgres advisory-lock leader election so cron runs only on whichever replica grabs the lock.

Plus three additional resilience improvements bundled in the same phase because they're cheap and synergistic:

4. **Off-Railway nightly `pg_dump`** to Backblaze B2 — disaster recovery beyond Railway's snapshot story.
5. **Anthropic Message Batches API for cortex** — 50% cost reduction on weekly memos / pattern detection / contradictions, all of which tolerate >1h latency.
6. **OpenAI batched embeddings** — 50-input batches with `p-limit(5)` parallelism, replacing per-row sequential calls. (Technically a Phase 16 quick win; finalized here as part of the fairness story.)

---

## Why now

1. **Billing risk.** No per-tenant cap = one user can produce a $1500/mo Anthropic bill. Blocks any freemium tier.
2. **Multi-instance enabler.** The in-memory rate limiter is the single largest blocker to running >1 API replica; Phase 19 cannot ship until this is out of process.
3. **Cost optimization.** The Batches API is free money — 50% off cortex spend with no UX impact.
4. **DR insurance.** Off-Railway backups protect against credential compromise or account loss; a single cheap weekly job.

## Prerequisites

- Phase 14 (observability) complete — token budget consumption visible in dashboards
- Phase 16 (cortex isolation) complete — Anthropic Batches API integration is in cortex, not API
- Backblaze B2 (or S3-compatible) bucket provisioned for backups
- Decision: graphile-worker or stay on node-cron. Default: stay on node-cron until Phase 19 demands graphile-worker; this phase adds Postgres advisory locks instead.

## Exit criteria

- [ ] `LlmUsage(userId, model, inputTokens, outputTokens, cachedTokens, costCents, requestId, createdAt)` table exists; populated on every Anthropic call
- [ ] Per-tenant daily caps configured per plan tier (free, pro, team) in `packages/shared/src/constants/`
- [ ] Token-budget middleware blocks requests when `today_spend > plan_cap`; returns 429 with `Retry-After: <seconds-until-midnight-utc>`
- [ ] Spend-velocity circuit breaker: 5x hourly average for 5 min → degraded mode (Haiku-only, no cortex)
- [ ] `RateLimitBucket(tenantId, bucketKey, tokens, lastRefillAt)` table replaces the in-memory `Map`
- [ ] In-memory rate limiter file moved to a deprecation shim that delegates to the DB-backed version
- [ ] Cortex jobs use Postgres advisory locks (`SELECT pg_try_advisory_lock(hash)`) before firing — second replica skips
- [ ] Nightly `pg_dump` job pushes encrypted dump to Backblaze B2; retention 30 days hot, monthly archive
- [ ] Restore drill (Phase 15) uses the off-Railway dump as source
- [ ] Cortex Anthropic calls migrated to Message Batches API; cost reduction visible in observability dashboards
- [ ] Embedding pipeline uses batched OpenAI calls (50-input batches, p-limit 5)
- [ ] Eval scenarios: token-cap enforcement, rate limiter survives instance restart, cortex single-fire across simulated replicas

## Dependencies

- **Upstream:** Phase 14 (observability), Phase 16 (cortex isolation)
- **Downstream blocks:** Phase 19 (horizontal scale) — every item here is a prerequisite
- **Concurrency:** Sequential before Phase 19. Several internal tasks parallel-safe.

## Blast radius

- **Token budget middleware** changes the user-visible failure mode for high-spend accounts (was "no limit"; now "429 with Retry-After"). Communicate to existing users; grandfather any unintended power users for 30 days.
- **Rate limiter migration** must preserve in-flight buckets across the cutover. Mitigation: dual-write period (write to both Map and DB; read from DB; remove Map after 24h).
- **Postgres advisory locks** are auto-released on session end; verify behavior survives connection pool reuse.
- **Backups** add ~10MB/day egress on Railway. Negligible.
- **Batches API** delays cortex by up to 24h; document the SLA explicitly. Weekly memos ship Sun 6pm; with Batches, "ship by Mon 6pm" — communicate to any UI surface.
- **Rollback:** every item has an env flag; can revert individually.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
