#!/usr/bin/env bash
# verify-prod.sh — post-deploy verification of the three Railway services
# (Phase 8 M1-A1). Run automatically by .github/workflows/post-deploy-verify.yml
# after CI succeeds on main; also runnable from a laptop.
#
# 1. SHA poll: GET <service>/health on boardroom-ai, omnimind-api and
#    omnimind-mcp until each reports `version == <expected sha>` (the services
#    read RAILWAY_GIT_COMMIT_SHA, M0-A2). Default timeout 15 min.
# 2. Read-only probes (nothing is written anywhere):
#      - GET /ready → 200 on all three services
#      - boardroom-ai GET /theme-init.js → 200, a JavaScript content type, and a
#        Content-Security-Policy header
#      - omnimind-mcp POST /mcp with no credential → 401 + WWW-Authenticate
#      - omnimind-mcp initialize with a syntactically valid but unknown omt_
#        token → 401 invalid_token (503 auth_unavailable is a FAILURE: the
#        gateway key or the private OmniMind URL is broken, so every real
#        client would fail too)
#      - omnimind-api x-agent-id without the rest of the identity triple →
#        400 partial_agent_identity. Needs OMNIMIND_API_KEY; without it the
#        probe is reported as SKIP, never as passed.
#    The authenticated read-burst probe is deliberately not here; it stays a
#    founder smoke (Phase 8 decision ledger).
#
# Usage:
#   scripts/verify-prod.sh [--sha <commit>] [--dry-run]
#                          [--boardroom-host <h>] [--api-host <h>] [--mcp-host <h>]
#                          [--timeout <s>] [--interval <s>]
#
# Inputs (flags win over env):
#   BOARDROOM_HOST, OMNIMIND_API_HOST, OMNIMIND_MCP_HOST
#       Public host of each service (repo variables in Actions). A bare host
#       means https://<host>; a value with a scheme is used as-is.
#   EXPECTED_SHA (falls back to GITHUB_SHA)   commit every /health must report
#   OMNIMIND_API_KEY      optional; enables the partial_agent_identity probe.
#                         Sent from a 0600 header file, never on the command
#                         line, never printed.
#   VERIFY_TIMEOUT_S (900), VERIFY_INTERVAL_S (15), VERIFY_CURL_MAX_TIME (10)
#
# Exit: 0 every probe that ran passed · 1 a probe failed (SHA timeout included)
#       · 2 usage or configuration error (missing host / sha).
# In GitHub Actions a failure is also emitted as ::error:: and the result table
# is appended to $GITHUB_STEP_SUMMARY.
set -uo pipefail

usage() { sed -n '/^# Usage:/,/^# Exit:/p' "$0" | sed 's/^# \{0,1\}//'; }

DRY_RUN=0
SHA="${EXPECTED_SHA:-${GITHUB_SHA:-}}"
B_HOST="${BOARDROOM_HOST:-}"
A_HOST="${OMNIMIND_API_HOST:-}"
M_HOST="${OMNIMIND_MCP_HOST:-}"
TIMEOUT_S="${VERIFY_TIMEOUT_S:-900}"
INTERVAL_S="${VERIFY_INTERVAL_S:-15}"
CURL_MAX_TIME="${VERIFY_CURL_MAX_TIME:-10}"

need_val() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "verify-prod: $1 needs a value" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --sha) need_val "$@"; SHA="$2"; shift 2 ;;
    --boardroom-host) need_val "$@"; B_HOST="$2"; shift 2 ;;
    --api-host) need_val "$@"; A_HOST="$2"; shift 2 ;;
    --mcp-host) need_val "$@"; M_HOST="$2"; shift 2 ;;
    --timeout) need_val "$@"; TIMEOUT_S="$2"; shift 2 ;;
    --interval) need_val "$@"; INTERVAL_S="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "verify-prod: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
for n in TIMEOUT_S INTERVAL_S CURL_MAX_TIME; do
  case "${!n}" in ''|*[!0-9]*) echo "verify-prod: $n must be a whole number of seconds, got '${!n}'" >&2; exit 2 ;; esac
done

origin_of() {  # bare host → https://host; a URL keeps its scheme; no trailing slash
  local v="${1%/}"
  case "$v" in http://*|https://*) printf '%s' "$v" ;; '') printf '' ;; *) printf 'https://%s' "$v" ;; esac
}
SVC_NAMES=(boardroom-ai omnimind-api omnimind-mcp)
SVC_VARS=(BOARDROOM_HOST OMNIMIND_API_HOST OMNIMIND_MCP_HOST)
SVC_ORIGINS=("$(origin_of "$B_HOST")" "$(origin_of "$A_HOST")" "$(origin_of "$M_HOST")")
B_ORIGIN="${SVC_ORIGINS[0]}"; A_ORIGIN="${SVC_ORIGINS[1]}"; M_ORIGIN="${SVC_ORIGINS[2]}"
HAS_KEY=0; [ -n "${OMNIMIND_API_KEY:-}" ] && HAS_KEY=1

