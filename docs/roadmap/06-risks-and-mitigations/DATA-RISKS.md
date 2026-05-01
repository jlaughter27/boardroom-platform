# Data Risks — Detailed Catalog

**Wave 2 Builder 4 · Risks & Mitigations**
**Date:** 2026-04-18 (Wave 4 reconciliation note: phase numbers in body text use the older Builder 4 scheme; canonical mapping is in `RISK-REGISTER.md` Section 6 and `04-roadmap/ROADMAP-OVERVIEW.md`)
**Sources:** `wave1-audit/data-integrity-audit.md`[2], `wave1-research/03-data-architecture.md` (referenced); `wave1-audit/code-quality-audit.md`[4]
**Cross-reference:** `RISK-REGISTER.md` for the master table (canonical phase numbers); `OPERATIONAL-RISKS.md` for restore-drill operational concerns.

> **Phase-number translation key (canonical):**
> - "Phase 11 (Persistent queue / Foundations)" → Phase 1 (durability layer) for queue work, Phase 0.25 for race fixes, Phase 0.5 for backup drill
> - "Phase 12 (Hardening)" → Phase 0.25 (six tasks 0.25.1–0.25.6) + Phase 9 (cortex deletedAt filters)
> - "Phase 13 (RLS rollout / soft-delete cascade / GDPR)" → Phase 18 (RLS, GDPR) + Phase 15 (cascade) + Phase 16 (cortex isolation)
> - "Phase 14 (Migration history)" → Phase 15 + Phase 19 (perf indexes)

This catalog enumerates every data-integrity risk by failure class — silent loss, silent corruption, recovery gaps, schema/migration drift — and gives each one: scenario, blast radius, mitigation phase, and residual after fix.

---

## A. Silent data loss

### A.1 DAT-001 — `prisma db push --accept-data-loss` runs on every container boot

**Severity:** 1/5 (catastrophic)
**Files:** `packages/omnimind-api/docker-entrypoint.sh:16`

```sh
prisma db push $SCHEMA --skip-generate --accept-data-loss 2>&1
```

**Scenario:** This is the production entrypoint on Railway (confirmed via `Procfile` + `Dockerfile`). On every restart, Prisma diffs `schema.prisma` against the live DB. The `--accept-data-loss` flag means Prisma will silently `DROP COLUMN` / `DROP TABLE` whenever a schema change implies it, with no migration history to record it. Realistic loss scenarios:

1. Renaming a column in `schema.prisma` (Prisma sees drop-old + add-new → all data in old column lost).
2. Narrowing a type (`String` → `Int`) → column dropped + recreated → data lost.
3. Removing the `searchVector` field from schema (a hot candidate; see DAT-016) — `db push` drops the column and the GIN indexes that depend on it.
4. A teammate's local `prisma db push` against a hot-fixed schema gets reverted on next deploy because the `schema.prisma` in `main` doesn't match.
5. **Restoration from backup:** restored DB has a column the schema lost → entrypoint drops it on first boot of the restored instance.

**Blast radius:** Every user, every memory, every dropped column. The restoration scenario is the worst — the *recovery procedure itself* destroys data.

**Mitigation phase:** **14** (Migration history). Hard requirement before any column refactor lands.
**Fix:**
- Replace line 16 with `prisma migrate deploy`, drop `--accept-data-loss`.
- Generate baseline migration before flipping (`prisma migrate diff --from-empty --to-schema-datamodel ...`); see DAT-003.
- Add `MIGRATE_PROTECTION=1` env-gate so `db push` only runs in dev.

**Residual after fix:** Manual `prisma migrate deploy` errors still possible during prod migration runs. Migration-CI gate (Phase 14) catches these. **Residual: 4/5.**

---

### A.2 DAT-002 — In-process embedding queue loses jobs on restart

**Severity:** 1/5 (catastrophic, daily occurrence)
**Files:** `packages/omnimind-api/src/services/embedding-queue.ts:19`, `packages/omnimind-api/src/services/incremental-embedding.service.ts:25`

