#!/usr/bin/env bash
# launch.sh — the founder's launch, start to finish, from a laptop.
#
# Chains the Phase 8 M0 founder items and the existing go-live tooling in the
# only safe order, with a gate before every write:
#
#   1. preflight   tools, `railway whoami`, `gh auth status`, PR checks green
#   2. backup      M0-F1: prod pg_dump (custom format, gzip, sha256) kept on this
#                  machine (off-Railway), then services/backup/restore-drill.sh
#                  into a throwaway pgvector container; the drill row is appended
#                  to docs/03-operations/BACKUP-DRILLS.md. Also runs the read-only
#                  case-duplicate e-mail check (DEPLOYMENT-RUNBOOK, fix C1).
#   3. rotate      M0-F2: new JWT_SECRET + OMNIMIND_API_KEY (both services in one
#                  window), new ANTHROPIC/OPENAI keys you paste (hidden input),
#                  ENCRYPTION_KEY only with --rotate-encryption-key (stored Google
#                  OAuth tokens become unreadable → reconnect Google). Verifies the
#                  old service key gets 401.
#   4. protect     M0-F3: branch protection on main requiring the six CI checks
#   5. merge       merge the launch PR (Railway deploys it; migrations run at boot)
#   6. verify      M0-F4: /health version == merge sha on both services
#   7. mcp         scripts/mcp-go-live.sh (third service, gateway, first token)
#   8. prod-check  scripts/verify-prod.sh against all three services
#
# Usage:
#   scripts/launch.sh --project <railway project id> --owner-email <email> [--dry-run] [--yes]
#                     [--from <step>] [--only <step>] [--rotate-encryption-key]
#                     [--pr <n>] [--environment <env>] [--pg-service <name>]
#                     [--api-host <host>] [--app-host <host>]
#
# Needs: railway (logged in), gh (logged in), docker, pg_dump/pg_restore/psql 16+,
# node, openssl, gzip. Secrets never reach stdout or a file in the repo; the dump
# goes to ./backups (gitignored). Re-run with --from <step> after fixing a failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="" ; OWNER_EMAIL="" ; ENVIRONMENT="production" ; PR="30"
REPO="jlaughter27/boardroom-platform"
PG_SERVICE="Postgres" ; API_SERVICE="omnimind-api" ; APP_SERVICE="boardroom-ai" ; MCP_SERVICE="omnimind-mcp"
API_HOST="omnimind-api-production.up.railway.app" ; APP_HOST="boardroom-ai-production-1092.up.railway.app"
FROM="preflight" ; ONLY="" ; DRY_RUN=0 ; YES=0 ; ROTATE_ENC=0
STEPS=(preflight backup rotate protect merge verify mcp prod-check)
REQUIRED_CHECKS=(
  "Install, typecheck, test"
  "E2E (tenant isolation + scope gate, pgvector)"
  "Retrieval IR eval (pgvector, mock embeddings)"
  "Docker build (boardroom-ai)"
  "Docker build (omnimind-api)"
  "Docker build (omnimind-mcp)"
)

usage() { sed -n '/^# Usage:/,/^# Needs:/p' "$0" | sed 's/^# \{0,1\}//'; }
need_val() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "launch: $1 needs a value" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --project) need_val "$@"; PROJECT="$2"; shift 2 ;;
    --owner-email) need_val "$@"; OWNER_EMAIL="$2"; shift 2 ;;
    --environment) need_val "$@"; ENVIRONMENT="$2"; shift 2 ;;
    --pr) need_val "$@"; PR="$2"; shift 2 ;;
    --pg-service) need_val "$@"; PG_SERVICE="$2"; shift 2 ;;
    --api-host) need_val "$@"; API_HOST="$2"; shift 2 ;;
    --app-host) need_val "$@"; APP_HOST="$2"; shift 2 ;;
    --from) need_val "$@"; FROM="$2"; shift 2 ;;
    --only) need_val "$@"; ONLY="$2"; shift 2 ;;
    --rotate-encryption-key) ROTATE_ENC=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "launch: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$PROJECT" ] || { [ "$DRY_RUN" -eq 1 ] && PROJECT="<project-id>"; } || { echo "launch: --project is required" >&2; exit 2; }
