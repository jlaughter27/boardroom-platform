# PHASE 18 — Tasks & Prompts

---

## Task 18.1 — `LlmUsage` table + per-request accounting

**Scope:** Schema + accounting helper invoked from every Anthropic call site.

**Prompt:**
> In `packages/omnimind-api/prisma/schema.prisma`: add `LlmUsage(id, userId, model, inputTokens, outputTokens, cachedTokens, costCents, requestId, source enum('api','mcp','cortex','sdk'), createdAt)` with composite index on `(userId, createdAt)`. Generate Phase-15-compliant migration. In `packages/omnimind-api/src/llm/`: create `usage-accountant.ts` exporting `recordUsage(args): Promise<void>`. Compute `costCents` from token counts and a per-model pricing constant in `packages/shared/src/constants/llm-pricing.ts` (Sonnet 4.6 $3/$15/MTok input/output, cached $0.30/MTok; Haiku 4.5 $1/$5/MTok input/output, cached $0.10/MTok). Wrap every Anthropic call site (in `packages/boardroom-ai/server/src/agents/agent.ts`, in cortex jobs, in sufficiency-check, in extraction services) to call `recordUsage` after every successful response. The Anthropic response includes `usage` — pass it through. Use the active request's `userId` from context; fallback to `system` for cortex with the iterating userId from the loop.

**Verification:** Trigger a session, observe rows in `LlmUsage` matching the invoked personas; aggregate per user matches the observability metric `omnimind.anthropic.tokens.input`.

---

## Task 18.2 — Per-tenant daily caps + middleware

**Scope:** Plan-tier caps in constants; middleware that 429s on cap breach.

