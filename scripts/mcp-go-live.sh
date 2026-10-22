#!/usr/bin/env bash
# mcp-go-live.sh — take the platform from "PR merged" to "MCP live and first
# client connected" in one run, from a laptop (railway login) or from the
# GitHub Actions wrapper (.github/workflows/mcp-go-live.yml, RAILWAY_TOKEN).
#
# It automates docs/runbooks/omnimind-mcp.md §0–§7 in order:
#   1. admin key on omnimind-api (+ ADMIN_EMAILS on boardroom-ai)
#   2. gateway agent `omnimind-mcp-gateway` (mcp:delegate + the scope ceiling)
#   3. tenant owners (PATCH /admin/tenants/:id)
#   4. the omnimind-mcp Railway service: create, variables, public domain, deploy
#   5. BoardRoom variables (OMNIMIND_MCP_PUBLIC_URL, APP_PUBLIC_URL, …)
#   6. first personal token + the `claude mcp add` line (skipped with --no-token)
#   7. verification (PRM, 401 contract, initialize, tools/list = 20, audit)
#
# Usage:
#   scripts/mcp-go-live.sh --project <railway project id> --owner-email <email> [--yes] [--dry-run]
#   pnpm go-live:mcp -- --project … --owner-email …
# Run `scripts/mcp-go-live.sh --help` for every flag. Re-running is safe: every
# step reads before it writes and skips what already exists.
#
# ─────────────────────────────────────────────────────────────────────────────
# RAILWAY CLI FLAGS — what was verified, and where (checked 2026-10-20)
#
# docs.railway.com and the rendered pages of github.com/railwayapp/docs were not
# reachable from the build sandbox, so every flag below was verified against the
# CLI SOURCE on github.com/railwayapp/cli (master, Cargo.toml version = 5.71.0,
# which is also `@railway/cli` "latest" on registry.npmjs.org as of 2026-10-19).
# The CLI is on major version 5, not 4.
#
# VERIFIED (source file under https://github.com/railwayapp/cli/blob/master/):
#   railway whoami [--json]
#       src/commands/whoami.rs — needs USER auth (login or RAILWAY_API_TOKEN).
#       src/config.rs `get_railway_auth_token` excludes RAILWAY_TOKEN, so with a
#       project token whoami cannot work; the script skips it in that mode.
#   railway link --project/-p <id|name> --environment/-e <name> [--service/-s <name>] [--workspace/-w <name>] [--json]
#       src/commands/link.rs — `select_workspace` picks the workspace that owns
#       the given project id, `select_environment` matches by name, and in
#       non-interactive mode a missing -e bails with "--environment required".
#       Needs user auth (calls `workspaces()`), so it is skipped under RAILWAY_TOKEN.
#   railway variable list --service/-s <svc> --environment/-e <env> --project/-p <id> --json
#       src/commands/variable.rs — JSON is an object {KEY: value|null}; sealed
#       variables are null. `railway variables` / `vars` / `var` are aliases
#       (src/main.rs `variable_aliases`). Legacy `railway variables --set K=V -s svc`
#       still parses.
#   railway variable set KEY=VALUE [KEY2=VALUE2 …] -s <svc> -e <env> -p <id> [--skip-deploys] [--json]
#       src/commands/variable.rs — one GraphQL `variableCollectionUpsert`; a set
#       triggers a redeploy unless --skip-deploys; --json prints {"keys":[…],"set":true}.
#   railway service list --project/-p <id> --environment/-e <env> --json
#       src/commands/service.rs + src/commands/output/service_summary.rs — JSON
#       array of {id, name, url, status, …}. "--environment is required when using --project".
#   railway add --service <name> [--variables K=V]… [--json]
#       src/commands/add.rs — creates an EMPTY service in the linked project
#       (CreateKind::EmptyService); no -p/-e flags: the project comes from
#       `railway link` state or, under RAILWAY_TOKEN, from the token itself
#       (src/config.rs `get_linked_project` → ProjectToken query). Not idempotent,
#       hence the `service list` check first. --json prints {"id","name"}.
#   railway domain --service/-s <svc> --environment/-e <env> --project <id> [--port/-p <n>] [--json]
#       src/commands/domain.rs — NOTE: here `-p` is --port; --project is long-only.
#       Creates a Railway service domain, or, when one exists, prints it and exits 0
#       (idempotent). JSON: {"domain":"https://host"} on create,
#       {"domains":["https://host", …]} when domains already exist.
#   railway up [path] --service/-s <svc> --environment/-e <env> --project/-p <id> --detach|--no-wait [--ci] [-y]
#       src/commands/up.rs — uploads the directory and deploys to that service;
#       "--environment is required when using --project". --detach returns as soon
#       as the deploy is started. Honours .gitignore.
#   railway redeploy -s <svc> -e <env> -p <id> -y        src/commands/redeploy.rs
#   RAILWAY_TOKEN / RAILWAY_API_TOKEN
#       README.md "Tokens": RAILWAY_TOKEN = project token (project-level actions),
#       RAILWAY_API_TOKEN = account/workspace token. src/client.rs sends a project
#       token as the `project-access-token` header; src/config.rs resolves the
#       project + environment from it, so no `railway link` is needed (or possible).
#   Install: `npm i -g @railway/cli` (registry.npmjs.org/@railway/cli, 5.71.0) or
#       `bash <(curl -fsSL railway.com/install.sh) -y` (README.md "Installation").
#
# NOT VERIFIED against Railway's own docs (unreachable from the sandbox) — the
# script prints these and asks, or treats failure as non-fatal:
#   * RAILWAY_DOCKERFILE_PATH as a service variable selecting the Dockerfile.
#     The repo's runbook (§3) and railway.toml rely on it; set here as a variable.
#   * Setting the per-service config-as-code path. No flag for it exists anywhere
#     in the CLI source (link/up/service/variable), so it is a DASHBOARD step:
#     Settings → Config-as-code → `packages/omnimind-mcp/railway.toml`.
#   * Whether a PROJECT token may run `railway add` / `railway domain` (service
#     creation, domain creation). If it cannot, use an account token
#     (RAILWAY_API_TOKEN) in the workflow instead; the script accepts either.
#   * `railway domain --port` vs the injected PORT. Left unset by default so
#     Railway's own detection routes to the port the container listens on.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="2026-10-20"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Defaults / flags ─────────────────────────────────────────────────────────
PROJECT=""
ENVIRONMENT="production"
API_SERVICE="omnimind-api"
APP_SERVICE="boardroom-ai"
MCP_SERVICE="omnimind-mcp"
OWNER_EMAIL=""
OWNER_USER_ID=""
TENANTS="josh-business,josh-personal,tgfc-ministry"
ADMIN_EMAILS=""
OAUTH_ISSUER=""
ANTHROPIC_FROM=""
GATEWAY_KEY="${OMNIMIND_MCP_AGENT_KEY:-}"
GATEWAY_AGENT="omnimind-mcp-gateway"
API_URL_OVERRIDE=""
APP_URL_OVERRIDE=""
MCP_PORT=""
TOKEN_NAME="Claude Code (laptop)"
TOKEN_DAYS="365"
DRY_RUN=0
YES=0
NO_TOKEN=0
QUIET_SECRETS=0
HEALTH_TIMEOUT="${GO_LIVE_HEALTH_TIMEOUT:-900}"   # seconds per wait
POLL_INTERVAL="${GO_LIVE_POLL_INTERVAL:-10}"

