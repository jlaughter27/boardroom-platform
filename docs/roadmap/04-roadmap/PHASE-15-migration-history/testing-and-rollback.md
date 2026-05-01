# PHASE 15 — Testing & Rollback

## Verification

1. **Staging dry-run end-to-end:** every task from 15.2 through 15.5 executes against staging cleanly before any prod work. Treat staging as a complete rehearsal.
2. **Baseline parity:** `migrate diff --from-empty --to-url=$PROD_URL --exit-code` returns 0. Every CREATE TABLE, every INDEX (including pgvector and pg_trgm), every CONSTRAINT in the baseline matches prod exactly.
3. **`migrate status` clean:** on prod, staging, and dev environments after Task 15.6.
4. **Entrypoint behavior:** prod deploy logs show `prisma migrate deploy` executing on boot, not `prisma db push`. The `--accept-data-loss` flag is gone from all entrypoints.
5. **Drift CI:** induced drift (apply a manual schema change to staging without a migration) triggers the nightly Slack alert.
6. **PR check:** a PR modifying `schema.prisma` without a migration is blocked; a PR with both passes.
7. **Restore drill:** the first quarterly drill (Task 15.8) completes cleanly within the documented time budget.
8. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Critical: Phase 15 has the highest rollback complexity in the make-it-10 + scale block.** Treat the cutover (Task 15.6) as a planned ops event with a 2-hour rollback budget.

**During cutover (within first 2 hours):**

If `migrate resolve --applied 0_init` corrupts `_prisma_migrations`:
- `DELETE FROM _prisma_migrations WHERE migration_name = '0_init';`
- Re-attempt with corrected baseline.

If the new entrypoint fails to boot:
- Revert `docker-entrypoint.sh` to `prisma db push --skip-generate` (NOTE: do NOT re-add `--accept-data-loss`; the staging dry-run should have caught any schema mismatch).
- Investigate offline; redo the cutover later.

If smoke tests fail post-cutover:
- Revert the entrypoint, redeploy.
- Schema is unchanged because the baseline is metadata-only — no data risk.

**After cutover (>2 hours, accepting some risk):**

- Subsequent migrations rely on the new system. Reverting requires deleting all migrations applied since cutover from both `_prisma_migrations` AND from the `prisma/migrations/` directory.
- If data corruption is detected, restore from the pre-cutover `pg_dump` (Task 15.1 produced this). Acceptable RPO is "since cutover" — typically a few hours.

**Failure modes to watch:**
- **Hidden drift between staging and prod.** Mitigated by Task 15.1's `prisma db pull` comparison. If it surfaces drift, fix it BEFORE baselining.
- **pgvector index DDL mismatch.** The baseline must encode the exact index that prod has. If prod is on IVFFlat with `lists=100` and the baseline emits HNSW, every restore will produce the wrong index. Verify by `\d+ "MemoryEntry"` against prod immediately before cutover.
- **Forgotten `migrate resolve` on dev environments.** Every developer's local DB needs `migrate resolve --applied 0_init` once. Document loudly in `CLAUDE.md` and the dev onboarding doc.
- **CI drift check noise.** A non-Prisma-aware DBA performing a manual ALTER trips the alert. That's the alert working. Document as expected behavior; have an "ack and amend the migration" runbook.
- **`migrate deploy` slow on cold boot.** First deploy after cutover may add a few seconds to startup as Prisma checks `_prisma_migrations`. Acceptable; verified during staging dry-run.