[ -n "$OWNER_EMAIL" ] || { [ "$DRY_RUN" -eq 1 ] && OWNER_EMAIL="<owner-email>"; } || { echo "launch: --owner-email is required" >&2; exit 2; }
for s in "$FROM" ${ONLY:+"$ONLY"}; do
  case " ${STEPS[*]} " in *" $s "*) ;; *) echo "launch: unknown step '$s' (one of: ${STEPS[*]})" >&2; exit 2 ;; esac
done

# ── Output helpers: progress on stderr, secrets redacted everywhere ──────────
SECRETS=() ; REPORT=() ; MANUAL=()
add_secret() { [ -n "$1" ] && [ "$DRY_RUN" -eq 0 ] && SECRETS+=("$1"); return 0; }
redact() { local o="$1" s; for s in "${SECRETS[@]+"${SECRETS[@]}"}"; do o="${o//"$s"/<redacted>}"; done; printf '%s' "$o"; }
log()  { printf '[launch] %s\n' "$(redact "$*")" >&2; }
warn() { printf '[launch] WARN: %s\n' "$(redact "$*")" >&2; }
die()  { printf '[launch] ERROR: %s\n' "$(redact "$*")" >&2; exit 1; }
banner() { printf '\n[launch] ══ %s ══\n' "$*" >&2; }
note() { REPORT+=("| $1 | $2 | $3 |"); }
manual() { MANUAL+=("- $1"); }
confirm() {
  [ "$YES" -eq 1 ] || [ "$DRY_RUN" -eq 1 ] && return 0
  [ -t 0 ] || die "confirmation needed for: $1 (re-run with --yes)"
  printf '[launch] %s [y/N] ' "$1" >&2; local a; read -r a
  case "$a" in y|Y|yes|YES) return 0 ;; *) die "aborted by operator" ;; esac
}
run() { log "\$ $*"; [ "$DRY_RUN" -eq 1 ] && return 0; "$@"; }
json_get() {  # json_get '<js expr over d>' <<< json
  node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let d;try{d=JSON.parse(s)}catch{process.exit(0)}let v;try{v=eval(process.argv[1])}catch{}if(v==null)return;process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1"
}
RW_SCOPE=(-e "$ENVIRONMENT" -p "$PROJECT")
rw_var() {  # rw_var <service> <KEY> → value (never logged)
  [ "$DRY_RUN" -eq 1 ] && { printf '<%s:%s>' "$1" "$2"; return 0; }
  railway variable list -s "$1" "${RW_SCOPE[@]}" --json | json_get "d[$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")]"
}
rw_set() {  # rw_set <service> KEY=VALUE… — one call, one redeploy; values redacted in the log
  local svc="$1"; shift; [ $# -eq 0 ] && return 0
  local keys=(); local kv; for kv in "$@"; do keys+=("${kv%%=*}"); done
  log "\$ railway variable set ${keys[*]/%/=<redacted>} -s $svc ${RW_SCOPE[*]}"
  [ "$DRY_RUN" -eq 1 ] && return 0
  railway variable set "$@" -s "$svc" "${RW_SCOPE[@]}" --json >/dev/null
}
rw_has_service() {
  [ "$DRY_RUN" -eq 1 ] && return 1
  railway service list -p "$PROJECT" -e "$ENVIRONMENT" --json | json_get "d.some(s=>s.name===$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"))?'yes':''" | grep -q yes
}
wait_health_sha() {  # wait_health_sha <host> <sha> — /health version == sha (15 min)
  [ "$DRY_RUN" -eq 1 ] && { log "would poll https://$1/health for version $2"; return 0; }
  local i v
  for i in $(seq 1 90); do
    v="$(curl -fsS -m 10 "https://$1/health" 2>/dev/null | json_get 'd.version' || true)"
    [ "$v" = "$2" ] && return 0
    sleep 10
  done
  return 1
}
marker() { printf '%s/backups/.launch-%s' "$REPO_ROOT" "$1"; }
fresh_marker() {  # fresh_marker <name> <max hours>
  local f; f="$(marker "$1")"; [ -f "$f" ] || return 1
  [ $(( $(date +%s) - $(cat "$f") )) -lt $(( $2 * 3600 )) ]
}
should_run() {
  local s="$1"
  [ -n "$ONLY" ] && { [ "$s" = "$ONLY" ]; return; }
  local seen=0 x; for x in "${STEPS[@]}"; do [ "$x" = "$FROM" ] && seen=1; [ "$x" = "$s" ] && { [ "$seen" -eq 1 ]; return; }; done
  return 1
}
mkdir -p "$REPO_ROOT/backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
log "project=$PROJECT environment=$ENVIRONMENT pr=#$PR from=$FROM${ONLY:+ only=$ONLY}$([ "$DRY_RUN" -eq 1 ] && echo ' DRY-RUN')"

