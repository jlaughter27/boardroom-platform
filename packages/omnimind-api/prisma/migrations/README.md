# OmniMind API — Prisma migrations

## Why `0_init` exists (AUDIT-2026-10-02 / O-104)

Production was created with `prisma db push`; no migration ever created the
base tables. When F-005 switched the entrypoint to `prisma migrate deploy`,
any **empty** database (DR restore, staging, a new Railway Postgres) crashed on
boot: the entrypoint marked the four old migrations as applied, and the first
real migration (`20260514_recall_count`) failed with
`relation "memory_entries" does not exist`.

`0_init/migration.sql` was generated with

```
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

at the schema state of commit `fea0e4e` (i.e. **before** the three
`20261002*` migrations below were added). It represents the full schema that
production had at that point, including everything the older migrations add.

### Design decision: snapshot baseline + idempotent follow-ups

Two options were considered:

1. Hand-edit `0_init` down to the "pre-first-migration" state so each later
   migration genuinely adds its delta.
2. Keep `0_init` as the full snapshot and make every later migration
   idempotent (`IF NOT EXISTS`, `DO $$ … $$` guards) so it is a no-op when it
   runs after `0_init`.

Option 2 was chosen. Hand-reducing an 860-line generated file is error-prone
and the "pre-first-migration" state was never a real, tested schema (the
first migration, `20250410_add_search_indexes`, referenced columns that do not
exist — see below). A generated snapshot is reproducible and verifiable with
`prisma migrate diff`.

Consequences:

- On a **fresh** database: `migrate deploy` applies `0_init` (everything),
  then each later migration runs and is a no-op except for the extra search
  indexes and the data backfills.
- On an **existing** database: `docker-entrypoint.sh` marks `0_init` and the
  four pre-migrate-deploy migrations as `--applied` (they are already
  reflected in the schema), then `migrate deploy` applies only new ones.
- The entrypoint now **detects** which case it is in
  (`prisma/scripts/detect-baseline.cjs`) instead of blindly resolving — that
  blind resolve was the actual cause of the crash loop.

### Migrations that were modified

| Migration | Change | Why |
|---|---|---|
| `20250410_add_search_indexes` | column names `userId/deletedAt/sourceRef/createdAt` → `user_id/deleted_at/source_ref/created_at` | The table uses snake_case (`@map`). This migration had never executed anywhere (always `--applied`); on an empty DB it crashed. Every statement is `IF NOT EXISTS`. |
| `20260407000000_add_embedding_column` | `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` | Collided with `0_init` on a fresh DB. |

Modifying already-resolved migrations is safe for production: `migrate deploy`
does not re-run or checksum-verify applied migrations.

### Rules for new migrations

- Write them idempotently (`IF NOT EXISTS`, guarded enum additions). It costs
  nothing and keeps fresh-DB boots and re-runs safe.
- Never add a new migration to the entrypoint's `--applied` baseline list;
  that list is frozen at the five entries that pre-date `migrate deploy`.
- `pgvector` must be available (`CREATE EXTENSION vector`). Locally without
  pgvector you can test the chain by stripping the vector bits (see
  `docs/audits` notes); production (Railway) has it.

## Migration log

| Migration | Purpose |
|---|---|
| `0_init` | Full schema snapshot (see above) |
| `20250410_add_search_indexes` | GIN trigram / FTS indexes |
| `20260407000000_add_embedding_column` | `embedding vector(1536)` + IVFFlat index |
| `20260509000000_mcp_phase_1` | tenants, agents, mcp_audit_logs, MCP columns, enum values |
| `20260509000001_mcp_phase_4` | ministry encryption columns, weekly_digests |
| `20260514_recall_count` | `recall_count` for decay reinforcement |
| `20260515_agent_id_required` | `agent_id` NOT NULL backfill |
| `20260515_embedding_outbox` | durable embedding retry queue |
| `20261002000000_base_importance` | O-103 — `base_importance` so decay never compounds |
| `20261002000001_tenant_owner_user_id` | O-107 — `tenants.owner_user_id` for job-written memories |
| `20261002000002_agents_api_key_hash_idx` | M-103 — index for `x-agent-key` lookups |
