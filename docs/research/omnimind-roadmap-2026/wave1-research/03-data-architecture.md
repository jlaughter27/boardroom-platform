# Wave 1 Research — Data Architecture Patterns for Evolving AI Memory Schemas

**Topic:** Migrations, backups, soft-delete enforcement, RLS, embedding versioning, bi-temporal modeling, audit logs, GDPR.
**Audience:** omnimind roadmap planners (Phase 1 schema alignment, Phase 14 migration baseline).
**Date:** 2026-04-18.

---

## 1. Migration baseline pattern after `prisma db push`

The omnimind production entrypoint runs `prisma db push --skip-generate --accept-data-loss` on every boot. There is no `_prisma_migrations` table — so no migration history exists. Establishing a baseline without dropping the database requires the **Prisma "baselining" workflow** documented at <https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining>.

**SOP (run against a clone of prod first):**
1. Snapshot prod (`pg_dump -Fc`) and restore to a staging database.
2. `mkdir -p prisma/migrations/0_init` then `npx prisma migrate diff --from-empty --to-schema-datasource prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`. This generates a single SQL file matching the *current* schema.
3. Hand-edit the generated SQL to remove `CREATE EXTENSION` statements that are managed by the entrypoint and to insert any pgvector index DDL Prisma can't represent (the `Unsupported("vector(1536)")` column needs a manual `CREATE INDEX ... USING ivfflat ...`).
4. On every existing environment (staging, prod): `npx prisma migrate resolve --applied 0_init`. This inserts the row into `_prisma_migrations` *without running the SQL*, marking the schema as already-applied.
5. Switch the entrypoint from `prisma db push` to `prisma migrate deploy`.
6. From that point, all schema changes go through `prisma migrate dev` locally and `prisma migrate deploy` in CI/prod.

**Pitfalls (from the Prisma docs and community reports):**
- If `prisma migrate diff` is run against a database that already has drift, the baseline encodes the drift permanently. Always diff *from-empty to-schema*, never *from-database*.
- Forgetting to `migrate resolve --applied` on every environment causes `migrate deploy` to try to re-create existing tables and fail.
- pgvector / pg_trgm extensions and IVFFlat indexes round-trip poorly through Prisma. Keep their DDL in a hand-managed `prisma/migrations/0_init/extensions.sql` invoked from the migration's main `migration.sql` via `\i` is *not* supported — instead inline the `CREATE EXTENSION IF NOT EXISTS` at the top of `migration.sql`.
- The 6 archived 2025-04 migration attempts must be deleted from `prisma/migrations/` before baselining or Prisma will try to apply them.

---

## 2. Zero-downtime schema migrations (expand–contract)

For a single-instance Railway service at 100k–1M rows, the goal is to avoid long `ACCESS EXCLUSIVE` locks and to keep old code compatible with new schema during deploy. The canonical pattern is **expand–contract** (also called "parallel change" — Martin Fowler, <https://martinfowler.com/bliki/ParallelChange.html>).

**ADD COLUMN:**
- Postgres 11+ adds `NOT NULL DEFAULT <const>` instantly (no table rewrite). For Postgres 16 + Prisma, simply add the column with a default; Prisma generates `ALTER TABLE ... ADD COLUMN ... DEFAULT ...`.
- For columns whose default requires a function call (`gen_random_uuid()`, `now()`), split into three deploys: (1) add nullable column, (2) backfill in batches of 1k–10k via `UPDATE ... WHERE id IN (SELECT id ... LIMIT 1000)`, (3) `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`.

**RENAME column** (the most dangerous operation):
1. Add the new column nullable, copy data with a trigger on writes (`BEFORE INSERT OR UPDATE` setting `new.new_col := new.old_col`).
2. Backfill historical rows.
3. Deploy code that reads the new column, writes to both.
4. Deploy code that writes only to the new column.
5. Drop the trigger and the old column.

**DROP column:**
1. Deploy code that no longer reads or writes it.
2. Wait one release cycle.
3. Drop. Postgres `DROP COLUMN` is metadata-only and fast.

**ALTER COLUMN TYPE** (e.g. `text` → `varchar(n)`): same expand–contract, but use `USING` clause carefully — narrowing types rewrites the table.

For omnimind (single instance, no read replicas), the trigger-based dual-write is overkill for most cases — but **the pattern is mandatory once a second app instance exists**, because old code on instance A could overwrite new column values written by instance B.

References:
- Strong Migrations (Rails): <https://github.com/ankane/strong_migrations> — its "bad" list maps 1:1 to Postgres trap operations.
- GoCardless "Zero-downtime Postgres migrations": <https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts/>.
- Prisma's own guidance on expand-and-contract: <https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern>.

---

## 3. Soft-delete enforcement at the DB layer

Application-layer "remember to filter `deletedAt IS NULL`" fails about as often as you'd expect. omnimind has 17+ models using `deletedAt` — every raw SQL query, every retrieval ranker, every cortex job is a potential leak. Three reliable enforcement options exist:

**a) Postgres views per table.** Create `memory_entries_v` as `SELECT * FROM "MemoryEntry" WHERE "deletedAt" IS NULL`. Application code reads from the view; only deletion code touches the base table. Works with Prisma via `@@map` plus `@@ignore` on the base model — but breaks Prisma's writable client. Best used selectively for high-risk read paths (retrieval, ranker).