# ── 1. preflight ─────────────────────────────────────────────────────────────
if should_run preflight; then
  banner "1. preflight"
  missing=()
  for t in railway gh docker pg_dump pg_restore psql node openssl gzip curl; do
    command -v "$t" >/dev/null || missing+=("$t")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    [ "$DRY_RUN" -eq 1 ] && warn "missing tools (a real run stops here): ${missing[*]}" || die "missing tools: ${missing[*]}"
  fi
  if command -v pg_dump >/dev/null; then
    pgmaj="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
    [ "$pgmaj" -ge 16 ] || die "pg_dump $pgmaj is older than the server (16): install postgresql-client 16+"
  fi
  [ "$DRY_RUN" -eq 1 ] || railway whoami >/dev/null 2>&1 || die "railway is not logged in: run 'railway login'"
  [ "$DRY_RUN" -eq 1 ] || gh auth status >/dev/null 2>&1 || die "gh is not logged in: run 'gh auth login'"
  [ "$DRY_RUN" -eq 1 ] || docker info >/dev/null 2>&1 || die "docker is not running (needed for the restore drill)"
  if [ "$DRY_RUN" -eq 0 ]; then
    state="$(gh pr view "$PR" --repo "$REPO" --json state -q .state)"
    if [ "$state" = "OPEN" ]; then
      gh pr checks "$PR" --repo "$REPO" >/dev/null 2>&1 || die "PR #$PR checks are not all green: gh pr checks $PR --repo $REPO"
    fi
    note "preflight" "ok" "tools present, railway+gh logged in, PR #$PR $state"
  fi
fi

# ── 2. backup + restore drill (M0-F1) ────────────────────────────────────────
if should_run backup; then
  banner "2. production pg_dump + restore drill (M0-F1)"
  DB_URL="$(rw_var "$PG_SERVICE" DATABASE_PUBLIC_URL)"; add_secret "$DB_URL"
  [ -n "$DB_URL" ] || die "no DATABASE_PUBLIC_URL on service '$PG_SERVICE' (pass --pg-service; enable the Postgres TCP proxy)"
  DUMP="$REPO_ROOT/backups/prod-$TS.dump.gz"
  confirm "Dump production to $DUMP (read-only on prod)?"
  log "\$ pg_dump -Fc --no-owner --no-privileges <prod> | gzip > $DUMP"
  if [ "$DRY_RUN" -eq 0 ]; then
    pg_dump "$DB_URL" -Fc --no-owner --no-privileges | gzip > "$DUMP"
    SHA="$( (sha256sum "$DUMP" 2>/dev/null || shasum -a 256 "$DUMP") | cut -d' ' -f1)"
    SIZE="$(du -h "$DUMP" | cut -f1)"
    log "dump ok: $SIZE sha256=$SHA"
    dups="$(psql "$DB_URL" -tAc "SELECT count(*) FROM (SELECT lower(trim(email)) FROM users GROUP BY 1 HAVING count(*) > 1) d;")"
    if [ "$dups" != "0" ]; then
      die "$dups e-mail(s) differ only by case/whitespace in production users — resolve before launch (DEPLOYMENT-RUNBOOK.md, ADMIN_EMAILS)"
    fi
    note "case-duplicate e-mails" "ok" "none"
  fi
  DRILL_PORT=55432; DRILL_NAME="boardroom-launch-drill"
  run docker rm -f "$DRILL_NAME" >/dev/null 2>&1 || true
  run docker run -d --name "$DRILL_NAME" -e POSTGRES_PASSWORD=drill -p "127.0.0.1:$DRILL_PORT:5432" pgvector/pgvector:pg16 >/dev/null
  if [ "$DRY_RUN" -eq 0 ]; then
    for _ in $(seq 1 60); do docker exec "$DRILL_NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
    ROW="$(BACKUP_FILE="$DUMP" DRILL_DATABASE_URL="postgresql://postgres:drill@127.0.0.1:$DRILL_PORT/postgres" \
           DRILL_LOG="$REPO_ROOT/docs/03-operations/BACKUP-DRILLS.md" bash services/backup/restore-drill.sh)" \
      || { docker rm -f "$DRILL_NAME" >/dev/null; die "restore drill FAILED — do not continue (dump kept at $DUMP)"; }
    docker rm -f "$DRILL_NAME" >/dev/null
    date +%s > "$(marker backup)"
    note "M0-F1 backup" "ok" "$SIZE, sha256 ${SHA:0:16}…, drill exit 0 (row appended to BACKUP-DRILLS.md)"
    log "drill row: $ROW"
  else
    log "would run services/backup/restore-drill.sh with BACKUP_FILE=$DUMP"
  fi
  manual "Copy $DUMP to a second off-Railway location (it holds personal data: keep it encrypted), then commit the BACKUP-DRILLS.md row."
