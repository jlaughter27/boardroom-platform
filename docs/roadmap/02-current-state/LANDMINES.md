# Landmines — Hidden Risks That Look Fine Until They Don't

**Audience:** Anyone planning to edit schema, deploy, touch billing, or scale beyond one Railway instance.
**Purpose:** The subset of [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md) where the *symptom is delayed*: code passes review, tests are green, prod looks healthy — and then a redeploy / a duplicate webhook / a typo in `NODE_ENV` / a concurrent PATCH detonates it.
**Scope:** Nine landmines that the audits (security, data-integrity, scalability, code-quality) explicitly called out as *invisible-until-explosion* failure modes.

> Each landmine: **Scenario** (the trigger) → **Symptom** (what the user/operator sees) → **Blast radius** (who is harmed and how badly) → **Fix** (the smallest concrete change that defuses it).

---

## L1. `prisma db push --accept-data-loss` runs on every container boot

**Source:** data-integrity-audit.md §A1 · severity 1 · KI-001
**File:** `packages/omnimind-api/docker-entrypoint.sh:16`
```sh
prisma db push $SCHEMA --skip-generate --accept-data-loss 2>&1
```

### Scenario
Anyone edits `schema.prisma` and pushes to `main`. Railway auto-deploys (no CI gate, per CLAUDE.md known limitation #1). The entrypoint runs `db push` which diffs `schema.prisma` against the live DB and silently emits whatever DDL closes the gap, with `--accept-data-loss` permitting `DROP COLUMN` / `DROP TABLE`.

Five concrete trigger paths (per data-integrity-audit.md §A1):
1. Renaming a column → Prisma sees drop-old + add-new → all data in the old column is lost.
2. Narrowing a type (`String` → `Int`) → column dropped + recreated → data lost.
3. Removing the `searchVector Unsupported("tsvector")?` field (a hot candidate per KI-018) → `db push` will drop the column and the GIN indexes that depend on it.
4. A teammate's local `prisma db push` against a hot-fixed schema gets reverted on next deploy because the `schema.prisma` in `main` doesn't match.
5. Restoration from backup: the restored DB has a column the schema lost → entrypoint drops it on first boot of the restored instance.

### Symptom
There is no symptom until the *next read*. The deploy succeeds. Health endpoint returns 200. Then a user tries to read a memory and the column is gone, or a cortex job runs against a table that no longer exists.

### Blast radius
- **Tens of thousands of memory rows** per active user, gone with no warning.
- **Restore from backup is impossible** until KI-003 (no baseline migration) is fixed — `prisma migrate deploy` cannot tell where the restored DB sits in the migration history.
- The orphan 2025-04-12 migrations (KI-015) make this worse the moment we *try* to switch to `migrate deploy`: they will fire and either error out or create dead tables (per data-integrity-audit.md §D1).

### Fix
1. Generate baseline init migration from current prod (`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/00000000000000_init/migration.sql`).
2. `INSERT INTO _prisma_migrations` rows for the init migration AND every existing applied delta.
3. Quarantine the 2025-04 orphan set into `prisma/migrations/_archived/`.
4. Replace line 16 of `docker-entrypoint.sh` with `prisma migrate deploy`. Drop `--accept-data-loss`.
5. Add `MIGRATE_PROTECTION=1` env-gate so `db push` only runs in dev.
6. Add a CI gate: `prisma migrate diff --from-migrations --to-schema-datamodel` must be empty.

Roadmap home: **Phase 15** (migration history). Pull-forward candidate to right after Phase 0.25. Cannot ship Phase 18 (resilience) or Phase 19 (horizontal scale) safely until this lands, because backup-restore drills require working migrations.

---

## L2. The RLS façade — `getPrismaClient(userId)` exists, no route uses it

**Source:** security-audit.md §A4, code-quality-audit.md §C row 4, data-integrity-audit.md §D1 · severity 2 · KI-008, KI-031
**Files:** `packages/omnimind-api/src/lib/db-audit.ts:1-37,61-221`, `lib/db.ts:18-58`

### Scenario
CLAUDE.md documents "RLS: All queries MUST include user_id filter." A new contributor reads that and assumes the database enforces row-level security — so they write a service that omits `WHERE userId = ?`, trusting Postgres to filter. Or, more subtly, someone with the leaked `OMNIMIND_API_KEY` sets `x-user-id: <victim_cuid>` and queries an endpoint whose route discipline silently slipped.

Three layers of facade, all simultaneous:
1. `getPrismaClient(userId)` and `attachRLSClient` middleware are **exported** but **no route imports them**. Every route uses the unscoped global `prisma`.
2. `USER_SCOPED_MODELS` lists models that **don't exist** in the schema (`memoryChunk`, `cortexSession`, `cortexMessage`, `embeddingJob`, `taskAssignment`, `userPreference`, …) and **omits** the real ones (`decision`, `commitment`, `oAuthToken`, `userProfile`, `contradictionAlert`, `weeklyMemo`, `customPersona`, `subscription`).
3. The 373-line migration `20250412010000_add_row_security_policies` likely failed at apply time — it references `userId`/`teamId`/`memoryId` columns that don't exist (Prisma maps them to `user_id`/`team_id`/`memory_id` in Postgres, per data-integrity-audit.md §D1).

### Symptom
None today, because route-level discipline (`findFirst({ where: { id, userId, deletedAt: null } })`) is a hard-held convention across all 17 OmniMind route files and is currently the *only* user-isolation boundary. The defense is real — but it's the *only* defense.

### Blast radius
- The day someone writes a service without the userId filter — and they will, per security-audit.md §A4 ("the architectural promise documented in CLAUDE.md is built on a façade") — there is **no second layer** to catch it. Cross-user reads become possible.
- **Multi-user rooms (the legacy "Phase 4 — Collaboration" from the original product spec; in this roadmap that capability lives at `04-roadmap/DEFERRED/multi-user-rooms.md` as DEF-015) is hard-blocked.** Per security-audit.md §F: "Multi-user rooms = multi-tenant queries = the route-level discipline is no longer sufficient." Real Postgres RLS lands in **Phase 18**, which un-blocks DEF-015.

### Fix
1. **Delete** `db-audit.ts` and the `getPrismaClient`/`attachRLSClient` exports — they create false confidence (worse than nothing).
2. **Replace** with a real Postgres RLS policy on user-scoped tables, set via `SET LOCAL app.user_id = $1` per-request inside a transaction wrapper. This is the only way to make the guarantee enforceable.
3. **Until then**, add a single grep-based CI check: any new `prisma.<model>.findMany({ where: { ... } })` without `userId` in the where clause fails the build.

Roadmap home: **Phase 0.25** task 0.25.4 (delete the facade — promoted from Phase 9 because A4 is one of the six P0 fixes) → **Phase 18** (real Postgres RLS before any multi-user collaboration work).

---

## L3. In-process embedding queue silently drops jobs on restart

**Source:** data-integrity-audit.md §A2, §B2 · severity 1 · KI-002, KI-011
**Files:** `packages/omnimind-api/src/services/embedding-queue.ts:19,108`, `services/embedding.service.ts:57-79,118`

### Scenario
```ts
const queue: EmbeddingJob[] = [];
let workerRunning = false;
```

`createMemory()` enqueues with priority `'high'`. Railway redeploys — average several per active day. The new container boots with an empty array. Every job that was in flight or queued **vanishes**, and there is no DB column to record it.

After 3 retry attempts with no success, the worker also drops the job from the queue with **only a log line** — no DB write to indicate "permanently failed."

A second in-memory queue exists in `incremental-embedding.service.ts:25` (`pendingQueue`) with the same defect — though that service is dead code today (per [`DEAD-CODE.md`](DEAD-CODE.md) and KI-055).

### Symptom
`getEmbeddingStatus` (`embedding.service.ts:118`) returns `'pending'` for both:
- "Haven't started yet" (queued, will run shortly)
- "Failed forever" (dropped after 3 attempts)

These are observably identical. A user creates a memory, never sees it surface in semantic search, opens a support ticket — operator queries the DB, sees `embedding IS NULL`, and has no way to know which state caused it.

### Blast radius
- **Every memory created in the 1–60s window** between insert and embedding generation is permanently un-embeddable until manual `queueBackfill`.
- Failed-after-3-attempts memories require full content re-fetch + manual re-enqueue.
- No alerting; loss is invisible until a user complains.

### Fix
1. Add `embedding_status` enum + `embedding_attempts int` + `embedding_last_error text` columns to `memory_entries`. Mark `'pending'` at create time so the failure is observable.
2. On boot, sweep `WHERE embedding IS NULL AND embedding_status = 'pending' AND created_at > NOW() - interval '7 days'` and re-enqueue.
3. Replace the in-memory queue with a PostgreSQL-backed job queue (`pg-boss` is the lightest fit — keeps ADR-009's "no Redis" rule intact).

Roadmap home: **Phase 1** durability layer (was tagged "Phase 1.5"; folded into Phase 1's `MemoryWriteEvent` durability work + Postgres-backed queue per ROADMAP-OVERVIEW phase-number map).

---

## L4. `MemoryEntry.version` increments are performative — last-write-wins race

**Source:** data-integrity-audit.md §B1, §A5 · severity 2 · KI-010, KI-021
**Files:** `packages/omnimind-api/src/services/memory.service.ts:139-168`, `decision.service.ts:90`, `entity.service.ts:82`, `commitment.service.ts:64`

### Scenario
`updateMemory` does `version: { increment: 1 }` with a comment that reads "optimistic concurrency." But the `where` clause is `{ id }` — *never* `{ id, version: expected }`. So:

```
Writer A: read memory v1, send PATCH { content: "A's edit" }
Writer B: read memory v1, send PATCH { content: "B's edit" }

A: prisma.update({ where: { id }, data: { content: "A's edit", version: { increment: 1 } } })
   → row now v2, content = "A's edit"
B: prisma.update({ where: { id }, data: { content: "B's edit", version: { increment: 1 } } })
   → row now v3, content = "B's edit"
```

A's write is silently overwritten. Version goes 1→3. No 409, no warning, no log.

`commitment.service.ts:64` doesn't even increment version (per data-integrity-audit.md §A5). `user-profile.service.ts:43` and `cortex-contradictions.service.ts:118` have no version field at all.

### Symptom
Two devices for the same user (or two browser tabs, or a user editing while a cortex job runs) → one of the edits disappears with no UI feedback. Hardest to reproduce because it requires concurrent millisecond-window writes.

### Blast radius
- Silent data loss — only the last writer's payload survives.
- Affects memory edits, decision edits, entity edits, commitment edits.
- Cortex pipelines that read updated entities can compute on stale data depending on race timing.

### Fix
- Require `If-Match: <version>` header on every PATCH.
- `prisma.memoryEntry.update({ where: { id, version: expected } })`.
- On `P2025` (record not found), return 409 Conflict with the current version in the body.

Roadmap home: **Phase 0.25** task 0.25.6 (was tagged "Phase 1.6"; absorbed into Phase 0.25 as one of the six P0 fixes per ROADMAP-OVERVIEW phase-number map).

---

## L5. OAuth `state` is unsigned and unbound — token-hijack window

**Source:** security-audit.md §A1 · severity 1 · KI-004
**Files:** `packages/boardroom-ai/server/src/routes/calendar.routes.ts:21-29`, `integrations.routes.ts:31-40`, `services/google-calendar.service.ts:24`, `index.ts:82-87`

### Scenario
The auth-url generator sets `state: userId`. A CUID. No signature, no nonce, no expiry, no replay protection.

Attack from security-audit.md §A1:
1. Attacker calls `/calendar/auth-url` with their own session cookie. Captures their own valid Google authorization `code`.
2. Attacker hand-crafts: `GET /calendar/callback?code=<their_code>&state=<VICTIM_USER_ID>`. Victim's CUID can be discovered via shared rooms, leaked logs, or session URLs.
3. `handleCallback(victimUserId, attackerCode)` runs, writes the **attacker's** Google tokens into the victim's `OAuthToken` row.
4. Victim now reads the **attacker's** Gmail and Calendar inside the BoardRoom app — content injection, phishing target, social-engineering surface.

Compounding: the route mount in `index.ts` has the actual `/calendar/callback` path **behind the auth wall** (line 87). Either prod is silently broken or someone hot-patched server-side. Either way, when this flow does work, state is wide open to forgery.

### Symptom
Subtle. Victim sees emails from accounts they don't recognize. Or sees their own data missing. Or — worst — sees normal-looking emails that were planted by the attacker to influence the BoardRoom personas' analysis.

### Blast radius
- **Account takeover surface** for any user whose CUID is discoverable.
- **Content injection** into the persona context — attacker can plant memories that the personas will treat as truth.
- Phase 3 integrations are currently live and exposed; per security-audit.md §F: "Fix in this wave or pull integrations from production."

### Fix
1. Replace `state: userId` with a signed, short-lived JWT containing `userId + nonce + exp` (5 min). Use `jsonwebtoken` (already in deps). Verify in the callback before calling `handleCallback`.
2. Move the actual public callback paths above the auth wall: `app.use('/calendar/callback', publicCalendarCallbackRouter)`. Same for Gmail.
3. Bind the nonce to a short-lived row keyed by userId so a code can't be replayed.

Roadmap home: **Phase 0.25** task 0.25.1 (was tagged "Phase 2.5"; absorbed into Phase 0.25 per ROADMAP-OVERVIEW phase-number map).

---

## L6. Stripe webhook is double-broken — raw body + auth wall

**Source:** security-audit.md §A2, data-integrity-audit.md §A4 · severity 2 · KI-005
**Files:** `packages/boardroom-ai/server/src/routes/subscription.routes.ts:27-35`, `index.ts:49,87,90`, `services/stripe.service.ts:44-107`

### Scenario
Two independent bugs that compound:

**Bug 1 (raw body):** `app.use(express.json())` is mounted globally at `index.ts:49`. By the time `/subscription/webhook` runs, `req.body` is a parsed Object, not a Buffer. `stripe.webhooks.constructEvent(payload, signature, secret)` requires raw bytes → throws on every webhook → 400 → Stripe retries 3 times → marks the endpoint failing.

**Bug 2 (auth wall):** `app.use('/subscription', subscriptionRouter)` is mounted *after* `app.use(authMiddleware)`. Stripe sends webhooks with no JWT cookie → 401 before reaching the handler.

**Compounding (idempotency):** No `event.id` dedup table. If a webhook *did* succeed, Stripe retries (network blips, 5xx replies) would call `omnimindClient.createSubscription` twice. The OmniMind route does `prisma.subscription.create` — the unique on `userId` throws P2002, which escapes (no try/catch), Stripe sees 500 → endpoint disabled. `invoice.paid` followed by `invoice.payment_failed` arriving out of order leaves the user permanently `PAST_DUE` despite paying.

**Compounding (no reconciliation):** No daily cron pulls Stripe truth back. If a webhook is missed (Stripe dashboard "Failed deliveries"), nothing recovers.

### Symptom
- Subscriptions never transition `TRIALING → ACTIVE`. Free trial users stay free forever.
- Paying users get cut off when their `currentPeriodEnd` lapses without a renewal write.
- No revenue, or worse, paying users churn because they were silently downgraded.

### Blast radius
- **Direct revenue loss** from every paid signup (since pricing is 14-day trial → $29/mo per CLAUDE.md ADR-context).
- **Customer trust damage** — paying users who get cut off.
- Subscription middleware fails-open (L7) on top of this means even payments-broken users see Pro features intermittently — "Why did my features disappear?" support tickets become unanswerable.

### Fix
```ts
// Mount FIRST in index.ts, before express.json() and before authMiddleware:
app.post('/subscription/webhook',
         express.raw({ type: 'application/json' }),
         webhookHandler);
// Then global JSON, then auth wall, then everything else.
```
Plus:
- Move the webhook out of `subscriptionRouter` into its own public mount.
- Add `processed_stripe_events(id text PRIMARY KEY, processed_at timestamptz)` and `INSERT … ON CONFLICT DO NOTHING` first.
- Add a daily reconciliation cron that pulls Stripe subscriptions for users updated in the last 24 h and corrects drift.
- Manual back-fill script for any users whose state diverged while broken.

Roadmap home: **Phase 0.25** task 0.25.2 (was tagged "Phase 2.5"; absorbed into Phase 0.25 per ROADMAP-OVERVIEW phase-number map).

---

## L7. Encryption-key fall-through — OAuth tokens silently in plaintext on env typo

**Source:** security-audit.md §A5 · severity 2 · KI-007
**Files:** `packages/omnimind-api/src/lib/crypto.ts:5-15,32`, `lib/env.ts:9`

### Scenario
`getKey()` returns `Buffer.alloc(32, 0)` (32 zero bytes) when `ENCRYPTION_KEY` is unset.
`encrypt()` and `decrypt()` short-circuit to plaintext when `ENCRYPTION_KEY` is unset.
`validateOmniMindEnv()` only requires `ENCRYPTION_KEY` when `NODE_ENV === 'production'` — exact string match.

Trigger: any deploy where `NODE_ENV` is set to anything other than literally `"production"`. Realistic typos: `"Production"`, `"prod"`, `"staging"`, `"preview"`, unset (Railway misconfig), or a preview deploy that gets promoted to prod.

When this happens, every OAuth token write (Google Calendar, Gmail) goes to Postgres in cleartext.

Compounding: `decrypt()` silently returns the input string unchanged when decryption fails (`crypto.ts:32`). A forged or corrupted token row passes plaintext-as-token to Google API calls — the failure is invisible until Google rejects the request.

### Symptom
None. The flow works. Tokens land in the DB, are read back, used for API calls. Then a single SQL access (backup leak, internal mistake, contractor with read access) becomes account-takeover for every connected Google account.

### Blast radius
- **Every connected Google account** (Calendar + Gmail) is exposed via a single backup leak.
- **24-hour window** for an env-typo deploy to write thousands of plaintext tokens before someone notices.
- Migration back to encrypted is painful — you can't decrypt what was never encrypted.

### Fix
1. Make `ENCRYPTION_KEY` required in **all** environments. Crash on startup if missing.
2. Remove the dev passthrough. Use a separate dev key (committed to the repo's `.env.example` is fine).
3. Replace silent decrypt failures with explicit throws. Log + null return at minimum.

Roadmap home: **Phase 0.25** task 0.25.5 (was tagged "Phase 2.5"; absorbed into Phase 0.25). 1 hour of work, 24-hour blast radius if someone fat-fingers `NODE_ENV`.

---

## L8. WeeklyMemo race — Sun 18:01 redeploy creates duplicate rows

**Source:** data-integrity-audit.md §B5, §D6 · severity 3 · KI-016, KI-023
**Files:** `packages/omnimind-api/src/jobs/cortex-scheduler.ts:15-30`, `services/cortex-memo.service.ts:72`, `prisma/schema.prisma:649-667`

### Scenario
The Sunday 18:00 cron iterates all users and unconditionally calls `prisma.weeklyMemo.create`. There is:
- No `@@unique([userId, weekStart])` constraint on the model.
- No "have we already run this week?" check.
- No `withDistributedLock` guard (the in-process `redlock.ts` is unused dead code anyway — useless across instances).

Trigger: any redeploy at Sun 18:01-ish — the cron job is mid-iteration on the old container, which gets `SIGTERM`'d. The new container starts; its cron also fires. Some users get processed twice.

Same shape risk for `ContradictionAlert.create` (`cortex-contradictions.service.ts:75`) — there *is* a substring dedup at line 70 (`.contains(d.description.slice(0, 30))`) but it's fragile and not transactional. `detectPatterns` does a substring upsert that's safer but still races: two simultaneous job runs can both miss `findFirst` and both `create` near-duplicates.

### Symptom
A user opens BoardRoom on Monday morning and sees two weekly memos. Or sees memo content that double-counts decisions because the cortex feed query also forgot the `deletedAt` filter (KI-022).

Operator runs a count and sees `WeeklyMemo` rows with non-unique `(userId, weekStart)` tuples. There's no recovery procedure documented.

### Blast radius
- **User confusion** (visible duplicates).
- **Anthropic spend doubled** for affected users on cortex weeks where redeploys collided.
- Compounds with the missing `deletedAt` filter (KI-022) — the duplicates also contain inflated decision counts, so the user gets *two wrong memos*.
- Hard-blocks horizontal scale: the moment a second Railway instance exists, every cortex week duplicates for every user (per scalability-audit.md §E row 4).

### Fix
1. Add `@@unique([userId, weekStart])` to `WeeklyMemo`. P2002 on duplicate insert is the desired behavior.
2. Wrap every cortex job in a Postgres-backed lock — a `cron_runs(job, key, started_at, finished_at)` table with `INSERT … ON CONFLICT` semantics. (Replaces the in-process `redlock.ts`.)
3. Move cron to a **dedicated Railway worker service** (single replica) so the API can horizontally scale without multiplying cron fires.

Roadmap home: **Phase 15** (`@@unique([userId, weekStart])` constraint with the migration baseline) + **Phase 16** (cortex moves to dedicated worker service so cron stops sharing the API event loop).

---

## L9. OAuth refresh failure swallowed — integration "appears connected" forever

**Source:** data-integrity-audit.md §B6, security-audit.md §B (related) · severity 3 · KI-024
**Files:** `packages/boardroom-ai/server/src/services/google-calendar.service.ts:92-95,57,98`

### Scenario
```ts
} catch (_err) {
  // Token expired or revoked — return empty
  return [];
}
```

Any Google API error (auth, rate limit, network, 5xx, refresh-token revoked) returns `[]` to the caller as if there were zero events.

The `client.on('tokens', ...)` handler at line 57 only updates the stored token if Google chose to refresh during the call. If the **refresh token itself** is invalid (Google rotated it, user revoked access, account deleted), no error surfaces. There is no `OAuthToken.error` column to record the state. `getStatus()` (line 98) keeps returning "connected" forever until a human notices the calendar feed has been empty for weeks.

### Symptom
- User connected their Google Calendar 30 days ago.
- They see "Calendar: Connected" in the UI.
- They see zero events in their persona context.
- They assume "I just don't have meetings" or "BoardRoom doesn't pick those up."
- The feature silently became dead.

### Blast radius
- **Silent feature degradation** for every user who ever revokes Google access or whose token expires.
- Cortex outputs and persona context lose entire signal categories without any warning.
- Compounds with the encryption-key landmine (L7): if tokens were stored in plaintext from an env typo, *and* Google rotates → permanent silent loss with no recoverable signal.

### Fix
1. Add columns: `OAuthToken.lastError text`, `OAuthToken.lastErrorAt timestamptz`, `OAuthToken.status enum('healthy','degraded','expired')`.
2. Refuse boot if `ENCRYPTION_KEY` is missing (also fixes L7).
3. Surface `status='expired'` in the UI as "Reconnect required" and link to the auth-url.
4. Distinguish error classes — rate limit vs. auth vs. network — and only mark `expired` on permanent auth failure.

Roadmap home: **Phase 0.25** (alongside L5 and L7) for foundation; **Phase 14** (observability suite) makes the silent failures visible.

---

## L10. Bonus: subscription middleware fails-open on every error class

**Source:** security-audit.md §B3, data-integrity-audit.md §A3 · severity 2 · KI-009
**File:** `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts:31-34`

### Scenario
```ts
} catch {
  // If subscription check fails, let the request through (don't block on billing service errors)
  next();
}
```

ADR-010 says subscription middleware should fail-open. But the bare `catch {}` swallows everything:
- 401 (API key rotated, BoardRoom out of sync) — paying users still get features, but so do free trials past expiry.
- 422 (bad request) — same.
- 500 (OmniMind down) — design intent (ADR-010), correct.
- Network DNS / connection refused — design intent.
- TypeError on `sub.status` — bug in our own code, fails-open silently.
- Circuit breaker open (J.1) — fails-open platform-wide for the cooldown.

### Symptom
- During an OmniMind outage: every user has Pro features. Reasonable.
- During an `OMNIMIND_API_KEY` rotation lag: every user has Pro features. Unintended.
- During a malformed-response bug: every user has Pro features. Unintended.

### Blast radius
- **Every hour OmniMind is unhealthy = free service for non-payers.** Pricing is 14-day trial then $29/mo (per CLAUDE.md scenario context).
- Combined with the Stripe webhook break (L6), the entire billing pipeline is silent: no enforcement, no payment events landing, no recovery.

### Fix
- Narrow the catch to `OmnimindUnavailableError` only. Log structured error with `userId` + `requestId`.
- Cache the last-known subscription state per user (TTL = 60s); on transient error, serve cached.
- Fail closed on 4xx; fail open only on transient network errors.
- Add counter `subscription_check_failed_open_total{reason=...}` so drift is visible.

Roadmap home: **Phase 18** (resilience + multitenant fairness — narrow the catch as part of the ADR-010 update).

---

## Sequencing summary

The landmines are **not independent**. Several compound in dangerous ways:

| Pair | Compounding effect |
|---|---|
| L1 + L8 | Cortex duplicates + schema drift = unrecoverable data state on first migration attempt |
| L3 + L4 | Embedding loss + version race = silent corruption with no observability |
| L5 + L7 + L9 | OAuth hijack + plaintext tokens + silent refresh failure = full account-takeover surface for any connected Google account |
| L6 + L10 | Webhook broken + middleware fails-open = entire billing pipeline runs silent |
| L2 + KI-031 (RLS facade) | Hard-blocks multi-user rooms (DEF-015) per security-audit.md §F. Real RLS lands in Phase 18. |

**Recommended defuse order** (smallest blast-radius gain first):
1. L7 (1 hour) — close the env-typo plaintext window.
2. L5 (3 hours) — close the OAuth hijack.
3. L6 (2 hours code + 1 hour back-fill) — restore billing.
4. L10 (2 hours) — narrow the fails-open catch.
5. L4 (1 day) — make `If-Match` real.
6. L3 (1 week) — durable embedding queue.
7. L8 (4 hours unique constraint + 1 day worker service split) — cortex idempotency.
8. L9 (1 day) — OAuth observability.
9. L1 (2 days inc. baseline migration) — only after backup runbook (KI-014) exists.
10. L2 (1 day to delete facade + 1 week for real RLS) — only before Phase 4.

For the full severity-ranked register, see [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md). For the unused-code subset of cleanup work, see [`DEAD-CODE.md`](DEAD-CODE.md). For the architecture diagrams that show how each landmine sits in the production data flow, see [`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md).