**b) Row Level Security (RLS) policies.** `ALTER TABLE "MemoryEntry" ENABLE ROW LEVEL SECURITY; CREATE POLICY mem_not_deleted ON "MemoryEntry" FOR SELECT USING ("deletedAt" IS NULL);`. Postgres transparently filters every SELECT for non-superuser roles. Prisma supports RLS but its connection pool runs as the table owner by default — you must connect as a non-owner role (e.g. `omnimind_app`) and `ALTER ROLE omnimind_app NOBYPASSRLS;`. This is also the foundation for multi-tenant isolation. See <https://supabase.com/docs/guides/database/postgres/row-level-security> for a production-tested overview.

**c) Generated `is_active` column + partial indexes.** `ALTER TABLE "MemoryEntry" ADD COLUMN "isActive" boolean GENERATED ALWAYS AS ("deletedAt" IS NULL) STORED;`. Then every index becomes `CREATE INDEX ... WHERE "isActive"`. Doesn't *prevent* leakage but makes the cost of a missed filter huge (full scan), which surfaces in slow-query logs fast.

**Recommended for omnimind:** RLS for `MemoryEntry`, `Decision`, `Person`, `Goal`, `Project`, `Task`, `MeetingOutput`. These contain user-readable content and have the highest leak risk. Plus generated `isActive` columns on all 17 soft-deletable tables for index efficiency. Hard delete pipelines (GDPR — see §9) bypass RLS by connecting as the owner role.

---

## 4. Embedding model versioning

OpenAI deprecated `text-embedding-ada-002` in 2024 with ~6 months' notice. `text-embedding-3-small` will eventually follow. omnimind has zero coexistence path today. The production pattern is **per-row model fingerprint + parallel-read backfill**:

**Schema additions (all on `MemoryEntry`):**
```
embeddingModel       text NOT NULL DEFAULT 'text-embedding-3-small'
embeddingModelVersion text NOT NULL DEFAULT '2024-01'
embeddingDim         int  NOT NULL DEFAULT 1536
embeddedAt           timestamptz NOT NULL DEFAULT now()
```

Add a sibling column `embeddingV2 vector(1536)` (or different dim if the new model differs — e.g. `vector(3072)` for `text-embedding-3-large`). `pgvector` allows multiple vector columns per row.

**Migration strategy (Pinecone / Weaviate community-recommended):**
1. **Dual-write window:** new memories embed with both the old and new model. Cheap (only new rows), measured in cents/day.
2. **Background backfill:** node-cron job pulls 1k rows/hour where `embeddingV2 IS NULL`, embeds with the new model. At 100k rows, full backfill is ~100 hours. At ~$0.02/M tokens for `3-small`, total backfill cost for a 100k-memory user is < $5.
3. **Dual-read with reranking:** retrieval queries both columns, then reranks. A simple approach: query top-30 from each, dedupe by id, rerank top-10 by Cohere/Voyage rerank API or by a Claude Haiku call. Once `embeddingV2` is fully populated, drop `embedding`.
4. **Index strategy:** during backfill, both vectors need indexes. IVFFlat tolerates partial population (queries return what exists). Build the new HNSW index `CONCURRENTLY` once `embeddingV2` is ≥80% populated.

**Don't do:** retrofit by computing similarity between old and new embeddings to "translate" — embedding spaces are not comparable across model families.

References: <https://docs.pinecone.io/docs/migrating-to-a-new-embedding-model>, OpenAI deprecations page, "Versioning embeddings in production" — <https://www.timescale.com/blog/postgresql-as-a-vector-database-using-pgvector>.

