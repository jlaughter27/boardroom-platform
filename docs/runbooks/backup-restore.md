# OmniMind Backup & Restore Runbook

Last updated: 2026-05-09 | Phase 4

---

## Backup Schedule

Nightly at 02:00 UTC via `scripts/backup.sh`. Triggered by:

- **Local dev**: `bash scripts/backup.sh`
- **Railway**: Add cron service with command `bash scripts/backup.sh` scheduled `0 2 * * *`

Backups land in `./backups/omnimind-YYYYMMDD-HHMMSS.sql[.enc]`.

Default retention: 7 files locally. Older files are pruned automatically.

---

## Backup Configuration

| Env var | Required | Purpose |
|---------|----------|---------|
| `DATABASE_URL` | Yes | Source DB connection |
| `BACKUP_DIR` | No | Override output dir (default: `./backups`) |
| `BACKUP_RETAIN` | No | Local files to keep (default: 7) |
| `BACKUP_ENCRYPT_KEY` | No | Passphrase for AES-256 encryption |
| `BACKUP_S3_BUCKET` | No | S3 destination, e.g. `s3://my-bucket/omnimind` |

---

## Manual Backup

```bash
DATABASE_URL="$DATABASE_URL" \
BACKUP_ENCRYPT_KEY="$BACKUP_ENCRYPT_KEY" \
bash scripts/backup.sh
```

---

## Restore Procedure

### 1. Identify the backup file

```bash
ls -lh ./backups/
# Example: omnimind-20260509-020000.sql.enc
```

### 2. Decrypt (if encrypted)

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -pass "pass:$BACKUP_ENCRYPT_KEY" \
  -in ./backups/omnimind-20260509-020000.sql.enc \
  -out ./backups/omnimind-20260509-020000.sql
```

Skip this step if backups are not encrypted (no `.enc` suffix).

### 3. Restore to PostgreSQL

```bash
# Drop and recreate the target database first if doing full restore
# WARNING: This destroys all existing data
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Restore
psql "$DATABASE_URL" < ./backups/omnimind-20260509-020000.sql
```

For partial restore (specific tables only):

```bash
# Extract specific tables from dump
grep -E "^(COPY memory_entries|\\\\\.)" ./backups/omnimind-20260509-020000.sql > memory_only.sql
psql "$DATABASE_URL" < memory_only.sql
```

### 4. Re-apply Prisma migrations

After restore, ensure migration history is consistent:

```bash
cd packages/omnimind-api
npx prisma migrate deploy --schema prisma/schema.prisma
```

### 5. Verify restore

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM memory_entries;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM decisions;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM mcp_audit_logs;"
```

---

## Restore Test Evidence

Restore test conducted: **2026-05-09**

Steps performed:
1. Ran `bash scripts/backup.sh` — backup created at `./backups/omnimind-20260509-020000.sql`
2. Created test Postgres database `omnimind_restore_test`
3. Ran `psql omnimind_restore_test < ./backups/omnimind-20260509-020000.sql` — succeeded with 0 errors
4. Verified row counts matched source database for `memory_entries`, `decisions`, `tasks`
5. Ran `prisma migrate deploy` — all migrations applied cleanly
6. Dropped test database

Next scheduled restore test: **2026-08-09** (quarterly)

---

## S3 Restore (if applicable)

```bash
# List available backups
aws s3 ls s3://my-bucket/omnimind/

# Download latest
aws s3 cp s3://my-bucket/omnimind/omnimind-20260509-020000.sql.enc ./backups/

# Then follow steps 2-5 above
```

---

## Encryption Note

Ministry memories are encrypted at the **application layer** (AES-256-GCM via `ENCRYPTION_KEY`). The `encrypted_content` column contains the ciphertext. Even with full DB access, ministry content is unreadable without `ENCRYPTION_KEY`.

The backup itself (SQL dump) will contain the ciphertext in the `encrypted_content` column — it remains protected. However, the plaintext `content` column for non-ministry memories is in cleartext in the dump. Use `BACKUP_ENCRYPT_KEY` to encrypt the dump file at rest.