fi

# ── 3. rotate the R-103 secrets (M0-F2) ──────────────────────────────────────
if should_run rotate; then
  banner "3. rotate the five R-103 secrets (M0-F2)"
  [ "$DRY_RUN" -eq 1 ] || fresh_marker backup 24 || die "no successful backup in the last 24 h — run --only backup first"
  OLD_API_KEY="$(rw_var "$API_SERVICE" OMNIMIND_API_KEY)"; add_secret "$OLD_API_KEY"
  NEW_API_KEY="$(openssl rand -hex 32)"; add_secret "$NEW_API_KEY"
  NEW_JWT="$(openssl rand -hex 48)"; add_secret "$NEW_JWT"
  NEW_ANTHROPIC="${NEW_ANTHROPIC_API_KEY:-}"; NEW_OPENAI="${NEW_OPENAI_API_KEY:-}"
  if [ "$DRY_RUN" -eq 0 ] && [ -t 0 ]; then
    [ -n "$NEW_ANTHROPIC" ] || { printf '[launch] Paste the NEW Anthropic API key (hidden; empty = skip): ' >&2; read -rs NEW_ANTHROPIC; echo >&2; }
    [ -n "$NEW_OPENAI" ] || { printf '[launch] Paste the NEW OpenAI API key (hidden; empty = skip): ' >&2; read -rs NEW_OPENAI; echo >&2; }
  fi
  add_secret "$NEW_ANTHROPIC"; add_secret "$NEW_OPENAI"
  API_VARS=("OMNIMIND_API_KEY=$NEW_API_KEY"); APP_VARS=("OMNIMIND_API_KEY=$NEW_API_KEY" "JWT_SECRET=$NEW_JWT"); MCP_VARS=("OMNIMIND_API_KEY=$NEW_API_KEY")
  [ -n "$NEW_ANTHROPIC" ] && { API_VARS+=("ANTHROPIC_API_KEY=$NEW_ANTHROPIC"); APP_VARS+=("ANTHROPIC_API_KEY=$NEW_ANTHROPIC"); MCP_VARS+=("ANTHROPIC_API_KEY=$NEW_ANTHROPIC"); }
  [ -n "$NEW_OPENAI" ] && API_VARS+=("OPENAI_API_KEY=$NEW_OPENAI")
  if [ "$ROTATE_ENC" -eq 1 ]; then
    NEW_ENC="$(openssl rand -hex 32)"; add_secret "$NEW_ENC"; API_VARS+=("ENCRYPTION_KEY=$NEW_ENC")
    warn "ENCRYPTION_KEY rotation: stored Google OAuth tokens become unreadable — reconnect Google Calendar/Gmail in Settings afterwards."
  else
    manual "ENCRYPTION_KEY not rotated (re-run --only rotate --rotate-encryption-key when you are ready to reconnect Google)."
  fi
  confirm "Rotate ${#API_VARS[@]} variable(s) on $API_SERVICE and ${#APP_VARS[@]} on $APP_SERVICE now? (logs everyone out)"
  HAS_MCP=0; rw_has_service "$MCP_SERVICE" && HAS_MCP=1
  rw_set "$API_SERVICE" "${API_VARS[@]}"
  rw_set "$APP_SERVICE" "${APP_VARS[@]}"
  [ "$HAS_MCP" -eq 1 ] && rw_set "$MCP_SERVICE" "${MCP_VARS[@]}"
  if [ "$DRY_RUN" -eq 0 ]; then
    log "waiting for $API_SERVICE to come back with the new key…"
    ok=0
    for _ in $(seq 1 90); do
      new_code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "x-api-key: $NEW_API_KEY" -H 'x-user-id: launch-probe' "https://$API_HOST/memories?limit=1" || true)"
      old_code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "x-api-key: $OLD_API_KEY" -H 'x-user-id: launch-probe' "https://$API_HOST/memories?limit=1" || true)"
      if [ "$old_code" = "401" ] && [ "$new_code" != "401" ] && [ "${new_code:0:1}" != "5" ]; then ok=1; break; fi
      sleep 10
    done
    [ "$ok" -eq 1 ] || die "after rotation the old key is not refused (old=$old_code new=$new_code) — check the $API_SERVICE deploy"
    note "M0-F2 rotation" "ok" "OMNIMIND_API_KEY + JWT_SECRET$([ -n "$NEW_ANTHROPIC" ] && echo ' + ANTHROPIC')$([ -n "$NEW_OPENAI" ] && echo ' + OPENAI')$([ "$ROTATE_ENC" -eq 1 ] && echo ' + ENCRYPTION_KEY'); old service key → 401"
  fi
  manual "Revoke the OLD Anthropic and OpenAI keys in their consoles (rotation is only finished once the old keys are dead)."
  manual "Store the new secrets in your password manager; update any local .env that held the old OMNIMIND_API_KEY (e.g. the vault-import workflow secret)."
  [ -n "$NEW_ANTHROPIC" ] || manual "ANTHROPIC_API_KEY not rotated: re-run --only rotate with NEW_ANTHROPIC_API_KEY set."
  [ -n "$NEW_OPENAI" ] || manual "OPENAI_API_KEY not rotated: re-run --only rotate with NEW_OPENAI_API_KEY set."