# ── Dry run: the plan, no network ────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  show() { [ -n "$1" ] && printf '%s' "$1" || printf '<%s unset>' "$2"; }
  b="$(show "$B_ORIGIN" BOARDROOM_HOST)"; a="$(show "$A_ORIGIN" OMNIMIND_API_HOST)"; m="$(show "$M_ORIGIN" OMNIMIND_MCP_HOST)"
  cat <<PLAN
verify-prod dry run — no requests are made.
expected sha: ${SHA:-<EXPECTED_SHA / GITHUB_SHA unset>}
SHA poll (every ${INTERVAL_S}s, timeout ${TIMEOUT_S}s):
  1. boardroom-ai  GET $b/health → version == sha
  2. omnimind-api  GET $a/health → version == sha
  3. omnimind-mcp  GET $m/health → version == sha
Read-only probes:
  4. boardroom-ai  GET $b/ready → 200
  5. omnimind-api  GET $a/ready → 200
  6. omnimind-mcp  GET $m/ready → 200
  7. boardroom-ai  GET $b/theme-init.js → 200, JavaScript content type, Content-Security-Policy header
  8. omnimind-mcp  POST $m/mcp without a credential → 401 + WWW-Authenticate
  9. omnimind-mcp  POST $m/mcp initialize with a bogus omt_ token → 401 invalid_token (503 auth_unavailable = FAIL)
 10. omnimind-api  GET $a/memories with x-agent-id only → 400 partial_agent_identity ($([ "$HAS_KEY" -eq 1 ] && echo 'OMNIMIND_API_KEY set: will run' || echo 'no OMNIMIND_API_KEY: will be SKIPPED, never passed'))
Not probed: the authenticated read burst (founder smoke).
PLAN
  exit 0
fi

# ── Configuration checks ─────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || { echo "verify-prod: curl is required" >&2; exit 2; }
cfg_err=0
for i in 0 1 2; do
  if [ -z "${SVC_ORIGINS[$i]}" ]; then
    echo "verify-prod: ${SVC_VARS[$i]} is not set (repo variable: Settings → Secrets and variables → Actions → Variables, or --$( [ "$i" = 0 ] && echo boardroom || { [ "$i" = 1 ] && echo api || echo mcp; })-host)" >&2
    cfg_err=1
  fi
done
if [ -z "$SHA" ]; then echo "verify-prod: no expected sha (--sha, EXPECTED_SHA or GITHUB_SHA)" >&2; cfg_err=1; fi
[ "$cfg_err" -eq 0 ] || exit 2
SHORT="${SHA:0:7}"

# ── Output helpers ───────────────────────────────────────────────────────────
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
redact() {  # tokens and the API key never reach the log
  local out="$1"
  if [ -n "${OMNIMIND_API_KEY:-}" ]; then out="${out//"$OMNIMIND_API_KEY"/<redacted>}"; fi
  printf '%s' "$out" | sed -E 's/(om[tk]_)[A-Za-z0-9_-]+/\1<redacted>/g'
}
snip() { redact "$(printf '%s' "$1" | tr -d '\r' | tr '\n' ' ' | cut -c1-160)"; }
R_STATUS=(); R_NAME=(); R_DETAIL=()
record() {  # record PASS|FAIL|SKIP <name> <detail>
  local d; d="$(redact "$3")"
  R_STATUS+=("$1"); R_NAME+=("$2"); R_DETAIL+=("$d")
  printf '%-4s  %s — %s\n' "$1" "$2" "$d"
  if [ "$1" = FAIL ] && [ -n "${GITHUB_ACTIONS:-}" ]; then printf '::error title=verify-prod::%s — %s\n' "$2" "$d"; fi
}

