# OmniMind-MCP Runbook — from checkout to "live"

Last updated: 2026-10-18 | Hosted MCP front door (per-user `omt_` tokens, OAuth resource server, `search`/`fetch`, Dockerfile + Railway service)

This is the operator path. **Follow §0–§7 in order the first time** — each step creates something the next step needs, and nothing is used before it exists (the MCP service in §3 refuses to start without the gateway key from §1). Afterwards jump to the section you need. Protocol-level detail (tool semantics, scopes, pagination) stays in `docs/MEMORY-PROTOCOL.md`; the OmniMind endpoints referenced here are specified in `docs/contracts/omnimind-api.contract.md`. Code of record: `packages/omnimind-mcp/src/lib/principal.ts` (credential → principal), `packages/omnimind-api/src/middleware/agent-context.ts` (delegation), `packages/omnimind-api/src/services/mcp-token.service.ts` (tokens), `packages/shared/src/types/mcp-token.types.ts` (`MCP_SCOPES`, `MCP_GATEWAY_CEILING_SCOPES`), `packages/boardroom-ai/client/src/components/settings/mcp-snippets.ts` (install snippets).

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
    │  scopes = principal.scopes ∩ (gateway.scopes − mcp:delegate); delegated calls are confined to an allow-list of routes
    ▼