```ts
const queue: EmbeddingJob[] = [];
let workerRunning = false;
```

**Scenario:** The queue is a plain in-memory array. Railway redeploys / OOM kills / `node` crashes silently throw away every queued job. Entry points that enqueue and rely on it:

- `memory.service.ts:59` — `createMemory()` queues `'high'` priority for every newly created memory. If the API restarts in the 1–60s window between insert and embedding generation, that memory is permanently `embedding IS NULL`.
- `memory.service.ts:162` — `updateMemory()` requeues on title/content edit (`'normal'`).
- `embedding-queue.ts:176` — `queueBackfill()` admin trigger.

**Compounding factors:**
- No persistence of `attempts`/`error` — failed jobs disappear after 3 attempts (line 108) with only a log line.
- A second in-memory queue exists in `incremental-embedding.service.ts:25` (`pendingQueue`) with the same defect.
- `embedding-queue.ts:108` removes failed jobs from the queue after 3 attempts but does NOT mark the row in the DB. No way to detect "embedding permanently failed" from a query.

**Blast radius:** Every memory created during the lossy window. Power users (most memories per day) are most affected. Cortex memos will reference older memories disproportionately because semantic search misses recent ones.

**Mitigation phase:** **11** (Foundations + persistent queue) — this is the highest-priority data risk.
**Fix:**
- Add nullable `embedding_status` enum + `embedding_attempts int` + `embedding_last_error text` columns to `memory_entries`. Mark `'pending'` at create time.
- On boot, sweep `WHERE embedding IS NULL AND embedding_status='pending' AND created_at > NOW() - interval '7 days'` and re-enqueue.
- Phase 13: replace with PostgreSQL-backed job queue (`pg-boss` or `graphile-worker` per ops research) — keeps ADR-009 (no Redis) intact.

**Residual after fix:** Backfill window for memories created before the fix lands. Migration script handles one-time backfill. **Residual: 4/5.**

---

### A.3 DAT-005 — `MemoryEntry.version` is performative, not enforced

**Severity:** 2/5
**Files:** `packages/omnimind-api/src/services/memory.service.ts:139-168`, `decision.service.ts:90`, `entity.service.ts:82`

**Scenario:** `updateMemory` does `version: { increment: 1 }` but the `where` clause never includes the expected version. So two concurrent PATCHes both pass ownership check (line 146), both call `update` with `{ id }` only, and the second wins. Version goes 1 → 3 silently and the first writer's payload is lost. Same pattern in `decision.service.ts:90` and `entity.service.ts:82`. The "optimistic concurrency" comment (line 151) is aspirational, not implemented.

**Blast radius:** Per-edit-conflict, per-user. Most likely failure mode: power user with multiple browser tabs. Cumulatively erodes "the system is reliable" trust. See `6-MONTH-FORECAST.md` Scenario 10 for the user-visible escalation.

**Mitigation phase:** **11**.
**Fix:** Require `If-Match: <version>` header on PATCH endpoints, do `prisma.memoryEntry.update({ where: { id, version: expected } })`. P2025 → 409 Conflict. Apply across `memory`, `decision`, `entity`, `commitment`, `userProfile`. Add API contract docs.

**Residual after fix:** Clients without `If-Match` header still race. Phase 12 enforces header at middleware. **Residual: 4/5.**

---

### A.4 DAT-012 — `commitment.update` skips version increment

**Severity:** 3/5
**Files:** `packages/omnimind-api/src/services/commitment.service.ts:64`

```ts
return prisma.commitment.update({ where: { id }, data: data as any });
```

**Scenario:** Every other entity service increments `version`. Commitment doesn't (commitments may also lack a `version` column on the model — verify). Two concurrent edits silently overwrite. Same audit needed in `user-profile.service.ts:43` (no version field), `cortex-contradictions.service.ts:118` (no version), `oauth.routes.ts:33` (`upsert` overwrites accessToken with no compare-and-swap — fine for tokens, dangerous if the refresh job races a UI reconnect).

