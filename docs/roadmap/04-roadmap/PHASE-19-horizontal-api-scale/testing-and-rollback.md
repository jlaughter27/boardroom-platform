# PHASE 19 — Testing & Rollback

## Verification

1. **Pre-flight audit:** Task 19.1's `pgbouncer-compatibility-audit.md` reviewed; remediations applied. This is the single most important pre-cutover gate.
2. **PgBouncer cutover:** staging on PgBouncer for 7 days with zero new error classes. Connection count drops; latency flat; trace spans show the PgBouncer hop.
3. **graphile-worker:** embedding latency p95 < 50ms (was ~200ms); outbox deliveries fire within 100ms of write.
4. **Cloudflare:** `cf-ray` present; cached endpoints HIT; rate limit triggers on a synthetic flood.
5. **Sticky sessions:** SSE streams served by single replica throughout; failover test passes.
6. **Load test:** 2x peak load passes the documented criteria.
7. **All Phase 18 evals re-run:** advisory-lock cron, rate limiter durability, token cap enforcement — all green under multi-replica.
8. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.
9. **Cost dashboard:** Phase 14's weekly cost report continues to land; per-replica costs visible.

## Rollback

**Per-cutover rollback (each cutover is independent):**

**PgBouncer rollback:**
- Revert `DATABASE_URL` to point at Postgres directly (not PgBouncer). Redeploy. ~3 min.
- PgBouncer service stays running (idle); leave for next attempt.

**graphile-worker rollback:**
- Revert the merge that switched embedding-queue and outbox-delivery to graphile-worker.
- The Phase 16 `EmbeddingQueueItem` polling worker resumes (file restored from git history).
- Phase 12's outbox delivery worker resumes its node-cron polling.
- `graphile_worker` namespace tables stay in Postgres (no harm; can be dropped later).

**Multi-replica rollback:**
- In Railway, scale `omnimind-api` back to 1 replica. ~1 min.
- Sticky session config can stay (no harm with 1 replica).
- This rollback is the cheapest in the phase.

**Cloudflare rollback:**
- Toggle DNS proxy from orange cloud to grey cloud (DNS-only). ~1 min for global propagation.
- WAF and rate limit rules stay configured; just inactive.
- If Cloudflare itself is the problem (configuration mistake), this is a 1-min escape hatch.

**Hard rollback (revert Phase 19 entirely):**
- Run all four per-cutover rollbacks in any order.
- Schema additions from Task 19.4 (graphile-worker namespace) stay; harmless.

**Failure modes to watch:**
- **PgBouncer "server closes connection" errors.** Usually means a Prisma operation expects a session-pinned feature (LISTEN, advisory lock across statements, prepared statement). The audit (Task 19.1) should catch these; if not, rollback while patching.
- **Sticky session breaks on failover.** Client retries against a different replica with a stale session ID; SSE state lost. Mitigation: BoardRoom client gracefully retries on `409` and re-establishes the SSE stream; document the user-visible re-load.
- **Cloudflare cache poisoning.** A misconfigured cache rule serves stale data to other users. Mitigation: cache only static endpoints (`/health`, `/openapi.json`); never cache anything that includes user data; verify with `Vary` headers and explicit cache-busters.
- **graphile-worker race condition.** The job claim race is well-tested in graphile-worker's library, but if you accidentally enqueue the same job twice (e.g., on a write retry), you process it twice. Mitigation: use `addJob` with a deterministic `job_key` to dedupe.
- **Replica drift in feature flags.** A flag set via in-memory toggle on one replica isn't visible on others. Audit: every feature flag must read from env or DB, never in-memory. (Phase 18's velocity-breaker degradation flag — verify this is per-tenant in DB, not per-replica.)
- **Postgres `max_connections` cap surprise.** Even with PgBouncer, if cortex + bouncer + replicas + maintenance connections exceed 100, Postgres rejects. Monitor `pg_stat_activity` count; alert at 80% of cap.
- **graphile-worker requires direct Postgres connection** (LISTEN/NOTIFY doesn't work through PgBouncer). cortex service uses direct connection; verify after Task 19.4.
