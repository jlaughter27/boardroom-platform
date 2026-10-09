#!/usr/bin/env bash
# OmniMind nightly backup → Cloudflare R2.
#
#   pg_dump -Fc → gzip → [openssl enc] → rclone copy r2:$R2_BUCKET/<prefix>/YYYY/MM/
#
# Required env:
#   DATABASE_URL           source Postgres (Railway: reference ${{Postgres.DATABASE_URL}})
#   R2_BUCKET              bucket name, optionally with a path: "omnimind-backups" or "omnimind-backups/prod"
#   R2_ACCOUNT_ID          Cloudflare account id (builds the S3 endpoint)
#   R2_ACCESS_KEY_ID       R2 API token key id
#   R2_SECRET_ACCESS_KEY   R2 API token secret
#     — OR — a fully configured rclone remote named "r2" via RCLONE_CONFIG_R2_* variables.
# Optional env:
#   BACKUP_RETAIN_DAYS     delete remote objects older than N days (default 30; 0 disables pruning)
#   BACKUP_ENCRYPT_KEY     if set, dump is encrypted with AES-256-CBC (pbkdf2) → ".enc"
#   BACKUP_PREFIX          object key prefix / file stem (default "omnimind")
#   BACKUP_LOCAL_DIR       scratch dir (default /tmp/backups); always cleaned up
#   BACKUP_HEALTHCHECK_URL pinged with GET on success (e.g. healthchecks.io) — one of the five alerts
#   BACKUP_DRY_RUN=1       do everything except the rclone upload/prune
#
# This script is the R2 successor of scripts/backup.sh (plain SQL → local/S3),
# which is left untouched for local use. Restore procedure: restore-drill.sh and
# docs/03-operations/BACKUPS.md.

set -euo pipefail

log() { printf '[backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"

BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-omnimind}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/tmp/backups}"
REMOTE_NAME="${BACKUP_RCLONE_REMOTE:-r2}"

# --- rclone remote from R2_* env (skipped when the operator configured RCLONE_CONFIG_R2_* directly)
configure_rclone() {
  if [ -n "${RCLONE_CONFIG_R2_TYPE:-}" ]; then
    log "using operator-provided rclone remote '${REMOTE_NAME}'"
    return
  fi
  : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required (or set RCLONE_CONFIG_R2_* yourself)}"
  : "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
  : "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_ACL=private
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
}

main() {
  configure_rclone
  command -v pg_dump >/dev/null || die "pg_dump not installed"
  command -v rclone  >/dev/null || die "rclone not installed"

  local ts day_path stem dump gz artifact
  ts="$(date -u +%Y%m%d-%H%M%S)"
  day_path="$(date -u +%Y/%m)"
  stem="${BACKUP_PREFIX}-${ts}"
  mkdir -p "$BACKUP_LOCAL_DIR"
  dump="${BACKUP_LOCAL_DIR}/${stem}.dump"
  gz="${dump}.gz"
  trap 'rm -f "'"$dump"'" "'"$gz"'" "'"$gz"'.enc"' EXIT

  log "pg_dump -Fc starting (${stem})"
  # -Fc is the custom archive (restorable table-by-table with pg_restore).
  # --compress=0 so gzip does the compression once, as a stream.
  pg_dump "$DATABASE_URL" \
    --format=custom --compress=0 \
    --no-owner --no-privileges \
    --file="$dump"
  gzip -9 "$dump"             # produces $gz, removes $dump
  artifact="$gz"
  log "dump complete: $(du -h "$gz" | cut -f1)"

  if [ -n "${BACKUP_ENCRYPT_KEY:-}" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
      -pass env:BACKUP_ENCRYPT_KEY -in "$gz" -out "${gz}.enc"
    rm -f "$gz"
    artifact="${gz}.enc"
    log "encrypted: $(basename "$artifact")"
  fi

  # Sanity: the archive must at least be a gzip stream (or ciphertext of one).
  [ -s "$artifact" ] || die "artifact is empty"
  if [ -z "${BACKUP_ENCRYPT_KEY:-}" ]; then
    gzip -t "$artifact" || die "gzip integrity check failed"
  fi

  local dest="${REMOTE_NAME}:${R2_BUCKET}/${BACKUP_PREFIX}/${day_path}"
  if [ "${BACKUP_DRY_RUN:-0}" = "1" ]; then
    log "DRY RUN — would upload $(basename "$artifact") to ${dest}"
  else
    log "uploading to ${dest}"
    rclone copy "$artifact" "$dest" --s3-no-check-bucket --stats-one-line --stats 0
    # Verify the object landed with the same size before pruning anything.
    local local_size remote_size
    local_size=$(stat -c %s "$artifact")
    remote_size=$(rclone lsjson "${dest}/$(basename "$artifact")" | sed -n 's/.*"Size":\([0-9]*\).*/\1/p' | head -n1)
    [ "$local_size" = "$remote_size" ] || die "upload size mismatch (local ${local_size}, remote ${remote_size:-none})"
    log "upload verified (${remote_size} bytes)"

    if [ "$BACKUP_RETAIN_DAYS" -gt 0 ] 2>/dev/null; then
      log "pruning objects older than ${BACKUP_RETAIN_DAYS}d under ${REMOTE_NAME}:${R2_BUCKET}/${BACKUP_PREFIX}"
      rclone delete "${REMOTE_NAME}:${R2_BUCKET}/${BACKUP_PREFIX}" --min-age "${BACKUP_RETAIN_DAYS}d" --s3-no-check-bucket
      rclone rmdirs "${REMOTE_NAME}:${R2_BUCKET}/${BACKUP_PREFIX}" --leave-root --s3-no-check-bucket 2>/dev/null || true
    fi
  fi

  if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] && [ "${BACKUP_DRY_RUN:-0}" != "1" ]; then
    curl -fsS -m 10 --retry 3 "$BACKUP_HEALTHCHECK_URL" >/dev/null && log "healthcheck pinged" || log "WARN: healthcheck ping failed"
  fi

  log "done: $(basename "$artifact")"
}

main "$@"