**Mitigation phase:** **11** (rolled into DAT-005 fix).
**Residual:** None for commitment after fix. OAuth upsert race deserves separate handling. **Residual: 4/5.**

---

## B. Silent corruption

### B.1 DAT-006 — Embedding write path has no failure observability

**Severity:** 2/5
**Files:** `packages/omnimind-api/src/services/embedding.service.ts:57-79,118`

**Scenario:** `createMemory` → row written with `embedding IS NULL` → `queueEmbedding(...).catch(log)` → background worker → `embedMemory()` → on permanent failure logs `Embedding generation permanently failed` and **returns void**. The memory row is never marked. `getEmbeddingStatus` reports `'pending'` for both "haven't started yet" and "failed forever" — same observable, different reality.

**Mitigation phase:** **11** (rolled into DAT-002 fix — same `embedding_status` columns).

**Residual after fix:** None. **Residual: 5/5.**

---

### B.2 DAT-007 — Soft-delete is application-layer only and not cascading

**Severity:** 2/5
**Files:** `packages/omnimind-api/prisma/schema.prisma` (lines 21-35 — `User`; 510-522 — `MemoryEntityLink`)

**Scenario:**
- All FK relations are `onDelete: Cascade`. When a `User` is **hard** deleted, everything cascades. But there's no hard delete anywhere in the codebase, only soft (`deletedAt = now()`).
- `User` has **no `deletedAt` column at all**. Cannot soft-delete a user account. Hard delete cascades to ~28 tables — opposite of "Account closed, retain for 30 days" GDPR posture.
- `MemoryEntityLink` has no `deletedAt`. When you soft-delete a `MemoryEntry`, link rows survive. Join from a Project finds the (soft-deleted) memory only because `entity.service.ts` filters parent on `deletedAt: null`. Any caller that queries `MemoryEntityLink` directly without parent filter sees ghosts. Same risk for `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`.
- `MemoryEntry.supersededBy` (line 198) is never written by any code path — dead column. See DAT-018.

**Mitigation phase:** **13** (GDPR cascade-soft-delete service).
**Fix:**
1. Add `deletedAt` to `User`. Write a cascade-soft-delete service that walks the FK graph and stamps `deletedAt` on every owned row.
2. Add partial unique indexes / partial indexes `WHERE deleted_at IS NULL` for hot lookups.
3. Daily cron hard-deletes anything `deletedAt < now() - 30 days` (GDPR Art. 17 — see SEC-024).

**Residual:** Edge cases in FK graph traversal will be discovered over time. **Residual: 3/5.**

---

### B.3 DAT-013 — Cortex services skip `deletedAt` filter

**Severity:** 3/5
**Files:** `packages/omnimind-api/src/services/cortex-memo.service.ts:19,22`, `cortex-patterns.service.ts:21`

**Scenario:** Spot checks against the audit pattern:
- `cortex-memo.service.ts:19` — `decision.findMany({ where: { userId, createdAt: { gte: weekStart } } })` does NOT filter `deletedAt: null`. Soft-deleted decisions still appear in the weekly memo data feed and inflate `decisionsMade`.
- `cortex-memo.service.ts:22` — `commitment.findMany({ where: { userId, status: 'OPEN' } })` no `deletedAt` filter. Soft-deleted-but-still-OPEN commitments leak into the memo.
- `cortex-patterns.service.ts:21` — `decision.findMany` for last 90 days, no `deletedAt`.

The cortex pipeline is the worst offender because its outputs are user-visible LLM summaries — a stale memo says "you made 12 decisions this week" when actually 4 were trashed.

**Mitigation phase:** **12** (Hardening).
**Fix:** Add `deletedAt: null` filter to every cortex service query. CI grep gate prevents regression.