---

## 5. pgvector IVFFlat → HNSW migration

IVFFlat is faster to build, lower memory; HNSW is faster to query, higher recall. For omnimind's Phase 3 transition at ~100k vectors, HNSW is the right call (build cost is acceptable, query latency drops 30–60%).

**Migration SOP:**
```sql
-- 1. Build the new index online — does not block reads or writes
CREATE INDEX CONCURRENTLY memory_entry_embedding_hnsw_idx
  ON "MemoryEntry"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 2. Validate query plans use it
EXPLAIN ANALYZE SELECT id FROM "MemoryEntry"
  ORDER BY embedding <=> '[...]'::vector LIMIT 10;
-- Should show "Index Scan using memory_entry_embedding_hnsw_idx"

-- 3. Compare top-10 recall against IVFFlat for a sample of 100 queries
-- 4. Drop the old index
DROP INDEX CONCURRENTLY memory_entry_embedding_ivfflat_idx;
```

**Realistic numbers for 100k 1536-dim vectors on Railway's standard Postgres (4 vCPU, 8GB):**
- HNSW build with `m=16, ef_construction=64`: ~8–15 minutes.
- Index size: ~1.5–2 GB for 100k vectors (vs ~600 MB IVFFlat).
- Query p95: ~5–15 ms vs IVFFlat ~20–50 ms at `lists=100`.
- Downtime: zero with `CONCURRENTLY`. Locking only at index swap — milliseconds.

**Pitfalls:**
- `CONCURRENTLY` cannot run inside a transaction; cannot be in a Prisma migration file directly. Run via `psql -f` or a one-shot job.
- Tune `hnsw.ef_search` per query (default 40, raise to 100 for higher recall at ~2x latency).
- `maintenance_work_mem` must be ≥ index size or build fails. Set to 4GB+ during build.

Reference: pgvector README §Performance, <https://github.com/pgvector/pgvector#performance>; Supabase HNSW guide <https://supabase.com/blog/increase-performance-pgvector-hnsw>.

---

## 6. Backups + PITR on Railway

Railway's Postgres backup story (as of early 2026) is **plan-dependent and shallow**:

- **Hobby / Pro plans:** daily logical backups via `pg_dump`, retained ~7 days, restored only via support ticket. No PITR.
- **Pro plan w/ "Backups" addon:** snapshots every 24h, 30-day retention, self-serve restore from dashboard. Still no PITR.
- **Enterprise plan / "Bring your own"**: PITR via WAL archiving requires running the Postgres workload on a managed alternative — Neon (PITR up to 30 days, point-in-time to the second), Supabase (PITR addon, $100/mo for 7-day window), Crunchy Bridge (full PITR, default 10 days), or self-hosted with `pgbackrest`.

**SOP for omnimind:**
1. Today: nightly `pg_dump -Fc -Z9` cron job inside the omnimind container, push to a dedicated S3-compatible bucket (Cloudflare R2 — $0.015/GB-mo, no egress). Encrypted at rest with `age` or `gpg`. Retain 30 days hot, archive monthly to Glacier-tier.
2. Weekly automated restore drill: spin a temporary Postgres container, restore the latest dump, run `prisma migrate status` and a smoke-test query suite. Failed restore → PagerDuty.
3. Phase 14 or earlier: migrate to Neon or Crunchy Bridge for true PITR. Neon's branching also gives free dev databases.
4. Cross-region: Railway is single-region per project. For DR, replicate dumps to a second cloud region. Full hot-standby is not feasible on Railway today.

References: Railway docs <https://docs.railway.com/reference/postgresql>; Neon PITR <https://neon.tech/docs/introduction/point-in-time-restore>.

---

## 7. Bi-temporal modeling in Postgres

omnimind already has the *concept* of memory supersession (the validation pipeline can mark old memories stale). Bi-temporal modeling formalizes "what did the system know about X, as of date D?" — critical for AI memory because user beliefs evolve.

**Two-axis model:**
- **Valid time:** when a fact was true in the world. `validFrom timestamptz`, `validTo timestamptz NULL`.
- **Transaction time:** when the system recorded it. Postgres gives this for free via `xmin` (system column) but it's not query-friendly. Add `recordedAt timestamptz NOT NULL DEFAULT now()` and `supersededAt timestamptz NULL`.

