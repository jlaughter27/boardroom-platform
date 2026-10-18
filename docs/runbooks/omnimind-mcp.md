# OmniMind-MCP Runbook — from checkout to "live"

Last updated: 2026-10-18 | Hosted MCP front door (per-user `omt_` tokens, OAuth resource server, `search`/`fetch`, Dockerfile + Railway service)

This is the operator path. Follow the numbered sections in order the first time; afterwards jump to the section you need. Protocol-level detail (tool semantics, scopes, pagination) stays in `docs/MEMORY-PROTOCOL.md`; the OmniMind endpoints referenced here are specified in `docs/contracts/omnimind-api.contract.md`. Code of record: `packages/omnimind-mcp/src/lib/principal.ts` (credential → principal), `packages/omnimind-api/src/middleware/agent-context.ts` (delegation), `packages/omnimind-api/src/services/mcp-token.service.ts` (tokens), `packages/boardroom-ai/client/src/components/settings/mcp-snippets.ts` (install snippets).

**Topology once live**

```
Claude.ai / Claude Desktop / Claude Code / ChatGPT / Cursor / Windsurf / Gemini CLI / VS Code / Zed
    │  Streamable HTTP to https://<mcp-host>/mcp
    │  Authorization: Bearer omt_<personal token>   (or an OAuth JWT, or the legacy static bearer)
    ▼
omnimind-mcp  (Railway service, packages/omnimind-mcp/Dockerfile, `node dist/index.js http`, PORT, binds `::`)
    │  resolves the credential ONCE per session, as the GATEWAY agent (x-api-key + x-agent-key, scope mcp:delegate):
    │     omt_ token → POST /mcp/tokens/introspect        OAuth JWT (jose, iss/aud/exp) → POST /mcp/identities/resolve
    │  then every tool call carries x-mcp-principal: token:<id> | oauth:<id>
    ▼
omnimind-api  (http://omnimind-api.railway.internal:3333 — private network)
    │  agent-context: verified gateway + principal → agentId = principal.agentName, tenant/user = principal's,
    │  scopes = principal.scopes ∩ (gateway.scopes − mcp:delegate)
    ▼
PostgreSQL  (mcp_tokens, mcp_oauth_identities, agents, tenants.owner_user_id)
```

One hosted URL serves every user and every client. The process-level identity (`OMNIMIND_MCP_AGENT_NAME` etc.) is the **gateway** agent; each session is re-attributed to the principal behind its bearer credential. The old single-identity static bearer (`OMNIMIND_MCP_API_KEY`) still works for a personal self-hosted instance and is called the *legacy static bearer* below.

Three things people get wrong, up front:

1. **The gateway's scopes are a ceiling, not a grant.** A delegated request's effective scopes are `token.scopes ∩ (gateway.scopes − mcp:delegate)`. A gateway holding only `mcp:delegate` makes every token useless (`SCOPE_DENIED` on everything). Give the gateway `mcp:delegate` **plus every scope a token may be minted with** (§2).
2. **Attribution is per token, not per gateway.** Writes, audit rows, rate buckets and idempotency scopes use the principal's `agentName` (`mcp-token:<slug>-<6 chars>` or `oauth:<client>`), never `omnimind-mcp-gateway`.
3. **Tenant ownership gates token minting.** A user can only mint a token for a tenant whose `owner_user_id` is that user (§3). Settings shows "No tenant is assigned to your account yet" until then.

---

## 0. Prerequisites

- OmniMind API deployed with the Lane A1 endpoints: `POST/GET /mcp/tokens`, `GET /mcp/tokens/options`, `DELETE /mcp/tokens/:id`, `POST /mcp/tokens/introspect`, `POST /mcp/identities/resolve`, `GET/PATCH /admin/tenants[/:id]`; migration `20261018000000_mcp_tokens` applied (entrypoint runs `migrate deploy`).
- `OMNIMIND_ADMIN_KEY` set on omnimind-api (needed for `POST /mcp/agents` and `/admin/*`).
- `pnpm-lock.yaml` carries `jose` (runtime dep of the MCP package). Both the Dockerfile and CI run `pnpm install --frozen-lockfile` and fail on drift.
- Local build sanity: `pnpm --filter @boardroom/shared build && pnpm --filter @boardroom/omnimind-mcp build`.

---

## 1. Deploy the MCP service on Railway

