#!/bin/bash
# OmniMind nightly database backup
# Runs via Railway cron or locally via: bash scripts/backup.sh
#
# Required env vars:
#   DATABASE_URL  — PostgreSQL connection string
#
# Optional env vars:
#   BACKUP_DIR    — local directory for backup files (default: ./backups)
#   BACKUP_RETAIN — number of local backup files to keep (default: 7)
#   BACKUP_S3_BUCKET — if set, upload to S3 after local write (e.g. s3://my-bucket/omnimind)
#   BACKUP_ENCRYPT_KEY — if set, encrypt via openssl AES-256 with this passphrase
#
# Restore procedure: see docs/runbooks/backup-restore.md

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETAIN="${BACKUP_RETAIN:-7}"
BACKUP_FILE="${BACKUP_DIR}/omnimind-${TIMESTAMP}.sql"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting pg_dump at ${TIMESTAMP}..."
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --exclude-table='spatial_ref_sys' \
  > "$BACKUP_FILE"

echo "[backup] Dump complete: ${BACKUP_FILE} ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Optional encryption
if [ -n "${BACKUP_ENCRYPT_KEY:-}" ]; then
  ENCRYPTED_FILE="${BACKUP_FILE}.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
    -pass "pass:${BACKUP_ENCRYPT_KEY}" \
    -in "$BACKUP_FILE" -out "$ENCRYPTED_FILE"
  rm "$BACKUP_FILE"
  BACKUP_FILE="$ENCRYPTED_FILE"
  echo "[backup] Encrypted: ${BACKUP_FILE}"
fi

# Optional S3 upload
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  S3_KEY="${BACKUP_S3_BUCKET}/$(basename "$BACKUP_FILE")"
  echo "[backup] Uploading to ${S3_KEY}..."
  aws s3 cp "$BACKUP_FILE" "$S3_KEY" --quiet
  echo "[backup] S3 upload complete"
fi

# Rotate local backups (keep most recent N)
echo "[backup] Rotating local backups (retain=${BACKUP_RETAIN})..."
ls -t "${BACKUP_DIR}"/omnimind-*.sql* 2>/dev/null | tail -n "+$((BACKUP_RETAIN + 1))" | xargs -r rm --
echo "[backup] Done. Local files kept: $(ls "${BACKUP_DIR}"/omnimind-*.sql* 2>/dev/null | wc -l)"