**Range types vs discrete columns:** Postgres `tstzrange` with `&&` (overlap) and `@>` (contains) operators is more elegant *and* indexable via GiST. `validity tstzrange NOT NULL` plus a GiST exclusion constraint prevents overlapping facts:
```sql
ALTER TABLE "MemoryEntry"
  ADD CONSTRAINT no_overlapping_validity
  EXCLUDE USING GIST (id WITH =, validity WITH &&);
```

**Indexing for point-in-time:** `CREATE INDEX ON "MemoryEntry" USING GIST (validity)` — supports `WHERE validity @> '2026-04-01'::timestamptz` in milliseconds.

**Avoiding query-site filter bugs:** wrap point-in-time queries in a Postgres function `memories_as_of(t timestamptz)` returning `SETOF memory_entry`, or expose a Postgres view `memory_entries_current AS SELECT * FROM "MemoryEntry" WHERE validity @> now() AND "deletedAt" IS NULL`. Application code that wants "current state" reads the view; only the supersession pipeline touches the base table.

References: Snodgrass *Developing Time-Oriented Database Applications in SQL* (still the canonical text); 2ndQuadrant "Temporal tables in PostgreSQL" series.

---

## 8. Audit log table design

For an AI system that synthesizes user data, an audit trail answers "where did this output come from?" — critical for debugging hallucinations and for compliance. Two viable approaches:

**a) Application-level (recommended for omnimind):** a single `AuditEvent` table with:
```
id, userId, actorType ('user'|'system'|'cron'|'api'),
action ('create'|'update'|'delete'|'read'|'extract'|...),
entityType, entityId,
before jsonb, after jsonb,  -- diff payload
metadata jsonb,             -- correlation_id, persona, prompt hash
createdAt timestamptz,
ipAddress inet,
userAgent text
```
Write from a Prisma middleware (`prisma.$use(...)`) that intercepts `create`, `update`, `delete` for audit-flagged models. Synchronous writes are fine at omnimind's scale; switch to a queue when audit volume > 1000/sec.

