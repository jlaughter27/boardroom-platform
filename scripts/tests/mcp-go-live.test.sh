#!/usr/bin/env bash
# Unit test for scripts/mcp-go-live.sh with railway / curl / openssl / claude
# stubbed on PATH. No Railway account, no network. node is REAL (the script uses
# it for JSON parsing and SHA-256, the same way restore-drill relies on bash).
# Run: bash scripts/tests/mcp-go-live.test.sh
#
# Covers:
#   GL-01  fresh run (--yes): the full call sequence in runbook order, the admin
#          key generated + waited for, the gateway agent created with the scope
#          ceiling, only the unowned tenant patched, the MCP service created,
#          variables / domain / up, BoardRoom variables, the token minted and
#          `claude mcp add` run, all seven verification checks green, secrets
#          redacted everywhere except the two sanctioned lines.
#   GL-02  re-run is idempotent: nothing created twice, gateway key reused from
#          the MCP service's variables, no tenant PATCH.
#   GL-03  409 on POST /mcp/agents: continues with --gateway-key / env, fails
#          with the rotation help otherwise.
#   GL-04  --no-token: no token minted, no claude call, summary points at Settings.
#   GL-05  --dry-run: zero railway / curl / claude calls, plan printed.
#   GL-06  e-mail that resolves to no user → asks for --owner-user-id.
#   GL-07  GitHub Actions mode: ::add-mask:: emitted, admin key never printed,
#          project-token mode skips whoami/link, summary lands in GITHUB_STEP_SUMMARY.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/../mcp-go-live.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STUBS="$TMP/bin"; mkdir -p "$STUBS"
export STUB_LOG="$TMP/stub.log"
export STUB_STATE="$TMP/state"

# ── Fixtures (reset per scenario by reset_state) ─────────────────────────────
API_KEY_FIXTURE="sk-api-SECRET-0001"
ANTHROPIC_FIXTURE="sk-ant-SECRET-0002"
ADMIN_KEY_FIXTURE="$(printf '1%.0s' $(seq 1 64))"     # first openssl rand → admin key
GATEWAY_HEX_FIXTURE="$(printf '2%.0s' $(seq 1 64))"   # second openssl rand → gateway key
GATEWAY_KEY_FIXTURE="omk_$GATEWAY_HEX_FIXTURE"
TOKEN_FIXTURE="omt_TESTTOKEN0123456789abcdefghijklmnopqrstuvwxyz"
TOKEN_AGENT_FIXTURE="mcp-token:claude-code-laptop-a1b2c3d4"

reset_state() {
  rm -rf "$STUB_STATE"; mkdir -p "$STUB_STATE"
  printf '{"OMNIMIND_API_KEY":"%s","ANTHROPIC_API_KEY":"%s","DATABASE_URL":"postgres://x"}' "$API_KEY_FIXTURE" "$ANTHROPIC_FIXTURE" > "$STUB_STATE/vars-omnimind-api.json"
  printf '{"JWT_SECRET":"jwt-SECRET","OMNIMIND_API_KEY":"%s"}' "$API_KEY_FIXTURE" > "$STUB_STATE/vars-boardroom-ai.json"
  printf '[{"id":"svc_api","name":"omnimind-api"},{"id":"svc_app","name":"boardroom-ai"}]' > "$STUB_STATE/services.json"
  printf '{"tenants":[{"id":"josh-business","name":"Josh Business","ownerUserId":null},{"id":"josh-personal","name":"Josh Personal","ownerUserId":"user_123"},{"id":"tgfc-ministry","name":"TGFC","ownerUserId":"user_other"}]}' > "$STUB_STATE/tenants.json"
  printf '{"agents":[],"count":0}' > "$STUB_STATE/agents.json"
  printf '1' > "$STUB_STATE/admin503.remaining"   # the API answers 503 once before the redeploy "lands"
  printf '0' > "$STUB_STATE/openssl.count"
  : > "$STUB_LOG"
}