**Residual:** None for the queries fixed. Audit must be exhaustive across services. **Residual: 4/5.**

---

### B.4 DAT-014 — Cortex jobs not idempotent — Railway restart writes duplicate `WeeklyMemo`s

**Severity:** 3/5
**Files:** `packages/omnimind-api/src/jobs/cortex-scheduler.ts:15-30`, `cortex-memo.service.ts:72`, `cortex-contradictions.service.ts:75`

**Scenario:** The Sunday 6 PM cron iterates all users and unconditionally calls `prisma.weeklyMemo.create`. There is no `@@unique([userId, weekStart])` on `WeeklyMemo` (DAT-011), and no "already ran this week" check. A redeploy at Sun 6:01 PM that takes >cron interval triggers the cron to fire again on the new instance → second memo row for the same week. Same shape risk for `ContradictionAlert.create` — there IS a substring dedup at line 70, but `.contains(d.description.slice(0, 30))` is fragile and not transactional.

`detectPatterns` does a substring upsert that's safer, but two simultaneous job runs for the same user can both miss the same `findFirst` and both `create` near-duplicates.

**Mitigation phase:** **12** for the unique constraint (DAT-011); **13** for distributed lock semantics.
**Fix:**
- Add `@@unique([userId, weekStart])` to `WeeklyMemo` (Phase 12).
- Gate every cortex job behind `withDistributedLock({ lockKey: 'cortex-memo:' + userId, ttlMs: 10*60*1000 })` — `redlock.ts` already provides this, but it's in-process so it doesn't help with multiple Railway instances.
- Phase 13 / 14: move the lock to a `cron_runs(job, key, started_at, finished_at)` table with `INSERT ... ON CONFLICT` semantics.

**Residual after fix:** Tail-end races during the unique-constraint deploy require a one-time cleanup. **Residual: 4/5.**

---

### B.5 DAT-015 — OAuth refresh failure absorbed silently

**Severity:** 3/5
**Files:** `packages/boardroom-ai/server/src/services/google-calendar.service.ts:92-95,57,98`

```ts
} catch (_err) {
  // Token expired or revoked — return empty
  return [];
}
```

**Scenario:** Any Google API error (auth, rate limit, network) returns `[]` to the caller as if there were zero events. The `client.on('tokens', ...)` only updates the token if Google chose to refresh during the call — if the refresh token itself is invalid, no error surfaces, no `OAuthToken.error` column exists to record it, and the integration appears "connected" forever in `getStatus()` until someone notices empty calendar data.

See `12-MONTH-FORECAST.md` Scenario 4 for the 12-month escalation: "ghost integrations" silently degrade Cortex output for 25% of integration users.

**Mitigation phase:** **12**.
**Fix:** Add `OAuthToken.lastError text`, `OAuthToken.lastErrorAt timestamptz`, `OAuthToken.status enum('healthy','degraded','expired')`. Refuse boot if `ENCRYPTION_KEY` missing in production. Surface "Calendar reconnect needed" badge in UI.

**Residual:** Recovery UX (re-auth flow) lands in Phase 13. **Residual: 4/5.**

---

### B.6 DAT-016 — `searchVector` declared `Unsupported("tsvector")` but no migration creates it

**Severity:** 3/5
**Files:** `packages/omnimind-api/prisma/schema.prisma:202`, `packages/omnimind-api/src/retrieval/fulltext-search.ts`

**Scenario:** The schema declares it as a generated column ("Generated column for full-text search") but the only applied migration that touches FTS (`20250410_add_search_indexes/migration.sql`) creates **expression** indexes `gin (to_tsvector('english', content))`, not a stored generated column. So `db push` sees the field is missing in the live DB and tries to add a plain `tsvector NULL` column with no generator — the FTS retrieval uses `to_tsvector(content)` on the fly anyway. Result: a useless column gets allocated on every row, and it stays `NULL` forever.

