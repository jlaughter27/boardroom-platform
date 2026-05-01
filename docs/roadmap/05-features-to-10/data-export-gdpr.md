# Data Export + Account Deletion (GDPR-Ready)

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

OmniMind stores PII (memories often contain names, emails, business specifics) and operates partially in jurisdictions where GDPR, CCPA, and similar laws apply. Today there is **no first-party way for a user to download all their data, no way to delete their account, no documented retention policy, and no audit trail of who accessed what**. That's:

- Legal risk (GDPR Article 15 right of access, Article 17 right to erasure, ~30-day response window)
- Trust risk (privacy-conscious users won't pay for a SaaS that hostage-holds their data)
- Operational risk (when we eventually ship multi-tenant teams, lack of an export/delete pipeline becomes a blocker)

This is foundational compliance, not a "nice to have." Ship it before any enterprise sales motion and before active marketing in EU markets.

## Approach

Two endpoints, one shared pipeline:

1. **Full account export** — generates a complete archive of everything OmniMind knows about the user, deliverable in two formats: a single JSON file (machine-readable) and the markdown vault (human-readable; reuses [markdown-export-import.md](markdown-export-import.md) infrastructure).
2. **Account deletion** — a 30-day soft-then-hard pipeline that cascades through every table touching user data, including embeddings, encrypted OAuth tokens, audit logs, and downstream caches.

### Export pipeline

Triggered by user action in the Settings UI or by a support team member with consent. Sequence:

1. Create a `DataExportRequest` row, status `pending`
2. Background job (`graphile-worker`) gathers data:
   - All `MemoryEntry` (including soft-deleted)
   - All `Decision`, `DecisionAssumption`, `DecisionReview`
   - All `Person`, `Goal`, `Project`, `Task` and link tables
   - All `Session`, `TranscriptEntry`, `AdvisorMessage`, `MeetingOutput`
   - All `Commitment`, `WeeklyMemo`, `ContradictionAlert`, `ThinkingPattern`
   - All `CustomPersona`, `UserProfile`, `ContextCapsule`
   - All `MemoryAuditLog` entries
   - `Subscription`, `OAuthToken` metadata (token VALUES are NOT exported — they're credentials, not user data)
   - `LlmUsage` records (so the user sees what they paid for)
3. Output: a single zip with two top-level directories: `vault/` (markdown) and `raw/` (JSON-per-table)
4. Store in S3-compatible storage (Backblaze B2) with a 7-day signed URL
5. Email the user with the link
6. Mark `DataExportRequest.status = succeeded`

### Deletion pipeline (30-day soft-then-hard)

GDPR allows up to 30 days to fulfill an erasure request and explicitly permits a "cooling-off" window for accidental requests. The 30-day window is also our recovery margin for support reversals.

Sequence:

**Day 0 — request submitted:**
1. Create a `DataDeletionRequest` row, status `scheduled`, `executeAt = now() + 30 days`
2. Set `User.deletedAt = now()` (soft-delete; user can no longer log in)
3. Cascade soft-delete:
   - All entity rows: `deletedAt = now()`
   - All sessions, decisions, memories, links: `deletedAt = now()`
4. Revoke all OAuth tokens immediately (Google, GitHub, Stripe — call provider revoke endpoints)
5. Send email confirmation with a "Cancel deletion" link valid for 30 days

**Day 0-30 — cooling-off:**
- User can log in via a one-time recovery link to cancel
- All data is soft-deleted but recoverable
- API + cortex jobs ignore soft-deleted rows (already enforced by retrieval queries)
- A daily reminder email at days 7, 14, 28 ("your account will be permanently deleted on [date]")

**Day 30 — hard delete:**

A scheduled job runs the hard-delete in a transaction:

1. Delete `MemoryEntry` rows + their embeddings (the `vector` column is in the same row, so no separate cleanup)
2. Delete every link table row referencing this user's entities
3. Delete entity rows (Person, Goal, Project, Task, Decision, etc.)
4. Delete sessions, transcripts, advisor messages, meeting outputs
5. Delete cortex outputs (WeeklyMemo, ContradictionAlert, ThinkingPattern)
6. Delete CustomPersona, UserProfile, ContextCapsule
7. Delete OAuthToken (encrypted blob is gone; the underlying provider account is unaffected — we already revoked at Day 0)
8. Delete LlmUsage (per audit policy: aggregate billing records retained for 7 years; per-request rows go)
9. Delete MemoryAuditLog
10. Delete EventOutbox + WebhookDelivery rows
11. Delete VaultExport rows
12. Delete the User row itself
13. Mark `DataDeletionRequest.status = completed`, retain *only the request row itself* for audit (with `userIdHash` instead of `userId` after final delete)
14. Async: trigger a search-and-purge across object storage (vault export zips, attachments) — anything keyed to `userId`

The `DataDeletionRequest` audit row outlives the user (7-year retention) so we can prove to a regulator that erasure happened on a specific date.

## Schema impact

```prisma
model DataExportRequest {
  id           String   @id @default(cuid())
  userId       String
  status       String   @default("pending") // pending | running | succeeded | failed
  triggeredBy  String   // "user" | "support" | "scheduled"
  formats      String[] // ["json", "vault"]
  archiveSizeBytes BigInt?
  signedUrl    String?
  signedUrlExpiresAt DateTime?
  errorMessage String?
  createdAt    DateTime @default(now())
  completedAt  DateTime?

  @@index([userId, createdAt])
}

model DataDeletionRequest {
  id           String   @id @default(cuid())
  userId       String?  // nullable after hard-delete; userIdHash retained
  userIdHash   String   // SHA-256(userId), retained post-deletion for audit
  status       String   @default("scheduled") // scheduled | cancelled | completed | failed
  scheduledAt  DateTime
  executeAt    DateTime
  cancelledAt  DateTime?
  completedAt  DateTime?
  recoveryToken String  @unique
  recoveryTokenExpiresAt DateTime
  errorMessage String?

  @@index([status, executeAt])
  @@index([userIdHash])
}
```

## API surface

- `POST /v1/account/exports` — request a full export
- `GET /v1/account/exports/:id` — poll status; returns signed URL when ready
- `POST /v1/account/deletion` — request account deletion
- `POST /v1/account/deletion/cancel?token=` — cancel within the cooling-off window
- `GET /v1/account/deletion` — view current scheduled deletion (if any)

## Phases

- [`../04-roadmap/PHASE-18-resilience-multitenant-fairness/`](../04-roadmap/PHASE-18-resilience-multitenant-fairness/) — full GDPR/DSAR/hard-delete pipeline ships alongside the RLS rollout in Phase 18 (canonical numbering; was tagged "Phase 13" by Builder 4). Shares the `graphile-worker` foundation that Phase 12 (webhooks + event bus) ships.

Estimated effort: ~2 weeks (export pipeline + deletion cascade + UI + recovery flow + audit retention policy).

## Risks

- **Cascade misses a table.** A new model is added later and the deletion cascade isn't updated, leaving orphan rows. Mitigation: foreign-key constraints with `onDelete: Cascade` where safe; an integration test that creates a full user, requests deletion, asserts zero remaining rows for that `userId`; CI gate on schema changes that touches user-scoped tables.
- **Soft-delete leaks into retrieval.** A query forgets to filter `deletedAt IS NULL`. Mitigation: Prisma middleware that auto-applies the filter; eval scenarios that confirm soft-deleted memories never surface.
- **OAuth provider revocation fails.** Some providers' revocation APIs are flaky. Mitigation: best-effort revocation at Day 0; record failures; retry on Day 30 before hard-delete.
- **Embeddings linger in cache.** The in-process retrieval cache may hold deleted memories briefly. Mitigation: cache invalidation on soft-delete; max cache TTL ≤ 5 min.
- **Vault export to user's GitHub repo persists data after deletion.** The user owns that repo; OmniMind cannot delete from it. Mitigation: export confirmation explicitly states this; deletion UI shows a checklist of "places your data may still exist" (your GitHub vault, your inbox where exports were emailed, etc.).
- **Backups contain deleted data.** Per ops research §7, off-provider backups exist. Mitigation: 90-day backup retention policy documented; backups older than 90 days are purged on a schedule.

## Success metrics

- 100% of export requests complete within the GDPR 30-day window (target: < 24h)
- 100% of deletion requests complete within 30 days + 24h grace
- Zero "I requested deletion but my data is still showing up in cortex" incidents
- < 5% of deletion requests cancelled (proxy for accidental clicks vs. intentional)
- Audit retention: every `DataDeletionRequest` row preserved for 7+ years

## Dependencies on other features

- **Markdown export + import** (Phase 11) — vault export is reused inside the GDPR archive
- **Memory editor UI** (Phase 11) — soft-delete + restore flow shares the same pipeline
- **Observability suite** (Phase 13) — deletion cascade emits structured logs for audit
- **Webhooks event bus** (Phase 13) — `account.deletion.scheduled` and `.completed` events for ops alerting
- **Per-tenant cost controls** (Phase 14) — deletion stops billing immediately