# ── Stubs ────────────────────────────────────────────────────────────────────
cat > "$STUBS/railway" <<'STUB'
#!/usr/bin/env bash
echo "railway $*" >> "$STUB_LOG"
cmd="${1:-}"; shift || true
args=("$@"); svc=""
for ((i=0;i<${#args[@]};i++)); do case "${args[i]}" in -s|--service) svc="${args[i+1]:-}";; esac; done
merge_json() { # merge_json <file> KEY=VALUE…
  node -e 'const fs=require("fs");const f=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
    for(const kv of process.argv.slice(2)){const i=kv.indexOf("=");d[kv.slice(0,i)]=kv.slice(i+1)}fs.writeFileSync(f,JSON.stringify(d))' "$@"
}
case "$cmd" in
  --version) echo "railway 5.71.0" ;;
  whoami) echo "Logged in as Josh (josh@example.com)" ;;
  link) echo "Project linked" ;;
  status) echo '{"name":"boardroom-platform"}' ;;
  service) cat "$STUB_STATE/services.json" ;;   # service list … --json
  add)
    name=""; for ((i=0;i<${#args[@]};i++)); do case "${args[i]}" in --service) name="${args[i+1]}";; esac; done
    node -e 'const fs=require("fs");const f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,"utf8"));d.push({id:"svc_new",name:process.argv[2]});fs.writeFileSync(f,JSON.stringify(d))' "$STUB_STATE/services.json" "$name"
    [ -f "$STUB_STATE/vars-$name.json" ] || printf '{}' > "$STUB_STATE/vars-$name.json"
    printf '{"id":"svc_new","name":"%s"}\n' "$name" ;;
  variable)
    sub="${args[0]:-}"
    case "$sub" in
      list) cat "$STUB_STATE/vars-$svc.json" ;;
      set)
        kvs=(); for a in "${args[@]:1}"; do case "$a" in [A-Z_]*=*) kvs+=("$a");; esac; done
        merge_json "$STUB_STATE/vars-$svc.json" "${kvs[@]}"
        node -e 'process.stdout.write(JSON.stringify({keys:process.argv.slice(1).map(k=>k.split("=")[0]),set:true})+"\n")' "${kvs[@]}" ;;
      *) echo "unexpected variable subcommand: $sub" >&2; exit 9 ;;
    esac ;;
  domain)
    case "$svc" in
      omnimind-api)  echo '{"domains":["https://omnimind-api-production.up.railway.app"]}' ;;
      boardroom-ai)  echo '{"domains":["https://boardroom-ai-production-1092.up.railway.app"]}' ;;
      omnimind-mcp)
        if [ -f "$STUB_STATE/mcp-domain" ]; then echo '{"domains":["https://omnimind-mcp-production.up.railway.app"]}'
        else touch "$STUB_STATE/mcp-domain"; echo '{"domain":"https://omnimind-mcp-production.up.railway.app"}'; fi ;;
      *) echo "unexpected domain service: $svc" >&2; exit 9 ;;
    esac ;;
  up) echo "Indexing... Uploaded. Deploy started (detached)."; touch "$STUB_STATE/deployed" ;;
  *) echo "unexpected railway command: $cmd" >&2; exit 9 ;;
esac
STUB

cat > "$STUBS/curl" <<'STUB'
#!/usr/bin/env bash
method=GET; url=""; data=""; out=""; dumph=""; wfmt=""; headers=()
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -H) headers+=("$2"); shift 2 ;;
    -d|--data) data="$2"; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    -D) dumph="$2"; shift 2 ;;
    -w) wfmt="$2"; shift 2 ;;
    -m) shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
hostpath="${url#https://}"; hostpath="${hostpath#http://}"
host="${hostpath%%/*}"; path="/${hostpath#*/}"; [ "$hostpath" = "$host" ] && path="/"
auth=""; admin=""; sid=""
for h in "${headers[@]+"${headers[@]}"}"; do
  case "$h" in
    Authorization:*|authorization:*) auth="${h#*: }" ;;
    x-admin-key:*) admin="${h#*: }" ;;
    mcp-session-id:*) sid="${h#*: }" ;;
  esac
