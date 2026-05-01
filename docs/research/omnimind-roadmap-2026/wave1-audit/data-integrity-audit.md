# Wave 1 Audit — Data Integrity

**Scope:** OmniMind API persistence layer, embedding pipeline, Stripe/OAuth integrations, schema/migration drift, recovery readiness.
**Branch:** `feature/folder-migration` (HEAD `3be89cc`)
**Severity scale:** 1 = catastrophic data loss / silent corruption affecting all users · 2 = high (data loss for some users, recoverable with effort) · 3 = medium (degrades trust, recoverable) · 4 = low (latent risk, no immediate impact) · 5 = cosmetic.

---

## A. Critical data-loss landmines (must fix Phase 0/1)

### A1 — `prisma db push --accept-data-loss` runs on every container boot · Severity 1
**File:** `packages/omnimind-api/docker-entrypoint.sh:16`
```sh
prisma db push $SCHEMA --skip-generate --accept-data-loss 2>&1
```
This is the production entrypoint on Railway (confirmed via `Procfile` + `Dockerfile`). On every restart, Prisma diffs `schema.prisma` against the live DB. The `--accept-data-loss` flag means Prisma will silently `DROP COLUMN` / `DROP TABLE` whenever a schema change implies it — without a migration history to record it. Realistic loss scenarios:

1. Renaming a column in `schema.prisma` (Prisma sees drop-old + add-new → all data in old column lost).
2. Narrowing a type (`String` → `Int`) → column dropped + recreated → data lost.
3. Removing the `searchVector Unsupported("tsvector")?` field from schema (already a hot candidate; see D2) — `db push` will drop the column and the GIN indexes that depend on it.
4. A teammate's local `prisma db push` against a hot-fixed schema gets reverted on next deploy because the `schema.prisma` in `main` doesn't match.
5. Restoration from backup: restored DB has a column the schema lost → entrypoint drops it on first boot of the restored instance.

**Mitigation (Phase 1, hard requirement):**
- Replace line 16 with `prisma migrate deploy`, drop `--accept-data-loss`.
- Generate baseline migration before flipping (`prisma migrate diff --from-empty --to-schema-datamodel ...`); see D1.
- Add `MIGRATE_PROTECTION=1` env-gate so `db push` only runs in dev.

### A2 — In-process embedding queue loses jobs on restart · Severity 1
**File:** `packages/omnimind-api/src/services/embedding-queue.ts:19`
```ts
const queue: EmbeddingJob[] = [];
let workerRunning = false;
```
The queue is a plain in-memory array. Railway redeploys / OOM kills / `node` crashes silently throw away every queued job. Entry points that enqueue and rely on it:

- `memory.service.ts:59` — `createMemory()` queues `'high'` priority for every newly created memory. If the API restarts in the 1–60s window between insert and embedding generation, that memory is permanently `embedding IS NULL` (until manual backfill).
- `memory.service.ts:162` — `updateMemory()` requeues on title/content edit (`'normal'`).
- `embedding-queue.ts:176` — `queueBackfill()` admin trigger.
- `_disabled/mem0-entity-pipeline.ts:279,566` — quarantined but live in git, easy footgun if anyone re-enables.

**Compounding factors:**
- No persistence of `attempts`/`error` — failed jobs disappear after 3 attempts (line 108) with only a log line.
- A second in-memory queue exists in `incremental-embedding.service.ts:25` (`pendingQueue`) with the same defect.
- `embedding-queue.ts:108` removes failed jobs from the queue after 3 attempts but does NOT mark the row in the DB, so there's no way to detect "embedding permanently failed" from a query.

**Mitigation (Phase 1):**
- Add nullable `embedding_status` enum + `embedding_attempts int` + `embedding_last_error text` columns to `memory_entries`. Mark `'pending'` at create time so the failure is observable.
- On boot, sweep `WHERE embedding IS NULL AND embedding_status='pending' AND created_at > NOW() - interval '7 days'` and re-enqueue.
- Phase 2: replace with PostgreSQL-backed job queue (`pg-boss` is the lightest fit — keeps the "no Redis" rule from ADR-009 intact).

