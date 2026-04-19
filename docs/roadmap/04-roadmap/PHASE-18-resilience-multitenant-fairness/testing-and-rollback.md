# PHASE 18 — Testing & Rollback

## Verification

1. **Token accounting accuracy:** sum `LlmUsage.costCents` per user matches the observability counter sum within 1%. Daily reconciliation script flags drift >1%.
2. **Cap enforcement:** `eval/scenarios/token-budget-cap.scenario.ts` passes; manual: drive a test user past cap, observe 429.
3. **Velocity breaker:** spend-velocity simulation triggers degraded mode within 5 min of detection.
4. **Rate limiter parity:** dual-write 24h period shows zero divergence between memory and DB decisions. After cutover, behavior unchanged from user perspective.
5. **Rate limiter durability:** restart the API instance mid-traffic; observe buckets persisted and request limits honored across the restart.
6. **Cron single-fire:** `eval/scenarios/cortex-single-fire.scenario.ts` passes.
7. **Backup restore:** Phase 15's restore drill (now using B2 dumps) executes cleanly.
8. **Cortex Batches savings:** 1 week post-cutover, cortex Anthropic spend in dashboards is ≥40% lower than the 4-week pre-cutover baseline.
9. **Embedding throughput:** 200-item burst drains in ≤15s (was ~80s).
10. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Per-task soft rollback flags:**
- `TOKEN_BUDGET_ENFORCEMENT_ENABLED=false` — middleware logs decisions but doesn't 429.
- `VELOCITY_BREAKER_ENABLED=false` — degradation never engages.
- `RATE_LIMITER_SOURCE=memory|pg` — switch the read source. Memory is the legacy path; left as escape hatch for 30 days.
- `CRON_ADVISORY_LOCK_ENABLED=false` — cron fires from every replica (fine until replicas exist).
- `CORTEX_USE_BATCHES=false` — cortex falls back to synchronous Anthropic calls.

**Hard rollback (revert):**
- Revert per-task. Each task is independently revertible because flags isolate them.
- Schema additions (`LlmUsage`, `RateLimitBucket`, `LlmBatch`) stay (additive; safe).
- B2 bucket and credentials stay (no harm).

**Customer-impact rollback:**
- If token caps cause unexpected user lockouts, rapidly raise the cap constants in `packages/shared/src/constants/llm-budgets.ts` and redeploy. ~5 min to ship.
- For grandfathered users (pre-Phase-18 power users), set per-user cap overrides via a `UserOverride.dailyCostCentsCap` field (sparse override row). Document the override workflow in the runbook.

**Cost emergency:**
- A bug in usage accounting double-charging users: set `TOKEN_BUDGET_ENFORCEMENT_ENABLED=false` immediately; investigate offline. The middleware was authoritative; users can keep operating while we fix.

**Failure modes to watch:**
- **Pricing constant drift.** Anthropic and OpenAI reprice; constants in `llm-pricing.ts` go stale. Add a quarterly review item; observability shows the cents-per-call ratio over time as a sanity check.
- **Time zone drift.** "Daily" is UTC. A user in PST sees their cap "reset" at 4-5pm local. Document loudly; consider per-user time zone in v2.
- **Rate limiter contention hot spot.** A single popular endpoint produces row-lock contention on `RateLimitBucket`. Mitigation: per-tenant rows are naturally sharded; if needed, add `bucket_key` salting. Verify under load.
- **Backup encryption passphrase loss.** If we lose `BACKUP_ENCRYPTION_PASSPHRASE`, all B2 dumps are useless. Mitigation: store the passphrase in a password manager outside the team's normal env-var rotation; document recovery procedure.
- **Batches API edge cases.** Anthropic Batches doesn't support every feature (streaming, prompt caching may differ). Verify the cortex prompts are compatible; fall back to sync for any incompatible cases.
- **Velocity breaker false positives.** A legitimate user with a sudden burst (e.g., bulk import) trips degraded mode. Mitigation: tune thresholds in staging using real traffic; add a `User.bypassVelocityBreaker` field for trusted accounts.