PostgreSQL  (mcp_tokens, mcp_oauth_identities, agents, tenants.owner_user_id)
```

One hosted URL serves every user and every client. The process-level identity is the **gateway** agent — on the hosted service that identity comes entirely from the agent row behind `OMNIMIND_MCP_AGENT_KEY` (the `OMNIMIND_MCP_AGENT_NAME` / `_TENANT_ID` / `_SCOPES` / `_SOURCE_WEIGHT` variables are **not read** in token/OAuth mode; see §3). Each session is re-attributed to the principal behind its bearer credential. The old single-identity static bearer (`OMNIMIND_MCP_API_KEY`) still works for a personal self-hosted instance and is called the *legacy static bearer* below.

Four things people get wrong, up front:

1. **The gateway's scopes are a ceiling, not a grant.** A delegated request's effective scopes are `token.scopes ∩ (gateway.scopes − mcp:delegate)`. A gateway holding only `mcp:delegate` makes every token useless (`SCOPE_DENIED` on everything). Give the gateway `mcp:delegate` **plus all seven grantable scopes** (§1) — that list is `MCP_GATEWAY_CEILING_SCOPES` in `@boardroom/shared`.
2. **The gateway key must be one OmniMind knows.** `POST /mcp/agents` is create-only (409 on an existing name); a key that was printed but never stored makes every introspection fail and every client gets `503 auth_unavailable` (§1 "Rotation").
3. **Attribution is per token, not per gateway.** Writes, audit rows, rate buckets and idempotency scopes use the principal's `agentName` (`mcp-token:<slug>-<6 chars>` or `oauth:<client>`), never `omnimind-mcp-gateway`.
4. **Tenant ownership gates token minting.** A user can only mint a token for a tenant whose `owner_user_id` is that user (§2). Settings shows "No tenant is assigned to your account yet" until then.

---

## 0. Prerequisites

Nothing below works until these exist.

- **OmniMind API deployed** with the Lane A1 endpoints: `POST/GET /mcp/tokens`, `GET /mcp/tokens/options`, `DELETE /mcp/tokens/:id`, `POST /mcp/tokens/introspect`, `POST /mcp/identities/resolve`, `GET /mcp/identities`, `PATCH/DELETE /mcp/identities/:id`, `GET/PATCH /admin/tenants[/:id]`; migrations `20261018000000_mcp_tokens` and `20261018000001_mcp_identity_hardening` applied (entrypoint runs `migrate deploy`).
- **`OMNIMIND_ADMIN_KEY` set on omnimind-api** (`openssl rand -hex 32`). `POST /mcp/agents`, `/admin/*` and the `/mcp/identities` admin routes are `x-admin-key` gated and answer `503 admin_disabled` in production until it exists — §1 and §2 cannot run without it. Export it in the shell you run keygen from.
- **`ADMIN_EMAILS` set on boardroom-ai** (your login e-mail) so the BoardRoom Admin page works; without it `/admin` is 403 for everyone.
- **Tenants exist**: `curl -s -H "x-admin-key: $OMNIMIND_ADMIN_KEY" https://omnimind-api-production.up.railway.app/admin/tenants | jq '.[].id'` lists `josh-personal`, `josh-business`, `tgfc-ministry` (seeded by migration `20260509000000_mcp_phase_1`).
- `pnpm-lock.yaml` carries `jose` (runtime dep of the MCP package). Both the Dockerfile and CI run `pnpm install --frozen-lockfile` and fail on drift.
- Local build sanity: `pnpm --filter @boardroom/shared build && pnpm --filter @boardroom/omnimind-mcp build`.

---

## 1. Create the gateway agent (`mcp:delegate` + the scope ceiling)

Every hosted request reaches OmniMind as the gateway agent plus `x-mcp-principal`. OmniMind honours that header only from a **verified** agent (valid `x-agent-key`) whose row holds `mcp:delegate`, and then caps the principal's scopes by the gateway's. Create it **before** deploying the MCP service (§3), which refuses to start without the key.

```bash
# From a checkout with the package built. Needs OMNIMIND_API_URL, OMNIMIND_API_KEY and
# OMNIMIND_ADMIN_KEY in the shell (POST /mcp/agents is x-admin-key gated).
node packages/omnimind-mcp/dist/index.js keygen \
  --agent omnimind-mcp-gateway \
  --tenant josh-business \
  --scopes "mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write" \
  --source-weight 1.0
```

- The scope list = `mcp:delegate` + **all seven** grantable token scopes (`MCP_SCOPES` in `packages/shared/src/types/mcp-token.types.ts`: `memory:read`, `memory:write`, `decision:write`, `task:write`, `project:write`, `commitment:write`, `code:write`). The same list is exported as `MCP_GATEWAY_CEILING_SCOPES` and is what the PRM `scopes_supported` advertises; Settings offers every one of them in the token form, so a shorter ceiling silently strips scopes from tokens. The wildcard form is `mcp:delegate,*` (`intersectDelegatedScopes` treats `*` as "everything") — a bare `*` does **not** work, because delegation requires the literal `mcp:delegate`; prefer the explicit list so a future scope is not granted implicitly. To run a **read-only gateway** (e.g. a second service only for Claude.ai Research mode) use `mcp:delegate,memory:read` — write tokens connected to it get `SCOPE_DENIED` on writes, which is the point.
- Copy the printed `omk_…` key **once** into 1Password; it goes into the Railway variable `OMNIMIND_MCP_AGENT_KEY` in §3. Only its SHA-256 is stored; it cannot be shown again.
- Verify the row (no agent context on a plain `x-api-key` call, so the tenant must be named — otherwise `400 tenant_scope_required`; the body is `{ agents, count }`):
  ```bash
  curl -s -H "x-api-key: $OMNIMIND_API_KEY" \
    "https://omnimind-api-production.up.railway.app/mcp/agents?tenantId=josh-business" \
    | jq '.agents[] | select(.name=="omnimind-mcp-gateway") | {name, tenantId, scopes}'
  # All tenants at once: "?includeAllTenants=true" plus -H "x-admin-key: $OMNIMIND_ADMIN_KEY"
  ```
- The gateway **never acts on its own scopes**: a request without `x-mcp-principal` from it is just an ordinary agent call, and `x-mcp-principal` from any agent without `mcp:delegate` is `403 delegation_not_allowed`. Delegated principals are additionally confined to an allow-list of routes (the tool-backing reads/writes); anything else — including every `/mcp/tokens*` management route — is `403 delegated_route_forbidden`, and the token-management routes refuse *any* agent context, so a stolen gateway key cannot mint or list tokens.
- Once the gateway is the only MCP writer, set `OMNIMIND_REQUIRE_AGENT_KEY=true` on omnimind-api so unverified `x-agent-id` headers are refused (Known Limitation 8).

### Rotation (read before you rotate)

`POST /mcp/agents` **creates** rows; `Agent.name` is unique, so running keygen again with `--agent omnimind-mcp-gateway` answers `409 Agent name already registered` and **nothing is updated**. keygen catches that, prints the SQL below as a fallback — and still prints a fresh `omk_` key as if it were registered. **If you put that key into `OMNIMIND_MCP_AGENT_KEY` without running the SQL, OmniMind does not know it: every introspection fails `401 invalid_agent_key`, which the MCP service maps to `503 auth_unavailable` for every client, while the old key keeps working.** The previous key stays valid until the agent row's hash changes.

Two working paths:

1. **Same name, new hash (psql).** Run keygen as above, expect the 409, then run the statement it printed (the `agents` table, keyed on `name`) against the production database:
   ```sql
   INSERT INTO agents (id, name, api_key_hash, tenant_id, scopes, source_weight, created_at)
   VALUES (gen_random_uuid()::text, 'omnimind-mcp-gateway', '<sha256 of the new key — printed by keygen>', 'josh-business',
           ARRAY['mcp:delegate', 'memory:read', 'memory:write', 'decision:write', 'task:write', 'project:write', 'commitment:write', 'code:write']::text[], 1, NOW())
   ON CONFLICT (name) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, tenant_id = EXCLUDED.tenant_id, scopes = EXCLUDED.scopes, source_weight = EXCLUDED.source_weight;
   ```
   The old key is invalid the moment this commits — the running MCP service starts failing introspection, so set the new `OMNIMIND_MCP_AGENT_KEY` and redeploy immediately after.
2. **New name, no SQL.** `keygen --agent omnimind-mcp-gateway-2 --tenant josh-business --scopes "<same ceiling>"` (201, new row), set `OMNIMIND_MCP_AGENT_KEY` to the new key, redeploy, then retire the old row (`UPDATE agents SET scopes = '{}' WHERE name = 'omnimind-mcp-gateway';` or delete it). Audit rows are attributed to the token principals, not the gateway, so the name change is invisible in the data.

Either way: verify with the `GET /mcp/agents?tenantId=…` curl above, then watch the first `initialize` after the redeploy succeed (§7b). A `503` on every authenticated request right after a rotation is this, nothing else.

---

## 2. Set tenant owners

`POST /mcp/tokens` only succeeds for a tenant whose `owner_user_id` is the requesting user (`mcp-token.service.ts`); `GET /mcp/tokens/options` lists exactly those tenants, and BoardRoom's panel shows "No tenant is assigned to your account yet" when the list is empty.

```bash
# List (x-admin-key)
curl -s -H "x-admin-key: $OMNIMIND_ADMIN_KEY" https://omnimind-api-production.up.railway.app/admin/tenants | jq .
# Set the owner (404 user_not_found if the cuid is wrong)
curl -s -X PATCH -H "x-admin-key: $OMNIMIND_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"ownerUserId":"<user cuid>"}' https://omnimind-api-production.up.railway.app/admin/tenants/josh-business
```

Repeat for `josh-personal` and `tgfc-ministry`. SQL fallback from the post-audit checklist: `UPDATE tenants SET owner_user_id = '<user cuid>' WHERE id IN (…);`. Verify with the `GET` — no `null` owners for tenants you expect tokens to target.

**OAuth and multiple owned tenants.** OAuth auto-link (§9) creates the identity row on first use and binds it to **one** tenant: when the user owns several, it picks the **oldest-created** owned tenant (`josh-personal` if it was seeded first). That is deterministic but may not be the tenant you want an OAuth client in; change it afterwards with the identities admin routes (`x-admin-key`):

```bash
curl -s -H "x-admin-key: $OMNIMIND_ADMIN_KEY" "https://omnimind-api-production.up.railway.app/mcp/identities?userId=<user cuid>" | jq .
curl -s -X PATCH -H "x-admin-key: $OMNIMIND_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"tenantId":"josh-business","scopes":["memory:read","memory:write"]}' https://omnimind-api-production.up.railway.app/mcp/identities/<identity id>
curl -s -X DELETE -H "x-admin-key: $OMNIMIND_ADMIN_KEY" https://omnimind-api-production.up.railway.app/mcp/identities/<identity id>   # next OAuth use re-links
```

`omt_` tokens are unaffected: each token names its tenant at minting time.

---

## 3. Deploy the MCP service on Railway

A plain Node HTTP process: no database, no Prisma, no prompts directory, no bash. Built from `packages/omnimind-mcp/Dockerfile` (same two-stage node:20-alpine / pnpm 10.32.1 / shared-first / `pnpm deploy --legacy` pattern as the other services; `.dockerignore` keeps host `node_modules`/`dist` out of the context; CI's `docker` matrix builds it from the repo root). You need the gateway key from §1 in hand: **the service exits 1 at startup without it** (`OMNIMIND_MCP_TOKEN_AUTH=true requires OMNIMIND_MCP_AGENT_KEY`), and `railway.toml`'s `restartPolicyMaxRetries = 3` then leaves it down.

1. Railway → **New Service → GitHub Repo → boardroom-platform**. Name it `omnimind-mcp`.
2. **Settings → Build.** The Dockerfile `COPY`s repo-root files (`package.json`, `pnpm-lock.yaml`, `turbo.json`) and `packages/shared/`, so the **build context must be the repository root** — this is the same shape CI uses (`docker build -f packages/omnimind-mcp/Dockerfile .`). Leave **Root Directory** at `/` (repo root), set the variable `RAILWAY_DOCKERFILE_PATH=packages/omnimind-mcp/Dockerfile`, and point config-as-code at the package file: **Settings → Config-as-code → config file path = `packages/omnimind-mcp/railway.toml`** (`RAILWAY_CONFIG_FILE=packages/omnimind-mcp/railway.toml` if your dashboard exposes it as a variable). Without that last setting Railway looks for `railway.toml` at the repo root, finds none, and you silently lose `healthcheckPath = "/health"` and `numReplicas = 1` (the session-affinity guard). If the build fails on `COPY package.json turbo.json …`, the context is not the repo root — the Root Directory was changed.
3. **Settings → Networking**: generate a **public** domain now (you need the host for `OMNIMIND_MCP_ALLOWED_HOSTS` below), e.g. `omnimind-mcp-production.up.railway.app`. Claude.ai connectors connect from Anthropic's cloud, so the host must be publicly reachable (no IP allowlist, or allowlist Anthropic's published ranges).
4. **Variables.** Which ones a mode reads (the hosted gateway is the **Token** column; add the **OAuth** column for §9; **Static** is the legacy personal instance):

| Variable | Value (hosted) | Static | Token | OAuth | Notes |
|---|---|:-:|:-:|:-:|---|
| `PORT` | *(Railway injects)* | auto | auto | auto | `index.ts` reads `PORT` (default 3334) and listens without a host, i.e. on `::`. Never set manually. |
| `OMNIMIND_API_URL` | `http://omnimind-api.railway.internal:3333` | yes | yes | yes | **Private network, http.** Port = whatever omnimind-api's `PORT` is (`docs/03-operations/PRIVATE-NETWORKING.md`). Fallback: the public `https://omnimind-api-production.up.railway.app`. |
| `OMNIMIND_API_KEY` | same value as omnimind-api | yes | yes | yes | Shared service key (`x-api-key`). |
| `OMNIMIND_MCP_AGENT_KEY` | `omk_…` from §1 | — | **yes** | **yes** | The gateway's key, sent as `x-agent-key` on introspection, identity resolution and every delegated call. The server **refuses to start** in token/OAuth mode without it. Not used by the static identity. |
| `OMNIMIND_MCP_TOKEN_AUTH` | `true` | — | **yes** | optional | Accept `omt_` tokens (`POST /mcp/tokens/introspect`). Token and OAuth coexist on one endpoint. |
| `OMNIMIND_MCP_ALLOWED_HOSTS` | `omnimind-mcp-production.up.railway.app` | yes | **yes** | **yes** | Exact `Host` values the DNS-rebinding guard accepts: the bare public host (Railway's proxy sends no port) plus any custom domain, comma-separated. Wrong ⇒ every MCP call is `403 Invalid Host header` while `/health` still passes. Printed at startup. |
| `OMNIMIND_MCP_TRUST_PROXY` | `true` | yes (behind a proxy) | **yes** | **yes** | Attribute requests to the right-most `X-Forwarded-For` entry for the per-IP authentication-failure limiter (30 failures/min, `429` + `Retry-After`). Railway terminates TLS in front of the service, so without this every client shares the proxy's one bucket and one bad token locks everyone out. Leave unset only for a direct loopback/LAN instance. |
| `OMNIMIND_MCP_PUBLIC_URL` | `https://omnimind-mcp-production.up.railway.app/mcp` | recommended | **yes** | **yes** | This server's resource identifier: PRM `resource`, default OAuth audience; checked as an http(s) URL at startup. Must equal BoardRoom's `OMNIMIND_MCP_PUBLIC_URL` exactly (§4). Hard-required only with an issuer. |
| `OMNIMIND_MCP_APP_URL` | `https://boardroom-ai-production-1092.up.railway.app` | yes | **yes** | **yes** | `fetch`/`search` result URLs (`<app>/memory/<id>`). Nothing else reads it. |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | writes | writes | writes | Haiku fact extraction inside `memory_write`. Omit on a read-only deployment; `memory_write` then fails with `FACT_EXTRACTOR_UNAVAILABLE`. |
| `OMNIMIND_MCP_API_KEY` | *(unset)* | **yes** | unset | unset | Legacy static inbound bearer. Leave unset on the hosted gateway so the only credentials are per-user. The server exits 1 when none of static bearer / token auth / OAuth issuer is configured. |
| `OMNIMIND_MCP_STATIC_AGENT_KEY` | *(unset)* | recommended | — | — | The static identity's **own** `omk_` key (keygen for that agent). Lets a legacy static instance present a verified `x-agent-key` once `OMNIMIND_REQUIRE_AGENT_KEY=true`; the gateway key is never used for static callers. |
| `OMNIMIND_MCP_AGENT_NAME` / `OMNIMIND_MCP_TENANT_ID` / `OMNIMIND_MCP_SCOPES` / `OMNIMIND_MCP_SOURCE_WEIGHT` | *(unset)* | **yes** | not read | not read | The static/stdio process identity. **The hosted gateway never reads them** — its identity, tenant and scope ceiling come from the agent row behind `OMNIMIND_MCP_AGENT_KEY`, and nothing compares the env with the row. Only the legacy static bearer, stdio, `bench` and `smoke` need `AGENT_NAME` + `TENANT_ID`. |
| `OMNIMIND_MCP_USER_ID` | *(unset)* | optional | — | — | Static / stdio only: user the `omnimind://` resources read as. Delegated sessions bind the token's user. |
| `OMNIMIND_MCP_OAUTH_ISSUER` / `OMNIMIND_MCP_OAUTH_JWKS_URL` / `OMNIMIND_MCP_OAUTH_AUDIENCE` | *(empty)* | — | — | issuer **yes** | OAuth resource-server mode (§9). JWKS is discovered from the issuer when the URL is unset; audience defaults to `OMNIMIND_MCP_PUBLIC_URL`. |
| `OMNIMIND_MCP_DOCS_URL` | *(optional)* | opt | opt | opt | PRM `resource_documentation`; defaults to `docs/MEMORY-PROTOCOL.md` on GitHub. |
| `OMNIMIND_MCP_WRITE_EXTRACT` | `sync` | opt | opt | opt | `async` returns from `memory_write` before Haiku fact extraction finishes (§7c). Deferred extraction runs on a long-lived client, so it completes even after the session that started it ends. |
| `OMNIMIND_MCP_SESSION_IDLE_MS` | `1800000` | opt | opt | opt | Idle session timeout; cap 100 live sessions, least-recently-seen evicted. |
| `NODE_ENV` | `production` | set by the image | | | Also gates `bench --yes` (§7c). |

5. Deploy. The log must show: `HTTP transport started on port <PORT>` → the enabled auth modes (`omt_ tokens (introspection)`, plus `OAuth (issuer …, audience …)` when set; **not** `static key`) → `allowedHosts: <your host>` without the `(default — loopback only)` suffix → `sessions: idle timeout 1800s, cap 100` → `auth failure limit: … client IP from right-most X-Forwarded-For` (the `socket peer (set OMNIMIND_MCP_TRUST_PROXY=true …)` variant on Railway means the limiter is keyed on the proxy). An exit with `requires OMNIMIND_MCP_AGENT_KEY` means §1 was skipped.
6. `curl -s https://<mcp-host>/health` → `{"status":"ok","uptime":<s>,"sessions":0}` — exactly those three keys; unauthenticated and deliberately silent about agents and tenants.

Rollback: Railway → Deployments → redeploy the previous image. Nothing in OmniMind or BoardRoom depends on this service being up.

---

## 4. BoardRoom variables (Settings → Connected AI tools)

The token panel and its install snippets are rendered by BoardRoom from `GET /api/mcp/tokens/connect-info` → `{ mcpUrl, appUrl, oauthEnabled }`. Set on the **boardroom-ai** service:

| Variable | Value | Effect |
|---|---|---|
| `OMNIMIND_MCP_PUBLIC_URL` | `https://omnimind-mcp-production.up.railway.app/mcp` — **identical** to the MCP service's value | `mcpUrl` in every snippet. Unset ⇒ snippets show the placeholder `https://<your-omnimind-mcp-host>/mcp`. |
| `APP_PUBLIC_URL` | `https://boardroom-ai-production-1092.up.railway.app` | `appUrl` (links back to Settings in the snippets). Optional: falls back to the request origin. |
| `OMNIMIND_MCP_OAUTH_ISSUER` | same issuer as the MCP service, **only** when §9 is configured | `oauthEnabled: true` ⇒ the Claude.ai / Claude Desktop and ChatGPT snippets show the OAuth path **first** and the header path as the alternative. Leave unset in token-only mode or the snippets promise a sign-in flow the server cannot serve. |

`connect-info` and `GET /api/mcp/tokens/options` sit behind the login cookie only (not behind the subscription middleware), so a user can always see the panel and their tenants. Redeploy BoardRoom after changing these; nothing on the MCP side depends on them.

---

## 5. Create a personal token

BoardRoom → **Settings → Connected AI tools**. Pick the client (it pre-fills the token name and renders the right snippet), the tenant (only tenants you own are offered — §2) and the scopes (all seven are offered; the gateway ceiling from §1 is what makes them effective). The `omt_…` value (`omt_` + 43 base64url chars) is shown **once**; the list afterwards shows only the 12-char prefix, expiry, last-used time and a Revoke button.

- **Expiry.** Tokens expire **365 days** after minting by default. The scripted API accepts `expiresInDays` (shorter) or `expiresInDays: null` for a non-expiring token; an expired token is `401 invalid_token` like a revoked one.
- **Revocation.** The row gets `revoked_at`; the MCP server caches a positive resolution for up to **60 s** and a live session keeps its resolved identity until the next resolution, so expect the client to lose access **within about a minute**, not within one request (the Settings page and the snippets say the same).

Recommended scopes per client:

| Client | Scopes | Why |
|---|---|---|
| Claude.ai / Claude Desktop connector | `memory:read` first; add `memory:write` after a week of dogfooding | Research mode invokes connector tools without further approval. |
| Claude Code, Cursor, Windsurf, VS Code, Zed | `memory:read,memory:write,decision:write,task:write,commitment:write` (+ `code:write` for repository notes) | Agentic coding sessions log decisions and tasks. |
| ChatGPT | `memory:read` | `search`/`fetch` only. |
| Gemini CLI | `memory:read,memory:write` | |

Scripted equivalent: `POST /mcp/tokens` on OmniMind (contract) or `POST /api/mcp/tokens` on BoardRoom with the user's cookie. Token-management routes on OmniMind refuse any agent context, so they cannot be reached through the MCP gateway.

---

## 6. Install in each client

Every HTTP client needs the same two facts: the server URL **`https://<mcp-host>/mcp`** and the header `Authorization: Bearer omt_…`. The Settings page renders these snippets with the real URL and token filled in (`mcp-snippets.ts` is the source of truth; this section mirrors it). Stdio configs (`docs/agent-configs/*.json`, `omnimind-local` entries) remain for running the server locally with an `omk_` agent key — not needed for the hosted path.

### Claude.ai and Claude Desktop (custom connector)
Settings → **Connectors** → *Add custom connector* → name `OmniMind`, Remote MCP server URL `https://<mcp-host>/mcp`. The dialog differs by plan, so the Settings page shows two paths and leads with OAuth when the server advertises an issuer:

- **OAuth mode** (issuer configured, §9): leave *Advanced settings* empty; Claude discovers the issuer from the PRM document and asks you to sign in when you enable the connector — no token needed. OAuth sign-in grants read-only access by default (`memory:read`); a token carries exactly the scopes you picked.
- **Token mode:** expand *Advanced settings*; **if it shows a header field** ("Authorization" or a custom header) paste `Authorization: Bearer omt_…` there and leave OAuth Client ID / Client Secret empty. The header field is not offered on every plan — if it is missing and OAuth is not configured, the connector cannot take a token; use the Claude Code command below (works everywhere) or, on Claude Desktop, `claude_desktop_config.json` bridged with `mcp-remote` (no header field needed):
  ```json
  { "mcpServers": { "omnimind": { "command": "npx", "args": ["-y", "mcp-remote", "https://<mcp-host>/mcp", "--header", "Authorization:Bearer omt_…"] } } }
  ```

Add, then enable the connector in a chat from the tools menu. Claude Desktop shares Claude.ai's connector list; the `claude_desktop_config.json` route above is the only reason to edit that file for the hosted server.

### Claude Code
```bash
claude mcp add --transport http omnimind https://<mcp-host>/mcp --header "Authorization: Bearer omt_…"
# add --scope user to make it available in every project; `claude mcp list` should report it connected
```
Claude Code loads the server `instructions` at session start (truncated at 2,048 chars) and uses them for tool search; `/mcp` shows connection state and re-auth in OAuth mode.

### ChatGPT (Developer mode)
Settings → **Connectors** → *Advanced* → enable **Developer mode** → *Create* → name `OmniMind`, URL `https://<mcp-host>/mcp`. Authentication: **when the server has an OAuth issuer (§9), choose OAuth** — ChatGPT completes the sign-in itself, no token needed (read-only by default; a token carries exactly its scopes). Without an issuer: developer-mode connectors normally offer only *OAuth* or *No authentication*; a personal token works **only if** the dialog also shows a custom header / API-key field — paste the header there. If it does not, ChatGPT cannot use a token until the operator sets `OMNIMIND_MCP_OAUTH_ISSUER` (and the matching BoardRoom variable, §4). ChatGPT uses the read-only `search` and `fetch` tools (`readOnlyHint: true`, so no confirmation prompt); Deep Research and company knowledge retrieve through that pair only.

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

## 7. Verification

Run these from any machine after each deploy. Replace `<mcp-host>` and `omt_…`.

POST responses from `/mcp` are **SSE frames** (`event: message` / `data: {…}`) by default — piping them straight into `jq` fails on the `event:` line. This helper reduces either shape to the JSON-RPC body, so the pipelines below work whether the server answers SSE or plain JSON:

```bash
mcpjson() { sed -n '/^data: /{s/^data: //;p;d}; /^{/p'; }
```

**a. Health, discovery, fail-closed**
```bash
curl -s https://<mcp-host>/health | jq .                                   # {status, uptime, sessions}
curl -s -i https://<mcp-host>/.well-known/oauth-protected-resource | head -1  # 200 in OAuth mode, 404 in token-only mode
curl -s -i -X POST https://<mcp-host>/mcp -H 'content-type: application/json' -d '{}' | sed -n '1p;/^www-authenticate/Ip;/^{/p'
# no credential:  HTTP/1.1 401 · WWW-Authenticate: Bearer realm="omnimind-mcp"[, resource_metadata=…] · body {"error":"unauthorized"}
curl -s -i -X POST https://<mcp-host>/mcp -H 'Authorization: Bearer omt_bogus' -H 'content-type: application/json' -d '{}' | sed -n '1p;/^www-authenticate/Ip;/^{/p'
# bad credential: HTTP/1.1 401 · WWW-Authenticate: Bearer realm="omnimind-mcp", error="invalid_token"[, resource_metadata=…] · body {"error":"invalid_token"}
# (403 on either = allowedHosts wrong). The specific reason is only in the service log, never in the body.
# Failures are rate-limited per client IP (30/min): a burst of the bogus call ends in 429 {"error":"too_many_requests"} + Retry-After.
# If one bad token from a laptop 429s *every* client, OMNIMIND_MCP_TRUST_PROXY is unset and the bucket is keyed on Railway's proxy.
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
curl -s -X POST https://<mcp-host>/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | mcpjson | jq '.result.tools | length'   # 20
curl -s -X POST https://<mcp-host>/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status_get","arguments":{}}}' | mcpjson | jq '.result.structuredContent.counts'
curl -s -X DELETE https://<mcp-host>/mcp -H "Authorization: Bearer omt_…" -H "mcp-session-id: $SID"
```
A token without `memory:write` must get `{ "error": "SCOPE_DENIED" }` from `memory_write` (a tool result, not a transport error). A revoked token gets `401` on a new session within 60 s. A wrong/unknown credential is `401` with body `{"error":"invalid_token"}` (no credential at all: `{"error":"unauthorized"}`); OmniMind unreachable — or a gateway key OmniMind does not know (§1 "Rotation") — is `503 auth_unavailable` with `Retry-After` (never cached). A session is bound to its principal **and** that principal's scope digest: a request whose credential now resolves to different scopes (token edited, identity re-scoped) is refused and the client must re-`initialize`.

**c. Write-latency bench (`memory_write`)**
```bash
# Runs memory_write N times IN-PROCESS (not over HTTP) with the stdio/gateway env —
# OMNIMIND_API_URL, OMNIMIND_API_KEY, OMNIMIND_MCP_AGENT_NAME, OMNIMIND_MCP_TENANT_ID, OMNIMIND_MCP_AGENT_KEY, ANTHROPIC_API_KEY —
# then compares with the server-side figures from GET /mcp/audit/stats.
NODE_ENV=development node packages/omnimind-mcp/dist/index.js bench --n 10 --user <user id> [--domain general] [--since-hours 24]
# Outside NODE_ENV=development (e.g. the Railway service shell) the real writes need an explicit opt-in:
node packages/omnimind-mcp/dist/index.js bench --n 10 --user <user id> --yes
```
It refuses to start without `OMNIMIND_API_URL`, `OMNIMIND_API_KEY`, `OMNIMIND_MCP_AGENT_NAME`, `OMNIMIND_MCP_TENANT_ID` and a user (`--user` or `OMNIMIND_MCP_USER_ID`) — the bench is the one place the hosted gateway's deployment does *not* already carry the name/tenant pair, so export them in the shell. **It performs real writes**: N low-importance (0.1) memories tagged `bench` under that user, each with its own `idempotencyKey`. `--cleanup` is **on by default** and archives them when the run ends (`--no-cleanup` keeps them for inspection; `memory_search` tag `bench` finds them); `--yes` is required whenever `NODE_ENV` is not `development`, because the run spends real Haiku tokens as well. Prints local p50/p95/min/max/mean plus the server-side p50/p95 and error rate for `memory_write` over the last `--since-hours`. Run it from a shell whose network path to OmniMind matches production (Railway service shell, or locally with the public API URL and note the extra hop). Budget: `memory_write` p95 **< 10 s** is comfortable (Haiku extraction dominates); the tool itself warns above **20 s** (`BENCH_ASYNC_THRESHOLD_MS`) — Claude Code backgrounds calls past two minutes and some clients time out at 60 s. Above that, set `OMNIMIND_MCP_WRITE_EXTRACT=async` on the Railway service: `memory_write` returns the raw row id immediately and extraction completes afterwards on a long-lived client (the extracted facts supersede the raw row; they show up in `memory_search` a few seconds later). Re-run after the switch. Read latency is covered by §7b: time the `status_get` call there; p95 **< 1.5 s** end to end over the public URL is the target.

**d. Attribution + audit**
`GET /mcp/audit` with the plain service key has no agent context, so name the tenant (or opt into all tenants with `x-admin-key`); the body is `{ entries, count }`:
```bash
curl -s -H "x-api-key: $OMNIMIND_API_KEY" \
  "https://omnimind-api-production.up.railway.app/mcp/audit?limit=20&tenantId=josh-business" \
  | jq '.entries[] | {agentId, toolName, durationMs}'
# every tenant: "…/mcp/audit?limit=20&includeAllTenants=true" -H "x-admin-key: $OMNIMIND_ADMIN_KEY"
```
Every call above appears with `agentId` = the token's `agentName` (`mcp-token:<slug>-<6>`), not the gateway. Failed calls are logged too. `GET /mcp/audit/stats` aggregates per agent.

**e. Two users, one URL** — tokens for two users/tenants: a `memory_write` from A is not returned by `memory_search` from B; the same search from A finds it. This is the property the single-identity transport could not provide.

**f. Built-in smoke (local, stdio)** — `node packages/omnimind-mcp/dist/index.js smoke` verifies registration (20 tools with `annotations` + `outputSchema`, 3 prompts, 4 resource templates); like `bench` it needs `OMNIMIND_MCP_AGENT_NAME` + `_TENANT_ID` in the shell. `docs/agent-configs/SMOKE-TESTS.md` has the full tiered checklist (Tier 8 = hosted).

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

## 9. OAuth option (resource-server mode)

The MCP server is an OAuth 2.1 **resource server**, not an authorization server. Set `OMNIMIND_MCP_OAUTH_ISSUER` (and optionally `_JWKS_URL`, `_AUDIENCE`) on the MCP service — plus `OMNIMIND_MCP_OAUTH_ISSUER` on BoardRoom so the snippets switch to OAuth-first (§4) — and it verifies incoming JWTs with `jose` — asymmetric algorithms only (RS256/ES256/EdDSA), `iss` = issuer, `aud` = audience (RFC 8707; defaults to `OMNIMIND_MCP_PUBLIC_URL`), `exp`/`sub` required, 30 s clock skew — then resolves the principal through `POST /mcp/identities/resolve` with `{issuer, subject, email?, emailVerified?, clientId?}`. A user is **auto-linked by verified e-mail** on first use (claim `email` with `email_verified: true` matching a BoardRoom user who owns at least one tenant; with several owned tenants the **oldest-created** one is bound — §2 shows how to move it); otherwise the credential is `401 unlinked`. The identity row's `agentName` is `oauth:<clientId or issuer host>-<8 chars of the row id>` (unique per identity since migration `20261018000001`) with the default OAuth scopes — **`memory:read` only** (`MCP_OAUTH_DEFAULT_SCOPES`), which is why the snippets say OAuth sign-in is read-only by default; a `scope` claim on the token narrows further (`intersectScopes`), and an admin widens or re-tenants the row with `PATCH /mcp/identities/:id {scopes, tenantId}`.

- **Issuer allow-list on OmniMind.** Optional `MCP_OAUTH_ALLOWED_ISSUERS` (comma-separated) on omnimind-api makes `POST /mcp/identities/resolve` refuse any issuer not listed, so a misconfigured gateway cannot link identities from an unexpected provider. Set it to the same issuer URL when you turn OAuth on.
- Discovery: `GET https://<mcp-host>/.well-known/oauth-protected-resource` (and `…/oauth-protected-resource/mcp` for path-scoped clients) returns RFC 9728 metadata `{ resource, authorization_servers: [issuer], scopes_supported, bearer_methods_supported: ["header"], resource_documentation }`; `scopes_supported` is `MCP_SCOPES` from `@boardroom/shared` (all seven). **It is served only when OAuth is configured** — in token-only mode it is `404`, and `WWW-Authenticate` on a 401 carries `resource_metadata="…"` only in OAuth mode.
- Client registration is the **issuer's** job. Claude.ai and Claude Code prefer **Client ID Metadata Documents (CIMD)** and use them only when the authorization server advertises `client_id_metadata_document_supported` and `none` in `token_endpoint_auth_methods_supported`; Dynamic Client Registration (RFC 7591) is deprecated in MCP spec 2026-07-28 but still what Cursor, Gemini CLI and Copilot Studio use; static pre-registered clients are the third path. Pick an issuer (WorkOS AuthKit, Ory Hydra, Auth0, …) that supports all three — ADR-014.
- We validate tokens from **one configured issuer**, with no consent-time scope picker and no built-in authorization server. Token auth (`omt_`) and OAuth coexist on the same endpoint; the server decides by shape (`omt_` prefix vs compact JWS).
- Startup refuses an issuer without `OMNIMIND_MCP_PUBLIC_URL` or without `OMNIMIND_MCP_AGENT_KEY` (identity resolution is a delegated call).

---

## 10. Operations reference (unchanged behaviour, kept short)

**HTTP transport.** One MCP session per `initialize` (`mcp-session-id`; clients must echo it), `GET` opens the SSE stream, `DELETE` ends the session, bodies capped at 1 MiB (413), handler failures → 500 JSON with the process kept alive. The credential is resolved when the session is created and the session is bound to that principal **and its scope digest**. Idle sessions close after `OMNIMIND_MCP_SESSION_IDLE_MS` (client sees `404 Session not found` and re-`initialize`s); at 100 live sessions a new `initialize` evicts the least-recently-seen one. Repeated authentication failures from one IP (30 per minute, token bucket) are answered `429 too_many_requests` with `Retry-After`; the IP is the right-most `X-Forwarded-For` entry when `OMNIMIND_MCP_TRUST_PROXY=true`, else the socket peer. Sessions are in-memory: **one replica only** until they are externalized.

**Delegated route allow-list (omnimind-api).** A request carrying `x-mcp-principal` may only reach the routes the MCP tools need (memories, decisions, tasks, projects, people, commitments, status, graph, audit write, introspection/identity resolution as the gateway). Anything else is `403 delegated_route_forbidden`; the `/mcp/tokens*` management routes additionally refuse **any** agent context (`x-agent-id` / `x-agent-key`), so neither the gateway nor a personal token can mint, list or revoke tokens — only a BoardRoom user session can.

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

**Legacy static bearer / stdio.** A personal instance can still run `node dist/index.js http` with `OMNIMIND_MCP_API_KEY` as the single inbound token and the process identity (`OMNIMIND_MCP_AGENT_NAME` / `_TENANT_ID` / `_SCOPES` / `_SOURCE_WEIGHT`) as the only agent — give it that agent's own key as `OMNIMIND_MCP_STATIC_AGENT_KEY` — or stdio with the `omnimind-local` configs in `docs/agent-configs/`, which carry the agent's `omk_` key as `OMNIMIND_MCP_AGENT_KEY` (stdio is a single-identity process: it uses `OMNIMIND_MCP_STATIC_AGENT_KEY` when set, else `OMNIMIND_MCP_AGENT_KEY`). All these keys come from keygen (`docs/agent-configs/keygen-commands.sh`). Never expose static-bearer mode on a shared URL.

---

## 11. Common errors

| Error | Cause | Fix |
|---|---|---|
| `403 Invalid Host header` on every MCP call, `/health` fine | `OMNIMIND_MCP_ALLOWED_HOSTS` lacks the exact `Host` the proxy sends | Set it to the bare public host (+ custom domain); redeploy; check the startup `allowedHosts:` line |
| Exits 1: `No inbound authentication configured for HTTP mode` | None of static bearer / `OMNIMIND_MCP_TOKEN_AUTH=true` / OAuth issuer set | Set `OMNIMIND_MCP_TOKEN_AUTH=true` (hosted) or a static bearer (personal) |
| Exits 1: `OMNIMIND_MCP_TOKEN_AUTH=true requires OMNIMIND_MCP_AGENT_KEY` (or the OAuth variant) | Gateway key missing — §1 was skipped or run after the deploy | §1, then redeploy |
| Exits 1: `OMNIMIND_MCP_OAUTH_ISSUER requires OMNIMIND_MCP_PUBLIC_URL` | Resource identifier missing | Set `OMNIMIND_MCP_PUBLIC_URL=https://<mcp-host>/mcp` |
| `503 auth_unavailable` on every authenticated request **right after a key rotation** | `OMNIMIND_MCP_AGENT_KEY` holds a key OmniMind never stored (keygen 409, SQL not run) | §1 "Rotation": run the `ON CONFLICT` SQL or create a new agent name; the agent row must hash to the key in the variable |
| `503 auth_unavailable` otherwise | OmniMind (or the OAuth issuer's JWKS) unreachable from the MCP service | Private hostname/port in `OMNIMIND_API_URL`; `curl` it from the service shell |
| `401` body `{"error":"invalid_token"}` with a fresh `omt_` token | `token auth is not enabled`, token revoked/expired (365-day default), or minted on a different OmniMind — the exact reason is in the service log, not the body | Check the startup auth-mode line, the token in Settings, and `OMNIMIND_API_URL` |
| `401` body `{"error":"unauthorized"}` | No credential reached the server (client dropped the header, or sent it on a path other than `/mcp`) | Fix the client config; the header must be on every request |
| `429 too_many_requests` from `/mcp` | Per-IP authentication-failure limiter (30/min) after a burst of bad credentials | Wait out `Retry-After`; fix the credential |
| `429` hits **every** client at once after one bad token | `OMNIMIND_MCP_TRUST_PROXY` unset behind Railway's proxy → one bucket for the proxy's address | Set `OMNIMIND_MCP_TRUST_PROXY=true`; redeploy; check the startup `auth failure limit:` line |
| Every tool returns `SCOPE_DENIED`, even reads | Gateway agent row holds only `mcp:delegate` → `token ∩ (gateway − mcp:delegate) = ∅` | Give the row the full ceiling (§1 "Rotation" path 1 updates scopes too) |
| A token minted with `code:write` (or another scope) behaves as if it lacked it | Gateway row's ceiling is shorter than the seven grantable scopes | Same fix — the row must carry `MCP_GATEWAY_CEILING_SCOPES` |
| `403 delegation_not_allowed` | `x-mcp-principal` from an agent without `mcp:delegate`, or an unverified key | Verify `GET /mcp/agents?tenantId=…` shows the scope; rotate `OMNIMIND_MCP_AGENT_KEY` per §1 |
| `403 delegated_route_forbidden` | A delegated principal reached a route outside the MCP allow-list (e.g. `/mcp/tokens`) | Expected — token management is a BoardRoom-session operation (§5) |
| `400 tenant_scope_required` from `GET /mcp/agents` or `GET /mcp/audit` | Service-key call without agent context and without a tenant | Add `?tenantId=<id>`, or `?includeAllTenants=true` + `x-admin-key` |
| `409 Agent name already registered` from keygen | Agent exists — `POST /mcp/agents` is create-only | §1 "Rotation" (SQL upsert or a new name); do **not** deploy the printed key as is |
| `503 admin_disabled` from keygen / `/admin/*` | `OMNIMIND_ADMIN_KEY` unset on omnimind-api in production | §0 |
| Settings: "No tenant is assigned to your account yet" / `POST /mcp/tokens` 403 | `tenants.owner_user_id` not set to this user | §2 |
| OAuth `401 unlinked` | `email` claim missing/unverified, no BoardRoom user with that address owning a tenant, or the identity row was revoked | Create the user, set a tenant owner (§2), issuer must emit `email_verified`; a revoked row stays unlinked until `DELETE /mcp/identities/:id` lets the next sign-in re-link |
| OAuth `401` with reason `issuer_not_allowed` (OmniMind log: "issuer refused by MCP_OAUTH_ALLOWED_ISSUERS") | The API's allow-list is set and does not contain this issuer | Add the issuer to `MCP_OAUTH_ALLOWED_ISSUERS` on omnimind-api (same string as `OMNIMIND_MCP_OAUTH_ISSUER`) |
| OAuth client can only read | Default OAuth scopes are `memory:read` | `PATCH /mcp/identities/:id {"scopes":[…]}` (§2), or use an `omt_` token with the scopes you need |
| OAuth identity landed in the wrong tenant | Auto-link bound the oldest-created owned tenant | `PATCH /mcp/identities/:id {"tenantId": …}` (§2) |
| OAuth `401 err_jwt_claim_validation_failed` (aud) | `OMNIMIND_MCP_OAUTH_AUDIENCE` / `PUBLIC_URL` ≠ the resource the issuer minted for | Make audience == `OMNIMIND_MCP_PUBLIC_URL` on both sides |
| PRM returns 404 | OAuth not configured (expected) | Only set the issuer vars if you need OAuth clients |
| ChatGPT / Claude.ai offers no header field, or rejects header auth | Plan or workspace allows OAuth connectors only | §9, then set `OMNIMIND_MCP_OAUTH_ISSUER` on BoardRoom too (§4) |
| `400 no valid session ID` | Client skipped `initialize` or dropped `mcp-session-id` | Client bug; sessions are required on the 2025-era protocol |
| `404 Session not found` after a pause | Idle timeout or eviction | Client re-initializes; raise `OMNIMIND_MCP_SESSION_IDLE_MS` if it happens mid-conversation |
| Session refused after a token's scopes changed | Session is bound to principal + scope digest | Client re-`initialize`s (new session) |
| `FACT_EXTRACTOR_UNAVAILABLE` on `memory_write` | `ANTHROPIC_API_KEY` unset on the MCP service, or Haiku timeout | Set the key; transient → retry with the same `idempotencyKey`; persistent → `OMNIMIND_MCP_WRITE_EXTRACT=async` |
| `bench` refuses to run: `--yes` required | `NODE_ENV` is not `development` and the bench performs real writes | Add `--yes` (rows are archived afterwards unless `--cleanup=false`) |
| `Ministry embedding unavailable` | Ollama down | Start Ollama; never fall back |
| `VALIDATION_ERROR … cursor` | Client edited an opaque cursor | Pass `nextCursor` back verbatim |
| `Output validation error … structured content` | OmniMind returned a shape outside the tool's `outputSchema` | Fix the API shape (`packages/shared/src/validation/mcp.schema.ts`); do not loosen the schema |
| Resource read `NO_USER_BOUND` (stdio only) | `OMNIMIND_MCP_USER_ID` unset | Set it, or use tools (which take `userId`) |
| Resource read `TENANT_MISMATCH` | URI tenant ≠ bound tenant | Cross-tenant reads are impossible by design |