### A3 — Subscription middleware fails open on **every** unrelated error · Severity 2
**File:** `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts:31-34`
```ts
} catch {
  // If subscription check fails, let the request through (don't block on billing service errors)
  next();
}
```
The bare `catch` swallows everything including 401/403/500 from OmniMind, JSON parse errors, and TypeError on `sub.status`. Three concrete scenarios:

1. OmniMind API key rotates → `omnimindClient.getSubscription` throws `OmnimindAuthError` → user gets full Pro features for free.
2. Circuit breaker trips (resilience layer in `omnimind-client.ts`) → all paid features are unlocked platform-wide for the breaker cooldown.
3. Stripe webhook fired `customer.subscription.deleted` while OmniMind was down → user has `null` sub but `STRIPE_SECRET_KEY` is set, so the failing-open path runs.

**Mitigation:** narrow the catch to `OmnimindUnavailableError` only, log structured error with `userId`+`requestId`, and either (a) cache the last known subscription state per user (TTL = 60 s) and serve that, or (b) fail closed on hard 4xx and fail open only on transient network errors. Add a counter metric `subscription_check_failed_open_total{reason=...}` so we see drift.

### A4 — Stripe webhooks have no idempotency or signature replay protection · Severity 2
**File:** `packages/boardroom-ai/server/src/services/stripe.service.ts:44-107`
`handleWebhook` processes every event the moment it arrives. No `event.id` dedup, no record table, no transactional write. Failure modes:
- Stripe retries are inevitable (network blips, 5xx replies). A repeated `checkout.session.completed` will call `omnimindClient.createSubscription` twice. The OmniMind route (`subscription.routes.ts:26 POST /`) calls `prisma.subscription.create` — the unique on `userId` (schema line 715) will throw P2002, but the error escapes (no try/catch), so Stripe gets a 500 and retries forever, eventually disabling the endpoint.
- `invoice.paid` followed by `invoice.payment_failed` arriving out of order leaves the user permanently `PAST_DUE` even though they paid.
- No reconciliation job. If a webhook is missed (Stripe dashboard → "Failed deliveries"), nothing ever pulls subscription truth back from Stripe.

**Mitigation:** add `processed_stripe_events(id text primary key, processed_at timestamptz)` table; `INSERT ... ON CONFLICT DO NOTHING` first, return 200 if already present. Add a daily cron that lists Stripe subscriptions for users updated in the last 24 h and reconciles status.

### A5 — `commitment.update` skips version increment · Severity 3
**File:** `packages/omnimind-api/src/services/commitment.service.ts:64`
```ts
return prisma.commitment.update({ where: { id }, data: data as any });
```
Every other entity service (`memory.service.ts:156`, `entity.service.ts:82`, `decision.service.ts:94`) increments `version`. Commitment doesn't even though the column exists in some shape (commitments lacks a `version` column on the model — verify), so two concurrent edits silently overwrite each other with last-write-wins. Same pattern check needed in `user-profile.service.ts:43` (no version field), `cortex-contradictions.service.ts:118` (no version), `oauth.routes.ts:33` (`upsert` overwrites accessToken with no compare-and-swap — fine for tokens, dangerous if the refresh job races a UI reconnect).

---

## B. Silent corruption risks

### B1 — `MemoryEntry.version` is performative, not enforced · Severity 2
**File:** `packages/omnimind-api/src/services/memory.service.ts:139-168`
`updateMemory` does `version: { increment: 1 }` but the `where` clause never includes the expected version. So two concurrent PATCHes both pass ownership check (line 146), both call `update` with `{ id }` only, and the second wins. Version goes from 1 → 3 silently and the first writer's payload is lost. Same pattern in `decision.service.ts:90` and `entity.service.ts:82`. The "optimistic concurrency" comment (line 151) is aspirational, not implemented.

