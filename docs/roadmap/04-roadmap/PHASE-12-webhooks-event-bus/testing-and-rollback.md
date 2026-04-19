# PHASE 12 — Testing & Rollback

## Verification

1. **Transactional integrity:** integration test `tests/integration/events/transactional-emit.test.ts` forces a memory write to fail mid-transaction; assert no `OutboxEvent` row was committed. This is the most important test in the phase — broken transactional emit = silent event loss.
2. **End-to-end emit → deliver:** integration test registers a mock endpoint, triggers a memory write, observes a signed POST to the mock within 10s, verifies the HMAC signature.
3. **Retry math:** unit test on the backoff calculator.
4. **Dead-letter:** `npm run eval:all` includes `webhook-dead-letter.scenario.ts` and exits 0.
5. **Per-tenant isolation:** events for user A are never delivered to user B's endpoints. Eval scenario in `mcp-tenant-isolation.scenario.ts` extended to webhooks.
6. **Replay UX:** admin replay endpoint exercised manually; observe successful delivery and audit log entry.
7. **Signature verification:** the worked example in `docs/USER-WEBHOOKS-GUIDE.md` is copy-pasted into a fresh Node project and verifies a real delivery without modification.
8. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Soft rollback:**
- Set `WEBHOOKS_DELIVERY_ENABLED=false` to stop the delivery worker. Outbox events keep accumulating (cheap; cleaned up by a separate cron after a configurable retention). Re-enable resumes delivery with no event loss.
- Set `WEBHOOKS_API_ENABLED=false` to disable user-facing endpoint registration; existing endpoints continue to receive events while delivery is on.

**Hard rollback (revert):**
- Revert the merge. New routes, new tables, new files.
- The three new tables can be dropped via a separate migration, or left in place (no harm).
- The transactional `emitEvent` calls need to be removed from the existing write paths — the revert handles this automatically.
- User-facing impact: any endpoints users registered are gone; they'd need to re-register on a re-roll-forward.

**Data integrity rollback:** events sitting in the outbox at revert time are unprocessed. They're safe in Postgres; on re-enable, they'd flush. If you want to prevent this, `UPDATE "OutboxEvent" SET "processedAt" = now() WHERE "processedAt" IS NULL;` before revert to mark them all processed.

**Failure modes to watch:**
- **Outbox table growth.** At 1k events/day, 30d retention = ~30k rows. Trivial. At 1M events/day, partition by day. Add the partition migration in Phase 18 if needed.
- **Slow delivery worker becomes the bottleneck.** A single in-process worker draining 100 events/cycle every 5s = 20 events/sec ceiling. Plenty for v1; if not, add `pLimit(20)` parallel HTTP delivery within a cycle.
- **Bad subscriber timing out.** A subscriber holding 10s on every request will starve the worker. Mitigation: per-endpoint circuit breaker (open after 5 consecutive timeouts; cool down 5 min); deliveries skip-and-retry-later.
- **Replay storm.** An admin bulk-replay can spike the worker. Bulk replays insert `nextAttemptAt` jittered within a 60s window, not all at `now()`.