done
echo "curl $method $url${auth:+ auth=$auth}${sid:+ sid=$sid}${data:+ data=$data}" >> "$STUB_LOG"
status=200; body=""; hdrs=""
case "$host" in
  omnimind-api-production.up.railway.app)
    case "$method $path" in
      "GET /health") body='{"status":"ok","dbConnected":true}' ;;
      "GET /admin/tenants")
        rem="$(cat "$STUB_STATE/admin503.remaining")"
        if [ "$rem" -gt 0 ]; then echo $((rem-1)) > "$STUB_STATE/admin503.remaining"; status=503; body='{"error":"admin_disabled"}'
        else body="$(cat "$STUB_STATE/tenants.json")"; fi ;;
      "PATCH /admin/tenants/"*)
        id="${path##*/}"
        node -e 'const fs=require("fs");const f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,"utf8"));const t=d.tenants.find(x=>x.id===process.argv[2]);t.ownerUserId=JSON.parse(process.argv[3]).ownerUserId;fs.writeFileSync(f,JSON.stringify(d));process.stdout.write(JSON.stringify(t))' "$STUB_STATE/tenants.json" "$id" "$data" > "$STUB_STATE/patch.out"
        body="$(cat "$STUB_STATE/patch.out")" ;;
      "POST /auth/login")
        if [ "${STUB_USER_404:-0}" = "1" ]; then status=404; body='{"error":"not_found","message":"User not found"}'
        else body='{"id":"user_123","email":"josh@example.com","name":"Josh","teamId":"team_1"}'; fi ;;
      "GET /mcp/agents?"*) body="$(cat "$STUB_STATE/agents.json")" ;;
      "POST /mcp/agents")
        exists="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d.agents.some(a=>a.name==="omnimind-mcp-gateway")))' "$STUB_STATE/agents.json")"
        if [ "$exists" = "true" ] || [ "${STUB_GATEWAY_409:-0}" = "1" ]; then status=409; body='{"error":"Agent name already registered"}'
        else
          node -e 'const fs=require("fs");const f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,"utf8"));const b=JSON.parse(process.argv[2]);d.agents.push({id:"agent_1",name:b.name,tenantId:b.tenantId,scopes:b.scopes});d.count=d.agents.length;fs.writeFileSync(f,JSON.stringify(d))' "$STUB_STATE/agents.json" "$data"
          status=201; body='{"id":"agent_1","name":"omnimind-mcp-gateway"}'
        fi ;;
      "POST /mcp/tokens")
        status=201; body="{\"token\":\"$TOKEN_FIXTURE\",\"record\":{\"id\":\"tok_1\",\"agentName\":\"$TOKEN_AGENT_FIXTURE\",\"scopes\":[\"memory:read\"]}}" ;;
      "GET /mcp/audit?"*) body="{\"entries\":[{\"agentId\":\"$TOKEN_AGENT_FIXTURE\",\"toolName\":\"tools/list\",\"durationMs\":12}],\"count\":1}" ;;
      *) status=404; body='{"error":"stub: no route"}' ;;
    esac ;;
  boardroom-ai-production-1092.up.railway.app)
    body='{"status":"ok"}' ;;
  omnimind-mcp-production.up.railway.app)
    case "$method $path" in
      "GET /health") body='{"status":"ok","uptime":3,"sessions":0}' ;;
      "GET /.well-known/oauth-protected-resource") status=404; body='{"error":"not_found"}' ;;
      "POST /mcp")
        if [ -z "$auth" ]; then status=401; hdrs='WWW-Authenticate: Bearer realm="omnimind-mcp"'; body='{"error":"unauthorized"}'
        else
          case "$data" in
            *'"method":"initialize"'*) hdrs='mcp-session-id: sess-0001'; body=$'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"omnimind-mcp","version":"0"},"instructions":"OmniMind is the user\'s persistent memory"}}\n' ;;
            *'"method":"notifications/initialized"'*) status=202 ;;
            *'"method":"tools/list"'*)
              tools="$(node -e 'process.stdout.write(JSON.stringify(Array.from({length:20},(_,i)=>({name:"tool_"+i}))))')"
              body=$'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":'"$tools"$'}}\n' ;;
            *) status=400; body='{"error":"stub: unknown method"}' ;;
          esac
        fi ;;
      "DELETE /mcp") status=200 ;;
      *) status=404; body='{"error":"stub: no route"}' ;;
    esac ;;
  *) status=000; body="" ;;
