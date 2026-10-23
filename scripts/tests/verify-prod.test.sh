#!/usr/bin/env bash
# Unit test for scripts/verify-prod.sh against a local MOCK SERVER (no Railway,
# no internet). curl and the script are real; a small node HTTP server plays
# boardroom-ai, omnimind-api and omnimind-mcp on three loopback ports, and its
# answers are driven per scenario by a JSON config file. Same assertion style as
# scripts/tests/mcp-go-live.test.sh.
# Run: bash scripts/tests/verify-prod.test.sh
#
# Covers (Phase 8 M1-A1):
#   VP-01  all good, no OMNIMIND_API_KEY → exit 0; partial_agent_identity is SKIP
#          ("skipped"), never PASS; summary 9 passed / 0 failed / 1 skipped.
#   VP-02  all good with the secret → exit 0, the probe passes, the key is never
#          printed and is sent only to the omnimind-api host.
#   VP-03  SHA mismatch on one service → exit 1 after the timeout, names what it saw.
#   VP-04  the deploy lands mid-poll (old SHA twice, then the new one) → exit 0.
#   VP-05  bogus-token initialize answers 503 auth_unavailable → exit 1.
#   VP-06  /ready 503 → exit 1.
#   VP-07  /theme-init.js without CSP, or served as HTML → exit 1.
#   VP-08  unauthenticated POST /mcp without WWW-Authenticate, or 403 → exit 1.
#   VP-09  --dry-run lists every probe and makes zero requests.
#   VP-10  missing host variable / missing sha / bad flag → exit 2.
#   VP-11  version "dev" → FAIL with the RAILWAY_GIT_COMMIT_SHA hint.
#   VP-12  GitHub Actions: ::error:: per failure, table in GITHUB_STEP_SUMMARY.
#   VP-13  wrong API key → partial probe FAIL (401), key still not printed.
#   VP-14  the bogus omt_ token is never printed in full.
#   VP-15  an unreachable service → FAIL with HTTP 000, exit 1.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/../verify-prod.sh"
TMP="$(mktemp -d)"
MOCK_PID=""
cleanup() { [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

SHA_FIXTURE="0123456789abcdef0123456789abcdef01234567"
OLD_SHA_FIXTURE="fedcba9876543210fedcba9876543210fedcba98"
API_KEY_FIXTURE="sk-verify-SECRET-0001"
export CONFIG="$TMP/config.json" REQLOG="$TMP/requests.log" PORTS="$TMP/ports"

# ── Mock server: three roles on three loopback ports ─────────────────────────
cat > "$TMP/mock.cjs" <<'MOCK'
const http = require('http');
const fs = require('fs');
const { CONFIG, REQLOG, PORTS, API_KEY_FIXTURE } = process.env;
const load = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const save = (c) => fs.writeFileSync(CONFIG, JSON.stringify(c));
function handler(role) {
  return (req, res) => {
    let data = '';
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      const c = load();
      const url = new URL(req.url, 'http://x');
      const auth = req.headers.authorization || '';
      const key = req.headers['x-api-key'] || '';
      fs.appendFileSync(REQLOG, `${role} ${req.method} ${url.pathname}${url.search}` +
        `${auth ? ' auth=' + auth : ''}${key ? ' x-api-key=' + key : ''}` +
        `${req.headers['x-agent-id'] ? ' x-agent-id=' + req.headers['x-agent-id'] : ''}\n`);
      const json = (status, body, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
        res.end(JSON.stringify(body));
      };
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /health') {
        let version = c.versions[role];
        if ((c.stale[role] || 0) > 0) { c.stale[role] -= 1; save(c); version = c.oldSha; }
        return json(200, { status: 'ok', service: role, version });
      }
      if (route === 'GET /ready') {
        const s = c.ready[role];
        return json(s, { status: s === 200 ? 'ready' : 'not_ready', version: c.versions[role] });
      }
      if (role === 'boardroom-ai' && route === 'GET /theme-init.js') {
        const h = { 'content-type': c.theme.ct };
        if (c.theme.csp) h['content-security-policy'] = "default-src 'self'";
        res.writeHead(c.theme.status, h);
        return res.end(c.theme.ct.includes('html') ? '<!doctype html><title>BoardRoom</title>' : 'document.documentElement.dataset.theme="light";');
      }
      if (role === 'omnimind-mcp' && route === 'POST /mcp') {
        if (!auth) {
          if (c.mcpUnauth.status === 403) return json(403, { error: 'forbidden_host' });
          return json(c.mcpUnauth.status, { error: 'unauthorized' }, c.mcpUnauth.www ? { 'www-authenticate': 'Bearer realm="omnimind-mcp"' } : {});
        }
        if (c.bogus === 503) return json(503, { error: 'auth_unavailable', message: 'introspection failed' }, { 'retry-after': '5' });
        return json(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer realm="omnimind-mcp", error="invalid_token"' });
      }
      if (role === 'omnimind-api' && route === 'GET /memories') {
        if (key !== API_KEY_FIXTURE) return json(401, { error: 'Unauthorized' });
        if (req.headers['x-agent-id'] && !req.headers['x-tenant-id']) {
          return json(400, { error: 'partial_agent_identity', message: 'x-agent-id must be accompanied by x-tenant-id and x-source-weight', fields: ['x-tenant-id', 'x-source-weight'] });
        }
        return json(200, { items: [] });
      }
      return json(404, { error: 'mock: no route' });
    });
  };
}
const roles = ['boardroom-ai', 'omnimind-api', 'omnimind-mcp'];
const ports = [];
let up = 0;
for (const role of roles) {
  const s = http.createServer(handler(role));
  s.listen(0, '127.0.0.1', () => {
    ports[roles.indexOf(role)] = s.address().port;
    if (++up === roles.length) fs.writeFileSync(PORTS, ports.join(' ') + '\n');
  });
}
MOCK

