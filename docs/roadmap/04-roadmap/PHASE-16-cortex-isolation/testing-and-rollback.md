# PHASE 16 — Testing & Rollback

## Verification

1. **Job parity:** every cron job that ran in-process produces identical output when run from the cortex service. Spot-check the first weekly memo, the first pattern-detection batch, the first contradiction-alert batch in staging. Compare row counts and content samples to a baseline run.
2. **Schedule fidelity:** each job fires at its documented UTC time. Verify across one full week.
3. **Embedding queue:** memory writes still get embedded within the same SLA (<10s for short text, <60s for long). Compare latency distribution to pre-Phase-16 baseline.
4. **API event loop:** the API service no longer emits `cortex.*` spans. Verify in observability after Task 16.7.
5. **Latency eval:** `eval/scenarios/cortex-isolation-latency.scenario.ts` passes — API p95 increase during cortex run <20% (versus ~10x before).
6. **Independent deploy:** push a no-op change to a cortex-only file; verify only the cortex service redeploys, not the API. Conversely, push to an API-only file; verify only API redeploys.
7. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Soft rollback (within hours of cutover):**
- Set `CORTEX_IN_API=true` in API service env; restore `packages/omnimind-api/src/jobs/cortex-scheduler.ts` from git history; redeploy API. The API resumes running cron in-process. Pause the cortex service in Railway (or scale to 0 replicas).
- Embedding queue: if Task 16.5's external queue table is causing issues, revert that commit; the in-process queue resumes. The `EmbeddingQueueItem` table can stay (no harm) or be dropped later.

**Soft rollback (after Task 16.7's deletion):**
- The deletion in Task 16.7 is the point of no return. Before that, rollback is one-line.
- After deletion: revert the deletion commit, redeploy. ~5 min.

**Hard rollback (revert Phase 16 entirely):**
- Revert all merge commits for Phase 16. Pause the cortex service in Railway.
- Schema additions (`EmbeddingQueueItem`) can stay (no harm) or be dropped via a separate migration after the dust settles.
- Railway "omnimind-cron" service can be deleted from the project (or paused indefinitely).

**Failure modes to watch:**
- **Two cron processes firing simultaneously.** During the staging dual-run period (Tasks 16.3-16.6 with `CORTEX_IN_API=true`), BOTH the API's in-process scheduler and the cortex service would fire the same job. The feature flag skip in Task 16.3 prevents this. Verify the flag works in staging before any prod cutover.
- **Connection pool starvation.** Cortex's `connection_limit=5` plus API's default 10 = 15 connections per replica pair. Below the Postgres 100 cap; safe. If a future replica scale-out (Phase 19) pushes this past 100, PgBouncer in Phase 18 absorbs.
- **Schema migrations blocked by cortex.** A long-running cortex transaction holding a row lock can block a Prisma migration. Mitigation: cortex jobs use short transactions (per-user, not per-batch); never hold a transaction open across an LLM call.
- **In-process state assumed by reused services.** If an API service relies on in-process caching, it won't share state across processes. Each cortex import that pulls an API service should be reviewed: any module-level mutable state is a divergence risk.
- **OTel service name collision.** Both services accidentally booting with `OTEL_SERVICE_NAME=omnimind-api` would mix traces. Verify env var per-service.