http() {  # http <METHOD> <url> [--data <json>] [--header-file <f>] [header…] → H_STATUS H_HEADERS H_BODY
  local method="$1" url="$2"; shift 2
  local args=(-sS -m "$CURL_MAX_TIME" -X "$method" -D "$TMPD/h" -o "$TMPD/b" -w '%{http_code}')
  while [ $# -gt 0 ]; do
    case "$1" in
      --data) args+=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream' --data "$2"); shift 2 ;;
      --header-file) args+=(-H "@$2"); shift 2 ;;
      *) args+=(-H "$1"); shift ;;
    esac
  done
  : > "$TMPD/h"; : > "$TMPD/b"
  H_STATUS="$(curl "${args[@]}" "$url" 2>/dev/null || true)"
  [ -n "$H_STATUS" ] || H_STATUS=000
  H_HEADERS="$(tr -d '\r' < "$TMPD/h")"; H_BODY="$(cat "$TMPD/b")"
}
header() { printf '%s\n' "$H_HEADERS" | grep -i "^$1:" | tail -1 | sed -E 's/^[^:]+:[[:space:]]*//'; }
json_str() { printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
sha_matches() {  # exact, or one is a ≥7-char prefix of the other (a short --sha)
  local v="$1"
  [ -n "$v" ] || return 1
  [ "$v" = "$SHA" ] && return 0
  [ "${#SHA}" -ge 7 ] && [ "${#v}" -ge 7 ] && { [ "${v#"$SHA"}" != "$v" ] || [ "${SHA#"$v"}" != "$SHA" ]; }
}

echo "verify-prod: expecting $SHORT on ${SVC_NAMES[*]} (timeout ${TIMEOUT_S}s, every ${INTERVAL_S}s)"

# ── 1. SHA poll ──────────────────────────────────────────────────────────────
MATCHED=(0 0 0); SEEN=("" "" "")
start=$SECONDS; deadline=$((SECONDS + TIMEOUT_S))
while :; do
  all=1
  for i in 0 1 2; do
    [ "${MATCHED[$i]}" -eq 1 ] && continue
    http GET "${SVC_ORIGINS[$i]}/health"
    v="$(json_str version "$H_BODY")"
    SEEN[$i]="HTTP $H_STATUS, version ${v:-<none>}"
    if [ "$H_STATUS" = 200 ] && sha_matches "$v"; then
      MATCHED[$i]=1
      echo "  ${SVC_NAMES[$i]} is on $SHORT ($((SECONDS - start))s)"
    else
      all=0
    fi
  done
  [ "$all" -eq 1 ] && break
  [ "$SECONDS" -ge "$deadline" ] && break
  waiting=""; for i in 0 1 2; do [ "${MATCHED[$i]}" -eq 1 ] || waiting="$waiting ${SVC_NAMES[$i]} (${SEEN[$i]});"; done
  echo "  waiting:$waiting"
  sleep "$INTERVAL_S"
done
for i in 0 1 2; do
  name="${SVC_NAMES[$i]} /health version == $SHORT"
  if [ "${MATCHED[$i]}" -eq 1 ]; then
    record PASS "$name" "deployed"
  else
    hint=""
    case "${SEEN[$i]}" in
      *"version dev") hint=" — RAILWAY_GIT_COMMIT_SHA is not set: is the service deployed from the GitHub repo?" ;;
      "HTTP 000"*) hint=" — no answer from ${SVC_ORIGINS[$i]} (DNS, TLS or the service is down)" ;;
    esac
    record FAIL "$name" "after ${TIMEOUT_S}s still ${SEEN[$i]}${hint}"
  fi
done

# ── 2. Readiness ─────────────────────────────────────────────────────────────
for i in 0 1 2; do
  http GET "${SVC_ORIGINS[$i]}/ready"
  if [ "$H_STATUS" = 200 ]; then record PASS "${SVC_NAMES[$i]} /ready" "200"
  else record FAIL "${SVC_NAMES[$i]} /ready" "expected 200, got $H_STATUS $(snip "$H_BODY")"; fi
done

# ── 3. BoardRoom serves /theme-init.js under CSP ─────────────────────────────
http GET "$B_ORIGIN/theme-init.js"
ct="$(header content-type)"; csp="$(header content-security-policy)"
if [ "$H_STATUS" = 200 ] && printf '%s' "$ct" | grep -qi 'javascript' && [ -n "$csp" ]; then
  record PASS "boardroom-ai /theme-init.js" "200, $ct, CSP present"
else
  why=()
  [ "$H_STATUS" = 200 ] || why+=("status $H_STATUS")
  printf '%s' "$ct" | grep -qi 'javascript' || why+=("content-type '${ct:-none}' is not JavaScript (SPA fallback?)")
  [ -n "$csp" ] || why+=("no Content-Security-Policy header")
  reason="${why[0]}"; for w in "${why[@]:1}"; do reason="$reason · $w"; done
  record FAIL "boardroom-ai /theme-init.js" "$reason"
fi

