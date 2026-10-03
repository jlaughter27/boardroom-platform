# services/backup — nightly Postgres backups to Cloudflare R2

A tiny Alpine image (postgres16-client + rclone + openssl) that Railway runs on
a cron schedule (`0 3 * * *` UTC, see `railway.json`). It is **not** part of
either application service; it only needs `DATABASE_URL` and R2 credentials.

| File | Purpose |
|---|---|
| `Dockerfile` | image; default command is `backup.sh` |
| `backup.sh` | `pg_dump -Fc` → gzip → optional `openssl enc` → `rclone copy` → prune by `BACKUP_RETAIN_DAYS` → optional healthcheck ping |
| `restore-drill.sh` | pull latest from R2 → `pg_restore` into `DRILL_DATABASE_URL` → row-count assertion → optional scratch `/health` → prints the line for `docs/03-operations/BACKUP-DRILLS.md` |
| `railway.json` | Railway service config (Dockerfile path + cron) |

Full setup, env table and the monthly drill procedure: **`docs/03-operations/BACKUPS.md`**.

`scripts/backup.sh` (plain-SQL dump to a local dir / S3) is unchanged and still
works for ad-hoc local backups; this directory is the production path.

## Local smoke test

```bash
docker build -f services/backup/Dockerfile -t omnimind-backup .
docker run --rm \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/boardroom_dev \
  -e R2_BUCKET=omnimind-backups/dev -e R2_ACCOUNT_ID=... -e R2_ACCESS_KEY_ID=... -e R2_SECRET_ACCESS_KEY=... \
  -e BACKUP_DRY_RUN=1 \
  omnimind-backup
```

Drill against the docker-compose test Postgres (pgvector-enabled):

```bash
docker run --rm \
  -e DRILL_DATABASE_URL=postgresql://test_user:test_password@host.docker.internal:5433/boardroom_test \
  -e R2_BUCKET=... -e R2_ACCOUNT_ID=... -e R2_ACCESS_KEY_ID=... -e R2_SECRET_ACCESS_KEY=... \
  omnimind-backup bash /app/restore-drill.sh
```