A plain Node HTTP process: no database, no Prisma, no prompts directory, no bash. Built from `packages/omnimind-mcp/Dockerfile` (same two-stage node:20-alpine / pnpm 10.32.1 / shared-first / `pnpm deploy --legacy` pattern as the other services; CI's `docker` matrix builds it).

1. Railway → **New Service → GitHub Repo → boardroom-platform**. Name it `omnimind-mcp`.
2. **Settings → Build**: like `omnimind-api` (`docs/03-operations/DEPLOY-RAILWAY.md`, Step 3): Builder *Dockerfile*, Root Directory `packages/omnimind-mcp`; `packages/omnimind-mcp/railway.toml` carries `healthcheckPath = "/health"` and `numReplicas = 1`. If the build fails on `COPY package.json turbo.json …`, the build context is not the repo root — set Root Directory `/` and `RAILWAY_DOCKERFILE_PATH=packages/omnimind-mcp/Dockerfile`.
3. **Settings → Networking**: generate a **public** domain, e.g. `omnimind-mcp-production.up.railway.app`. Claude.ai connectors connect from Anthropic's cloud, so the host must be publicly reachable (no IP allowlist, or allowlist Anthropic's published ranges).
4. **Variables**:

| Variable | Value | Required | Notes |
|---|---|:-:|---|
| `PORT` | *(Railway injects)* | auto | `index.ts` reads `PORT` (default 3334) and listens without a host, i.e. on `::`. Never set manually. |
| `OMNIMIND_API_URL` | `http://omnimind-api.railway.internal:3333` | yes | **Private network, http.** Port = whatever omnimind-api's `PORT` is (`docs/03-operations/PRIVATE-NETWORKING.md`). Fallback: the public `https://omnimind-api-production.up.railway.app`. |
| `OMNIMIND_API_KEY` | same value as omnimind-api | yes | Shared service key (`x-api-key`). |
| `OMNIMIND_MCP_AGENT_NAME` | `omnimind-mcp-gateway` | yes | The gateway agent (§2). |
| `OMNIMIND_MCP_TENANT_ID` | `josh-business` | yes | Gateway's own tenant (used only by the legacy static bearer / stdio). Delegated sessions use the token's tenant. |
| `OMNIMIND_MCP_SCOPES` | `mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write` | yes | Must match the agent row from §2. This is the **ceiling** for every token. |
| `OMNIMIND_MCP_SOURCE_WEIGHT` | `1.0` | no | Finite, 0..2; delegated sessions use the token's weight. |
| `OMNIMIND_MCP_AGENT_KEY` | `omk_…` from §2 | yes | Sent as `x-agent-key`. The server **refuses to start** with `OMNIMIND_MCP_TOKEN_AUTH=true` or an OAuth issuer and no agent key. |
| `OMNIMIND_MCP_TOKEN_AUTH` | `true` | yes | Accept `omt_` tokens (`POST /mcp/tokens/introspect`). |
| `OMNIMIND_MCP_API_KEY` | *(unset)* | no | Legacy static bearer. Leave unset on the hosted gateway so the only credentials are per-user. The server exits 1 when none of static bearer / token auth / OAuth issuer is configured. |
| `OMNIMIND_MCP_ALLOWED_HOSTS` | `omnimind-mcp-production.up.railway.app` | yes | Exact `Host` values the DNS-rebinding guard accepts: the bare public host (Railway's proxy sends no port) plus any custom domain, comma-separated. Wrong ⇒ every MCP call is `403 Invalid Host header` while `/health` still passes. Printed at startup. |
| `OMNIMIND_MCP_PUBLIC_URL` | `https://omnimind-mcp-production.up.railway.app/mcp` | yes | This server's resource identifier: PRM `resource`, default OAuth audience, and what BoardRoom renders into install snippets. Must equal BoardRoom's `OMNIMIND_MCP_PUBLIC_URL` exactly. |
| `OMNIMIND_MCP_APP_URL` | `https://boardroom-ai-production-1092.up.railway.app` | yes | `fetch`/`search` result URLs (`<app>/memory/<id>`) and where 401 bodies point people to mint a token. |
| `OMNIMIND_MCP_DOCS_URL` | *(optional)* | no | PRM `resource_documentation`; defaults to `docs/MEMORY-PROTOCOL.md` on GitHub. |
| `OMNIMIND_MCP_OAUTH_ISSUER` / `OMNIMIND_MCP_OAUTH_JWKS_URL` / `OMNIMIND_MCP_OAUTH_AUDIENCE` | *(empty)* | no | OAuth resource-server mode (§6). JWKS is discovered from the issuer when the URL is unset; audience defaults to `OMNIMIND_MCP_PUBLIC_URL`. |
| `OMNIMIND_MCP_WRITE_EXTRACT` | `sync` | no | `async` returns from `memory_write` before Haiku fact extraction finishes (§7c). |
| `OMNIMIND_MCP_SESSION_IDLE_MS` | `1800000` | no | Idle session timeout; cap 100 live sessions, least-recently-seen evicted. |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | yes (writes) | Haiku fact extraction inside `memory_write`. Omit on a read-only deployment; `memory_write` then fails with `FACT_EXTRACTOR_UNAVAILABLE`. |
| `OMNIMIND_MCP_USER_ID` | *(unset)* | no | Stdio / legacy static bearer only: user the `omnimind://` resources read as. Delegated sessions bind the token's user. |
| `NODE_ENV` | `production` | set by the image | |

5. Deploy. The log must show: `HTTP transport started on port <PORT>` → the enabled auth modes (`omt_ tokens (introspection)`, plus `OAuth (issuer …, audience …)` when set; **not** `static key`) → `allowedHosts: <your host>` without the `(default — loopback only)` suffix → `sessions: idle timeout 1800s, cap 100`.
6. `curl -s https://<mcp-host>/health` → `{"status":"ok","uptime":<s>,"sessions":0}` — exactly those three keys; unauthenticated and deliberately silent about agents and tenants.

Rollback: Railway → Deployments → redeploy the previous image. Nothing in OmniMind or BoardRoom depends on this service being up.

---

## 2. Create the gateway agent (`mcp:delegate` + the scope ceiling)

Every hosted request reaches OmniMind as the gateway agent plus `x-mcp-principal`. OmniMind honours that header only from a **verified** agent (valid `x-agent-key`) whose row holds `mcp:delegate`, and then caps the principal's scopes by the gateway's.

```bash
# From a checkout with the package built. Needs OMNIMIND_API_URL, OMNIMIND_API_KEY and
# OMNIMIND_ADMIN_KEY in the shell (POST /mcp/agents is x-admin-key gated).
node packages/omnimind-mcp/dist/index.js keygen \
  --agent omnimind-mcp-gateway \
  --tenant josh-business \
  --scopes "mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write" \
  --source-weight 1.0
```

- The scope list = `mcp:delegate` + all six grantable token scopes (`MCP_SCOPES` in `principal.ts`). `*` also works (`intersectDelegatedScopes` treats it as "everything") but then a future scope is granted implicitly; prefer the explicit list. To run a **read-only gateway** (e.g. a second service only for Claude.ai Research mode) use `mcp:delegate,memory:read` — write tokens connected to it get `SCOPE_DENIED` on writes, which is the point.
- Copy the printed `omk_…` key **once** into 1Password, then into the Railway variable `OMNIMIND_MCP_AGENT_KEY`. Only its SHA-256 is stored; it cannot be shown again. If the API is unreachable keygen prints an `INSERT INTO agents …` fallback.
- Verify: `curl -s -H "x-api-key: $OMNIMIND_API_KEY" https://omnimind-api-production.up.railway.app/mcp/agents | jq '.[] | select(.name=="omnimind-mcp-gateway") | {name, tenantId, scopes}'`.
- The gateway **never acts on its own scopes**: a request without `x-mcp-principal` from it is just an ordinary agent call, and `x-mcp-principal` from any agent without `mcp:delegate` is `403 delegation_not_allowed`.
- Once the gateway is the only MCP writer, set `OMNIMIND_REQUIRE_AGENT_KEY=true` on omnimind-api so unverified `x-agent-id` headers are refused (Known Limitation 8).

Rotation: run keygen again with the same `--agent` name, update the Railway variable, redeploy. The previous key is invalid as soon as the agent row is updated.

---

## 3. Set tenant owners

`POST /mcp/tokens` only succeeds for a tenant whose `owner_user_id` is the requesting user (`mcp-token.service.ts`); `GET /mcp/tokens/options` lists exactly those tenants, and BoardRoom's panel shows "No tenant is assigned to your account yet" when the list is empty. OAuth auto-link also picks the user's owned tenant.

```bash
# List (x-admin-key)
curl -s -H "x-admin-key: $OMNIMIND_ADMIN_KEY" https://omnimind-api-production.up.railway.app/admin/tenants | jq .
# Set the owner (404 user_not_found if the cuid is wrong)
curl -s -X PATCH -H "x-admin-key: $OMNIMIND_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"ownerUserId":"<user cuid>"}' https://omnimind-api-production.up.railway.app/admin/tenants/josh-business
```

Repeat for `josh-personal` and `tgfc-ministry`. SQL fallback from the post-audit checklist: `UPDATE tenants SET owner_user_id = '<user cuid>' WHERE id IN (…);`. Verify with the `GET` — no `null` owners for tenants you expect tokens to target.

---

## 4. Create a personal token

BoardRoom → **Settings → Connected AI tools**. Pick the client (it pre-fills the token name and renders the right snippet), the tenant (only tenants you own are offered) and the scopes. The `omt_…` value (`omt_` + 43 base64url chars) is shown **once**; the list afterwards shows only the 12-char prefix, last-used time and a Revoke button.

Revocation: the row gets `revoked_at`; the MCP server caches a positive resolution for up to **60 s** and a live session keeps its resolved identity until the next resolution, so expect the client to lose access within about a minute, not within one request. (Lane C's "immediately" is the user-facing simplification.)

Recommended scopes per client:

| Client | Scopes | Why |
|---|---|---|
| Claude.ai / Claude Desktop connector | `memory:read` first; add `memory:write` after a week of dogfooding | Research mode invokes connector tools without further approval. |
| Claude Code, Cursor, Windsurf, VS Code, Zed | `memory:read,memory:write,decision:write,task:write,commitment:write` | Agentic coding sessions log decisions and tasks. |
| ChatGPT | `memory:read` | `search`/`fetch` only. |
| Gemini CLI | `memory:read,memory:write` | |

Scripted equivalent: `POST /mcp/tokens` on OmniMind (contract) or `POST /api/mcp/tokens` on BoardRoom with the user's cookie. `GET /api/mcp/tokens/connect-info` returns `{ mcpUrl, appUrl, oauthEnabled }` — the values the snippets are built from.

---

## 5. Install in each client

Every HTTP client needs the same two facts: the server URL **`https://<mcp-host>/mcp`** and the header `Authorization: Bearer omt_…`. The Settings page renders these snippets with the real URL and token filled in (`mcp-snippets.ts` is the source of truth; this section mirrors it). Stdio configs (`docs/agent-configs/*.json`, `omnimind-local` entries) remain for running the server locally with an `omk_` agent key — not needed for the hosted path.

### Claude.ai and Claude Desktop (custom connector)
Settings → **Connectors** → *Add custom connector* → name `OmniMind`, Remote MCP server URL `https://<mcp-host>/mcp`. Expand *Advanced settings* and add the `Authorization: Bearer omt_…` header — no OAuth client ID or secret is needed in token mode. Save, then enable the connector in a chat from the tools menu. Custom connectors with a static header need a plan that allows custom connectors (Pro, Max, Team, Enterprise). Claude Desktop shares the connector list; no `claude_desktop_config.json` edit. In OAuth mode (§6) leave the credential fields empty; Claude discovers the issuer from the PRM document.

### Claude Code
```bash
claude mcp add --transport http omnimind https://<mcp-host>/mcp --header "Authorization: Bearer omt_…"
# add --scope user to make it available in every project; `claude mcp list` should report it connected
```
Claude Code loads the server `instructions` at session start (truncated at 2,048 chars) and uses them for tool search; `/mcp` shows connection state and re-auth in OAuth mode.

### ChatGPT (Developer mode)
Settings → **Connectors** → *Advanced* → enable **Developer mode** → *Create* → name `OmniMind`, URL `https://<mcp-host>/mcp`. Authentication: choose *Custom header / API key* if your workspace offers it and paste the header; if the workspace only allows OAuth connectors, header auth is rejected and §6 must be configured (the connector then completes the sign-in flow without a token). ChatGPT uses the read-only `search` and `fetch` tools (`readOnlyHint: true`, so no confirmation prompt); Deep Research and company knowledge retrieve through that pair only.

### Cursor
`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):
```json
{ "mcpServers": { "omnimind": { "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
One-click: `cursor://anysphere.cursor-deeplink/mcp/install?name=omnimind&config=<base64 of {url, headers}>` — rendered on the Settings page. Cursor → Settings → MCP shows the server; toggle it on if listed as disabled.

### Windsurf
`~/.codeium/windsurf/mcp_config.json` (Windsurf → Settings → Cascade → MCP → Configure), then *Refresh* in the MCP panel:
```json
{ "mcpServers": { "omnimind": { "serverUrl": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
Windsurf caps the total tool count at 100 across all servers; OmniMind contributes 20.

### Gemini CLI
`~/.gemini/settings.json` (or `.gemini/settings.json` in a project), then `/mcp` inside Gemini CLI to confirm:
```json
{ "mcpServers": { "omnimind": { "httpUrl": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
Equivalent: `gemini mcp add --transport http omnimind https://<mcp-host>/mcp --header "Authorization: Bearer omt_…"`. Use `httpUrl` (Streamable HTTP), never `url` (legacy SSE, which this server does not serve and Gemini Enterprise rejects).

### VS Code / GitHub Copilot
`.vscode/mcp.json` in the workspace (or *MCP: Add Server* from the Command Palette); Copilot Chat must be in **Agent** mode:
```json
{ "servers": { "omnimind": { "type": "http", "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
From a terminal: `code --add-mcp '{"name":"omnimind","type":"http","url":"https://<mcp-host>/mcp","headers":{"Authorization":"Bearer omt_…"}}'`. To keep the token out of a committed file use an `inputs` prompt (`docs/agent-configs/vscode-copilot.json`).

### Zed
`settings.json` (`zed: open settings`):
```json
{ "context_servers": { "omnimind": { "source": "custom", "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
If your Zed build only supports stdio servers, bridge with `mcp-remote`: `"command": "npx", "args": ["-y", "mcp-remote", "https://<mcp-host>/mcp", "--header", "Authorization:Bearer omt_…"]`. Zed does not surface elicitation; destructive tools rely on their server-side `confirm`/`dryRun` arguments.

### Any other Streamable HTTP client
URL + header as above. Smoke with curl (§7b). The legacy HTTP+SSE two-endpoint transport is not served on purpose (deprecated; rejected by Copilot Studio and Gemini Enterprise).

---

## 6. OAuth option (resource-server mode)

The MCP server is an OAuth 2.1 **resource server**, not an authorization server. Set `OMNIMIND_MCP_OAUTH_ISSUER` (and optionally `_JWKS_URL`, `_AUDIENCE`) and it verifies incoming JWTs with `jose` — asymmetric algorithms only (RS256/ES256/EdDSA), `iss` = issuer, `aud` = audience (RFC 8707; defaults to `OMNIMIND_MCP_PUBLIC_URL`), `exp`/`sub` required, 30 s clock skew — then resolves the principal through `POST /mcp/identities/resolve` with `{issuer, subject, email?, emailVerified?, clientId?}`. A user is **auto-linked by verified e-mail** on first use (claim `email` with `email_verified: true` matching a BoardRoom user who owns a tenant); otherwise the credential is `401 unlinked`. The identity row's `agentName` is `oauth:<clientId or issuer host>` with the default OAuth scopes; a `scope` claim on the token narrows them (`intersectScopes`).

- Discovery: `GET https://<mcp-host>/.well-known/oauth-protected-resource` (and `…/oauth-protected-resource/mcp` for path-scoped clients) returns RFC 9728 metadata `{ resource, authorization_servers: [issuer], scopes_supported, bearer_methods_supported: ["header"], resource_documentation }`. **It is served only when OAuth is configured** — in token-only mode it is `404`, and `WWW-Authenticate` on a 401 carries `resource_metadata="…"` only in OAuth mode.
- Client registration is the **issuer's** job. Claude.ai and Claude Code prefer **Client ID Metadata Documents (CIMD)** and use them only when the authorization server advertises `client_id_metadata_document_supported` and `none` in `token_endpoint_auth_methods_supported`; Dynamic Client Registration (RFC 7591) is deprecated in MCP spec 2026-07-28 but still what Cursor, Gemini CLI and Copilot Studio use; static pre-registered clients are the third path. Pick an issuer (WorkOS AuthKit, Ory Hydra, Auth0, …) that supports all three — ADR-014.
- We validate tokens from **one configured issuer**, with no consent-time scope picker and no built-in authorization server. Token auth (`omt_`) and OAuth coexist on the same endpoint; the server decides by shape (`omt_` prefix vs compact JWS).
- Startup refuses an issuer without `OMNIMIND_MCP_PUBLIC_URL` or without `OMNIMIND_MCP_AGENT_KEY` (identity resolution is a delegated call).

---

## 7. Verification

Run these from any machine after each deploy. Replace `<mcp-host>` and `omt_…`.

**a. Health, discovery, fail-closed**
```bash
curl -s https://<mcp-host>/health | jq .                                   # {status, uptime, sessions}
curl -s -i https://<mcp-host>/.well-known/oauth-protected-resource | head -1  # 200 in OAuth mode, 404 in token-only mode
curl -s -i -X POST https://<mcp-host>/mcp -H 'content-type: application/json' -d '{}' | head -3
# HTTP/1.1 401 + WWW-Authenticate: Bearer realm="omnimind-mcp"[, resource_metadata=…]  (403 here = allowedHosts wrong)
```

**b. `initialize` round trip with a token**
```bash
curl -s -i -X POST https://<mcp-host>/mcp \
  -H "Authorization: Bearer omt_…" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```
Expect `200`, an `mcp-session-id: <uuid>` header, `serverInfo.name` `omnimind-mcp`, and an `instructions` string that starts with "OmniMind is the user's persistent memory". Then, with that header:
```bash
SID=<uuid>; H=(-H "Authorization: Bearer omt_…" -H "mcp-session-id: $SID" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
curl -s -X POST https://<mcp-host>/mcp "${H[@]}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
curl -s -X POST https://<mcp-host>/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools | length'   # 20
curl -s -X POST https://<mcp-host>/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status_get","arguments":{}}}' | jq '.result.structuredContent.counts'
curl -s -X DELETE https://<mcp-host>/mcp -H "Authorization: Bearer omt_…" -H "mcp-session-id: $SID"
```
A token without `memory:write` must get `{ "error": "SCOPE_DENIED" }` from `memory_write` (a tool result, not a transport error). A revoked token gets `401` on a new session within 60 s. A wrong/unknown credential is `401 error="invalid_token"`; OmniMind unreachable is `503` (never cached).

**c. Write-latency bench (`memory_write`)**
```bash
# Runs memory_write N times IN-PROCESS (not over HTTP) with the stdio/gateway env —
# OMNIMIND_API_URL, OMNIMIND_API_KEY, OMNIMIND_MCP_AGENT_*/AGENT_KEY, ANTHROPIC_API_KEY —
# then compares with the server-side figures from GET /mcp/audit/stats.
node packages/omnimind-mcp/dist/index.js bench --n 10 --user <user id> [--domain general] [--since-hours 24]
```
It refuses to start without `OMNIMIND_API_URL`, `OMNIMIND_API_KEY`, `OMNIMIND_MCP_AGENT_NAME`, `OMNIMIND_MCP_TENANT_ID` and a user (`--user` or `OMNIMIND_MCP_USER_ID`). **It performs real writes**: N low-importance (0.1) memories tagged `bench` under that user, each with its own `idempotencyKey` — use a scratch user or archive them afterwards (`memory_search` tag `bench`). Prints local p50/p95/min/max/mean plus the server-side p50/p95 and error rate for `memory_write` over the last `--since-hours`. Run it from a shell whose network path to OmniMind matches production (Railway service shell, or locally with the public API URL and note the extra hop). Budget: `memory_write` p95 **< 10 s** is comfortable (Haiku extraction dominates); the tool itself warns above **20 s** (`BENCH_ASYNC_THRESHOLD_MS`) — Claude Code backgrounds calls past two minutes and some clients time out at 60 s. Above that, set `OMNIMIND_MCP_WRITE_EXTRACT=async` on the Railway service: `memory_write` returns the raw row id immediately and extraction completes afterwards (the extracted facts supersede the raw row; they show up in `memory_search` a few seconds later). Re-run after the switch. Read latency is covered by §7b: time the `status_get` call there; p95 **< 1.5 s** end to end over the public URL is the target.

**d. Attribution + audit**
`curl -s -H "x-api-key: $OMNIMIND_API_KEY" "https://omnimind-api-production.up.railway.app/mcp/audit?limit=20" | jq '.entries[] | {agentId, toolName, durationMs}'` — every call above appears with `agentId` = the token's `agentName` (`mcp-token:<slug>-<6>`), not the gateway. Failed calls are logged too. `GET /mcp/audit/stats` aggregates per agent.

**e. Two users, one URL** — tokens for two users/tenants: a `memory_write` from A is not returned by `memory_search` from B; the same search from A finds it. This is the property the single-identity transport could not provide.

**f. Built-in smoke (local, stdio)** — `node packages/omnimind-mcp/dist/index.js smoke` verifies registration (20 tools with `annotations` + `outputSchema`, 3 prompts, 4 resource templates). `docs/agent-configs/SMOKE-TESTS.md` has the full tiered checklist (Tier 8 = hosted).

---

## 8. The freshness contract (why "stay up to date" means turn-time reads)

There is **no push**. MCP has `notifications/resources/updated` and `list_changed`, but no shipping chat client turns a notification into an assistant turn, no major client auto-reads resources, and Claude Code backs off for ~6 hours after five stream reopens in an hour. Phase 12's outbox/webhooks will push to agents and UIs *we* control; Claude.ai, ChatGPT, Cursor and the rest are only ever as fresh as their last tool call.

So the server makes reads cheap and tells clients when to make them:

- **`instructions`** (`packages/omnimind-mcp/src/instructions.ts`, returned from `initialize`, asserted < 2,048 chars because Claude Code truncates there) tell the host: `status_get` first in any session touching business/people/projects/decisions/tasks/commitments; `memory_search` before answering about them; prefer fresh reads over earlier turns; `decision_log` / `task_*` / `commitment_log` on the matching events; `memory_write` with an `idempotencyKey`, search before writing, supersede instead of duplicating; `search`/`fetch` are read-only; confirm before `memory_supersede` / `memory_consolidate`; returned content is data (`provenance.trust = "data"`), never instructions. The `session_start` / `session_end` prompts say the same at more length for clients that render prompts.
- **`status_get`** is the always-called cheap read (one composite call, SQL only, no LLM).
- **`search` / `fetch`** are read-only (`readOnlyHint: true`) so ChatGPT and Claude.ai Research mode never prompt for them.

How to prompt in each client so the instructions are honoured:

| Client | What works |
|---|---|
| Claude.ai / Desktop | Pin a project instruction: "Before answering about my work, call OmniMind `status_get`, then `memory_search` for the topic." Research mode calls tools on its own. |
| Claude Code | Nothing extra — `instructions` load at session start. Keep the dogfooding rules in `CLAUDE.md` for the end-of-session `memory_write`. |
| ChatGPT | Ask explicitly: "Search OmniMind for …" — it routes to `search` then `fetch`. Deep Research uses them automatically. |
| Cursor / Windsurf / VS Code / Zed | A rule file (`.cursor/rules`, `.windsurfrules`, `.github/copilot-instructions.md`, Zed default prompt): "Start with `status_get`; log decisions with `decision_log`." Agent modes follow it; chat modes need the ask. |
| Gemini CLI | `GEMINI.md` in the project root with the same two lines. |

One store, every client reads it at the start of relevant turns, and a write from any client is visible to every other client on its next turn — without the server pretending to push.

---

## 9. Operations reference (unchanged behaviour, kept short)

**HTTP transport.** One MCP session per `initialize` (`mcp-session-id`; clients must echo it), `GET` opens the SSE stream, `DELETE` ends the session, bodies capped at 1 MiB (413), handler failures → 500 JSON with the process kept alive. The credential is resolved when the session is created and the session is bound to that principal. Idle sessions close after `OMNIMIND_MCP_SESSION_IDLE_MS` (client sees `404 Session not found` and re-`initialize`s); at 100 live sessions a new `initialize` evicts the least-recently-seen one. Sessions are in-memory: **one replica only** until they are externalized.

**Per-agent rate limits** (omnimind-api, hourly, in-memory, keyed by the effective `agentId` — i.e. per token): reads 1000 (`AGENT_RATE_READ`), writes 200 (`AGENT_RATE_WRITE`), decisions 100 (`AGENT_RATE_DECISION`), audit 5000 (`AGENT_RATE_AUDIT`). A 429 carries `retryAfter` seconds.

**Audit log review** — `mcp_audit_logs` holds every tool call incl. refusals; ministry inputs are `[REDACTED:ministry]`, outputs reduced to ids/titles/counts.
```sql
SELECT agent_id, tool_name, input_json->>'domain' AS domain, duration_ms, created_at
FROM mcp_audit_logs WHERE agent_id LIKE 'mcp-token:%' ORDER BY created_at DESC LIMIT 50;
SELECT agent_id, tool_name, duration_ms, created_at FROM mcp_audit_logs WHERE duration_ms > 2000 ORDER BY created_at DESC LIMIT 20;
```

**Consolidation safety.** `memory_consolidate` defaults to `dryRun: true`; review `output_json->'pairs'` before anyone runs `dryRun: false`. Applied pairs are reversible (`invalid_at` / `superseded_by`); nothing is deleted. Ministry rows are never scanned.

**Ministry domain.** Writes embed with Ollama `bge-base-en-v1.5`; if Ollama is down the write is refused (422) — never falls back to OpenAI. Rows are AES-256-GCM encrypted with `ENCRYPTION_KEY`.

**Tenant isolation.** A token is bound to one tenant; `delegated-user-isolation.ts` pins `x-user-id` to the principal's user; resource URIs whose `{tenant}` differs are refused with `TENANT_MISMATCH` before any HTTP call. Spot check: `SELECT COUNT(*) FROM memory_entries WHERE tenant_id != '<tenant>' AND agent_id = '<agent>';` → 0.

**Legacy static bearer / stdio.** A personal instance can still run `node dist/index.js http` with `OMNIMIND_MCP_API_KEY` as the single inbound token and the process identity as the only agent, or stdio with the `omnimind-local` configs in `docs/agent-configs/`. Both need an `omk_` agent key from keygen (`docs/agent-configs/keygen-commands.sh`). Never expose static-bearer mode on a shared URL.

---

## 10. Common errors

| Error | Cause | Fix |
|---|---|---|
| `403 Invalid Host header` on every MCP call, `/health` fine | `OMNIMIND_MCP_ALLOWED_HOSTS` lacks the exact `Host` the proxy sends | Set it to the bare public host (+ custom domain); redeploy; check the startup `allowedHosts:` line |
| Exits 1: `No inbound authentication configured for HTTP mode` | None of static bearer / `OMNIMIND_MCP_TOKEN_AUTH=true` / OAuth issuer set | Set `OMNIMIND_MCP_TOKEN_AUTH=true` (hosted) or a static bearer (personal) |
| Exits 1: `OMNIMIND_MCP_TOKEN_AUTH=true requires OMNIMIND_MCP_AGENT_KEY` (or the OAuth variant) | Gateway key missing | §2 |
| Exits 1: `OMNIMIND_MCP_OAUTH_ISSUER requires OMNIMIND_MCP_PUBLIC_URL` | Resource identifier missing | Set `OMNIMIND_MCP_PUBLIC_URL=https://<mcp-host>/mcp` |
| `401 invalid_token` with a fresh `omt_` token | `token auth is not enabled`, token revoked/expired, or minted on a different OmniMind | Check the startup auth-mode line, the token in Settings, and `OMNIMIND_API_URL` |
| `503` on every authenticated request | OmniMind (or the OAuth issuer's JWKS) unreachable from the MCP service | Private hostname/port in `OMNIMIND_API_URL`; `curl` it from the service shell |
| Every tool returns `SCOPE_DENIED`, even reads | Gateway agent row holds only `mcp:delegate` → `token ∩ (gateway − mcp:delegate) = ∅` | Re-keygen the gateway with the full ceiling (§2); `OMNIMIND_MCP_SCOPES` must match |
| `403 delegation_not_allowed` | `x-mcp-principal` from an agent without `mcp:delegate`, or an unverified key | Verify `GET /mcp/agents` shows the scope; rotate `OMNIMIND_MCP_AGENT_KEY` |
| Settings: "No tenant is assigned to your account yet" / `POST /mcp/tokens` 403 | `tenants.owner_user_id` not set to this user | §3 |
| OAuth `401 unlinked` | `email` claim missing/unverified or no BoardRoom user with that address owning a tenant | Create the user, set tenant owner, issuer must emit `email_verified` |
| OAuth `401 err_jwt_claim_validation_failed` (aud) | `OMNIMIND_MCP_OAUTH_AUDIENCE` / `PUBLIC_URL` ≠ the resource the issuer minted for | Make audience == `OMNIMIND_MCP_PUBLIC_URL` on both sides |
| PRM returns 404 | OAuth not configured (expected) | Only set the issuer vars if you need OAuth clients |
| ChatGPT rejects header auth | Workspace allows OAuth connectors only | §6 |
| `400 no valid session ID` | Client skipped `initialize` or dropped `mcp-session-id` | Client bug; sessions are required on the 2025-era protocol |
| `404 Session not found` after a pause | Idle timeout or eviction | Client re-initializes; raise `OMNIMIND_MCP_SESSION_IDLE_MS` if it happens mid-conversation |
| `FACT_EXTRACTOR_UNAVAILABLE` on `memory_write` | `ANTHROPIC_API_KEY` unset on the MCP service, or Haiku timeout | Set the key; transient → retry with the same `idempotencyKey`; persistent → `OMNIMIND_MCP_WRITE_EXTRACT=async` |
| `Ministry embedding unavailable` | Ollama down | Start Ollama; never fall back |
| `VALIDATION_ERROR … cursor` | Client edited an opaque cursor | Pass `nextCursor` back verbatim |
| `Output validation error … structured content` | OmniMind returned a shape outside the tool's `outputSchema` | Fix the API shape (`packages/shared/src/validation/mcp.schema.ts`); do not loosen the schema |
| Resource read `NO_USER_BOUND` (stdio only) | `OMNIMIND_MCP_USER_ID` unset | Set it, or use tools (which take `userId`) |
| Resource read `TENANT_MISMATCH` | URI tenant ≠ bound tenant | Cross-tenant reads are impossible by design |
