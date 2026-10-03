#!/usr/bin/env bash
# Unit test for services/backup/restore-drill.sh with rclone / pg_restore /
# psql stubbed on PATH. No database, no network. Run: bash services/backup/tests/restore-drill.test.sh
#
# Covers:
#   R-D-02  the R2 path: fetch_latest must hand back a clean artifact path
#           (progress logging must not leak into it) and nothing but the
#           markdown row may appear on stdout.
#   R-D-03  pg_restore runs WITHOUT --exit-on-error; extension-ownership /
#           already-exists / COMMENT ON EXTENSION errors are tolerated and
#           counted, any other error still fails the drill.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/../restore-drill.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STUBS="$TMP/bin"; FIXTURES="$TMP/fixtures"; mkdir -p "$STUBS" "$FIXTURES"
export STUB_LOG="$TMP/stub.log" STUB_FIXTURE_DIR="$FIXTURES"

# A gzip-valid "dump" named like backup.sh produces it.
printf 'PGDMP fake archive\n' | gzip > "$FIXTURES/omnimind-20261001-030000.dump.gz"

cat > "$STUBS/rclone" <<'STUB'
#!/usr/bin/env bash
echo "rclone $*" >> "$STUB_LOG"
case "$1" in
  lsf)  printf 'README.txt\n2026/09/omnimind-20260930-030000.dump.gz\n2026/10/omnimind-20261001-030000.dump.gz\n' ;;
  copy) mkdir -p "$3"; cp "$STUB_FIXTURE_DIR/$(basename "$2")" "$3/" ;;
  *)    echo "unexpected rclone verb: $1" >&2; exit 9 ;;
esac
STUB

cat > "$STUBS/pg_restore" <<'STUB'
#!/usr/bin/env bash
echo "pg_restore $*" >> "$STUB_LOG"
case "${PG_RESTORE_MODE:-tolerated}" in
  clean) exit 0 ;;
  tolerated)
    cat >&2 <<'ERR'
pg_restore: error: could not execute query: ERROR:  must be owner of extension vector
Command was: COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';
pg_restore: error: could not execute query: ERROR:  extension "pg_trgm" already exists
Command was: CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
pg_restore: warning: errors ignored on restore: 2
ERR
    exit 1 ;;
  fatal)
    cat >&2 <<'ERR'
pg_restore: error: could not execute query: ERROR:  must be owner of extension vector
Command was: COMMENT ON EXTENSION vector IS 'x';
pg_restore: error: could not execute query: ERROR:  relation "memory_entries" does not exist
Command was: COPY public.memory_entries (id, content) FROM stdin;
pg_restore: warning: errors ignored on restore: 2
ERR
    exit 1 ;;
esac
STUB

cat > "$STUBS/psql" <<'STUB'
#!/usr/bin/env bash
echo "psql $*" >> "$STUB_LOG"
for a in "$@"; do
  case "$a" in
    *memory_entries*) echo "${STUB_MEMORY_ROWS:-42}"; exit 0 ;;
    *decisions*|*tasks*|*_prisma_migrations*) echo 3; exit 0 ;;
  esac
done
cat > /dev/null   # schema-reset heredoc
exit 0
STUB
chmod +x "$STUBS"/*

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; }
assert_eq()       { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "expected: $3"$'\n'"actual:   $2"; fi; }
assert_contains() { if printf '%s' "$2" | grep -qE -- "$3"; then ok "$1"; else fail "$1" "missing /$3/ in:"$'\n'"$2"; fi; }
assert_lacks()    { if printf '%s' "$2" | grep -qE -- "$3"; then fail "$1" "unexpected /$3/ in:"$'\n'"$2"; else ok "$1"; fi; }

# Runs the drill; sets RC / OUT / ERR / LOG.
run_drill() {
  : > "$STUB_LOG"
  local work="$TMP/work-$RANDOM"; mkdir -p "$work"
  set +e
  OUT="$(PATH="$STUBS:$PATH" BACKUP_LOCAL_DIR="$work" \
        DRILL_DATABASE_URL="postgresql://drill:drill@localhost:5433/drill_scratch" \
        R2_BUCKET="omnimind-backups/test" R2_ACCOUNT_ID=acct R2_ACCESS_KEY_ID=k R2_SECRET_ACCESS_KEY=s \
        env "$@" bash "$SCRIPT" 2> "$TMP/stderr")"
  RC=$?
  set -e
  ERR="$(cat "$TMP/stderr")"
  LOG="$(cat "$STUB_LOG")"
  WORK="$work"
}

echo "# R-D-02: R2 path hands back a clean artifact path"
run_drill
assert_eq       "exit 0 from the R2 path" "$RC" "0"
assert_contains "markdown row names the fetched artifact" "$OUT" '\| omnimind-20261001-030000\.dump\.gz \| memory_entries=42 \| health=skipped \| PASS \|'
assert_lacks    "stdout carries no progress lines" "$OUT" '\[drill\]'
assert_contains "progress lines go to stderr" "$ERR" '\[drill\] .* latest backup: 2026/10/omnimind-20261001-030000\.dump\.gz'
assert_contains "DRILL PASSED on stderr" "$ERR" 'DRILL PASSED'
assert_contains "rclone copied the lexicographically newest object" "$LOG" 'rclone copy r2:omnimind-backups/test/omnimind/2026/10/omnimind-20261001-030000\.dump\.gz '
assert_contains "pg_restore received the gunzipped archive path" "$LOG" "pg_restore --dbname=postgresql://drill:drill@localhost:5433/drill_scratch --no-owner --no-privileges ${WORK}/drill/restore\.dump"

echo "# R-D-03: pg_restore error filtering"
assert_lacks    "pg_restore no longer runs with --exit-on-error" "$LOG" '\-\-exit-on-error'
assert_contains "tolerated errors are counted and reported" "$ERR" 'errors=2 tolerated=2 remaining=0'

run_drill PG_RESTORE_MODE=fatal
assert_eq       "a non-tolerated error fails the drill" "$RC" "1"
assert_contains "the offending error is surfaced" "$ERR" 'relation "memory_entries" does not exist'
assert_contains "the count distinguishes tolerated from remaining" "$ERR" 'errors=2 tolerated=1 remaining=1'
assert_contains "a FAIL row is still printed" "$OUT" '\| FAIL \| pg_restore failed: 1 non-tolerated error\(s\) \|'

run_drill PG_RESTORE_MODE=clean
assert_eq       "a clean restore passes" "$RC" "0"
assert_contains "zero errors reported" "$ERR" 'errors=0 tolerated=0 remaining=0'

echo "# BACKUP_FILE path + row-count gate"
run_drill BACKUP_FILE="$FIXTURES/omnimind-20261001-030000.dump.gz"
assert_eq       "local BACKUP_FILE passes without rclone" "$RC" "0"
assert_lacks    "rclone is not invoked for a local file" "$LOG" 'rclone'

run_drill STUB_MEMORY_ROWS=0
assert_eq       "memory_entries below DRILL_MIN_MEMORY_ROWS fails" "$RC" "1"
assert_contains "row-count failure is named" "$ERR" 'memory_entries count 0 < 1'

echo
echo "restore-drill.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