# ── 4. MCP refuses an unauthenticated request ────────────────────────────────
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-prod","version":"1"}}}'
http POST "$M_ORIGIN/mcp" --data "$INIT"
www="$(header www-authenticate)"
if [ "$H_STATUS" = 401 ] && [ -n "$www" ]; then
  record PASS "omnimind-mcp unauthenticated POST /mcp" "401 + WWW-Authenticate: $(printf '%s' "$www" | cut -c1-80)"
elif [ "$H_STATUS" = 403 ]; then
  record FAIL "omnimind-mcp unauthenticated POST /mcp" "403 — OMNIMIND_MCP_ALLOWED_HOSTS does not include the public host"
else
  if [ -n "$www" ]; then got="$H_STATUS (WWW-Authenticate present)"; else got="$H_STATUS (no WWW-Authenticate)"; fi
  record FAIL "omnimind-mcp unauthenticated POST /mcp" "expected 401 with WWW-Authenticate, got $got"
fi

# ── 5. MCP introspects a bogus omt_ token through the gateway key ────────────
# BoardRoom's token shape: omt_ + 43 base64url chars. Unknown to OmniMind, so a
# healthy chain answers 401 invalid_token; 503 auth_unavailable means the
# gateway key is unknown to OmniMind or OmniMind is unreachable from the MCP.
BOGUS="omt_$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' | cut -c1-43)"
printf 'authorization: Bearer %s\n' "$BOGUS" > "$TMPD/bogus.hdr"
http POST "$M_ORIGIN/mcp" --data "$INIT" --header-file "$TMPD/bogus.hdr"
err="$(json_str error "$H_BODY")"
if [ "$H_STATUS" = 401 ] && [ "$err" = invalid_token ]; then
  record PASS "omnimind-mcp bogus-token initialize" "401 invalid_token (introspection through the gateway key works)"
elif [ "$H_STATUS" = 503 ]; then
  record FAIL "omnimind-mcp bogus-token initialize" "503 ${err:-?} — introspection failed: OmniMind does not know OMNIMIND_MCP_AGENT_KEY (runbook §1 Rotation) or the MCP cannot reach OMNIMIND_API_URL; every real client fails the same way"
else
  record FAIL "omnimind-mcp bogus-token initialize" "expected 401 invalid_token, got $H_STATUS $(snip "$H_BODY")"
fi

# ── 6. OmniMind refuses a partial agent identity (needs the service key) ─────
if [ "$HAS_KEY" -eq 1 ]; then
  ( umask 077; printf 'x-api-key: %s\n' "$OMNIMIND_API_KEY" > "$TMPD/key.hdr" )
  http GET "$A_ORIGIN/memories?limit=1" --header-file "$TMPD/key.hdr" 'x-agent-id: verify-prod-probe'
  rm -f "$TMPD/key.hdr"
  err="$(json_str error "$H_BODY")"
  if [ "$H_STATUS" = 400 ] && [ "$err" = partial_agent_identity ]; then
    record PASS "omnimind-api partial_agent_identity" "400 partial_agent_identity (x-agent-id alone is refused, never served unscoped)"
  elif [ "$H_STATUS" = 401 ]; then
    record FAIL "omnimind-api partial_agent_identity" "401 — the OMNIMIND_API_KEY Actions secret does not match the API's key (rotated?)"
  else
    record FAIL "omnimind-api partial_agent_identity" "expected 400 partial_agent_identity, got $H_STATUS $(snip "$H_BODY")"
  fi
else
  record SKIP "omnimind-api partial_agent_identity" "skipped: no OMNIMIND_API_KEY Actions secret (not verified)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
pass=0; fail=0; skip=0
for s in "${R_STATUS[@]}"; do case "$s" in PASS) pass=$((pass + 1)) ;; FAIL) fail=$((fail + 1)) ;; SKIP) skip=$((skip + 1)) ;; esac; done
echo
echo "verify-prod: ${pass} passed, ${fail} failed, ${skip} skipped (sha $SHORT)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Post-deploy verify — \`$SHORT\`"
    echo
    echo "**${pass} passed, ${fail} failed, ${skip} skipped.** Skipped probes were not verified."
    echo
    echo "| Result | Probe | Detail |"
    echo "|---|---|---|"
    for i in "${!R_STATUS[@]}"; do
      printf '| %s | %s | %s |\n' "${R_STATUS[$i]}" "${R_NAME[$i]}" "$(printf '%s' "${R_DETAIL[$i]}" | sed 's/|/\\|/g')"
    done
  } >> "$GITHUB_STEP_SUMMARY"
fi
[ "$fail" -eq 0 ]