usage() {
  cat <<EOF
mcp-go-live.sh ($VERSION) — PR merged → MCP live → first client connected.

Required:
  --project <id>             Railway project id (Project → Settings → General)
  --owner-email <email>      BoardRoom login e-mail of the tenant owner (you)

Optional:
  --environment <name>       Railway environment            (default: production)
  --api-service <name>       OmniMind API service name      (default: omnimind-api)
  --app-service <name>       BoardRoom service name         (default: boardroom-ai)
  --mcp-service <name>       MCP service name               (default: omnimind-mcp)
  --owner-user-id <cuid>     Skip the e-mail lookup (POST /auth/login) and use this id
  --tenants <a,b,c>          Tenants to own                 (default: josh-business,josh-personal,tgfc-ministry)
  --admin-emails <list>      ADMIN_EMAILS for boardroom-ai  (default: --owner-email)
  --oauth-issuer <url>       Also configure OAuth resource-server mode (runbook §9)
  --anthropic-key-from <svc> Service to copy ANTHROPIC_API_KEY from (default: --api-service)
  --gateway-key <omk_…>      Existing gateway key (or env OMNIMIND_MCP_AGENT_KEY) when the agent already exists
  --api-url <url>            Override the OmniMind public URL (default: from railway domain)
  --app-url <url>            Override the BoardRoom public URL (default: from railway domain)
  --mcp-port <n>             Pass --port to railway domain for the MCP service (default: unset)
  --token-name <name>        Name of the first token        (default: "Claude Code (laptop)")
  --token-days <n>           Expiry of the first token      (default: 365)
  --no-token                 Do not mint or print a personal token (CI)
  --quiet-secrets            Never print the admin key (implied under GITHUB_ACTIONS)
  --dry-run                  Print the plan with placeholders; make no calls
  --yes                      Skip confirmations; run \`claude mcp add\` when claude is on PATH
  -h, --help

Environment: RAILWAY_TOKEN (project token, CI) or RAILWAY_API_TOKEN (account token)
replace \`railway login\`; with RAILWAY_TOKEN whoami/link are skipped.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --api-service) API_SERVICE="$2"; shift 2 ;;
    --app-service) APP_SERVICE="$2"; shift 2 ;;
    --mcp-service) MCP_SERVICE="$2"; shift 2 ;;
    --owner-email) OWNER_EMAIL="$2"; shift 2 ;;
    --owner-user-id) OWNER_USER_ID="$2"; shift 2 ;;
    --tenants) TENANTS="$2"; shift 2 ;;
    --admin-emails) ADMIN_EMAILS="$2"; shift 2 ;;
    --oauth-issuer) OAUTH_ISSUER="$2"; shift 2 ;;
    --anthropic-key-from) ANTHROPIC_FROM="$2"; shift 2 ;;
    --gateway-key) GATEWAY_KEY="$2"; shift 2 ;;
    --api-url) API_URL_OVERRIDE="$2"; shift 2 ;;
    --app-url) APP_URL_OVERRIDE="$2"; shift 2 ;;
    --mcp-port) MCP_PORT="$2"; shift 2 ;;
    --token-name) TOKEN_NAME="$2"; shift 2 ;;
    --token-days) TOKEN_DAYS="$2"; shift 2 ;;
    --no-token) NO_TOKEN=1; shift ;;
    --quiet-secrets) QUIET_SECRETS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "${GITHUB_ACTIONS:-}" ] && QUIET_SECRETS=1
[ -z "$ADMIN_EMAILS" ] && ADMIN_EMAILS="$OWNER_EMAIL"
[ -z "$ANTHROPIC_FROM" ] && ANTHROPIC_FROM="$API_SERVICE"
IFS=',' read -r -a TENANT_LIST <<< "$TENANTS"
FIRST_TENANT="${TENANT_LIST[0]:-}"

# ── Output helpers (all progress on stderr; summary on stdout) ───────────────
SECRETS=()
redact() {
  local out="$1" s
  for s in "${SECRETS[@]+"${SECRETS[@]}"}"; do
    [ -n "$s" ] && out="${out//"$s"/<redacted>}"
  done
  printf '%s' "$out"
}
add_secret() {
  [ -z "$1" ] && return 0
  case "$1" in \<*|*\<*\>*) return 0 ;; esac   # dry-run placeholders stay readable
  [ "$DRY_RUN" -eq 1 ] && return 0
  SECRETS+=("$1")
  # GitHub Actions: mask the value in every later log line.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then printf '::add-mask::%s\n' "$1"; fi
}
log()  { printf '[go-live] %s\n' "$(redact "$*")" >&2; }
warn() { printf '[go-live] WARN: %s\n' "$(redact "$*")" >&2; }
die()  { printf '[go-live] ERROR: %s\n' "$(redact "$*")" >&2; exit 1; }
step() { printf '\n[go-live] ── %s ──\n' "$*" >&2; }

confirm() {
  # confirm <question> — true when --yes or --dry-run, or the operator answers y.
  [ "$YES" -eq 1 ] || [ "$DRY_RUN" -eq 1 ] && return 0
  if [ ! -t 0 ]; then die "confirmation needed for: $1 (re-run with --yes)"; fi
  printf '[go-live] %s [y/N] ' "$1" >&2
  local a; read -r a
  case "$a" in y|Y|yes|YES) return 0 ;; *) die "aborted by operator" ;; esac
}

# run <cmd…> — echo (redacted) then execute; prints nothing and runs nothing in --dry-run.
run() {
  log "\$ $*"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  "$@"
}
# capture <cmd…> — like run, but stdout is returned to the caller.
capture() {
  log "\$ $*"
  if [ "$DRY_RUN" -eq 1 ]; then printf ''; return 0; fi
  "$@"
}

# JSON access without jq: `json_get '<js expression over d>' <<< "$json"`.
# node is already a hard requirement of this repo, jq is not.
json_get() {
  local expr="$1"
  node -e '
    let s = ""; process.stdin.on("data", c => s += c).on("end", () => {
      let d; try { d = JSON.parse(s); } catch { process.exit(0); }
      let v; try { v = eval(process.argv[1]); } catch { v = undefined; }
      if (v === undefined || v === null) return;
      process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
    });' "$expr"
}
json_escape() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
sha256_hex() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"; }

# ── Railway wrappers ─────────────────────────────────────────────────────────
RW_SCOPE=()   # -e <env> -p <project>, added to every scoped command
rw_vars_json() {        # rw_vars_json <service> → {KEY: value|null}
  if [ "$DRY_RUN" -eq 1 ]; then log "\$ railway variable list -s $1 ${RW_SCOPE[*]} --json"; printf '{}'; return 0; fi
  capture railway variable list -s "$1" "${RW_SCOPE[@]}" --json
}
rw_var() {              # rw_var <service> <KEY> → value or empty
  local json; json="$(rw_vars_json "$1")"
  json_get "d[$(json_escape "$2")]" <<< "$json"
}
rw_set() {              # rw_set <service> KEY=VALUE… (one call → one redeploy)
  local svc="$1"; shift
  [ $# -eq 0 ] && return 0
  run railway variable set "$@" -s "$svc" "${RW_SCOPE[@]}" --json >/dev/null
}
rw_set_nodeploy() {     # same, --skip-deploys (used before the first deploy)
  local svc="$1"; shift
  [ $# -eq 0 ] && return 0
  run railway variable set "$@" -s "$svc" "${RW_SCOPE[@]}" --skip-deploys --json >/dev/null
}
rw_domain_host() {      # rw_domain_host <service> → bare host (creates a service domain when none exists)
  local json
  if [ "$DRY_RUN" -eq 1 ]; then log "\$ railway domain -s $1 -e $ENVIRONMENT --project $PROJECT --json"; printf '<%s-host>' "$1"; return 0; fi
  if [ -n "$MCP_PORT" ] && [ "$1" = "$MCP_SERVICE" ]; then
    json="$(capture railway domain -s "$1" -e "$ENVIRONMENT" --project "$PROJECT" --port "$MCP_PORT" --json)"
  else
    json="$(capture railway domain -s "$1" -e "$ENVIRONMENT" --project "$PROJECT" --json)"
  fi
  local url
  url="$(json_get 'd.domain || (Array.isArray(d.domains) ? d.domains[0] : undefined)' <<< "$json")"
  [ -z "$url" ] && die "could not read a domain for service '$1' from: $json"
  url="${url#https://}"; url="${url#http://}"; url="${url%%/*}"
  printf '%s' "$url"
}
rw_service_exists() {   # rw_service_exists <name>
  local json names
  json="$(capture railway service list "${RW_SCOPE[@]}" --json)"
  names="$(json_get 'd.map(s => s.name).join("\n")' <<< "$json")"
  printf '%s\n' "$names" | grep -qxF "$1"
}

# ── HTTP wrapper: api <METHOD> <path> [json body] [admin] ───────────────────
API_URL=""; API_KEY=""; ADMIN_KEY=""
API_STATUS=""; API_BODY=""
api() {
  local method="$1" path="$2" body="${3:-}" admin="${4:-}"
  local args=(-sS -X "$method" -H "x-api-key: $API_KEY" -H "content-type: application/json")
  [ -n "$admin" ] && args+=(-H "x-admin-key: $ADMIN_KEY")
  [ -n "$body" ] && args+=(-d "$body")
  log "\$ curl -X $method $API_URL$path${admin:+ (x-admin-key)}${body:+ -d $(redact "$body")}"
  if [ "$DRY_RUN" -eq 1 ]; then API_STATUS="000"; API_BODY=""; return 0; fi
  local tmp; tmp="$(mktemp)"
  API_STATUS="$(curl "${args[@]}" -o "$tmp" -w '%{http_code}' "$API_URL$path" || true)"
  API_BODY="$(cat "$tmp")"; rm -f "$tmp"
}

# wait_for <label> <url> <grep-regex on body> [extra curl args…]
wait_for() {
  local label="$1" url="$2" expect="$3"; shift 3
  log "waiting up to ${HEALTH_TIMEOUT}s for $label ($url) to match /$expect/"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  local start now body
  start=$(date +%s)
  while :; do
    body="$(curl -sS -m 15 "$@" "$url" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -qE -- "$expect"; then log "$label ready"; return 0; fi
    now=$(date +%s)
    if [ $((now - start)) -ge "$HEALTH_TIMEOUT" ]; then
      die "$label did not become ready within ${HEALTH_TIMEOUT}s (last body: $(printf '%s' "$body" | head -c 200))"
    fi
    sleep "$POLL_INTERVAL"
  done
}

# ── Summary accumulator ──────────────────────────────────────────────────────
SUMMARY_ROWS=()
note() { SUMMARY_ROWS+=("| $1 | $2 | $3 |"); }   # note <item> <result> <detail>
MANUAL_ROWS=()
manual() { MANUAL_ROWS+=("- $1"); }

# =============================================================================
# 0. Preflight
# =============================================================================
step "0. Preflight"
[ "$DRY_RUN" -eq 1 ] && log "DRY RUN — the plan is printed with placeholders; nothing is called."
for bin in railway curl node openssl; do
  command -v "$bin" >/dev/null 2>&1 || die "missing required command: $bin"
done
[ -f "$REPO_ROOT/packages/omnimind-mcp/Dockerfile" ] || die "repo root not detected at $REPO_ROOT (packages/omnimind-mcp/Dockerfile missing)"
[ -n "$PROJECT" ] || { [ "$DRY_RUN" -eq 1 ] && PROJECT="<project-id>"; } || die "--project <railway project id> is required"
[ -n "$OWNER_EMAIL" ] || [ -n "$OWNER_USER_ID" ] || { [ "$DRY_RUN" -eq 1 ] && OWNER_EMAIL="<owner-email>"; } || die "--owner-email <email> (or --owner-user-id) is required"
[ -n "$FIRST_TENANT" ] || die "--tenants must name at least one tenant"
[ -z "$ADMIN_EMAILS" ] && ADMIN_EMAILS="$OWNER_EMAIL"
RW_SCOPE=(-e "$ENVIRONMENT" -p "$PROJECT")
add_secret "$GATEWAY_KEY"

log "repo root: $REPO_ROOT"
log "project=$PROJECT environment=$ENVIRONMENT api=$API_SERVICE app=$APP_SERVICE mcp=$MCP_SERVICE"
log "owner=${OWNER_EMAIL:-<by id>} tenants=$TENANTS admin_emails=$ADMIN_EMAILS oauth_issuer=${OAUTH_ISSUER:-<none>}"

AUTH_MODE="login"
if [ -n "${RAILWAY_TOKEN:-}" ]; then
  AUTH_MODE="project-token"
  log "RAILWAY_TOKEN set → project-token mode: whoami/link are skipped (project tokens carry no user; project + environment come from the token)"
  # Not verified: whether `railway status` accepts a project token. Non-fatal.
  if [ "$DRY_RUN" -eq 0 ] && ! capture railway status "${RW_SCOPE[@]}" --json >/dev/null 2>&1; then
    warn "railway status failed under RAILWAY_TOKEN — continuing; the first scoped command will fail loudly if the token is wrong"
  fi
elif [ -n "${RAILWAY_API_TOKEN:-}" ]; then
  AUTH_MODE="api-token"
  run railway whoami >/dev/null || die "RAILWAY_API_TOKEN is not accepted by 'railway whoami'"
else
  run railway whoami >/dev/null || die "not logged in — run 'railway login' (or set RAILWAY_TOKEN / RAILWAY_API_TOKEN)"
fi
if [ "$AUTH_MODE" != "project-token" ]; then
  # `railway add` has no -p/-e flags: it needs the directory linked.
  run railway link -p "$PROJECT" -e "$ENVIRONMENT" -s "$API_SERVICE" >/dev/null \
    || die "railway link failed — check --project / --environment"
fi
if [ "$DRY_RUN" -eq 1 ]; then CLI_VERSION="dry-run"; else CLI_VERSION="$(railway --version 2>/dev/null | head -1 || echo '?')"; fi
note "Preflight" "ok" "auth=$AUTH_MODE, cli=$CLI_VERSION"

confirm "Proceed with the go-live against project $PROJECT / $ENVIRONMENT?"

# =============================================================================
# 1. Admin key, service key, public URLs
# =============================================================================
step "1. Admin key + service-level inputs on $API_SERVICE"
API_VARS="$(rw_vars_json "$API_SERVICE")"
API_KEY="$(json_get 'd.OMNIMIND_API_KEY' <<< "$API_VARS")"
ADMIN_KEY="$(json_get 'd.OMNIMIND_ADMIN_KEY' <<< "$API_VARS")"
if [ "$DRY_RUN" -eq 1 ]; then
  API_KEY="${API_KEY:-<OMNIMIND_API_KEY from $API_SERVICE>}"
  ADMIN_KEY="${ADMIN_KEY:-<OMNIMIND_ADMIN_KEY: existing, or openssl rand -hex 32>}"
fi
[ -n "$API_KEY" ] || die "OMNIMIND_API_KEY is not set on $API_SERVICE (sealed variables read back as null — unseal or pass the service through --api-service)"
add_secret "$API_KEY"

ANTHROPIC_KEY=""
if [ "$ANTHROPIC_FROM" = "$API_SERVICE" ]; then
  ANTHROPIC_KEY="$(json_get 'd.ANTHROPIC_API_KEY' <<< "$API_VARS")"
else
  ANTHROPIC_KEY="$(rw_var "$ANTHROPIC_FROM" ANTHROPIC_API_KEY)"
fi
[ "$DRY_RUN" -eq 1 ] && ANTHROPIC_KEY="${ANTHROPIC_KEY:-<ANTHROPIC_API_KEY from $ANTHROPIC_FROM>}"
if [ -z "$ANTHROPIC_KEY" ]; then
  warn "ANTHROPIC_API_KEY not readable from $ANTHROPIC_FROM — memory_write will fail with FACT_EXTRACTOR_UNAVAILABLE until it is set on $MCP_SERVICE"
  manual "Set ANTHROPIC_API_KEY on the $MCP_SERVICE service (not readable from $ANTHROPIC_FROM)."
fi
add_secret "$ANTHROPIC_KEY"

if [ -n "$API_URL_OVERRIDE" ]; then API_URL="${API_URL_OVERRIDE%/}"; else API_URL="https://$(rw_domain_host "$API_SERVICE")"; fi
if [ -n "$APP_URL_OVERRIDE" ]; then APP_URL="${APP_URL_OVERRIDE%/}"; else APP_URL="https://$(rw_domain_host "$APP_SERVICE")"; fi
log "OmniMind public URL: $API_URL"
log "BoardRoom public URL: $APP_URL"

ADMIN_KEY_STATE="existing"
[ "$DRY_RUN" -eq 1 ] && ADMIN_KEY_STATE="<existing, or generated>"
if [ -z "$ADMIN_KEY" ]; then
  ADMIN_KEY_STATE="generated"
  ADMIN_KEY="$(openssl rand -hex 32)"
  add_secret "$ADMIN_KEY"
  log "OMNIMIND_ADMIN_KEY is not set — generating one and setting it on $API_SERVICE (this redeploys the API)"
  rw_set "$API_SERVICE" "OMNIMIND_ADMIN_KEY=$ADMIN_KEY"
  if [ "$QUIET_SECRETS" -eq 1 ]; then
    log "admin key written to the Railway variable OMNIMIND_ADMIN_KEY on $API_SERVICE (not printed here — read it from the Railway dashboard when you need it)"
  else
    printf '\n[go-live] === OMNIMIND_ADMIN_KEY — store in 1Password now; printed once ===\n[go-live] %s\n\n' "$ADMIN_KEY" >&2
  fi
  wait_for "$API_SERVICE /health" "$API_URL/health" '"status":"ok"'
  # The old deployment still answers /health; the admin routes answering 200
  # with the new key is the real "redeployed" signal.
  wait_for "$API_SERVICE admin routes with the new key" "$API_URL/admin/tenants" '"tenants"' \
    -H "x-api-key: $API_KEY" -H "x-admin-key: $ADMIN_KEY"
else
  add_secret "$ADMIN_KEY"
  log "OMNIMIND_ADMIN_KEY already set on $API_SERVICE — reusing"
fi
note "OMNIMIND_ADMIN_KEY ($API_SERVICE)" "$ADMIN_KEY_STATE" "x-admin-key for /admin/* and POST /mcp/agents"

# =============================================================================
# 2. Gateway agent
# =============================================================================
step "2. Gateway agent '$GATEWAY_AGENT' on tenant $FIRST_TENANT"
# Scope ceiling = MCP_GATEWAY_CEILING_SCOPES (packages/shared/src/types/mcp-token.types.ts):
# the seven MCP_SCOPES + mcp:delegate. Read from the file so a new scope is never
# silently left out of the ceiling; fall back to the literal list.
SCOPES_FILE="$REPO_ROOT/packages/shared/src/types/mcp-token.types.ts"
CEILING_SCOPES="$(node -e '
  const fs = require("fs"); const f = process.argv[1];
  const fallback = ["memory:read","memory:write","decision:write","task:write","commitment:write","project:write","code:write","mcp:delegate"];
  try {
    const src = fs.readFileSync(f, "utf8");
    const m = src.match(/MCP_SCOPES\s*=\s*\[([^\]]*)\]/);
    const scopes = m ? [...m[1].matchAll(/["\x27]([a-z]+:[a-z]+)["\x27]/g)].map(x => x[1]) : [];
    const d = src.match(/MCP_DELEGATE_SCOPE\s*=\s*["\x27]([a-z:]+)["\x27]/);
    const out = scopes.length ? [...scopes, d ? d[1] : "mcp:delegate"] : fallback;
    process.stdout.write(out.join(","));
  } catch { process.stdout.write(fallback.join(",")); }' "$SCOPES_FILE")"
GRANTABLE_SCOPES="${CEILING_SCOPES//,mcp:delegate/}"
log "ceiling scopes: $CEILING_SCOPES"
CEILING_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1].split(",")))' "$CEILING_SCOPES")"
GRANTABLE_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1].split(",")))' "$GRANTABLE_SCOPES")"

# Does the agent row exist already? (plain x-api-key call → tenant must be named)
api GET "/mcp/agents?tenantId=$FIRST_TENANT"
EXISTING_AGENT=""
if [ "$API_STATUS" = "200" ]; then
  EXISTING_AGENT="$(json_get "(d.agents||[]).find(a => a.name === $(json_escape "$GATEWAY_AGENT"))" <<< "$API_BODY")"
elif [ "$DRY_RUN" -eq 0 ]; then
  die "GET /mcp/agents failed ($API_STATUS): $API_BODY"
fi

rotation_help() {
  cat >&2 <<EOF
[go-live] The agent row '$GATEWAY_AGENT' already exists and POST /mcp/agents is create-only (409),
[go-live] so its raw key cannot be re-read. Three ways forward (runbook §1 "Rotation"):
[go-live]   a) pass the key you stored: --gateway-key omk_… (or env OMNIMIND_MCP_AGENT_KEY) and re-run;
[go-live]   b) rotate in place (psql against the production DB), then re-run with --gateway-key <new key>:
[go-live]        node packages/omnimind-mcp/dist/index.js keygen --agent $GATEWAY_AGENT --tenant $FIRST_TENANT \\
[go-live]          --scopes "$CEILING_SCOPES" --source-weight 1.0   # expect 409; it prints the ON CONFLICT SQL
[go-live]      or, with a key you generate yourself (sha256 hex of the raw key as api_key_hash):
[go-live]        INSERT INTO agents (id, name, api_key_hash, tenant_id, scopes, source_weight, created_at)
[go-live]        VALUES (gen_random_uuid()::text, '$GATEWAY_AGENT', '<sha256 hex>', '$FIRST_TENANT',
[go-live]                ARRAY[$(printf "'%s'," ${CEILING_SCOPES//,/ } | sed 's/,$//')]::text[], 1, NOW())
[go-live]        ON CONFLICT (name) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, tenant_id = EXCLUDED.tenant_id,
[go-live]                scopes = EXCLUDED.scopes, source_weight = EXCLUDED.source_weight;
[go-live]   c) new name, no SQL: --gateway-agent is fixed in this script, so use keygen with a new --agent name
[go-live]      and set OMNIMIND_MCP_AGENT_KEY on $MCP_SERVICE by hand.
EOF
}

GATEWAY_STATE=""
if [ -n "$EXISTING_AGENT" ]; then
  log "agent row exists: $(json_get 'JSON.stringify({tenantId:d.tenantId, scopes:d.scopes})' <<< "$EXISTING_AGENT")"
  missing="$(json_get "$CEILING_JSON.filter(s => !(d.scopes||[]).includes(s) && !(d.scopes||[]).includes('*')).join(',')" <<< "$EXISTING_AGENT")"
  [ -n "$missing" ] && warn "existing gateway row lacks scopes [$missing] — tokens will be capped; widen with the ON CONFLICT SQL (runbook §1)"
  if [ -z "$GATEWAY_KEY" ]; then
    # Idempotent re-run: the MCP service may already carry the key.
    if [ "$DRY_RUN" -eq 0 ] && rw_service_exists "$MCP_SERVICE"; then
      GATEWAY_KEY="$(rw_var "$MCP_SERVICE" OMNIMIND_MCP_AGENT_KEY)"
      add_secret "$GATEWAY_KEY"
      [ -n "$GATEWAY_KEY" ] && log "reusing OMNIMIND_MCP_AGENT_KEY already set on $MCP_SERVICE"
    fi
  fi
  if [ -z "$GATEWAY_KEY" ]; then rotation_help; die "gateway agent exists but no key is available"; fi
  GATEWAY_STATE="existing (key supplied)"
else
  if [ "$DRY_RUN" -eq 1 ]; then GATEWAY_KEY_NEW="omk_<openssl rand -hex 32>"; else GATEWAY_KEY_NEW="omk_$(openssl rand -hex 32)"; fi
  GATEWAY_HASH="$(sha256_hex "$GATEWAY_KEY_NEW")"
  body="$(node -e 'process.stdout.write(JSON.stringify({name:process.argv[1], apiKeyHash:process.argv[2], tenantId:process.argv[3], scopes:JSON.parse(process.argv[4]), sourceWeight:1.0}))' \
    "$GATEWAY_AGENT" "$GATEWAY_HASH" "$FIRST_TENANT" "$CEILING_JSON")"
  api POST "/mcp/agents" "$body" admin
  case "$API_STATUS" in
    201|000)
      GATEWAY_KEY="$GATEWAY_KEY_NEW"; add_secret "$GATEWAY_KEY"
      GATEWAY_STATE="created"
      log "agent registered: $(json_get 'JSON.stringify(d)' <<< "$API_BODY")  (the raw omk_ key is generated here; the API stores only its SHA-256 and never returns it)"
      ;;
    409)
      rotation_help
      if [ -n "$GATEWAY_KEY" ]; then
        warn "409 Agent name already registered — continuing with the key supplied via --gateway-key / OMNIMIND_MCP_AGENT_KEY"
        GATEWAY_STATE="existing (409, key supplied)"
      else
        die "409 Agent name already registered and no --gateway-key supplied"
      fi
      ;;
    503) die "POST /mcp/agents → 503 admin_disabled: the API has not picked up OMNIMIND_ADMIN_KEY yet; re-run in a minute" ;;
    *)   die "POST /mcp/agents failed ($API_STATUS): $API_BODY" ;;
  esac
fi
note "Gateway agent $GATEWAY_AGENT" "$GATEWAY_STATE" "tenant $FIRST_TENANT, scopes $CEILING_SCOPES"

# =============================================================================
# 3. Tenant owners
# =============================================================================
step "3. Tenant owners"
if [ -z "$OWNER_USER_ID" ]; then
  # OmniMind has no admin "user by e-mail" route; POST /auth/login {email} is the
  # existing lookup BoardRoom uses (it returns the user minus passwordHash).
  api POST "/auth/login" "{\"email\":$(json_escape "$OWNER_EMAIL")}"
  if [ "$API_STATUS" = "200" ]; then
    OWNER_USER_ID="$(json_get 'd.id' <<< "$API_BODY")"
  elif [ "$DRY_RUN" -eq 1 ]; then
    OWNER_USER_ID="<user id of $OWNER_EMAIL>"
  fi
  [ -n "$OWNER_USER_ID" ] || die "could not resolve '$OWNER_EMAIL' to a user id (POST /auth/login → $API_STATUS). Pass --owner-user-id <cuid>: it is the 'id' in BoardRoom's login response (GET /api/auth/me) or the users table (SELECT id FROM users WHERE email = '…')."
fi
log "owner user id: $OWNER_USER_ID"

api GET "/admin/tenants" "" admin
if [ "$API_STATUS" != "200" ] && [ "$DRY_RUN" -eq 0 ]; then die "GET /admin/tenants failed ($API_STATUS): $API_BODY"; fi
TENANTS_JSON="$API_BODY"
OWNED=(); PATCHED=(); SKIPPED=()
for t in "${TENANT_LIST[@]}"; do
  t="$(printf '%s' "$t" | tr -d ' ')"; [ -z "$t" ] && continue
  if [ "$DRY_RUN" -eq 1 ]; then
    log "would PATCH /admin/tenants/$t {ownerUserId} unless already owned"
    PATCHED+=("$t"); continue
  fi
  row="$(json_get "(d.tenants||[]).find(x => x.id === $(json_escape "$t"))" <<< "$TENANTS_JSON")"
  if [ -z "$row" ]; then warn "tenant '$t' does not exist (seeded by migration 20260509000000_mcp_phase_1) — skipping"; SKIPPED+=("$t (missing)"); continue; fi
  owner="$(json_get 'd.ownerUserId' <<< "$row")"
  if [ "$owner" = "$OWNER_USER_ID" ]; then log "tenant $t already owned by $OWNER_USER_ID"; OWNED+=("$t"); continue; fi
  if [ -n "$owner" ]; then warn "tenant $t is owned by a DIFFERENT user ($owner) — not changing it; PATCH by hand if intended"; SKIPPED+=("$t (owner $owner)"); continue; fi
  api PATCH "/admin/tenants/$t" "{\"ownerUserId\":$(json_escape "$OWNER_USER_ID")}" admin
  [ "$API_STATUS" = "200" ] || die "PATCH /admin/tenants/$t failed ($API_STATUS): $API_BODY"
  log "tenant $t → owner $OWNER_USER_ID"; PATCHED+=("$t")
done
note "Tenant owners" "set ${#PATCHED[@]}, kept ${#OWNED[@]}, skipped ${#SKIPPED[@]}" "owner $OWNER_USER_ID; patched: ${PATCHED[*]:-none}; skipped: ${SKIPPED[*]:-none}"

# =============================================================================
# 4. MCP service
# =============================================================================
step "4. Railway service $MCP_SERVICE"
MCP_SERVICE_STATE="existing"
if [ "$DRY_RUN" -eq 1 ]; then
  log "would create service $MCP_SERVICE with 'railway add --service $MCP_SERVICE' unless it exists"
  MCP_SERVICE_STATE="<create if missing>"
elif rw_service_exists "$MCP_SERVICE"; then
  log "service $MCP_SERVICE exists"
else
  confirm "Create Railway service '$MCP_SERVICE' in $PROJECT/$ENVIRONMENT?"
  run railway add --service "$MCP_SERVICE" --json >/dev/null || die "railway add failed"
  MCP_SERVICE_STATE="created"
fi

PRIVATE_API_URL="http://$API_SERVICE.railway.internal:3333"   # docs/03-operations/PRIVATE-NETWORKING.md
MCP_VARS=(
  "RAILWAY_DOCKERFILE_PATH=packages/omnimind-mcp/Dockerfile"
  "OMNIMIND_API_URL=$PRIVATE_API_URL"
  "OMNIMIND_API_KEY=$API_KEY"
  "OMNIMIND_MCP_TOKEN_AUTH=true"
  "OMNIMIND_MCP_AGENT_KEY=$GATEWAY_KEY"
  "OMNIMIND_MCP_TRUST_PROXY=true"
  "OMNIMIND_MCP_APP_URL=$APP_URL"
)
[ -n "$ANTHROPIC_KEY" ] && MCP_VARS+=("ANTHROPIC_API_KEY=$ANTHROPIC_KEY")
rw_set_nodeploy "$MCP_SERVICE" "${MCP_VARS[@]}"

MCP_HOST="$(rw_domain_host "$MCP_SERVICE")"
MCP_PUBLIC_URL="https://$MCP_HOST/mcp"
log "MCP public host: $MCP_HOST"
HOST_VARS=("OMNIMIND_MCP_ALLOWED_HOSTS=$MCP_HOST" "OMNIMIND_MCP_PUBLIC_URL=$MCP_PUBLIC_URL")
if [ -n "$OAUTH_ISSUER" ]; then
  HOST_VARS+=("OMNIMIND_MCP_OAUTH_ISSUER=$OAUTH_ISSUER" "OMNIMIND_MCP_OAUTH_AUDIENCE=$MCP_PUBLIC_URL")
fi
rw_set_nodeploy "$MCP_SERVICE" "${HOST_VARS[@]}"
if [ -n "$OAUTH_ISSUER" ]; then
  rw_set "$API_SERVICE" "MCP_OAUTH_ALLOWED_ISSUERS=$OAUTH_ISSUER"
fi

log "deploying $MCP_SERVICE from the repo root (build context = repo root, Dockerfile via RAILWAY_DOCKERFILE_PATH)"
( cd "$REPO_ROOT" && run railway up . -s "$MCP_SERVICE" "${RW_SCOPE[@]}" --detach ) || die "railway up failed"
manual "Railway dashboard → $MCP_SERVICE → Settings → Config-as-code → set the config file path to packages/omnimind-mcp/railway.toml (no CLI flag exists; without it healthcheckPath=/health and numReplicas=1 are not applied)."
manual "Railway dashboard → $MCP_SERVICE → Settings → Source → connect the GitHub repo (branch main, root directory /) so pushes to main redeploy it; until then re-run this script (or 'railway up') to deploy."
wait_for "$MCP_SERVICE /health" "https://$MCP_HOST/health" '"status":"ok"'
note "Service $MCP_SERVICE" "$MCP_SERVICE_STATE, deployed" "https://$MCP_HOST — ${#MCP_VARS[@]}+${#HOST_VARS[@]} variables set"

# =============================================================================
# 5. BoardRoom variables
# =============================================================================
step "5. BoardRoom variables on $APP_SERVICE"
APP_VARS_JSON="$(rw_vars_json "$APP_SERVICE")"
APP_SET=()
want_app() {  # want_app KEY VALUE — queue when different
  local cur; cur="$(json_get "d[$(json_escape "$1")]" <<< "$APP_VARS_JSON")"
  if [ "$cur" != "$2" ]; then APP_SET+=("$1=$2"); else log "$APP_SERVICE $1 already correct"; fi
}
want_app OMNIMIND_MCP_PUBLIC_URL "$MCP_PUBLIC_URL"
want_app APP_PUBLIC_URL "$APP_URL"
want_app ADMIN_EMAILS "$ADMIN_EMAILS"
[ -n "$OAUTH_ISSUER" ] && want_app OMNIMIND_MCP_OAUTH_ISSUER "$OAUTH_ISSUER"
if [ ${#APP_SET[@]} -gt 0 ]; then
  rw_set "$APP_SERVICE" "${APP_SET[@]}"
  [ "$DRY_RUN" -eq 0 ] && sleep 5
  wait_for "$APP_SERVICE /health" "$APP_URL/health" '"status":"ok"'
  log "note: /health answers from the previous deployment too — give the new one a minute before opening Settings → Connected AI tools"
fi
note "BoardRoom variables" "${#APP_SET[@]} set" "OMNIMIND_MCP_PUBLIC_URL=$MCP_PUBLIC_URL, APP_PUBLIC_URL=$APP_URL, ADMIN_EMAILS=$ADMIN_EMAILS${OAUTH_ISSUER:+, OMNIMIND_MCP_OAUTH_ISSUER=$OAUTH_ISSUER}"

# =============================================================================
# 6. First token
# =============================================================================
step "6. First personal token"
TOKEN=""; TOKEN_AGENT=""
if [ "$NO_TOKEN" -eq 1 ]; then
  log "--no-token: not minting. Mint the first token in BoardRoom → Settings → Connected AI tools."
  note "First token" "skipped (--no-token)" "mint in BoardRoom → Settings → Connected AI tools"
else
  body="$(node -e 'process.stdout.write(JSON.stringify({userId:process.argv[1], tenantId:process.argv[2], name:process.argv[3], scopes:JSON.parse(process.argv[4]), expiresInDays:Number(process.argv[5])}))' \
    "$OWNER_USER_ID" "$FIRST_TENANT" "$TOKEN_NAME" "$GRANTABLE_JSON" "$TOKEN_DAYS")"
  api POST "/mcp/tokens" "$body"      # x-api-key only — no agent headers (token routes refuse any agent context)
  case "$API_STATUS" in
    201) TOKEN="$(json_get 'd.token' <<< "$API_BODY")"; TOKEN_AGENT="$(json_get 'd.record.agentName' <<< "$API_BODY")"; add_secret "$TOKEN" ;;
    000) TOKEN="omt_<minted by POST /mcp/tokens>"; TOKEN_AGENT="mcp-token:<slug>-<id>" ;;
    403) die "POST /mcp/tokens → 403 tenant_not_owned: $FIRST_TENANT is not owned by $OWNER_USER_ID (step 3 skipped it?)" ;;
    409) die "POST /mcp/tokens → 409 token_limit: revoke one in Settings → Connected AI tools and re-run" ;;
    *)   die "POST /mcp/tokens failed ($API_STATUS): $API_BODY" ;;
  esac
  CLAUDE_ADD=(claude mcp add --transport http --scope user omnimind "$MCP_PUBLIC_URL" --header "Authorization: Bearer $TOKEN")
  printf '\n[go-live] === First token "%s" (%s) — shown once; the only place it is printed ===\n' "$TOKEN_NAME" "$TOKEN_AGENT" >&2
  printf '%s\n\n' "claude mcp add --transport http --scope user omnimind $MCP_PUBLIC_URL --header \"Authorization: Bearer $TOKEN\"" >&2
  if command -v claude >/dev/null 2>&1 && [ "$YES" -eq 1 ]; then
    log "claude CLI found and --yes given → registering the server for this user"
    if [ "$DRY_RUN" -eq 0 ]; then "${CLAUDE_ADD[@]}" || warn "claude mcp add failed — run the line above by hand"; fi
    note "First token" "minted + claude mcp add run" "$TOKEN_AGENT, scopes $GRANTABLE_SCOPES, $TOKEN_DAYS days"
  else
    note "First token" "minted" "$TOKEN_AGENT — run the printed 'claude mcp add' line"
  fi
fi

# =============================================================================
# 7. Verify (runbook §7)
# =============================================================================
step "7. Verification"
mcpjson() { sed -n '/^data: /{s/^data: //;p;d}; /^{/p'; }
V_FAILS=0
vfail() { warn "VERIFY FAIL: $1"; V_FAILS=$((V_FAILS + 1)); note "verify: $1" "FAIL" "$2"; }
vok()   { log "verify ok: $1"; note "verify: $1" "ok" "$2"; }
http() {  # http <METHOD> <url> [data] [headers…] → sets H_STATUS, H_HEADERS, H_BODY
  local method="$1" url="$2" data="$3"; shift 3
  local hf bf; hf="$(mktemp)"; bf="$(mktemp)"
  local args=(-sS -m 30 -X "$method" -D "$hf" -o "$bf" -w '%{http_code}')
  [ -n "$data" ] && args+=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$data")
  local h; for h in "$@"; do args+=(-H "$h"); done
  log "\$ curl -X $method $url"
  H_STATUS="$(curl "${args[@]}" "$url" || true)"
  H_HEADERS="$(cat "$hf")"; H_BODY="$(cat "$bf")"; rm -f "$hf" "$bf"
}
if [ "$DRY_RUN" -eq 1 ]; then
  log "would check: PRM (404 token-only / 200 OAuth), POST /mcp without token → 401 + WWW-Authenticate, initialize → mcp-session-id, tools/list → 20, DELETE session, GET /mcp/audit?tenantId=$FIRST_TENANT&limit=5"
  note "Verification" "dry-run" "7 checks planned"
else
  http GET "https://$MCP_HOST/.well-known/oauth-protected-resource" ""
  if [ -n "$OAUTH_ISSUER" ]; then
    if [ "$H_STATUS" = "200" ] && printf '%s' "$H_BODY" | grep -q "$MCP_PUBLIC_URL"; then vok "PRM" "200, resource=$MCP_PUBLIC_URL"; else vfail "PRM" "expected 200 with resource=$MCP_PUBLIC_URL, got $H_STATUS"; fi
  else
    if [ "$H_STATUS" = "404" ]; then vok "PRM" "404 (token-only mode)"; else vfail "PRM" "expected 404 in token-only mode, got $H_STATUS"; fi
  fi

  http POST "https://$MCP_HOST/mcp" '{}'
  if [ "$H_STATUS" = "401" ] && printf '%s' "$H_HEADERS" | grep -qi '^www-authenticate: *Bearer realm="omnimind-mcp"'; then
    vok "unauthenticated POST /mcp" "401 + WWW-Authenticate: Bearer realm=\"omnimind-mcp\""
  elif [ "$H_STATUS" = "403" ]; then
    vfail "unauthenticated POST /mcp" "403 — OMNIMIND_MCP_ALLOWED_HOSTS is wrong (got host $MCP_HOST)"
  else
    vfail "unauthenticated POST /mcp" "expected 401 with WWW-Authenticate, got $H_STATUS"
  fi

  if [ -n "$TOKEN" ]; then
    init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-go-live","version":"1"}}}'
    http POST "$MCP_PUBLIC_URL" "$init" "Authorization: Bearer $TOKEN"
    SID="$(printf '%s' "$H_HEADERS" | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')"
    server_name="$(printf '%s' "$H_BODY" | mcpjson | json_get 'd.result && d.result.serverInfo && d.result.serverInfo.name')"
    if [ "$H_STATUS" = "200" ] && [ -n "$SID" ] && [ "$server_name" = "omnimind-mcp" ]; then
      vok "initialize" "200, mcp-session-id issued, serverInfo.name=omnimind-mcp"
    elif [ "$H_STATUS" = "503" ]; then
      vfail "initialize" "503 auth_unavailable — OmniMind does not know the gateway key (runbook §1 Rotation) or is unreachable over $PRIVATE_API_URL"
    else
      vfail "initialize" "status $H_STATUS, session=${SID:-none}, server=${server_name:-?}"
    fi
    if [ -n "$SID" ]; then
      http POST "$MCP_PUBLIC_URL" '{"jsonrpc":"2.0","method":"notifications/initialized"}' "Authorization: Bearer $TOKEN" "mcp-session-id: $SID"
      http POST "$MCP_PUBLIC_URL" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' "Authorization: Bearer $TOKEN" "mcp-session-id: $SID"
      tools="$(printf '%s' "$H_BODY" | mcpjson | json_get 'd.result && d.result.tools && d.result.tools.length')"
      if [ "$tools" = "20" ]; then vok "tools/list" "20 tools"; else vfail "tools/list" "expected 20 tools, got ${tools:-none} (status $H_STATUS)"; fi
      http DELETE "$MCP_PUBLIC_URL" "" "Authorization: Bearer $TOKEN" "mcp-session-id: $SID"
      case "$H_STATUS" in 200|204) vok "DELETE session" "$H_STATUS" ;; *) vfail "DELETE session" "status $H_STATUS" ;; esac
    fi
    api GET "/mcp/audit?tenantId=$FIRST_TENANT&limit=5"
    seen="$(json_get "(d.entries||[]).some(e => e.agentId === $(json_escape "$TOKEN_AGENT"))" <<< "$API_BODY")"
    if [ "$seen" = "true" ]; then vok "audit attribution" "GET /mcp/audit shows agentId=$TOKEN_AGENT"; else vfail "audit attribution" "no row with agentId=$TOKEN_AGENT yet (status $API_STATUS) — tools/list may not be audited; run a tools/call and re-check"; fi
  else
    log "authenticated checks (initialize, tools/list, audit) skipped: no token minted (--no-token). Mint one in BoardRoom and run runbook §7b."
    note "verify: authenticated round trip" "skipped" "no token (--no-token); run runbook §7b after minting"
  fi
fi

# =============================================================================
# Summary
# =============================================================================
[ -z "$OAUTH_ISSUER" ] && manual "OAuth (runbook §9) — needed for ChatGPT and most Claude.ai organizations: pick a DCR-capable issuer, then re-run with --oauth-issuer <url>."
manual "Once the gateway is the only MCP writer: railway variable set OMNIMIND_REQUIRE_AGENT_KEY=true -s $API_SERVICE -e $ENVIRONMENT -p $PROJECT (Known Limitation 8)."
[ "$DRY_RUN" -eq 1 ] && manual "This was a dry run — nothing above was executed."

SUMMARY="$(
  printf '## MCP go-live summary (%s)\n\n' "$(date -u +%Y-%m-%dT%H:%MZ)"
  printf '| Item | Result | Detail |\n|---|---|---|\n'
  printf '%s\n' "${SUMMARY_ROWS[@]}"
  printf '\n**MCP URL:** `%s`  \n**OmniMind:** `%s`  \n**BoardRoom:** `%s`\n\n' "$MCP_PUBLIC_URL" "$API_URL" "$APP_URL"
  printf '### Still manual\n'
  printf '%s\n' "${MANUAL_ROWS[@]}"
)"
SUMMARY="$(redact "$SUMMARY")"
printf '\n%s\n' "$SUMMARY"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"; fi

if [ "$V_FAILS" -gt 0 ]; then
  warn "$V_FAILS verification check(s) failed — see the table"
  exit 3
fi
log "done."