**b) Postgres-native via `pgaudit` extension** (<https://github.com/pgaudit/pgaudit>): logs every statement to the Postgres log file. Excellent for SOC2/HIPAA. Overhead: ~5–10% on write-heavy workloads. Not available on Railway managed Postgres (not in the extension allowlist) — would require self-hosting.

**Retention + partitioning:** audit tables grow fast. Partition by month:
```sql
CREATE TABLE "AuditEvent" (...) PARTITION BY RANGE ("createdAt");
CREATE TABLE "AuditEvent_2026_04" PARTITION OF "AuditEvent"
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```
Use `pg_partman` to auto-create monthly partitions and drop ones >18 months old. Compliance-relevant rows (deletion events for GDPR) get exported to S3 before partition drop and retained 7 years.

**What to log (omnimind-specific minimum):** memory writes (with raw input → validated output diff), persona dispatches (which personas, what context items), all DELETE operations, all auth events, all OAuth token refreshes, all subscription changes, all cortex job outputs.

---

## 9. Pre-PMF data export + GDPR readiness

Even pre-PMF, GDPR/CCPA right-to-delete and right-to-export apply if any EU/CA user signs up. Minimum viable:

**Export endpoint (`GET /me/export`):**
- Returns a single ZIP: `user.json`, `sessions/*.json`, `memories.jsonl`, `decisions.jsonl`, `entities/{persons,goals,projects,tasks}.jsonl`, `cortex/{memos,patterns,contradictions}.jsonl`, `oauth_tokens.json` (with secrets redacted), `subscriptions.json`.
- Embeddings excluded (raw vectors not human-meaningful) but the source `content` field IS included for each memory.
- Generated server-side as a background job (10s–5min for active users). Email link with 24h expiry.
- Format: portable JSONL, one record per line, plus a `MANIFEST.json` describing each file. JSON Schema for each entity type included.

**Account deletion workflow:**
1. **Soft phase (immediate):** set `deletedAt = now()` on User, cascade soft-delete to all owned rows. User loses access. Recoverable for 30 days.
2. **Hard phase (30 days later, cron job):**
   - `DELETE FROM "MemoryEntry" WHERE "userId" = $1` (cascades to embeddings via `ON DELETE CASCADE` foreign keys — verify schema).
   - Hard-delete all link tables: `MemoryEntityLink`, `GoalProjectLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`.
   - Hard-delete cortex outputs: `ThinkingPattern`, `ContradictionAlert`, `WeeklyMemo`, `OutcomeReviewNudge`.
   - Hard-delete auth artifacts: `OAuthToken` (after revoking upstream Google/Stripe tokens).
   - **Anonymize-not-delete** records needed for legal/financial integrity: `Subscription` (replace `userId` with a tombstone, keep payment audit trail).
   - Write a `DeletionEvent` row to AuditEvent (counts per table, retained 7 years).

**Pitfalls:**
- Embeddings in IVFFlat/HNSW indexes are deleted with their row — but vacuum is required to actually reclaim index space. Schedule `VACUUM (INDEX_CLEANUP TRUE)` weekly.
- "Soft-deleted" data still in backups counts as "stored" under GDPR. Document the 30-day backup retention as the actual deletion SLA in the privacy policy.
- Cortex outputs that *aggregate* multiple users' data (none in omnimind today, but watch for it in Phase 4 collaboration) need explicit handling.

---

## 10. Schema drift detection

`prisma db push` masks drift by silently making the database match the schema. Once on `migrate deploy`, drift comes from manual SQL, failed migrations, or Postgres-side changes (extensions, indexes added by hand).

**Detection commands:**
- `npx prisma migrate status` — flags migrations not applied or unknown migrations applied.
- `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-url $DATABASE_URL --exit-code` — exit code 2 means drift exists. Use in CI.

**CI check (GitHub Actions or Railway pre-deploy hook):**
```yaml
- name: Detect schema drift
  run: |
    npx prisma migrate diff \
      --from-schema-datasource prisma/schema.prisma \
      --to-url ${{ secrets.PROD_DATABASE_URL }} \
      --exit-code
```
Run nightly against prod (read-only role). Notify Slack on drift.

**Drift dashboard:** simple Grafana/SigNoz panel reading from `pg_stat_user_indexes` and `_prisma_migrations` — shows last applied migration, indexes not in `schema.prisma`, columns not in any Prisma model. <https://github.com/lukin/postgres-grafana-dashboards> has starter queries.

**Trigger-based real-time drift detection:** a Postgres event trigger on `ddl_command_end` writes every DDL change to a `SchemaChangeLog` table. Any unexpected entry means out-of-band schema change.

---

## Implications for omnimind roadmap

**Phase 1 (schema alignment) MUST do first, before any other Phase 1 work:**
1. Stop the bleeding: change the entrypoint to `prisma db push` *without* `--accept-data-loss` immediately. Today, an accidental destructive schema change deploys to prod silently. The flag must be removed even before baselining.
2. `pg_dump -Fc` of prod to off-Railway storage (R2 or S3) before any schema work. Verified by restore to a throwaway database. This is the rollback floor.
3. Delete the 6 archived 2025-04 migration directories so they don't poison baselining.

**Phase 14 (migration history) must include:**
1. Baseline migration via the §1 SOP. Prisma `migrate resolve --applied 0_init` on prod, staging, and every dev clone.
2. Switch entrypoint from `prisma db push` to `prisma migrate deploy`. Add a CI step that runs `migrate diff --exit-code` on every PR.
3. Drift detection cron (nightly) per §10, alerting to Slack.
4. Documented expand-contract SOP per §2 in `docs/FRAGILE-ZONES.md`.

**New phases needed:**
- **Phase 1.5 — Soft-delete enforcement:** RLS policies on the 7 highest-risk tables (§3), plus generated `isActive` columns on all 17 soft-deletable tables. Two-day effort, prevents an entire class of leaks.
- **Phase 2.5 — Embedding versioning:** add `embeddingModel`, `embeddingModelVersion`, `embeddingDim`, `embeddedAt` columns now (§4). Even without a second model, having the columns means a future migration is a deploy not a redesign.
- **Phase 3.5 — Backup + PITR:** nightly `pg_dump` to R2 plus weekly automated restore drill (§6). Migrate to Neon or Crunchy Bridge before paid public launch.
- **Phase 4 — Bi-temporal + audit:** `validity` ranges on `MemoryEntry` and `Decision` (§7), partitioned `AuditEvent` table (§8). Required before multi-user collaboration ships.
- **Phase 5 — GDPR export + delete:** `/me/export` endpoint and 30-day soft-then-hard delete pipeline (§9). Required before EU paid users.

**Specific mitigations for `prisma db push --accept-data-loss` landmine:** remove the flag this week; require manual approval gate (`if [ "$ALLOW_DESTRUCTIVE" != "true" ]`) for any push that would drop data; eventual replacement by `migrate deploy` per Phase 14. The current entrypoint is one careless `schema.prisma` edit away from total data loss.