esac
if [ -n "$dumph" ]; then printf 'HTTP/1.1 %s X\r\n%s\r\n\r\n' "$status" "${hdrs:-x-stub: 1}" > "$dumph"; fi
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
if [ -n "$wfmt" ]; then printf '%s' "$status"; fi
STUB

cat > "$STUBS/openssl" <<'STUB'
#!/usr/bin/env bash
echo "openssl $*" >> "$STUB_LOG"
n="$(cat "$STUB_STATE/openssl.count")"; n=$((n+1)); echo "$n" > "$STUB_STATE/openssl.count"
case "$n" in
  1) printf '1%.0s' $(seq 1 64) ;;
  2) printf '2%.0s' $(seq 1 64) ;;
  *) printf '%d%.0s' "$n" $(seq 1 64) ;;
esac
echo
STUB

cat > "$STUBS/claude" <<'STUB'
#!/usr/bin/env bash
echo "claude $*" >> "$STUB_LOG"
echo "Added HTTP MCP server omnimind"
STUB
chmod +x "$STUBS"/*
export TOKEN_FIXTURE TOKEN_AGENT_FIXTURE

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; }
assert_eq()       { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "expected: $3"$'\n'"actual:   $2"; fi; }
assert_contains() { if printf '%s' "$2" | grep -qE -- "$3"; then ok "$1"; else fail "$1" "missing /$3/ in:"$'\n'"$(printf '%s' "$2" | tail -n 40)"; fi; }
assert_lacks()    { if printf '%s' "$2" | grep -qE -- "$3"; then fail "$1" "unexpected /$3/ in:"$'\n'"$(printf '%s' "$2" | grep -E -- "$3" | head -5)"; else ok "$1"; fi; }
assert_count()    { local n; n="$(printf '%s' "$2" | grep -cE -- "$3" || true)"; assert_eq "$1" "$n" "$4"; }
# assert_before <label> <regexA> <regexB>: A's first match precedes B's first match in the stub log.
assert_before() {
  local a b
  a="$(printf '%s\n' "$LOG" | grep -nE -- "$2" | head -1 | cut -d: -f1)"
  b="$(printf '%s\n' "$LOG" | grep -nE -- "$3" | head -1 | cut -d: -f1)"
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then ok "$1"; else fail "$1" "A=/$2/ at line ${a:-none}, B=/$3/ at line ${b:-none}"; fi
}

# run_go_live [env K=V…] -- <script args…>; sets RC / OUT / ERR / LOG.
run_go_live() {
  local envs=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  : > "$STUB_LOG"
  set +e
  OUT="$(cd "$TMP" && PATH="$STUBS:$PATH" GO_LIVE_HEALTH_TIMEOUT=5 GO_LIVE_POLL_INTERVAL=0 \
        env -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY -u RAILWAY_TOKEN -u RAILWAY_API_TOKEN -u OMNIMIND_MCP_AGENT_KEY \
        "${envs[@]+"${envs[@]}"}" bash "$SCRIPT" "$@" 2> "$TMP/stderr")"
  RC=$?
  set -e
  ERR="$(cat "$TMP/stderr")"
  LOG="$(cat "$STUB_LOG")"
}
COMMON=(--project proj_test --owner-email josh@example.com --environment production)

echo "# GL-01: fresh run, full sequence"
reset_state
run_go_live -- "${COMMON[@]}" --yes
assert_eq       "exit 0" "$RC" "0"
assert_contains "whoami ran" "$LOG" '^railway whoami$'
assert_before   "link before reading variables" '^railway link -p proj_test -e production -s omnimind-api$' '^railway variable list -s omnimind-api -e production -p proj_test --json$'
assert_contains "admin key generated and set WITHOUT --skip-deploys" "$LOG" "^railway variable set OMNIMIND_ADMIN_KEY=$ADMIN_KEY_FIXTURE -s omnimind-api -e production -p proj_test --json$"
assert_before   "api /health polled after the admin key" 'variable set OMNIMIND_ADMIN_KEY' 'curl GET https://omnimind-api-production.up.railway.app/health'
assert_count    "admin route polled until it stops answering 503 (2 calls)" "$LOG" 'curl GET https://omnimind-api-production.up.railway.app/admin/tenants$' "3"
assert_before   "GET /mcp/agents before POST" 'curl GET https://omnimind-api-production.up.railway.app/mcp/agents\?tenantId=josh-business' 'curl POST https://omnimind-api-production.up.railway.app/mcp/agents'
GATEWAY_HASH="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$GATEWAY_KEY_FIXTURE")"
assert_contains "gateway POST carries the sha256 of the generated key and the ceiling" "$LOG" "POST https://omnimind-api-production.up.railway.app/mcp/agents data=\\{\"name\":\"omnimind-mcp-gateway\",\"apiKeyHash\":\"$GATEWAY_HASH\",\"tenantId\":\"josh-business\",\"scopes\":\\[\"memory:read\",\"memory:write\",\"decision:write\",\"task:write\",\"commitment:write\",\"project:write\",\"code:write\",\"mcp:delegate\"\\],\"sourceWeight\":1\\}"
assert_contains "e-mail resolved through POST /auth/login" "$LOG" 'curl POST https://omnimind-api-production.up.railway.app/auth/login data=\{"email":"josh@example.com"\}'
assert_contains "unowned tenant patched" "$LOG" 'curl PATCH https://omnimind-api-production.up.railway.app/admin/tenants/josh-business data=\{"ownerUserId":"user_123"\}'
assert_lacks    "already-owned tenant not patched" "$LOG" 'PATCH .*/admin/tenants/josh-personal'
assert_lacks    "tenant owned by someone else not patched" "$LOG" 'PATCH .*/admin/tenants/tgfc-ministry'
assert_contains "different owner is warned about" "$ERR" 'tenant tgfc-ministry is owned by a DIFFERENT user \(user_other\)'
assert_before   "service list before add" '^railway service list -e production -p proj_test --json$' '^railway add --service omnimind-mcp --json$'
assert_contains "MCP variables set with --skip-deploys, private API URL, gateway key, Dockerfile path" "$LOG" "^railway variable set RAILWAY_DOCKERFILE_PATH=packages/omnimind-mcp/Dockerfile OMNIMIND_API_URL=http://omnimind-api.railway.internal:3333 OMNIMIND_API_KEY=$API_KEY_FIXTURE OMNIMIND_MCP_TOKEN_AUTH=true OMNIMIND_MCP_AGENT_KEY=$GATEWAY_KEY_FIXTURE OMNIMIND_MCP_TRUST_PROXY=true OMNIMIND_MCP_APP_URL=https://boardroom-ai-production-1092.up.railway.app ANTHROPIC_API_KEY=$ANTHROPIC_FIXTURE -s omnimind-mcp -e production -p proj_test --skip-deploys --json$"
assert_before   "domain generated after the first variable batch" 'variable set RAILWAY_DOCKERFILE_PATH' '^railway domain -s omnimind-mcp -e production --project proj_test --json$'
assert_contains "host variables from the generated domain" "$LOG" '^railway variable set OMNIMIND_MCP_ALLOWED_HOSTS=omnimind-mcp-production.up.railway.app OMNIMIND_MCP_PUBLIC_URL=https://omnimind-mcp-production.up.railway.app/mcp -s omnimind-mcp -e production -p proj_test --skip-deploys --json$'
assert_before   "up after every MCP variable" 'variable set OMNIMIND_MCP_ALLOWED_HOSTS' '^railway up \. -s omnimind-mcp -e production -p proj_test --detach$'
assert_before   "MCP /health polled after up" '^railway up ' 'curl GET https://omnimind-mcp-production.up.railway.app/health'
assert_contains "BoardRoom variables in one call (redeploys)" "$LOG" '^railway variable set OMNIMIND_MCP_PUBLIC_URL=https://omnimind-mcp-production.up.railway.app/mcp APP_PUBLIC_URL=https://boardroom-ai-production-1092.up.railway.app ADMIN_EMAILS=josh@example.com -s boardroom-ai -e production -p proj_test --json$'
assert_contains "token minted with x-api-key only, all seven scopes, 365 days" "$LOG" 'curl POST https://omnimind-api-production.up.railway.app/mcp/tokens data=\{"userId":"user_123","tenantId":"josh-business","name":"Claude Code \(laptop\)","scopes":\["memory:read","memory:write","decision:write","task:write","commitment:write","project:write","code:write"\],"expiresInDays":365\}'
assert_contains "claude mcp add executed with --yes" "$LOG" "^claude mcp add --transport http --scope user omnimind https://omnimind-mcp-production.up.railway.app/mcp --header Authorization: Bearer $TOKEN_FIXTURE$"
assert_before   "PRM checked before the 401 probe" 'curl GET https://omnimind-mcp-production.up.railway.app/.well-known/oauth-protected-resource' 'curl POST https://omnimind-mcp-production.up.railway.app/mcp data=\{\}$'
assert_contains "initialize with the token" "$LOG" "curl POST https://omnimind-mcp-production.up.railway.app/mcp auth=Bearer $TOKEN_FIXTURE data=.*\"method\":\"initialize\""
assert_contains "tools/list echoes the session id" "$LOG" 'curl POST https://omnimind-mcp-production.up.railway.app/mcp auth=Bearer omt_.* sid=sess-0001 data=.*"method":"tools/list"'
assert_contains "session deleted" "$LOG" 'curl DELETE https://omnimind-mcp-production.up.railway.app/mcp auth=Bearer omt_.* sid=sess-0001'
assert_contains "audit read for the tenant" "$LOG" 'curl GET https://omnimind-api-production.up.railway.app/mcp/audit\?tenantId=josh-business&limit=5'
assert_contains "summary: gateway created" "$OUT" '\| Gateway agent omnimind-mcp-gateway \| created \|'
assert_contains "summary: tenants" "$OUT" '\| Tenant owners \| set 1, kept 1, skipped 1 \|'
assert_contains "summary: service created + deployed" "$OUT" '\| Service omnimind-mcp \| created, deployed \| https://omnimind-mcp-production.up.railway.app'
assert_contains "summary: admin key generated" "$OUT" '\| OMNIMIND_ADMIN_KEY \(omnimind-api\) \| generated \|'
for check in PRM 'unauthenticated POST /mcp' initialize 'tools/list' 'DELETE session' 'audit attribution'; do
  assert_contains "summary: verify $check ok" "$OUT" "\| verify: $check \| ok \|"