**Mitigation phase:** **14** (Migration history cleanup).
**Fix:** Either remove the field from `schema.prisma` (recommended — FTS works without it) or write a real migration `ALTER TABLE memory_entries ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED;` plus `CREATE INDEX ... USING gin(search_vector)`. Pick one; the half-state is worse than either.

**Residual:** None. **Residual: 5/5.**

---

## C. Stripe / billing data integrity

### C.1 DAT-004 — Stripe webhooks have no idempotency or signature replay protection

**Severity:** 2/5
**Files:** `packages/boardroom-ai/server/src/services/stripe.service.ts:44-107`, `packages/omnimind-api/src/routes/subscription.routes.ts:26`

**Scenario:** `handleWebhook` processes every event the moment it arrives. No `event.id` dedup, no record table, no transactional write. Failure modes:
- Stripe retries are inevitable. A repeated `checkout.session.completed` calls `omnimindClient.createSubscription` twice. The OmniMind route calls `prisma.subscription.create` — the unique on `userId` will throw P2002, but the error escapes (no try/catch), so Stripe gets a 500 and retries forever, eventually disabling the endpoint.
- `invoice.paid` followed by `invoice.payment_failed` arriving out of order leaves the user permanently `PAST_DUE` even though they paid.
- No reconciliation job. If a webhook is missed (Stripe dashboard → "Failed deliveries"), nothing ever pulls subscription truth back from Stripe.

This is in addition to SEC-002 (signature verification fundamentally broken because `express.json()` consumed the raw body).

**Blast radius:** Every paying user, retroactively. See `6-MONTH-FORECAST.md` Scenario 1.

**Mitigation phase:** **12** (idempotency + signature fix); **13** (reconciliation cron).
**Fix:**
- Add `processed_stripe_events(id text primary key, processed_at timestamptz)` table; `INSERT ... ON CONFLICT DO NOTHING` first, return 200 if already present.
- Daily cron lists Stripe subscriptions for users updated in the last 24h and reconciles status.
- Manual back-fill script for any users whose subscription state diverged while the bug was live.

**Residual:** None after both phases. **Residual: 5/5.**

---

## D. Recovery story gaps

### D.1 DAT-003 — No baseline migration

**Severity:** 1/5
**Files:** `packages/omnimind-api/prisma/migrations/`

**Scenario:** `migrations/` contains only forward deltas. There is no `init` migration capturing the bulk of the 32-model schema. After a hypothetical Railway DB loss + restore from a logical backup, `prisma migrate deploy` would not know what state the restored DB is in. The current entrypoint papers over it with `db push --accept-data-loss` (DAT-001). **You cannot run a controlled migration deployment until baseline exists.**

**Mitigation phase:** **14**.
**Fix (required sequence):**
1. Snapshot prod DB.
2. `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/00000000000000_init/migration.sql`.
3. `INSERT INTO _prisma_migrations` rows for the init migration AND every existing applied delta.
4. Replace entrypoint to use `prisma migrate deploy`.

**Residual:** Migration-CI gate (Phase 14) prevents schema drift. **Residual: 4/5.**

---

### D.2 DAT-008 — No GDPR / user-export endpoint

**Severity:** 2/5
**Files:** No `/users/:id/export` route exists.

**Scenario:** Searched `routes/`: zero `export`, `gdpr`, `download` endpoints. A user who asks for their data today cannot be served without a hand-written SQL dump. CCPA/GDPR breach risk if anyone is in EU/CA.

**Mitigation phase:** **13**.
**Fix:** `GET /users/:id/export` returning a streamed JSON archive across all 32 tables filtered by `userId` (or `userId` reachable via FK). Document the field map.

**Residual:** Edge cases (cortex-derived data, OAuth token derivatives) need explicit treatment. **Residual: 4/5.**

---

### D.3 DAT-009 — Backup strategy is "Railway does it"

**Severity:** 2/5
**Files:** No `scripts/backup-*.sh`, no `BACKUP-RUNBOOK.md`.