**Fix:** require `If-Match: <version>` header, do `prisma.memoryEntry.update({ where: { id, version: expected } })`. P2025 → return 409.

### B2 — Embedding write path has no failure observability · Severity 2
The flow is: `createMemory` → row written with `embedding IS NULL` → `queueEmbedding(...).catch(log)` → background worker → `embedMemory()` (`embedding.service.ts:57-79`) → on permanent failure logs `Embedding generation permanently failed` and **returns void**. The memory row is never marked. `getEmbeddingStatus` (`embedding.service.ts:118`) reports `'pending'` for both "haven't started yet" and "failed forever" states — same observable, different reality.

**Fix:** write a column. See A2 mitigation.

### B3 — Soft-delete is application-layer only and not cascading · Severity 2
- All FK relations are `onDelete: Cascade` (schema lines 60-61, 82, 99, 114, etc.). When a `User` is **hard** deleted, everything cascades. But there's no hard delete anywhere in the codebase, only soft (`deletedAt = now()`).
- When `User.deletedAt` is set (no field on User actually — see schema line 21-35, **no soft-delete column on User at all**), nothing prevents the rest of the data from looking live: `MemoryEntry.deletedAt` stays null, `Project.deletedAt` stays null, retrieval returns rows for an account that isn't supposed to exist.
- `MemoryEntityLink` has no `deletedAt` (schema line 510-522). When you soft-delete a `MemoryEntry`, the link rows survive and the join from a Project still finds the (soft-deleted) memory row only because `entity.service.ts` filters parent on `deletedAt: null`. Any caller that queries `MemoryEntityLink` directly without the parent filter sees ghosts. Same risk for `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink` — none have `deletedAt`.
- `MemoryEntry.supersededBy` (line 198) is never written by any code path searched — dead column, but worth noting because supersession semantics are advertised in `MASTER-FRAMEWORK.md`.

**Fix:** (a) add `deletedAt` to `User`, write a cascade-soft-delete service. (b) Add partial unique indexes / partial indexes `WHERE deleted_at IS NULL` for hot lookups (already done for some via the orphan migration A1, see D2).

### B4 — Several services forget the `deletedAt` filter · Severity 3
Spot checks against the audit pattern:
- `cortex-memo.service.ts:19` — `decision.findMany({ where: { userId, createdAt: { gte: weekStart } } })` does NOT filter `deletedAt: null`. Soft-deleted decisions still appear in the weekly memo data feed and inflate `decisionsMade`.
- `cortex-memo.service.ts:22` — `commitment.findMany({ where: { userId, status: 'OPEN' } })` no `deletedAt` filter. Soft-deleted-but-still-OPEN commitments leak into the memo.
- `cortex-patterns.service.ts:21` — `decision.findMany` for last 90 days, no `deletedAt`.
- `cortex-patterns.service.ts:50` — `thinkingPattern.findFirst` — model has no soft-delete column, fine.
- `cortex-contradictions.service.ts:23` — decision lookup for context: HAS `deletedAt: null` ✓.
- `relationship.service.ts:22` — `projectPersonLink.findMany` — link table, no soft-delete column to check.

The cortex pipeline is the worst offender because its outputs are user-visible LLM summaries — a stale memo says "you made 12 decisions this week" when actually 4 were trashed.

### B5 — Cortex jobs are not idempotent — a Railway restart can write duplicate `WeeklyMemo`s · Severity 3
**File:** `packages/omnimind-api/src/jobs/cortex-scheduler.ts:15-30` + `cortex-memo.service.ts:72`
The Sunday 6 PM cron iterates all users and unconditionally calls `prisma.weeklyMemo.create`. There is no `@@unique([userId, weekStart])` on `WeeklyMemo` (schema line 649-667), and no "already ran this week" check. A redeploy at Sun 6:01 PM that takes >cron interval triggers the cron to fire again on the new instance → second memo row for the same week. Same shape risk for `ContradictionAlert.create` (`cortex-contradictions.service.ts:75`) — there IS a substring dedup at line 70, but it's `.contains(d.description.slice(0, 30))`, fragile and not transactional.