**Prompt:**
> In `packages/shared/src/constants/llm-budgets.ts`: define caps per plan tier — `free: { dailyCostCents: 50 }`, `pro: { dailyCostCents: 1000 }`, `team: { dailyCostCents: 10000 }`. Constants only; the actual per-user plan is read from `Subscription.tier`. In `packages/omnimind-api/src/middleware/token-budget.ts`: middleware that runs before any Anthropic-using route. Steps: read `userId` from auth, lookup plan, compute today's spend `SELECT SUM("costCents") FROM "LlmUsage" WHERE "userId" = $1 AND "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC')` (cache result for 30s per user with a small in-process LRU — no need for DB on every request), if > cap: return 429 with `Retry-After: <seconds_until_midnight_utc>` and a clear JSON error `{ error: { code: 'daily_token_budget_exceeded', message: '...', resetsAt: ISO_STRING } }`. Wire into routes that hit Anthropic. Add unit + integration tests.

**Verification:** Simulate spend up to cap; next request 429s; midnight UTC roll resets.

---

## Task 18.3 — Spend-velocity circuit breaker

**Scope:** Detect runaway loops; degrade gracefully.

**Prompt:**
> In `packages/omnimind-api/src/middleware/`: extend `token-budget.ts` (or a sibling) with velocity check. Compute hourly average over the prior 7 days for the user (cached 5 min). If current hour's spend > 5x average AND > $5 absolute, set an in-memory degradation flag for the user (TTL 30 min). When flag is set: middleware injects `X-Omnimind-Degraded-Mode: true` into the request; agent runtime checks the header and downgrades — Sonnet → Haiku, skip cortex enrichment, refuse premium personas. Emit observability event `omnimind.degraded_mode.engaged` with `userId`, `currentSpend`, `avgSpend`. Document the user-visible UX: "Activity above normal. Some advanced features paused for the next 30 min."

**Verification:** Simulate a runaway loop (script that fires 100 Sonnet requests/min); within minutes, degradation engages; observe Haiku fallback.

---

## Task 18.4 — DB-backed rate limiter

**Scope:** Replace in-memory `Map` with Postgres token-bucket.

**Prompt:**
> Read `packages/omnimind-api/src/middleware/rate-limiter.ts` to understand current behavior. In `packages/omnimind-api/prisma/schema.prisma`: add `RateLimitBucket(id, tenantId, bucketKey, tokens Int, lastRefillAt DateTime, @@unique([tenantId, bucketKey]))`. Generate migration. In `packages/omnimind-api/src/middleware/`: create `rate-limiter-pg.ts` implementing the same interface as the in-memory limiter but backed by Postgres. Use `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` for atomic refill+consume in one round trip. Use the formula: `new_tokens = LEAST(capacity, tokens + (now - lastRefillAt) * refill_rate) - 1`. Update `lastRefillAt = now()` and `tokens = new_tokens`. If new_tokens < 0, return 429. Run a graphile-worker-style cleanup cron deleting buckets unused for >24h. Add unit + integration tests including concurrency test (100 parallel requests should produce exactly the cap, no more). Dual-write period: emit metrics from BOTH limiters (`omnimind.rate_limit.decision` with `source: 'memory'|'pg'`) for 24h before flipping the read source. After cutover, leave the in-memory limiter as a deprecation shim that delegates.

**Verification:** Concurrency test green; behavior parity with in-memory under normal load; survives instance restart with no bucket loss.

---

## Task 18.5 — Postgres advisory-lock cron

**Scope:** Cortex jobs grab an advisory lock before firing.

**Prompt:**
> In `packages/omnimind-cron/src/jobs/`: wrap each cron callback with a `withAdvisoryLock(lockKey, fn)` helper. Implementation: `BEGIN; SELECT pg_try_advisory_lock(hash_of(lockKey)); if false: ROLLBACK; return; else: try { await fn() } finally { SELECT pg_advisory_unlock(hash_of(lockKey)); }`. Use a stable 64-bit hash of the job name as the lock key. Each job (weekly-memo, pattern-detection, contradiction-alerts, outcome-reviews, embedding-batch-drain, marketplace-scrape) gets its own lock. Add a unit test that simulates two replicas firing the same cron at the same time — only one should execute.

**Verification:** Run two `omnimind-cron` processes locally; both attempt to fire weekly-memo simultaneously; only one runs.

---

## Task 18.6 — Off-Railway nightly `pg_dump` to Backblaze B2

**Scope:** Cron job + secret + bucket.

**Prompt:**
> Provision a Backblaze B2 bucket (manual ops; document in `docs/DEPLOYMENT-RUNBOOK.md`). Create application keys with write-only access; store key ID + secret in Railway env (`B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET`, `BACKUP_ENCRYPTION_PASSPHRASE`). In `packages/omnimind-cron/src/jobs/`: add `nightly-backup.job.ts` running daily at 03:30 UTC. Steps: (1) `pg_dump -Fc -Z9 $DATABASE_URL > /tmp/dump-{ISO}.dump`, (2) encrypt with `age` or `gpg --symmetric --cipher-algo AES256 --batch --passphrase $BACKUP_ENCRYPTION_PASSPHRASE`, (3) upload to B2 via `b2-sdk-core` or shell out to `b2` CLI, (4) delete local file, (5) prune B2 to 30 days hot + monthly archive. On failure, alert via the Phase 14 alerting pipeline. Update Phase 15's restore drill runbook to use the B2 dump as source.

**Verification:** Manually trigger; observe encrypted dump in B2; decrypt locally; restore to a test DB; smoke-test green.

---

## Task 18.7 — Cortex on Anthropic Message Batches API

**Scope:** Migrate the 4 cortex jobs to Batches.

**Prompt:**
> Read [Anthropic Message Batches API docs](https://docs.anthropic.com/en/docs/build-with-claude/message-batches). In `packages/omnimind-cron/src/cortex/`: refactor `weekly-memo.job.ts` to: (1) collect all per-user prompts into a batch, (2) submit to `/v1/messages/batches`, (3) poll for completion (polling interval 5 min; max wait 24h), (4) on completion, fetch results, run the same per-result handlers as before. Add an `LlmBatch` table tracking `(id, type, providerBatchId, status, submittedAt, completedAt, userCount)`. Same refactor for pattern-detection, contradiction-alerts, outcome-reviews. Document the SLA change: weekly memos ship "by Mon 6pm UTC" not "Sun 6pm UTC". Update any UI surface that mentions a specific time. Verify cost reduction in observability — should see 50% drop in cortex Anthropic spend after a full week.

**Verification:** Batches submit, complete, and produce identical content to the synchronous version. Cost reduction observable.

---

## Task 18.8 — Batched OpenAI embeddings + parallelism

**Scope:** Replace sequential per-row OpenAI calls with batches.

**Prompt:**
> Refactor `packages/omnimind-cron/src/jobs/embedding-batch-drain.ts` (Phase 16) to: (1) drain up to 50 queue items per cycle, (2) call `openai.embeddings.create({ input: textsArray })` ONCE with all 50, (3) write all 50 embeddings back. Use `p-limit(5)` to allow up to 5 such batches in flight simultaneously across queue partitions (split by hash of memoryId mod 5). Honor 429s with `Retry-After`-aware backoff (the OpenAI SDK handles, verify). Confirm OpenAI tier (likely Tier 1-2) supports the throughput.

**Verification:** Embedding latency on a 200-item burst drops from ~80s to ~5-10s.

---

## Task 18.9 — Eval scenarios: enforcement under load

**Scope:** Three scenarios verifying enforcement actually works.

**Prompt:**
> In `eval/scenarios/`: (1) `token-budget-cap.scenario.ts` — drive a synthetic user past the daily cap; assert subsequent requests 429 with the right shape. (2) `rate-limiter-restart.scenario.ts` — fill a user's bucket to near-cap, restart the in-process simulator, verify the bucket persists and new requests honor the remaining tokens. (3) `cortex-single-fire.scenario.ts` — boot two cortex worker processes in-test (use child_process.fork), trigger the weekly-memo job at the same time on both, assert exactly one runs to completion. Add to `npm run eval:all` under the "scale-and-fairness" category.

**Verification:** All three pass consistently.
