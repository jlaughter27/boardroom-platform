# DEF-009 — Audit Tables (Memory Access Log)

**Capability:** A first-class `AuditEvent` table capturing every read/write to user data, with before/after diff payloads, actor identity, IP/UA, correlation ID, retention policy. Supports SOC 2 / HIPAA evidence requirements and forensic incident investigation.

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE (either):**
- A SOC 2 Type 1 customer requirement on a real deal — i.e., a paying or pipeline customer requires SOC 2 evidence, AND we've decided to pursue it. Not "we might want SOC 2 someday."
- A forensic incident requires it (e.g., a security event where we need to answer "who saw what user's data when").

**Work estimate when triggered:** 2 weeks.

Breakdown per wave 1 data-architecture research §8:
- 0.5 week: schema. `AuditEvent(id, userId, actorType enum('user','system','cron','api','mcp','sdk'), action enum, entityType, entityId, before jsonb, after jsonb, metadata jsonb, ipAddress inet, userAgent text, requestId text, createdAt timestamptz)`. Partition by month using `pg_partman` for retention sanity.
- 0.5 week: Prisma middleware (`prisma.$use(...)`) intercepting create/update/delete on audit-flagged models. Synchronous writes are fine at this scale; switch to outbox-driven async if audit volume passes 1000/sec.
- 0.5 week: read endpoints. `GET /admin/audit?userId=...&entityType=...&from=...&to=...`. Auditor-only access. Cursor pagination.
- 0.5 week: retention pipeline. Monthly partitions auto-create; partitions >18 months old archive to S3-compatible storage (Backblaze B2 from Phase 18) with 7-year retention for compliance-relevant rows (deletion events).

**Why deferred:**

(a) **No customer asking for it yet.** Building SOC 2-grade audit before there's a SOC 2-bound deal is over-engineering. The cost is real — partitioning, retention, infra for archival — and the benefit is hypothetical.

(b) **Partial substitute already exists.** Phase 12 outbox table records every state-changing event. Phase 14 observability captures every request with its `requestId`. Together they answer ~70% of "who did what when" questions without a dedicated audit table. The gap is read-side observability (we don't log every retrieval as an audit event today) and the structured before/after diff for updates.

(c) **`pgaudit` extension is unavailable on Railway managed Postgres** per the wave 1 research. Self-hosting Postgres just for `pgaudit` is a separate, larger architectural decision.

**Interaction with GDPR (DEF-009 also relevant to wave 1 §9):**

When a user requests deletion (GDPR right-to-delete), the deletion event itself must be auditable for 7 years (regulator may ask "did you actually delete this user's data and when"). Today's pattern: log the deletion via the standard logger to the observability vendor; vendor retention is shorter than 7 years. When this audit table exists, deletion events get written there with 7-year retention and never partition-pruned.

**References:**
- `docs/research/omnimind-roadmap-2026/wave1-research/03-data-architecture.md` §8 + §9
- Phase 12 outbox provides the partial substitute today
- `pg_partman` for partition management when triggered
- `pgaudit` — incompatible with Railway, document why this isn't the answer