reset_config() {  # reset_config [node expression that edits `c`]
  node -e '
    const c = { versions: { "boardroom-ai": process.argv[1], "omnimind-api": process.argv[1], "omnimind-mcp": process.argv[1] },
      oldSha: process.argv[2], stale: {}, ready: { "boardroom-ai": 200, "omnimind-api": 200, "omnimind-mcp": 200 },
      theme: { status: 200, ct: "application/javascript; charset=UTF-8", csp: true },
      mcpUnauth: { status: 401, www: true }, bogus: 401 };
    eval(process.argv[3] || "");
    require("fs").writeFileSync(process.env.CONFIG, JSON.stringify(c));' "$SHA_FIXTURE" "$OLD_SHA_FIXTURE" "${1:-}"
  : > "$REQLOG"
}

reset_config
API_KEY_FIXTURE="$API_KEY_FIXTURE" node "$TMP/mock.cjs" &
MOCK_PID=$!
for _ in $(seq 1 50); do [ -s "$PORTS" ] && break; sleep 0.1; done
[ -s "$PORTS" ] || { echo "mock server did not start"; exit 1; }
read -r P_APP P_API P_MCP < "$PORTS"
B_URL="http://127.0.0.1:$P_APP"; A_URL="http://127.0.0.1:$P_API"; M_URL="http://127.0.0.1:$P_MCP"

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; }
assert_eq()       { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "expected: $3"$'\n'"actual:   $2"; fi; }
assert_contains() { if printf '%s' "$2" | grep -qE -- "$3"; then ok "$1"; else fail "$1" "missing /$3/ in:"$'\n'"$(printf '%s' "$2" | tail -n 30)"; fi; }
assert_lacks()    { if printf '%s' "$2" | grep -qE -- "$3"; then fail "$1" "unexpected /$3/ in:"$'\n'"$(printf '%s' "$2" | grep -E -- "$3" | head -5)"; else ok "$1"; fi; }
assert_count()    { local n; n="$(printf '%s' "$2" | grep -cE -- "$3" || true)"; assert_eq "$1" "$n" "$4"; }