`detectPatterns` (`cortex-patterns.service.ts:50-65`) does a substring upsert that's safer, but still races: two simultaneous job runs for the same user can both miss the same `findFirst` and both `create` near-duplicates.

**Fix:** add `@@unique([userId, weekStart])` to `WeeklyMemo`; gate every cortex job behind a `withDistributedLock({ lockKey: 'cortex-memo:' + userId, ttlMs: 10*60*1000 })` — `redlock.ts` already provides this, but it's in-process so it doesn't help with multiple Railway instances. Phase 2: move the lock to a `cron_runs(job, key, started_at, finished_at)` table with `INSERT ... ON CONFLICT` semantics.

### B6 — OAuth refresh failure is silently absorbed · Severity 3
**File:** `packages/boardroom-ai/server/src/services/google-calendar.service.ts:92-95`
```ts
} catch (_err) {
  // Token expired or revoked — return empty
  return [];
}
```
Any Google API error (auth, rate limit, network) returns `[]` to the caller as if there were zero events. The `client.on('tokens', ...)` (line 57) only updates the token if Google chose to refresh during the call — if the refresh token itself is invalid (Google rotated it, user revoked access), no error surfaces to the user, no `OAuthToken.error` column exists to record it, and the integration appears "connected" forever in `getStatus()` (line 98) until someone notices empty calendar data.

Encryption (`crypto.ts`) silently passes through unencrypted tokens when `ENCRYPTION_KEY` is unset (lines 15, 24) — fine for dev, dangerous if a prod deploy ever launches without `ENCRYPTION_KEY` set: `prisma db push` won't reject it, the route accepts plaintext, and the migration to encrypted later is irreversible-by-default.

**Fix:** add `OAuthToken.lastError text`, `OAuthToken.lastErrorAt timestamptz`, `OAuthToken.status enum('healthy','degraded','expired')`. Refuse boot if `ENCRYPTION_KEY` missing in production.

### B7 — `searchVector` is declared `Unsupported("tsvector")` but no migration creates it · Severity 3
**File:** `packages/omnimind-api/prisma/schema.prisma:202`
The schema declares it as a generated column ("Generated column for full-text search") but the only applied migration that touches FTS (`20250410_add_search_indexes/migration.sql`) creates **expression** indexes `gin (to_tsvector('english', content))`, not a stored generated column. So `db push` sees the field is missing in the live DB and tries to add a plain `tsvector NULL` column with no generator — the FTS retrieval (`fulltext-search.ts`) uses `to_tsvector(content)` on the fly anyway. Result: a useless column gets allocated on every row, and it stays `NULL` forever. See D2.

---

## C. Recovery story gaps

### C1 — No baseline migration · Severity 1
`packages/omnimind-api/prisma/migrations/` contains only forward deltas. There is no `init` migration capturing the bulk of the 32-model schema. After a hypothetical Railway DB loss + restore from a logical backup, `prisma migrate deploy` would not know what state the restored DB is in. The current entrypoint papers over it with `db push --accept-data-loss`. **You cannot run a controlled migration deployment until baseline exists.**

**Required fix (Phase 1):**
1. Snapshot prod DB.
2. `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/00000000000000_init/migration.sql`
3. `INSERT INTO _prisma_migrations` rows for the init migration AND every existing applied delta.
4. Replace entrypoint to use `prisma migrate deploy`.