fi

# ── 4. branch protection (M0-F3) ─────────────────────────────────────────────
if should_run protect; then
  banner "4. branch protection on main (M0-F3)"
  body="$(node -e 'process.stdout.write(JSON.stringify({required_status_checks:{strict:false,contexts:process.argv.slice(1)},enforce_admins:false,required_pull_request_reviews:null,restrictions:null}))' "${REQUIRED_CHECKS[@]}")"
  confirm "Require ${#REQUIRED_CHECKS[@]} CI checks on main?"
  log "\$ gh api -X PUT repos/$REPO/branches/main/protection --input <${#REQUIRED_CHECKS[@]} checks>"
  if [ "$DRY_RUN" -eq 0 ]; then
    printf '%s' "$body" | gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null
    n="$(gh api "repos/$REPO/branches/main/protection" -q '.required_status_checks.contexts | length')"
    [ "$n" = "${#REQUIRED_CHECKS[@]}" ] || die "protection reads back $n required checks, expected ${#REQUIRED_CHECKS[@]}"
    note "M0-F3 branch protection" "ok" "$n required checks on main"
  fi
  manual "Railway → each service → Settings → enable 'Wait for CI' (check-suite gating) and record the option name in CHANGELOG."
fi

# ── 5. merge the launch PR ───────────────────────────────────────────────────
MERGE_SHA=""
if should_run merge; then
  banner "5. merge PR #$PR (deploys; migrations run at boot)"
  [ "$DRY_RUN" -eq 1 ] || fresh_marker backup 24 || die "no successful backup in the last 24 h — the migration needs one first (--only backup)"
  if [ "$DRY_RUN" -eq 0 ] && [ "$(gh pr view "$PR" --repo "$REPO" --json state -q .state)" = "MERGED" ]; then
    log "PR #$PR is already merged"
  else
    confirm "Merge PR #$PR into main now? Railway deploys it to production."
    run gh pr merge "$PR" --repo "$REPO" --merge
  fi
  [ "$DRY_RUN" -eq 1 ] || MERGE_SHA="$(gh pr view "$PR" --repo "$REPO" --json mergeCommit -q .mergeCommit.oid)"
  note "merge" "ok" "PR #$PR → ${MERGE_SHA:0:7}"