# run_verify [K=V…] -- <args…>: hosts + sha + a fast poll by default; sets RC / OUT / LOG.
run_verify() {
  local envs=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  set +e
  OUT="$(env -u OMNIMIND_API_KEY -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY -u GITHUB_SHA \
    BOARDROOM_HOST="$B_URL" OMNIMIND_API_HOST="$A_URL" OMNIMIND_MCP_HOST="$M_URL" EXPECTED_SHA="$SHA_FIXTURE" \
    VERIFY_TIMEOUT_S=2 VERIFY_INTERVAL_S=1 VERIFY_CURL_MAX_TIME=5 \
    "${envs[@]+"${envs[@]}"}" bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  set -e
  LOG="$(cat "$REQLOG")"
}

echo "# VP-01: all good, no OMNIMIND_API_KEY secret"
reset_config
run_verify
assert_eq       "exit 0" "$RC" "0"
assert_count    "three SHA rows pass" "$OUT" "^PASS  omnimind-(api|mcp) /health version == 0123456|^PASS  boardroom-ai /health version == 0123456" "3"
assert_count    "three /ready rows pass" "$OUT" '^PASS  [a-z-]+ /ready — 200$' "3"
assert_contains "theme-init passes" "$OUT" '^PASS  boardroom-ai /theme-init.js — 200, application/javascript; charset=UTF-8, CSP present$'
assert_contains "unauthenticated POST /mcp passes" "$OUT" '^PASS  omnimind-mcp unauthenticated POST /mcp — 401 \+ WWW-Authenticate: Bearer realm="omnimind-mcp"$'
assert_contains "bogus token passes" "$OUT" '^PASS  omnimind-mcp bogus-token initialize — 401 invalid_token'
assert_contains "partial probe reported as skipped" "$OUT" '^SKIP  omnimind-api partial_agent_identity — skipped: no OMNIMIND_API_KEY Actions secret \(not verified\)$'
assert_lacks    "partial probe never PASS without the secret" "$OUT" '^PASS  omnimind-api partial_agent_identity'
assert_contains "summary counts the skip separately" "$OUT" '^verify-prod: 9 passed, 0 failed, 1 skipped \(sha 0123456\)$'
assert_lacks    "no request to /memories without the secret" "$LOG" '/memories'
assert_lacks    "no x-api-key sent anywhere" "$LOG" 'x-api-key='
assert_lacks    "nothing written (only GET + MCP POST)" "$LOG" ' (PUT|PATCH|DELETE) '

echo "# VP-02: all good with the secret"
reset_config
run_verify OMNIMIND_API_KEY="$API_KEY_FIXTURE"
assert_eq       "exit 0" "$RC" "0"
assert_contains "partial probe passes" "$OUT" '^PASS  omnimind-api partial_agent_identity — 400 partial_agent_identity'
assert_contains "summary 10 passed" "$OUT" '^verify-prod: 10 passed, 0 failed, 0 skipped'
assert_lacks    "the API key is never printed" "$OUT" "$API_KEY_FIXTURE"
assert_contains "the probe sent x-agent-id alone" "$LOG" "^omnimind-api GET /memories\?limit=1 x-api-key=$API_KEY_FIXTURE x-agent-id=verify-prod-probe$"
assert_lacks    "the key goes to no other host" "$LOG" "^(boardroom-ai|omnimind-mcp) .*x-api-key="
assert_lacks    "the key never goes on curl's command line (header file only)" "$(cat "$SCRIPT")" "-H [\"']x-api-key"

echo "# VP-03: SHA mismatch"
reset_config 'c.versions["omnimind-mcp"] = c.oldSha;'
run_verify
assert_eq       "exit 1" "$RC" "1"
assert_contains "the MCP SHA row fails with what it saw" "$OUT" '^FAIL  omnimind-mcp /health version == 0123456 — after 2s still HTTP 200, version fedcba9876543210fedcba9876543210fedcba98$'
assert_contains "the others pass" "$OUT" '^PASS  omnimind-api /health version == 0123456'
assert_contains "it polled while waiting" "$OUT" 'waiting: omnimind-mcp \(HTTP 200, version fedcba'
assert_contains "summary has the failure" "$OUT" '^verify-prod: 8 passed, 1 failed, 1 skipped'
reset_config
run_verify -- --sha "$OLD_SHA_FIXTURE"
assert_eq       "--sha overrides EXPECTED_SHA (nothing is on it → exit 1)" "$RC" "1"
assert_count    "all three SHA rows fail" "$OUT" '^FAIL  [a-z-]+ /health version == fedcba9' "3"

