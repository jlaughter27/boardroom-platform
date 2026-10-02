# Backups — nightly R2 dumps and the monthly restore drill

> A backup you have not restored is a hope, not a backup. This page is the
> setup for `services/backup/` and the drill that proves it works.
> Companion log: [`BACKUP-DRILLS.md`](BACKUP-DRILLS.md). Older local-dump
> procedure: `docs/runbooks/backup-restore.md` (still valid for ad-hoc use).

## What runs

| When | What | Where it lands |
|---|---|---|
| Nightly 03:00 UTC (Railway cron) | `services/backup/backup.sh`: `pg_dump -Fc` → gzip → optional AES-256 → `rclone copy` | `r2://<R2_BUCKET>/<BACKUP_PREFIX>/YYYY/MM/omnimind-YYYYMMDD-HHMMSS.dump.gz[.enc]` |
| After each upload | size-verified, then objects older than `BACKUP_RETAIN_DAYS` are pruned | same prefix |
| Monthly (manual, calendar it) | `services/backup/restore-drill.sh` into a scratch DB | row in `BACKUP-DRILLS.md` |

The custom archive format (`-Fc`) restores table-by-table with `pg_restore`,
which is what you want when one table is corrupted and the rest are fine.

## One-time setup

### 1. Cloudflare R2
1. Create a bucket (e.g. `omnimind-backups`). Keep it private; no public access.
2. Create an **R2 API token** scoped to that bucket with *Object Read & Write*.
   Note the Account ID, Access Key ID and Secret Access Key.
3. (Recommended) Add an R2 lifecycle rule as a second line of defence:
   delete objects older than `BACKUP_RETAIN_DAYS + 7`.

### 2. Railway cron service
1. New service → **GitHub repo** (same monorepo) → *Settings → Root Directory*
   leave at `/` and set *Config file* to `services/backup/railway.json`
   (Dockerfile path is already inside it). Railway picks up `cronSchedule`.
2. Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres plugin) |
| `R2_BUCKET` | `omnimind-backups/prod` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from step 1 |
| `BACKUP_RETAIN_DAYS` | `30` |
| `BACKUP_ENCRYPT_KEY` | `openssl rand -base64 32` — store in 1Password **next to** `ENCRYPTION_KEY`; without it the dump is unreadable |
| `BACKUP_HEALTHCHECK_URL` | optional dead-man URL (healthchecks.io / Grafana OnCall); alert "backup missed" lives there |
| `BACKUP_PREFIX` | optional, default `omnimind` |

3. Trigger a manual run (Railway → service → *Deployments → Run*) and confirm
   the object appears in R2 with a non-trivial size.

### 3. Secrets to keep together
`ENCRYPTION_KEY` (ministry content + OAuth tokens, AES-256-GCM at the
application layer) and `BACKUP_ENCRYPT_KEY` (the dump file at rest). Losing
the first makes ministry rows unreadable even from a perfect restore; losing
the second makes every dump unreadable. Both belong in the vault entry titled
"OmniMind restore kit" with this page linked.

## Monthly restore drill (≈20 minutes)

Goal: restore the newest dump into a throwaway database, prove the rows are
there, prove the API can talk to it, write the dated line down.

1. **Scratch database.** Easiest: a second Railway Postgres (pgvector image is
   the plugin default) in a `drill` environment, or locally
   `docker compose -f docker-compose.test.yml up -d postgres-test`
   (`postgresql://test_user:test_password@localhost:5433/boardroom_test`).
   The script drops `public` in that DB — never point it at production (it
   refuses URLs containing `production`/`prod.` as a tripwire).
2. **(Optional) scratch API.** Deploy `omnimind-api` pointed at the scratch DB
   with the production `ENCRYPTION_KEY` so the `/health` and a ministry-row
   read can be checked. Skipping it is fine; the row-count assertion still runs.
3. **Run the drill** (from the backup image or any box with `pg_restore` 16, `rclone`, `openssl`):

   ```bash
   docker run --rm \
     -e DRILL_DATABASE_URL="postgresql://.../drill" \
     -e R2_BUCKET=omnimind-backups/prod -e R2_ACCOUNT_ID=... -e R2_ACCESS_KEY_ID=... -e R2_SECRET_ACCESS_KEY=... \
     -e BACKUP_ENCRYPT_KEY=... \
     -e DRILL_API_HEALTH_URL=https://omnimind-drill.up.railway.app/health \
     omnimind-backup bash /app/restore-drill.sh
   ```

   It prints `DRILL PASSED` and a markdown row such as
   `| 2026-10-02 | omnimind-20261002-030001.dump.gz.enc | memory_entries=1842 | health=ok | PASS | restored from R2 into scratch DB |`.
4. **If `ENCRYPTION_KEY` is set on the scratch API**, `GET /memories?domain=ministry&limit=1`
   through it with the service key and confirm `content` is plaintext (not the
   encrypted placeholder). That is the only way to know the key in the vault is
   the key that wrote the rows.
5. **Record it.** Append the row to [`BACKUP-DRILLS.md`](BACKUP-DRILLS.md)
   (`DRILL_LOG=docs/03-operations/BACKUP-DRILLS.md` does it for you when run
   from a checkout) and commit. Tear down the scratch resources.

A drill that fails is a P1 for the week: the nightly job is lying.

## Restoring for real (outline)

1. Stop writers: scale `omnimind-api` to 0 (BoardRoom fails open on
   subscription checks and surfaces 502s; that is acceptable during a restore).
2. Provision a fresh Postgres (pgvector) and run `restore-drill.sh` against it
   with `DRILL_MIN_MEMORY_ROWS` set to roughly last night's count — the drill
   *is* the restore procedure, only the target differs.
3. Point `DATABASE_URL` of `omnimind-api` at the new database, redeploy; the
   entrypoint's `migrate deploy` is a no-op on a fully restored
   `_prisma_migrations` table.
4. Verify `/health`, one hybrid search, one ministry read. Scale back up.

## Alerts tied to this page
- Backup missed (dead-man ping on `BACKUP_HEALTHCHECK_URL`, 26 h window).
- Drill overdue — a calendar reminder on the first Monday of the month.
See [`OBSERVABILITY.md`](OBSERVABILITY.md) for the full (five-alert) list.