**Scenario:** Railway PostgreSQL plugin offers daily snapshots but no documented evidence anyone has restored one. Worse — restoring a snapshot into a fresh Postgres + booting omnimind-api will hit DAT-001 immediately and silently mutate the restored schema.

**Mitigation phase:** **11** (Foundations — non-negotiable before paying-user growth).
**Fix:**
- Scripted weekly logical dump to S3-compatible storage (Backblaze B2, per ops research §7) with retention.
- Documented quarterly restore drill into a scratch DB.
- Runbook with explicit `--accept-data-loss=false` flag during the drill (impossible today because the entrypoint hardcodes it).

**Residual:** Discovery of restore failures during a drill is a *good* outcome. **Residual: 4/5.**

---

### D.4 DAT-017 — Soft-delete restore has no UI / endpoint

**Severity:** 4/5
**Files:** No `POST /memories/:id/restore` route.

**Scenario:** Once `deletedAt` is set, recovery is via SQL only. Low severity because data is technically intact; recovery story is "ssh to Railway."

**Mitigation phase:** Beyond 14 — accepted at current scale.

---

## E. Schema / migration drift

### E.1 DAT-010 — Six 2025-04 orphan migrations with snake_case/camelCase mismatch

**Severity:** 2/5
**Files:** `packages/omnimind-api/prisma/migrations/20250410_add_search_indexes/`, `20250412010000_add_row_security_policies/`, `20250412020000_add_foreign_key_constraints/`, `20250412030000_extend_audit_logging/`, `20250412040000_add_feature_flags/`, `20250412050000_add_performance_monitoring/`, `20250412060000_add_mem0_hybrid_search/`

**Scenario:** Per the audit table:

| Migration | Status | Bug |
|---|---|---|
| `20250410_add_search_indexes` | Likely applied | Uses `gin (userId, content gin_trgm_ops)` and `WHERE deletedAt IS NULL` — but Prisma maps to snake_case |
| `20250412010000_add_row_security_policies` | Probably failed | Refers to camelCase `userId/teamId/memoryId` — RLS policies error out |
| `20250412020000_add_foreign_key_constraints` | Partially applied | Re-adds FK constraints Prisma already declares; no `IF NOT EXISTS` for FK in PG |
| `20250412030000_extend_audit_logging` | Unknown | Likely creates tables not in schema |
| `20250412040000_add_feature_flags` | Unknown | Creates `feature_flags` table no service writes to |
| `20250412050000_add_performance_monitoring` | Unknown | Likely orphan tables |
| `20250412060000_add_mem0_hybrid_search` | Definitely partial / broken | Uses inline `INDEX` syntax invalid inside `CREATE TABLE` |

These are the wreckage of the abandoned mem0 work (per code-quality audit §A4). Six migrations created 6,498 lines of SQL for code that was deleted. They sit where any `prisma migrate deploy` would attempt to re-run them — inert today only because `db push` ignores migration history.

**Mitigation phase:** **14** (must precede the entrypoint flip from DAT-001).
**Fix:** Quarantine entire 2025-04 set into `prisma/migrations/_archived/` and write a single forward migration reflecting what is actually in prod (run after DAT-003 baseline).

**Residual:** Discovery of hidden mem0 tables in prod requires per-table audit. **Residual: 4/5.**

---

### E.2 DAT-011 — `WeeklyMemo` lacks `@@unique([userId, weekStart])`

**Severity:** 2/5
**Files:** `packages/omnimind-api/prisma/schema.prisma:649-667`

**Scenario:** Sunday 6 PM redeploy at 6:01 PM = duplicate memo rows. See DAT-014 for full scenario.

**Mitigation phase:** **12**.
**Fix:** Add `@@unique([userId, weekStart])` constraint. Cleanup script for any existing duplicates.

**Residual:** None. **Residual: 5/5.**

---