### C2 — No GDPR / user-export endpoint · Severity 2
Searched `routes/`: zero `export`, `gdpr`, `download` endpoints. A user who asks for their data today cannot be served without a hand-written SQL dump. CCPA/GDPR breach risk if anyone is in EU/CA.

**Fix:** `GET /users/:id/export` returning a streamed JSON archive across all 32 tables filtered by `userId` (or `userId` reachable via FK). Document the field map.

### C3 — Backup strategy is "Railway does it" · Severity 2
No `scripts/backup-*.sh`, no `BACKUP-RUNBOOK.md`, no documented RPO/RTO. Railway PostgreSQL plugin offers daily snapshots but I cannot find evidence anyone has restored one. Worse — restoring a snapshot into a fresh Postgres + booting omnimind-api will hit landmine A1 immediately and silently mutate the restored schema.

**Fix:** scripted weekly logical dump to S3-compatible storage with retention; documented quarterly restore drill into a scratch DB; runbook with explicit `--accept-data-loss=false` flag during the drill (impossible today because the entrypoint hardcodes it).

### C4 — Soft-delete restore has no UI / endpoint · Severity 4
Once `deletedAt` is set, there is no `POST /memories/:id/restore`, no `?include_deleted=true` query mode. So a fat-fingered DELETE is recoverable only via direct SQL. Low severity because data is technically intact, but the recovery story today is "ssh to Railway".

### C5 — In-memory rate limiter loses state on restart · Severity 4
`middleware/rate-limiter.ts` is in-process per CLAUDE.md known limitation #2. Not strictly data-integrity, but the abuse-control state is part of the platform's data; if an attacker times their bursts to redeploys they get unlimited attempts. Logged here for completeness.

---

## D. Schema / migration drift catalog

### D1 — Six "orphan" 2025-04 migrations are dated in the future relative to the bulk and reference snake_case→camelCase mismatches · Severity 2

| Migration | Status | Notes |
|---|---|---|
| `20250410_add_search_indexes` | Likely applied | Creates trigram + FTS indexes. **Bug:** uses `gin (userId, content gin_trgm_ops)` and `WHERE deletedAt IS NULL` — but Prisma maps fields to snake_case `user_id` / `deleted_at`. These index DDLs would have failed on first run unless the live schema differs. Either silently failing or the column-naming convention here is wrong. |
| `20250412010000_add_row_security_policies` | Probably failed | Refers to `userId`, `teamId`, `memoryId` — none of which exist in PG (real columns are `user_id`, `team_id`, `memory_id`). RLS policies would error out. |
| `20250412020000_add_foreign_key_constraints` | Partially applied? | Uses snake_case ✓ but adds FK constraints that Prisma already declares. Re-adding would error with "constraint already exists" unless guarded with `IF NOT EXISTS` (which Postgres does NOT support for FK constraints). |
| `20250412030000_extend_audit_logging` | Unknown | Not inspected — likely creates tables not in `schema.prisma`. |
| `20250412040000_add_feature_flags` | Unknown | Not inspected — likely creates `feature_flags` table not in schema. |
| `20250412050000_add_performance_monitoring` | Unknown | Not inspected. |
| `20250412060000_add_mem0_hybrid_search` | Definitely partially applied / broken | Creates `extracted_entities` table referencing the now-quarantined mem0 stack, uses inline `INDEX` syntax that Postgres does not accept inside CREATE TABLE (line 51-53). This migration has never run successfully. |

**These migrations all date 2025-04-10/12 but the codebase is on 2026-04-18.** They represent abandoned mem0 work that was never properly torn down. They sit in the migrations folder where any `prisma migrate deploy` would attempt to re-run them. Right now `db push` ignores migration history entirely, so they're inert — but the second you flip to `migrate deploy` (which you must, see C1) they will fire and either error out or create dead tables.