done
assert_contains "summary: config-as-code remains manual" "$OUT" 'Config-as-code → set the config file path to packages/omnimind-mcp/railway.toml'
assert_contains "summary: connect the repo remains manual" "$OUT" 'connect the GitHub repo'
assert_contains "summary: OAuth + REQUIRE_AGENT_KEY remain manual" "$OUT" 'OMNIMIND_REQUIRE_AGENT_KEY=true'
assert_contains "admin key printed once with the 1Password note" "$ERR" "store in 1Password now; printed once ===
\[go-live\] $ADMIN_KEY_FIXTURE"
assert_count    "admin key appears exactly once in stderr" "$ERR" "$ADMIN_KEY_FIXTURE" "1"
assert_lacks    "admin key never on stdout" "$OUT" "$ADMIN_KEY_FIXTURE"
assert_lacks    "gateway key never printed" "$ERR$OUT" "$GATEWAY_HEX_FIXTURE"
assert_lacks    "service key never printed" "$ERR$OUT" "$API_KEY_FIXTURE"
assert_lacks    "anthropic key never printed" "$ERR$OUT" "$ANTHROPIC_FIXTURE"
assert_count    "token printed exactly once (the claude mcp add line)" "$ERR" "$TOKEN_FIXTURE" "1"
assert_contains "the printed line is the claude mcp add command" "$ERR" "^claude mcp add --transport http --scope user omnimind https://omnimind-mcp-production.up.railway.app/mcp --header \"Authorization: Bearer $TOKEN_FIXTURE\"$"
assert_contains "every external command is echoed" "$ERR" '\[go-live\] \$ railway up \. -s omnimind-mcp'