### E.3 DAT-018 — `MemoryEntry.supersededBy` declared, never used

**Severity:** 4/5
**Files:** `packages/omnimind-api/prisma/schema.prisma:198`

**Scenario:** Searched usages: zero. Either implement supersession semantics or drop the column. Half-state is worse than either.

**Mitigation phase:** **14** (drop column).

---

### E.4 DAT-019 — `Decision` lacks `@@unique` on `(userId, sessionId)`

**Severity:** 4/5
**Files:** `packages/omnimind-api/prisma/schema.prisma`

**Scenario:** Two concurrent decision-create calls from the same `DecisionSession` produce duplicates. Low likelihood, easy to add.

**Mitigation phase:** **14**.

---

### E.5 DAT-020 — Per-user data lookups don't use partial indexes consistently

**Severity:** 4/5
**Files:** `packages/omnimind-api/prisma/schema.prisma`

**Scenario:** The orphan FK migration tried to add `idx_memory_entries_user_id ... WHERE deleted_at IS NULL`. Whether they applied or not, the schema does NOT declare these. Big-table queries (`memory_entries.findMany WHERE userId AND deletedAt IS NULL`) walk the full per-user index regardless of `deletedAt`. Phase 2 perf concern.

**Mitigation phase:** **14**.

---

## F. Roadmap implications

### F.1 Phase 11 (Foundations + persistent queue + backup)

Closes the bleeding: DAT-002, DAT-005, DAT-006, DAT-009, DAT-012. Foundational because the rest of the data fixes assume a queue you can trust and a backup you can restore.

### F.2 Phase 12 (Hardening)

Stripe billing fix (DAT-004), unique constraints (DAT-011), cortex `deletedAt` filter (DAT-013), OAuth status surfacing (DAT-015). Mostly small, targeted PRs.

### F.3 Phase 13 (RLS, GDPR, cron isolation)

Soft-delete cascade (DAT-007), user export (DAT-008), distributed cron locks (DAT-014). Larger build-outs.

### F.4 Phase 14 (Migration history)

DAT-001 (the entrypoint), DAT-003 (baseline), DAT-010 (orphan migrations), DAT-016 (searchVector ghost), DAT-018, DAT-019, DAT-020. **All 7 must land together** because they're interlocked: you cannot adopt `migrate deploy` while orphan migrations exist, and orphan migrations cannot be quarantined safely without baseline.

---

## G. Operational SOPs missing

These should exist as runbooks under `docs/runbooks/` before any meaningful user data is loaded. Listed here so the data risk treatment is paired with operational treatment:

1. `restore-from-backup.md` — Railway snapshot → fresh DB → entrypoint flag overrides → smoke tests. Must include "set MIGRATE_PROTECTION=1 before booting omnimind to prevent DAT-001."
2. `embedding-queue-drain.md` — detect stuck/dropped jobs; manually trigger `queueBackfill` per user; verify with `SELECT count(*) WHERE embedding IS NULL`.
3. `schema-rollback.md` — given Prisma's lack of down-migrations, documented procedure: snapshot → checkout previous schema → manually craft inverse SQL.
4. `stripe-reconciliation.md` — what to do when a user reports "I paid but I'm on free tier" (or vice versa).
5. `oauth-token-revoked.md` — recovery for users whose Google/Gmail integration silently degraded.
6. `user-deletion.md` — current state is "you can't really." Document the SQL until DAT-007 lands.
7. `gdpr-data-export.md` — manual SQL dump procedure until DAT-008 is implemented.
8. `incident-postmortem-template.md` — none exists. Required before paying users land.
9. `cortex-job-rerun.md` — safely rerun a failed weekly memo/pattern scan given DAT-014 idempotency gap.
10. `db-vacuum-and-reindex.md` — pgvector IVFFlat indexes degrade as data grows.

These runbooks are tracked in `OPERATIONAL-RISKS.md` under OPS-014.

---

**Word count: ~2,150.**