**Fix:** quarantine the entire 2025-04 set into `prisma/migrations/_archived/` and write a single forward migration that reflects what is actually in prod (run after C1's baseline).

### D2 — `searchVector` column declared in schema but never created · Severity 3
See B7. Either remove the field from `schema.prisma` (recommended — FTS works without it) or write a real migration `ALTER TABLE memory_entries ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED;` plus `CREATE INDEX ... USING gin(search_vector)`. Pick one; the half-state is worse than either.

### D3 — `MemoryEntry.supersededBy String?` is declared but never written or read · Severity 4
Searched usages: zero. Either implement supersession semantics or drop the column.

### D4 — `User` table lacks `deletedAt` column despite soft-delete being the platform pattern · Severity 3
Schema lines 21-35 have only `createdAt`/`updatedAt`. Cannot soft-delete a user account today; hard delete cascades to ~28 tables via CASCADE FKs which is the opposite of what an "Account closed, retain for 30 days" GDPR posture requires.

### D5 — `Decision` lacks `@@unique` on (userId, sessionId) · Severity 4
Two concurrent decision-create calls from the same `DecisionSession` will produce duplicates. Low likelihood but easy to add.

### D6 — `WeeklyMemo` lacks `@@unique([userId, weekStart])` · Severity 2
See B5.

### D7 — Per-user data lookups don't use partial indexes consistently · Severity 4
The orphan FK migration (D1) tried to add `idx_memory_entries_user_id ... WHERE deleted_at IS NULL`. Whether they applied or not, the schema does NOT declare these. Big-table queries (`memory_entries.findMany WHERE userId AND deletedAt IS NULL`) walk the full per-user index regardless of `deletedAt`. Phase 2 perf concern.

---

## E. Roadmap implications

### E1 — Phase 14 (migration history) MUST include
1. Generate baseline init migration from current prod (C1).
2. Quarantine the 2025-04 orphan set (D1).
3. Reconcile or drop `searchVector` and `supersededBy` (D2, D3).
4. Add `User.deletedAt` (D4) and `WeeklyMemo (userId, weekStart)` unique (D6).
5. Switch entrypoint from `db push --accept-data-loss` to `migrate deploy` (A1).
6. Add a migration-CI gate: `prisma migrate diff --from-migrations --to-schema-datamodel` must be empty in CI.

### E2 — Phases that need to be **added** to the roadmap

| New phase | Scope | Priority |
|---|---|---|
| **Phase 0.5 — Backup drill** | Quarterly restore-from-backup runbook + scripted automation. Cannot ship Phase 1 (paying users) without this. | P0 |
| **Phase 1.5 — Persistent embedding queue** | Move from in-memory array (A2) to PostgreSQL-backed `pg-boss` or equivalent. Add `embedding_status` columns. | P0 |
| **Phase 1.6 — Optimistic concurrency v2** | Make `version` checks real across memory/decision/entity update paths (B1). Add `If-Match` to API contract. | P1 |
| **Phase 2 — Stripe reconciliation job** | Daily cron that pulls Stripe truth and corrects drift (A4). Idempotency table for webhooks. | P0 |
| **Phase 2.5 — GDPR readiness** | User export endpoint, soft-delete-cascade service, OAuth-error surfacing (C2, B3, B6). | P1 |
| **Phase 3 — Embedding versioning** | Track `embedding_model`, `embedding_dimensions`, `embedded_at` per memory so re-embedding from `text-embedding-3-small` → next model is recoverable per-row, not all-or-nothing. | P2 |
| **Phase 4 — Postgres-backed cron locks** | Replace in-process `redlock.ts` with a `job_runs(job, lock_key, started_at, finished_at)` table to make cortex idempotent across multi-instance deploys (B5). Required before horizontal scaling. | P1 |

### E3 — Roadmap items that should be **deprioritized**
- Multi-instance horizontal scaling cannot land before E2 Phase 4. Adding a second Railway replica today multiplies the cron-duplication problem (B5) and the in-memory queue loss (A2).
- Mem0 re-integration (`docs/MEM0_*` plans in working-tree) cannot land before D1 cleanup; the orphan migrations are the wreckage of the previous attempt.

---

## F. Operational SOPs missing

All of these should exist as runbooks under `docs/runbooks/` before any meaningful user data is loaded:

1. **`restore-from-backup.md`** — step-by-step Railway snapshot → fresh DB → entrypoint flag overrides → smoke tests. Must include the explicit "set MIGRATE_PROTECTION=1 before booting omnimind to prevent A1" warning.
2. **`embedding-queue-drain.md`** — how to detect stuck/dropped jobs, how to manually trigger `queueBackfill` per user, how to verify completion with `SELECT count(*) WHERE embedding IS NULL`.
3. **`schema-rollback.md`** — given Prisma's lack of down-migrations, the documented procedure to revert a bad migration: snapshot → checkout previous schema → manually craft inverse SQL.
4. **`stripe-reconciliation.md`** — what to do when a user reports "I paid but I'm on free tier" (or vice versa). Includes Stripe dashboard search, `omnimindClient.updateSubscription` curl, audit trail.
5. **`oauth-token-revoked.md`** — recovery for users whose Google/Gmail integration silently degraded (B6). Force-disconnect, re-auth flow.
6. **`user-deletion.md`** — current state is "you can't really". Document the SQL until D4 lands.
7. **`gdpr-data-export.md`** — manual SQL dump procedure until C2 is implemented; format expected.
8. **`incident-postmortem-template.md`** — none exists. Required for retrospective discipline once paying users land.
9. **`cortex-job-rerun.md`** — how to safely rerun a failed weekly memo/pattern scan for a user, given B5's idempotency gap.
10. **`db-vacuum-and-reindex.md`** — pgvector IVFFlat indexes degrade as data grows; needs scheduled `REINDEX INDEX CONCURRENTLY` and `VACUUM ANALYZE`.

---

## Summary table

| ID | Severity | Class | Headline |
|---|---|---|---|
| A1 | 1 | Loss | `db push --accept-data-loss` in entrypoint |
| A2 | 1 | Loss | In-memory embedding queue loses jobs on restart |
| C1 | 1 | Recovery | No baseline migration; restore is impossible |
| A3 | 2 | Loss | Subscription middleware fails open on every error |
| A4 | 2 | Loss | Stripe webhooks: no idempotency, no reconciliation |
| B1 | 2 | Corruption | `version` increments are not enforced — last-write-wins |
| B2 | 2 | Corruption | Embedding failure is unobservable from DB |
| B3 | 2 | Corruption | Soft-delete doesn't cascade; link tables leak ghosts |
| C2 | 2 | Recovery | No user-data export endpoint (GDPR risk) |
| C3 | 2 | Recovery | No documented backup/restore drill |
| D1 | 2 | Drift | Six orphan 2025-04 migrations, mostly broken |
| D6 | 2 | Drift | `WeeklyMemo` lacks unique on (userId, weekStart) |
| A5 | 3 | Loss | `commitment.update` skips version increment |
| B4 | 3 | Corruption | Cortex services skip `deletedAt` filter |
| B5 | 3 | Corruption | Cortex jobs not idempotent across restarts |
| B6 | 3 | Corruption | OAuth refresh failures absorbed silently |
| B7 | 3 | Corruption | `searchVector` column ghost-declared, never built |
| D2 | 3 | Drift | `searchVector` schema vs. reality mismatch |
| D4 | 3 | Drift | `User` table lacks `deletedAt` |
| C4 | 4 | Recovery | No restore-from-soft-delete UI |
| C5 | 4 | Recovery | In-memory rate-limit state lost on restart |
| D3 | 4 | Drift | `supersededBy` declared, never used |
| D5 | 4 | Drift | `Decision` lacks unique on (userId, sessionId) |
| D7 | 4 | Drift | Per-user partial indexes inconsistently declared |