echo "# VP-04: the deploy lands mid-poll"
reset_config 'c.stale["omnimind-api"] = 2;'
run_verify VERIFY_TIMEOUT_S=10
assert_eq       "exit 0" "$RC" "0"
assert_count    "api /health polled three times" "$LOG" '^omnimind-api GET /health$' "3"
assert_count    "boardroom /health polled once (already on the sha)" "$LOG" '^boardroom-ai GET /health$' "1"
assert_contains "reports when it landed" "$OUT" '^  omnimind-api is on 0123456 \([0-9]+s\)$'

echo "# VP-05: bogus-token initialize → 503 auth_unavailable"
reset_config 'c.bogus = 503;'
run_verify
assert_eq       "exit 1" "$RC" "1"
assert_contains "FAIL row explains the broken chain" "$OUT" '^FAIL  omnimind-mcp bogus-token initialize — 503 auth_unavailable — introspection failed: OmniMind does not know OMNIMIND_MCP_AGENT_KEY'

echo "# VP-06: /ready 503"
reset_config 'c.ready["omnimind-api"] = 503;'
run_verify
assert_eq       "exit 1" "$RC" "1"
assert_contains "FAIL row with status and body" "$OUT" '^FAIL  omnimind-api /ready — expected 200, got 503 \{"status":"not_ready"'

echo "# VP-07: /theme-init.js"
reset_config 'c.theme.csp = false;'
run_verify
assert_eq       "no CSP → exit 1" "$RC" "1"
assert_contains "says CSP is missing" "$OUT" '^FAIL  boardroom-ai /theme-init.js — no Content-Security-Policy header$'
reset_config 'c.theme.ct = "text/html; charset=UTF-8";'
run_verify
assert_eq       "HTML (SPA fallback) → exit 1" "$RC" "1"
assert_contains "says the content type is wrong" "$OUT" "^FAIL  boardroom-ai /theme-init.js — content-type 'text/html; charset=UTF-8' is not JavaScript \(SPA fallback\?\)"

echo "# VP-08: unauthenticated POST /mcp"
reset_config 'c.mcpUnauth.www = false;'
run_verify
assert_eq       "401 without WWW-Authenticate → exit 1" "$RC" "1"
assert_contains "says the header is missing" "$OUT" '^FAIL  omnimind-mcp unauthenticated POST /mcp — expected 401 with WWW-Authenticate, got 401 \(no WWW-Authenticate\)$'
reset_config 'c.mcpUnauth.status = 403;'
run_verify
assert_eq       "403 → exit 1" "$RC" "1"
assert_contains "names OMNIMIND_MCP_ALLOWED_HOSTS" "$OUT" '403 — OMNIMIND_MCP_ALLOWED_HOSTS'

echo "# VP-09: --dry-run"
reset_config
run_verify -- --dry-run
assert_eq       "exit 0" "$RC" "0"
assert_eq       "zero requests" "$LOG" ""
assert_contains "lists the SHA poll" "$OUT" "boardroom-ai  GET $B_URL/health → version == sha"
assert_contains "lists /ready ×3" "$OUT" "omnimind-mcp  GET $M_URL/ready → 200"
assert_contains "lists theme-init" "$OUT" '/theme-init.js → 200, JavaScript content type, Content-Security-Policy header'
assert_contains "lists the unauthenticated probe" "$OUT" '/mcp without a credential → 401 \+ WWW-Authenticate'
assert_contains "lists the bogus-token probe" "$OUT" 'bogus omt_ token → 401 invalid_token \(503 auth_unavailable = FAIL\)'
assert_contains "says the partial probe will be skipped" "$OUT" 'no OMNIMIND_API_KEY: will be SKIPPED, never passed'
set +e
DRY_OUT="$(env -i PATH="$PATH" bash "$SCRIPT" --dry-run 2>&1)"; DRY_RC=$?
set -e
assert_eq       "dry run works with no configuration at all" "$DRY_RC" "0"
assert_contains "and shows what is unset" "$DRY_OUT" '<OMNIMIND_MCP_HOST unset>/health'