echo "# GL-02: re-run is idempotent"
run_go_live -- "${COMMON[@]}" --yes
assert_eq    "exit 0 on re-run" "$RC" "0"
assert_lacks "no second admin key" "$LOG" 'variable set OMNIMIND_ADMIN_KEY'
assert_lacks "no second POST /mcp/agents" "$LOG" 'curl POST .*/mcp/agents'
assert_lacks "no second railway add" "$LOG" '^railway add'
assert_lacks "no tenant PATCH" "$LOG" 'PATCH .*/admin/tenants'
assert_contains "gateway key reused from the MCP service variables" "$ERR" 'reusing OMNIMIND_MCP_AGENT_KEY already set on omnimind-mcp'
assert_contains "BoardRoom variables already correct → nothing set" "$ERR" 'boardroom-ai ADMIN_EMAILS already correct'
assert_lacks "no BoardRoom variable set on re-run" "$LOG" 'variable set .* -s boardroom-ai'
assert_contains "summary: gateway existing" "$OUT" '\| Gateway agent omnimind-mcp-gateway \| existing \(key supplied\) \|'
assert_contains "summary: admin key existing" "$OUT" '\| OMNIMIND_ADMIN_KEY \(omnimind-api\) \| existing \|'
assert_contains "summary: service existing" "$OUT" '\| Service omnimind-mcp \| existing, deployed \|'
assert_contains "summary: tenants all kept" "$OUT" '\| Tenant owners \| set 0, kept 2, skipped 1 \|'

