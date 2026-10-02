#!/usr/bin/env bash
# Monthly restore drill: prove the R2 backups restore.
#
#   1. pull the newest object under r2:$R2_BUCKET/$BACKUP_PREFIX (or use BACKUP_FILE)
#   2. decrypt (if .enc) + gunzip
#   3. pg_restore into DRILL_DATABASE_URL (a THROWAWAY database — it is wiped first)
#   4. assert SELECT count(*) FROM memory_entries > 0 (+ a few more tables)
#   5. optional GET $DRILL_API_HEALTH_URL (a scratch omnimind-api pointed at the drill DB) must be 200 + dbConnected
#   6. print a markdown row to append to docs/03-operations/BACKUP-DRILLS.md
#      (appends automatically when DRILL_LOG points at that file)
#
# Required env:
#   DRILL_DATABASE_URL     scratch Postgres with pgvector (NEVER production). All objects in `public` are dropped.
#   R2_BUCKET + R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY   (same as backup.sh) unless BACKUP_FILE is set
# Optional env:
#   BACKUP_FILE            local .dump.gz[.enc] to restore instead of pulling from R2
#   BACKUP_ENCRYPT_KEY     needed when the artifact is .enc
#   BACKUP_PREFIX          default "omnimind"
#   DRILL_API_HEALTH_URL   e.g. https://omnimind-drill.up.railway.app/health
#   DRILL_MIN_MEMORY_ROWS  default 1
#   DRILL_LOG              path to BACKUP-DRILLS.md to append the dated line
#   ENCRYPTION_KEY         not used by the restore itself, but the drill reminds you to verify a ministry row
#                          decrypts in the scratch API when it is set (see BACKUPS.md).

set -euo pipefail

log() { printf '[drill] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; record_result FAIL "$*"; exit 1; }

: "${DRILL_DATABASE_URL:?DRILL_DATABASE_URL is required (scratch DB only)}"
BACKUP_PREFIX="${BACKUP_PREFIX:-omnimind}"
REMOTE_NAME="${BACKUP_RCLONE_REMOTE:-r2}"
WORK="${BACKUP_LOCAL_DIR:-/tmp/backups}/drill"
MIN_ROWS="${DRILL_MIN_MEMORY_ROWS:-1}"
ARTIFACT_NAME="(none)"
ROWS="?"
HEALTH="skipped"

case "$DRILL_DATABASE_URL" in
  *production*|*prod.*) die "DRILL_DATABASE_URL looks like production — refusing" ;;
esac

record_result() {
  local status="$1" note="${2:-}"
  local line="| $(date -u +%Y-%m-%d) | ${ARTIFACT_NAME} | memory_entries=${ROWS} | health=${HEALTH} | ${status} | ${note} |"
  printf '\nAppend to docs/03-operations/BACKUP-DRILLS.md:\n%s\n' "$line"
  if [ -n "${DRILL_LOG:-}" ] && [ -w "$DRILL_LOG" ]; then
    printf '%s\n' "$line" >> "$DRILL_LOG"
    log "appended to $DRILL_LOG"
  fi
}

configure_rclone() {
  if [ -n "${RCLONE_CONFIG_R2_TYPE:-}" ]; then return; fi
  : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
  : "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
  : "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
}

fetch_latest() {
  : "${R2_BUCKET:?R2_BUCKET is required when BACKUP_FILE is not set}"
  configure_rclone
  local base="${REMOTE_NAME}:${R2_BUCKET}/${BACKUP_PREFIX}"
  # File names embed UTC timestamps, so the lexicographically last path is the newest.
  local latest
  latest=$(rclone lsf "$base" --recursive --files-only --s3-no-check-bucket | grep -E "${BACKUP_PREFIX}-[0-9]{8}-[0-9]{6}\.dump\.gz(\.enc)?$" | sort | tail -n1)
  [ -n "$latest" ] || die "no backups found under ${base}"
  log "latest backup: ${latest}"
  rclone copy "${base}/${latest}" "$WORK" --s3-no-check-bucket --stats 0
  printf '%s/%s\n' "$WORK" "$(basename "$latest")"
}

main() {
  mkdir -p "$WORK"
  trap 'rm -rf "'"$WORK"'"' EXIT

  local artifact
  if [ -n "${BACKUP_FILE:-}" ]; then
    artifact="$BACKUP_FILE"
  else
    artifact="$(fetch_latest)"
  fi
  [ -s "$artifact" ] || die "artifact missing or empty: $artifact"
  ARTIFACT_NAME="$(basename "$artifact")"

  local gz="$artifact"
  if [[ "$artifact" == *.enc ]]; then
    : "${BACKUP_ENCRYPT_KEY:?artifact is encrypted; BACKUP_ENCRYPT_KEY is required}"
    gz="${WORK}/$(basename "${artifact%.enc}")"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass env:BACKUP_ENCRYPT_KEY -in "$artifact" -out "$gz"
    log "decrypted"
  fi
  gzip -t "$gz" || die "gzip integrity check failed"
  local dump="${WORK}/restore.dump"
  gunzip -c "$gz" > "$dump"
  log "archive ready: $(du -h "$dump" | cut -f1)"

  log "resetting scratch schema"
  psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
SQL

  log "pg_restore starting"
  # --no-owner/--no-privileges: the scratch role differs from production's.
  # Exit status is tolerated only for the extension-ownership warnings; any
  # table-level error fails the drill.
  if ! pg_restore --dbname="$DRILL_DATABASE_URL" --no-owner --no-privileges --exit-on-error "$dump" 2> "$WORK/restore.err"; then
    cat "$WORK/restore.err" >&2
    die "pg_restore failed"
  fi
  log "pg_restore complete"

  ROWS=$(psql "$DRILL_DATABASE_URL" -tAc 'SELECT count(*) FROM memory_entries;')
  local decisions tasks migrations
  decisions=$(psql "$DRILL_DATABASE_URL" -tAc 'SELECT count(*) FROM decisions;' 2>/dev/null || echo "n/a")
  tasks=$(psql "$DRILL_DATABASE_URL" -tAc 'SELECT count(*) FROM tasks;' 2>/dev/null || echo "n/a")
  migrations=$(psql "$DRILL_DATABASE_URL" -tAc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;' 2>/dev/null || echo "n/a")
  log "rows: memory_entries=${ROWS} decisions=${decisions} tasks=${tasks} applied_migrations=${migrations}"
  [ "$ROWS" -ge "$MIN_ROWS" ] 2>/dev/null || die "memory_entries count ${ROWS} < ${MIN_ROWS}"

  if [ -n "${DRILL_API_HEALTH_URL:-}" ]; then
    local body
    body=$(curl -fsS -m 15 "$DRILL_API_HEALTH_URL") || die "GET ${DRILL_API_HEALTH_URL} failed"
    if printf '%s' "$body" | grep -q '"dbConnected":true'; then HEALTH="ok"; else HEALTH="degraded"; die "scratch API health reports dbConnected=false: ${body}"; fi
    log "scratch API health ok"
  fi

  if [ -n "${ENCRYPTION_KEY:-}" ]; then
    log "ENCRYPTION_KEY present — remember to GET one ministry-domain memory through the scratch API to confirm it decrypts (see BACKUPS.md)."
  fi

  record_result PASS "restored from R2 into scratch DB"
  log "DRILL PASSED"
}

main "$@"