fi

# ── 6. verify the deploy (M0-F4) ─────────────────────────────────────────────
if should_run verify; then
  banner "6. verify the deploy (M0-F4)"
  [ -n "$MERGE_SHA" ] || [ "$DRY_RUN" -eq 1 ] || MERGE_SHA="$(gh pr view "$PR" --repo "$REPO" --json mergeCommit -q .mergeCommit.oid)"
  for h in "$API_HOST" "$APP_HOST"; do
    wait_health_sha "$h" "$MERGE_SHA" || die "$h did not report version ${MERGE_SHA:0:7} within 15 min — check its Railway deploy log (migrate deploy)"
  done
  [ "$DRY_RUN" -eq 1 ] || note "M0-F4 deploy" "ok" "both services on ${MERGE_SHA:0:7}"
  manual "Railway → $API_SERVICE → deploy log: confirm 'migrate deploy' applied the pending migrations; paste the lines into CHANGELOG."
fi

# ── 7. MCP go-live ───────────────────────────────────────────────────────────
if should_run mcp; then
  banner "7. MCP go-live (scripts/mcp-go-live.sh)"
  [ "$DRY_RUN" -eq 1 ] || fresh_marker backup 24 || die "mcp-go-live needs a backup from the last 24 h"
  args=(--project "$PROJECT" --environment "$ENVIRONMENT" --owner-email "$OWNER_EMAIL" --backup-ok)
  [ "$YES" -eq 1 ] && args+=(--yes); [ "$DRY_RUN" -eq 1 ] && args+=(--dry-run)
  log "\$ scripts/mcp-go-live.sh ${args[*]}"
  bash scripts/mcp-go-live.sh "${args[@]}"   # its own --dry-run is passed through
  note "MCP go-live" "$([ "$DRY_RUN" -eq 1 ] && echo dry-run || echo ok)" "see the go-live summary above"
  manual "Once the hosted gateway is the only MCP writer, set OMNIMIND_REQUIRE_AGENT_KEY=true on $API_SERVICE."
fi

# ── 8. full production check ─────────────────────────────────────────────────
if should_run prod-check; then
  banner "8. scripts/verify-prod.sh"
  MCP_HOST="${OMNIMIND_MCP_HOST:-}"
  if [ -z "$MCP_HOST" ] && [ "$DRY_RUN" -eq 0 ]; then
    MCP_HOST="$(rw_var "$APP_SERVICE" OMNIMIND_MCP_PUBLIC_URL | sed -E 's#^https?://##; s#/.*$##')"
  fi
  [ -n "$MERGE_SHA" ] || [ "$DRY_RUN" -eq 1 ] || MERGE_SHA="$(gh pr view "$PR" --repo "$REPO" --json mergeCommit -q .mergeCommit.oid)"
  vargs=(--sha "${MERGE_SHA:-<sha>}" --boardroom-host "$APP_HOST" --api-host "$API_HOST" --mcp-host "${MCP_HOST:-<mcp-host>}")
  [ "$DRY_RUN" -eq 1 ] && vargs+=(--dry-run)
  log "\$ scripts/verify-prod.sh ${vargs[*]}"
  bash scripts/verify-prod.sh "${vargs[@]}"  # its own --dry-run is passed through
  note "verify-prod" "$([ "$DRY_RUN" -eq 1 ] && echo dry-run || echo ok)" "all probes on three services"
fi

# ── summary (stdout) ─────────────────────────────────────────────────────────
echo
echo "## Launch summary ($TS)"
echo
echo "| Step | Result | Detail |"
echo "|---|---|---|"
for r in "${REPORT[@]+"${REPORT[@]}"}"; do echo "$(redact "$r")"; done
if [ ${#MANUAL[@]} -gt 0 ]; then
  echo
  echo "### Still yours"
  for m in "${MANUAL[@]}"; do echo "$(redact "$m")"; done
fi