echo "# GL-03: 409 on POST /mcp/agents"
reset_state
run_go_live STUB_GATEWAY_409=1 -- "${COMMON[@]}" --yes
assert_eq       "409 without a key fails" "$RC" "1"
assert_contains "rotation help names --gateway-key" "$ERR" '--gateway-key omk_'
assert_contains "rotation help prints the ON CONFLICT SQL" "$ERR" 'ON CONFLICT \(name\) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash'
assert_lacks    "stops before creating the service" "$LOG" '^railway add'
reset_state
run_go_live STUB_GATEWAY_409=1 OMNIMIND_MCP_AGENT_KEY=omk_fromenv0000 -- "${COMMON[@]}" --yes
assert_eq       "409 with the key from the environment continues" "$RC" "0"
assert_contains "409 is reported" "$ERR" '409 Agent name already registered — continuing with the key supplied'
assert_contains "supplied key is what lands on the MCP service" "$LOG" 'OMNIMIND_MCP_AGENT_KEY=omk_fromenv0000 '
assert_contains "summary says existing (409)" "$OUT" '\| Gateway agent omnimind-mcp-gateway \| existing \(409, key supplied\) \|'
assert_lacks    "supplied key never printed" "$ERR$OUT" 'omk_fromenv0000'

echo "# GL-04: --no-token"
reset_state
run_go_live -- "${COMMON[@]}" --yes --no-token
assert_eq    "exit 0" "$RC" "0"
assert_lacks "no token minted" "$LOG" 'POST .*/mcp/tokens'
assert_lacks "claude not called" "$LOG" '^claude '
assert_lacks "no authenticated MCP call" "$LOG" 'auth=Bearer'
assert_contains "unauthenticated contract still verified" "$OUT" '\| verify: unauthenticated POST /mcp \| ok \|'
assert_contains "summary points at Settings" "$OUT" '\| First token \| skipped \(--no-token\) \| mint in BoardRoom → Settings → Connected AI tools \|'
assert_contains "authenticated round trip marked skipped" "$OUT" '\| verify: authenticated round trip \| skipped \|'