echo "# VP-10: configuration errors"
reset_config
run_verify OMNIMIND_MCP_HOST=
assert_eq       "missing MCP host → exit 2" "$RC" "2"
assert_contains "names the repo variable" "$OUT" 'OMNIMIND_MCP_HOST is not set \(repo variable'
assert_eq       "no request made" "$LOG" ""
run_verify EXPECTED_SHA=
assert_eq       "missing sha → exit 2" "$RC" "2"
assert_contains "says where the sha comes from" "$OUT" 'no expected sha \(--sha, EXPECTED_SHA or GITHUB_SHA\)'
run_verify -- --bogus
assert_eq       "unknown flag → exit 2" "$RC" "2"
run_verify VERIFY_TIMEOUT_S=soon
assert_eq       "non-numeric timeout → exit 2" "$RC" "2"
run_verify EXPECTED_SHA= GITHUB_SHA="$SHA_FIXTURE"
assert_eq       "GITHUB_SHA is the fallback" "$RC" "0"

echo "# VP-11: version dev (RAILWAY_GIT_COMMIT_SHA unset)"
reset_config 'c.versions["boardroom-ai"] = "dev";'
run_verify
assert_eq       "exit 1" "$RC" "1"
assert_contains "hints at RAILWAY_GIT_COMMIT_SHA" "$OUT" '^FAIL  boardroom-ai /health version == 0123456 — after 2s still HTTP 200, version dev — RAILWAY_GIT_COMMIT_SHA is not set'

echo "# VP-12: GitHub Actions output"
reset_config 'c.bogus = 503;'
: > "$TMP/summary.md"
run_verify GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$TMP/summary.md"
SUMMARY="$(cat "$TMP/summary.md")"
assert_eq       "exit 1" "$RC" "1"
assert_contains "::error:: for the failure" "$OUT" '^::error title=verify-prod::omnimind-mcp bogus-token initialize — 503'
assert_count    "only failures become ::error::" "$OUT" '^::error' "1"
assert_contains "summary heading with the short sha" "$SUMMARY" '^### Post-deploy verify — `0123456`$'
assert_contains "summary counts" "$SUMMARY" '^\*\*8 passed, 1 failed, 1 skipped\.\*\* Skipped probes were not verified\.$'
assert_contains "summary row for the skip" "$SUMMARY" '^\| SKIP \| omnimind-api partial_agent_identity \| skipped: no OMNIMIND_API_KEY'
assert_contains "summary row for the failure" "$SUMMARY" '^\| FAIL \| omnimind-mcp bogus-token initialize \| 503'

echo "# VP-13: wrong API key"
reset_config
run_verify OMNIMIND_API_KEY=sk-wrong-SECRET-0009
assert_eq       "exit 1" "$RC" "1"
assert_contains "says the secret does not match" "$OUT" '^FAIL  omnimind-api partial_agent_identity — 401 — the OMNIMIND_API_KEY Actions secret does not match'
assert_lacks    "the wrong key is not printed either" "$OUT" 'sk-wrong-SECRET-0009'

echo "# VP-14: the bogus token stays out of the output"
reset_config
run_verify
BOGUS_SENT="$(printf '%s\n' "$LOG" | sed -n 's/^omnimind-mcp POST \/mcp auth=Bearer \(omt_[A-Za-z0-9_-]*\)$/\1/p' | head -1)"
assert_eq       "a 47-char omt_ token was sent" "${#BOGUS_SENT}" "47"
assert_lacks    "it is not printed" "$OUT" "${BOGUS_SENT:-omt_never}"
assert_count    "exactly one unauthenticated and one bogus-token POST" "$LOG" '^omnimind-mcp POST /mcp' "2"

echo "# VP-15: unreachable service"
reset_config
run_verify OMNIMIND_API_HOST=http://127.0.0.1:9
assert_eq       "exit 1" "$RC" "1"
assert_contains "SHA row says nothing answered" "$OUT" '^FAIL  omnimind-api /health version == 0123456 — after 2s still HTTP 000, version <none> — no answer from http://127.0.0.1:9'
assert_contains "/ready row has status 000" "$OUT" '^FAIL  omnimind-api /ready — expected 200, got 000'

echo
echo "verify-prod.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