echo "# GL-05: --dry-run makes no calls"
reset_state
run_go_live -- "${COMMON[@]}" --dry-run
assert_eq    "exit 0" "$RC" "0"
assert_lacks "no railway call" "$LOG" '^railway '
assert_lacks "no curl call" "$LOG" '^curl '
assert_lacks "no claude call" "$LOG" '^claude '
assert_lacks "no openssl call" "$LOG" '^openssl '
assert_contains "announces the dry run" "$ERR" 'DRY RUN — the plan is printed with placeholders; nothing is called'
assert_contains "plan shows the railway commands" "$ERR" '\$ railway variable set RAILWAY_DOCKERFILE_PATH=packages/omnimind-mcp/Dockerfile OMNIMIND_API_URL=http://omnimind-api.railway.internal:3333 OMNIMIND_API_KEY=<OMNIMIND_API_KEY from omnimind-api>'
assert_contains "plan shows the API calls" "$ERR" '\$ curl -X POST https://<omnimind-api-host>/mcp/agents \(x-admin-key\)'
assert_contains "plan shows the up" "$ERR" '\$ railway up \. -s omnimind-mcp -e production -p proj_test --detach'
assert_contains "summary marks the dry run" "$OUT" 'This was a dry run — nothing above was executed'

echo "# GL-06: unknown e-mail"
reset_state
run_go_live STUB_USER_404=1 -- "${COMMON[@]}" --yes
assert_eq       "fails" "$RC" "1"
assert_contains "asks for --owner-user-id and says where to find it" "$ERR" "could not resolve 'josh@example.com' to a user id \(POST /auth/login → 404\). Pass --owner-user-id <cuid>: it is the 'id' in BoardRoom's login response"
reset_state
run_go_live STUB_USER_404=1 -- "${COMMON[@]}" --yes --owner-user-id user_123 --no-token
assert_eq    "--owner-user-id bypasses the lookup" "$RC" "0"
assert_lacks "no /auth/login call" "$LOG" '/auth/login'

echo "# GL-07: GitHub Actions + project token"
reset_state
run_go_live GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY="$TMP/summary.md" RAILWAY_TOKEN=prj_token -- "${COMMON[@]}" --yes --no-token
assert_eq       "exit 0" "$RC" "0"
assert_lacks    "whoami skipped under a project token" "$LOG" '^railway whoami'
assert_lacks    "link skipped under a project token" "$LOG" '^railway link'
assert_contains "status used as the auth probe" "$LOG" '^railway status -e production -p proj_test --json$'
assert_contains "admin key masked" "$OUT" "^::add-mask::$ADMIN_KEY_FIXTURE$"
assert_contains "gateway key masked" "$OUT" "^::add-mask::$GATEWAY_KEY_FIXTURE$"
assert_lacks    "admin key never printed in CI" "$ERR" "$ADMIN_KEY_FIXTURE"
assert_contains "CI note says where the key lives" "$ERR" 'admin key written to the Railway variable OMNIMIND_ADMIN_KEY on omnimind-api \(not printed here'
assert_contains "summary written to GITHUB_STEP_SUMMARY" "$(cat "$TMP/summary.md")" '^## MCP go-live summary'
assert_lacks    "no secret in the step summary" "$(cat "$TMP/summary.md")" "$ADMIN_KEY_FIXTURE|$GATEWAY_HEX_FIXTURE|$API_KEY_FIXTURE"

echo
echo "mcp-go-live.test.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
