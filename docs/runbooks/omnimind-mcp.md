# OmniMind-MCP Runbook — from checkout to "live"

Last updated: 2026-10-22 | Hosted MCP front door (per-user `omt_` tokens, OAuth resource server, `search`/`fetch`, Dockerfile + Railway service)

## One-command path

`scripts/mcp-go-live.sh` runs §0–§7 below in order, idempotently (every step reads before it writes; re-running skips what exists). The manual sections stay the reference for what each step does and how to recover when one fails.

**From a laptop** (`railway login` done, `gh auth login` done, `curl`, `node`, `openssl` on PATH; `railway` via `npm i -g @railway/cli`):
```bash
pnpm go-live:mcp -- --project <railway project id> --owner-email <your BoardRoom e-mail> --dry-run               # plan only
pnpm go-live:mcp -- --project <railway project id> --owner-email <your BoardRoom e-mail> --backup-ok --yes      # execute
```

**Preconditions — checked before any write; the run aborts with nothing changed when one fails** (Phase 8 M1-A2):
- **The latest `ci.yml` run on `main` is `completed` + `success`**, read with `gh api repos/<owner>/<repo>/actions/workflows/ci.yml/runs?branch=main&per_page=1` (repo from `--repo`, `$GITHUB_REPOSITORY` or the `origin` remote; workflow via `--ci-workflow`). A red, still-running or unreadable result aborts (fail closed: no `gh`, or `gh` not authenticated, is an abort too). If the checkout's `HEAD` is not the green run's SHA the script warns — `railway up` deploys the checkout.
- **Backup evidence**: `--backup-ok` (you have a fresh prod `pg_dump` with a restore-drill row in `docs/03-operations/BACKUP-DRILLS.md`), or `--backup-check-url https://healthchecks.io/api/v3/checks/<uuid>` with `BACKUP_CHECK_API_KEY` in the environment (a read-only healthchecks.io key) — the backup service's dead-man check must have pinged within 26 h (`docs/03-operations/BACKUPS.md`).

A `--dry-run` prints both preconditions (and warns when no backup evidence was given) but calls nothing.
It reads omnimind-api's `PORT` for the private URL `http://omnimind-api.railway.internal:<PORT>` (when `PORT` is not set on omnimind-api it sets `PORT=3333` there explicitly, with the admin key when that is new — one redeploy; `--api-port <n>` overrides without a write), sets `OMNIMIND_ADMIN_KEY` (printed once — store it in 1Password) and `ADMIN_EMAILS`, creates the gateway agent with the scope ceiling, patches tenant owners, creates the `omnimind-mcp` service with every variable from §3 (including `OMNIMIND_MCP_WRITE_EXTRACT=async`, so `memory_write` never waits on Haiku), generates its domain, runs `railway up`, sets the BoardRoom variables from §4, mints the first token (`Claude Code (laptop)`, all seven scopes, 365 days) and prints the `claude mcp add` line (runs it when `claude` is on PATH and `--yes` was given), then runs the §7 checks and prints a summary table. One check runs even with `--no-token`: `initialize` with a syntactically valid but unknown `omt_` token must answer `401 invalid_token` — that forces a real introspection through the gateway key over the private URL, so a `503 auth_unavailable` (unknown gateway key, wrong private port) is a verification **failure** (exit 3), not a pass. `--help` lists every flag (`--owner-user-id` when the e-mail lookup fails, `--gateway-key` when the agent already exists, `--oauth-issuer`, `--no-token`, …).

**From a phone** (GitHub → Actions → *MCP go-live* → *Run workflow*): *the workflow does not pass the new preconditions' inputs yet (`--backup-ok` / `--backup-check-url`, and `GH_TOKEN` with `actions: read` for the CI check), so an executing run aborts at "0b. Preconditions" until `.github/workflows/mcp-go-live.yml` mirrors them; a dry run works.* Add the repository secret `RAILWAY_TOKEN` first (a Railway **project** token: project → Settings → Tokens, for the `production` environment). The workflow (`.github/workflows/mcp-go-live.yml`) installs the CLI, runs the same script with `--yes --no-token` and writes the verification table to the job summary. *dry_run* is ticked by default — run once to see the plan, then again unticked. No personal token is minted in CI: afterwards mint the first one in BoardRoom → Settings → Connected AI tools (§5) and install it (§6). If the project token is refused for creating the service or the domain, add an account token as `RAILWAY_API_TOKEN` instead.

**Still manual after either route** (the script prints these too): Railway → `omnimind-mcp` → Settings → *Config-as-code* → `packages/omnimind-mcp/railway.toml` (no CLI flag exists); Settings → *Source* → connect this repository (branch `main`, root `/`) — the first `railway up` deploys the checkout once, and connecting the repo is what makes later pushes to `main` redeploy it (until then re-run the script or the workflow); OAuth (§9) when a ChatGPT / claude.ai user needs in; `OMNIMIND_REQUIRE_AGENT_KEY=true` on omnimind-api once the gateway is the only MCP writer. Railway CLI flags the script relies on were verified against the CLI source (v5.71.0); the header of the script lists what was and was not verified.

---

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
| `ANTHROPIC_API_KEY` | `sk-ant-…` | writes | writes | writes | Haiku fact extraction inside `memory_write`. Without it `memory_write` still stores each write as one raw row and answers `extraction: "deferred"` (extraction is retried in the background and keeps failing), so set it on any deployment that writes. |
| `OMNIMIND_MCP_API_KEY` | *(unset)* | **yes** | unset | unset | Legacy static inbound bearer. Leave unset on the hosted gateway so the only credentials are per-user. The server exits 1 when none of static bearer / token auth / OAuth issuer is configured. |
| `OMNIMIND_MCP_STATIC_AGENT_KEY` | *(unset)* | recommended | — | — | The static identity's **own** `omk_` key (keygen for that agent). Lets a legacy static instance present a verified `x-agent-key` once `OMNIMIND_REQUIRE_AGENT_KEY=true`; the gateway key is never used for static callers. |
| `OMNIMIND_MCP_AGENT_NAME` / `OMNIMIND_MCP_TENANT_ID` / `OMNIMIND_MCP_SCOPES` / `OMNIMIND_MCP_SOURCE_WEIGHT` | *(unset)* | **yes** | not read | not read | The static/stdio process identity. **The hosted gateway never reads them** — its identity, tenant and scope ceiling come from the agent row behind `OMNIMIND_MCP_AGENT_KEY`, and nothing compares the env with the row. Only the legacy static bearer, stdio, `bench` and `smoke` need `AGENT_NAME` + `TENANT_ID`. |
| `OMNIMIND_MCP_USER_ID` | *(unset)* | optional | — | — | Static / stdio only: user the `omnimind://` resources read as. Delegated sessions bind the token's user. |
| `OMNIMIND_MCP_OAUTH_ISSUER` / `OMNIMIND_MCP_OAUTH_JWKS_URL` / `OMNIMIND_MCP_OAUTH_AUDIENCE` | *(empty)* | — | — | issuer **yes** | OAuth resource-server mode (§9). JWKS is discovered from the issuer when the URL is unset; audience defaults to `OMNIMIND_MCP_PUBLIC_URL`. |
| `OMNIMIND_MCP_OAUTH_USERINFO` | `true` | — | — | opt | When the access token lacks `email` / `email_verified`, fetch them from the issuer's `userinfo_endpoint` with the same token (`sub` must match). `false` disables the fallback (§9.4). |
| `OMNIMIND_MCP_DOCS_URL` | *(optional)* | opt | opt | opt | PRM `resource_documentation`; defaults to `docs/MEMORY-PROTOCOL.md` on GitHub. |
| `OMNIMIND_MCP_WRITE_EXTRACT` | `sync` | opt | opt | opt | `async` returns from `memory_write` before Haiku fact extraction finishes (§7c). Deferred extraction runs on a long-lived client, so it completes even after the session that started it ends. |
| `OMNIMIND_MCP_SESSION_IDLE_MS` | `1800000` | opt | opt | opt | Idle session timeout; cap 100 live sessions, least-recently-seen evicted. |
| `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` | `30000` | — | opt | opt | Positive credential-cache TTL (ms), clamped 5000..300000. Bounds only how long an **idle** client keeps a session after its token is revoked; a data call on a revoked token is refused at once. |
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
| `OMNIMIND_MCP_OAUTH_ISSUER` | same issuer as the MCP service, **only** when §9 is configured | `oauthEnabled: true` ⇒ the Claude.ai / Claude Desktop snippets show the OAuth path **first** (the *Request headers* beta as the alternative) and the ChatGPT snippet shows the OAuth steps instead of "ChatGPT cannot use this token". Leave unset in token-only mode or the snippets promise a sign-in flow the server cannot serve. |

`connect-info` and `GET /api/mcp/tokens/options` sit behind the login cookie only (not behind the subscription middleware), so a user can always see the panel and their tenants. Redeploy BoardRoom after changing these; nothing on the MCP side depends on them.

---

## 5. Create a personal token

BoardRoom → **Settings → Connected AI tools**. Pick the client (it pre-fills the token name and renders the right snippet), the tenant (only tenants you own are offered — §2) and the scopes (all seven are offered; the gateway ceiling from §1 is what makes them effective). The `omt_…` value (`omt_` + 43 base64url chars) is shown **once**; the list afterwards shows only the 12-char prefix, expiry, last-used time and a Revoke button.

- **Expiry.** Tokens expire **365 days** after minting by default. The scripted API accepts `expiresInDays` (shorter) or `expiresInDays: null` for a non-expiring token; an expired token is `401 invalid_token` like a revoked one.
- **Revocation.** The row gets `revoked_at` and OmniMind evicts its delegation cache synchronously; the MCP server fails the in-flight call with `PRINCIPAL_REVOKED`, evicts the credential and closes the session, so the next request is `401 invalid_token`. The token stops working **immediately**; only an idle client that makes no calls may keep an open session for up to `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` (default 30 s), and every call on it fails (the Settings page and the snippets say the same).

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

Every client needs the server URL **`https://<mcp-host>/mcp`** and a credential: the header `Authorization: Bearer omt_…` where the client can send one, or an OAuth sign-in (§9) where it cannot. The Settings page renders these snippets with the real URL and token filled in (`mcp-snippets.ts` is the source of truth; this section mirrors it, and the dialog vocabulary below was checked against each vendor's own documentation on 2026-10-19). Stdio configs (`docs/agent-configs/*.json`, `omnimind-local` entries) remain for running the server locally with an `omk_` agent key — not needed for the hosted path.

**Which credential works where**

| Client | Header token (`omt_`) | OAuth (§9) | Notes |
|---|:-:|:-:|---|
| Claude.ai | beta only | yes | The "Request headers" section of *Add custom connector* is in beta for a limited set of organizations. No beta ⇒ OAuth is the only path. |
| Claude Desktop | beta only, **or** the `claude_desktop_config.json` `mcp-remote` bridge (always) | yes | Shares claude.ai's connector list and dialog. |
| Claude Code | yes | yes | `claude mcp add … --header` |
| ChatGPT | **no** | **required** | The Create-connector dialog offers OAuth or "No authentication" only; there is no header / API-key field. |
| Cursor, Windsurf, Gemini CLI, VS Code, Zed | yes | varies | Static header in the config file. |

**Shared rule — the URL must not redirect.** `OMNIMIND_MCP_PUBLIC_URL` is the final URL: Claude drops the `Authorization` header when a redirect crosses hosts, and ChatGPT reports "Session terminated" on a `/mcp` → `/mcp/` 307. The server answers both spellings directly; a custom domain or proxy in front of it must not add a redirect.

### Claude.ai and Claude Desktop (custom connector)
One dialog for both: remote connectors are configured and brokered through the Claude account, so Claude Desktop → Settings → Connectors shows the same list as claude.ai (and `claude_desktop_config.json` is a separate, local-server mechanism). The dialog layout varies by organization — either name, URL and an *Advanced settings* disclosure on one screen, or two steps — but the choices are the same:

- **Authentication:** *Sign in now* · *Sign in when needed* · *No sign-in*.
- **OAuth client:** *Use Claude's published identity* (Client ID Metadata Document that Anthropic hosts) · *Register automatically* (Dynamic Client Registration) · *Use your own OAuth client* (a client ID you registered with the issuer; secret blank unless required).
- **Request headers** — fixed credentials Claude sends on every request: pick a header name from the list (`authorization`, `x-api-key`, `x-auth-token`, or a custom name Anthropic approves), enter the **full value verbatim** (`Bearer omt_…` — Claude adds no scheme), up to four headers. **Beta, limited set of organizations:** if you don't see *Request headers* in the dialog, your organization doesn't have it yet. On an OAuth connection `authorization` cannot be a request header.
- **Authentication settings cannot be edited after creation** (OAuth client and request headers alike): remove the connector and add it again.

Steps, as the Settings page shows them (OAuth first when the server advertises an issuer):

1. Settings → **Connectors** → *Add custom connector* → name `OmniMind`, URL `https://<mcp-host>/mcp`.
2. **OAuth mode (issuer configured, §9):** Authentication *Sign in when needed*; OAuth client *Register automatically*. Pick *Use Claude's published identity* only if the issuer supports CIMD (Claude uses it only when the authorization-server metadata advertises `client_id_metadata_document_supported: true` **and** `none` in `token_endpoint_auth_methods_supported`; otherwise it falls back to DCR anyway). No token is needed — Claude asks you to sign in on first use. OAuth sign-in is read-only (`memory:read`) until an admin widens the identity (§9); an `omt_` token carries exactly the scopes picked at minting.
3. **Token mode:** Authentication *No sign-in*; under *Request headers* add header name `authorization`, value `Bearer omt_…`. Only possible when the beta section is visible.
4. **No Request headers and no OAuth yet:**
   - claude.ai (web / mobile) has **no way to send the token**. The server needs OAuth — §9, then `OMNIMIND_MCP_OAUTH_ISSUER` on BoardRoom (§4) so the page switches to the sign-in steps. Until then use Claude Code or Claude Desktop.
   - Claude Desktop can skip the connector dialog and bridge the hosted URL through `mcp-remote` in `claude_desktop_config.json` (works regardless of the beta; token with its exact scopes):
     ```json
     { "mcpServers": { "omnimind": { "command": "npx", "args": ["-y", "mcp-remote", "https://<mcp-host>/mcp", "--header", "Authorization:Bearer omt_…"] } } }
     ```
5. Add, then enable the connector in a chat from the tools menu. Claude follows the 2025-03-26 / 2025-06-18 / 2025-11-25 authorization specs; connectors are IPv4-only and connect from Anthropic's cloud, so the host must be publicly reachable.

### Claude Code
```bash
claude mcp add --transport http --scope user omnimind https://<mcp-host>/mcp --header "Authorization: Bearer omt_…"
# --scope user stores it in ~/.claude.json for every project (the default local scope = current project only).
# `claude mcp list` should report it connected; /mcp shows state and re-auth in OAuth mode.
```
To keep the token out of a committed `.mcp.json`, use environment-variable expansion — Claude Code expands `${VAR}` in `url` and `headers`:
```json
{ "mcpServers": { "omnimind": { "type": "http", "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer ${OMNIMIND_TOKEN}" } } } }
```
Pick a name like `OMNIMIND_TOKEN`: credential-looking names such as `ANTHROPIC_AUTH_TOKEN` are deliberately read as empty in a remote server's `url`/`headers`, so `Bearer ${ANTHROPIC_AUTH_TOKEN}` sends `Bearer ` with no credential. Claude Code loads the server `instructions` at session start (truncated at 2,048 chars). OAuth: `claude mcp login omnimind` or `/mcp`; its CIMD declares the loopback callbacks `http://localhost/callback` and `http://127.0.0.1/callback` (port ignored).

### ChatGPT (Developer mode) — OAuth only
Settings → **Apps & Connectors** (older builds: *Connectors*) → *Advanced* → **Developer mode** on. Developer mode exists on Plus, Pro, Business, Enterprise and Edu (not Free); on Business/Enterprise an admin enables it under *Workspace Settings → Permissions & Roles*. Then *Create* → name `OmniMind`, URL `https://<mcp-host>/mcp`.

- **Authentication: OAuth.** The dialog offers **OAuth or "No authentication" only — there is no header or API-key field**, so a personal `omt_` token can never be used from ChatGPT. Without an issuer on this server (§9) ChatGPT cannot connect; the Settings page says so and points here. ChatGPT registers with the issuer via CIMD (public-client `none` or `private_key_jwt`) or DCR, and signs the user in.
- Write tools are confirmed available in Developer mode on Business, Enterprise and Edu; on Plus and Pro the connector **may be read-only** (`search`/`fetch` only) — 2026 help-center text says so and launch-era text says otherwise, so check the current plan limits. ChatGPT asks for confirmation before non-read-only tools (it keys off `readOnlyHint`), shows changed tool definitions as a diff, and disables new actions by default.
- `search` and `fetch` (`readOnlyHint: true`, no confirmation prompt) are what Deep Research and company knowledge use; without Developer mode a server lacking them is rejected, so they stay exposed.
- OAuth sign-in is read-only (`memory:read`) by default; widen per identity with `PATCH /mcp/identities/:id` (§9).

### Cursor
`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):
```json
{ "mcpServers": { "omnimind": { "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
Cursor resolves `${env:NAME}` in `url` and `headers`, so `"Authorization": "Bearer ${env:OMNIMIND_TOKEN}"` keeps the token out of the file. One-click: `cursor://anysphere.cursor-deeplink/mcp/install?name=omnimind&config=<base64 of {url, headers}>` — rendered on the Settings page. Cursor → Settings → MCP shows the server; toggle it on if listed as disabled.

### Windsurf
`~/.codeium/windsurf/mcp_config.json` (Windsurf → Settings → Cascade → MCP → Configure), then *Refresh* in the MCP panel:
```json
{ "mcpServers": { "omnimind": { "serverUrl": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
Use `serverUrl` (not `url`) for a remote server. The file is global only (no per-project config) and has no environment-variable interpolation, so the token sits in it in plain text — prefer a read-mostly token. Windsurf caps the total tool count at 100 across all servers; OmniMind contributes 20.

### Gemini CLI
```bash
gemini mcp add --transport http --scope user --header "Authorization: Bearer omt_…" omnimind https://<mcp-host>/mcp
# --scope user → ~/.gemini/settings.json (default scope = project); /mcp inside Gemini CLI confirms the tools.
```
Equivalent JSON in `~/.gemini/settings.json` (or `.gemini/settings.json` in a project):
```json
{ "mcpServers": { "omnimind": { "httpUrl": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
`httpUrl` selects Streamable HTTP; `url` selects the legacy SSE transport, which this server does not serve (and Gemini Enterprise rejects). Gemini CLI resolves `$VAR` / `${VAR}` (and `${VAR:-default}`) across the whole settings file, so `"Bearer $OMNIMIND_TOKEN"` works; an undefined variable is left as the literal placeholder.

### VS Code / GitHub Copilot
`.vscode/mcp.json` in the workspace (or *MCP: Add Server* from the Command Palette); Copilot Chat must be in **Agent** mode. Use an `inputs` prompt so the token is requested once (`password: true` hides it) and kept in VS Code's secret store, never in the file:
```json
{
  "inputs": [{ "id": "omnimind-token", "type": "promptString", "password": true, "description": "OmniMind personal token (omt_…)" }],
  "servers": { "omnimind": { "type": "http", "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer ${input:omnimind-token}" } } }
}
```
`type: "http"` is required (`"sse"` is the other value; VS Code tries HTTP Stream first and falls back to SSE). `${env:NAME}` also works. Servers that need interactive inputs are not forwarded to Copilot harness sessions; for those, or a throwaway machine, the literal form is `code --add-mcp '{"name":"omnimind","type":"http","url":"https://<mcp-host>/mcp","headers":{"Authorization":"Bearer omt_…"}}'`.

### Zed
Zed connects to remote MCP servers natively — no `mcp-remote` bridge. `settings.json` (`zed: open settings`), or Settings → AI → MCP Servers → *Add Remote Server*:
```json
{ "context_servers": { "omnimind": { "url": "https://<mcp-host>/mcp", "headers": { "Authorization": "Bearer omt_…" } } } }
```
The header is stored in plain text (no interpolation documented). With no `Authorization` header configured, Zed starts the standard MCP OAuth flow instead (only works once §9 is live). Zed does not surface elicitation; destructive tools rely on their server-side `confirm`/`dryRun` arguments, so prefer a read-mostly token.

### Any other Streamable HTTP client
URL + header as above. Smoke with curl (§7b). The server may answer a POST with `application/json` or `text/event-stream` (both are spec-compliant and every client must accept both); `GET` opens the SSE stream; `Mcp-Session-Id` is issued at `initialize` and must be echoed. The legacy HTTP+SSE two-endpoint transport is not served on purpose (deprecated; rejected by Copilot Studio and Gemini Enterprise).

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
A token without `memory:write` must get `{ "error": "SCOPE_DENIED" }` from `memory_write` (a tool result, not a transport error). A revoked token fails its next call at once (`PRINCIPAL_REVOKED` on the in-flight call, then `401 invalid_token`); an idle session may linger up to 30 s. A wrong/unknown credential is `401` with body `{"error":"invalid_token"}` (no credential at all: `{"error":"unauthorized"}`); OmniMind unreachable — or a gateway key OmniMind does not know (§1 "Rotation") — is `503 auth_unavailable` with `Retry-After` (never cached). A session is bound to its principal **and** that principal's scope digest: a request whose credential now resolves to different scopes (token edited, identity re-scoped) is refused and the client must re-`initialize`.

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

## 9. OAuth (resource-server mode) — required for ChatGPT and most Claude.ai organizations

**Why you need it.** ChatGPT's connector dialog has no header or API-key field (OAuth or "No authentication" only), and claude.ai's *Request headers* section is a beta for a limited set of organizations. Without OAuth those two clients cannot use the per-user `omt_` tokens at all. Everything else (Claude Code, Claude Desktop via the `mcp-remote` bridge, Cursor, Windsurf, Gemini CLI, VS Code, Zed) works with tokens alone, so this section is optional until a ChatGPT or claude.ai user needs in.

**What the server is.** An OAuth 2.1 **resource server** only (ADR-016, issuer choice Proposed): it verifies JWTs from one configured issuer and maps them to BoardRoom users. There is no built-in authorization server, no consent-time scope picker, and client registration is entirely the issuer's job. `omt_` tokens and OAuth coexist on the same endpoint (the server tells them apart by shape: `omt_` prefix vs compact JWS).

### 9.1 Choose an identity provider

Requirements, in order of importance:

1. **Dynamic Client Registration (RFC 7591)** — what ChatGPT, Claude's *Register automatically*, Cursor, Gemini CLI and Copilot Studio use. Non-negotiable.
2. **Client ID Metadata Documents (CIMD)** — what Claude.ai / Claude Code and ChatGPT prefer. Claude selects it only when the authorization-server metadata advertises `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`; otherwise it falls back to DCR, so CIMD is a nice-to-have, not a blocker.
3. **Resource indicators (RFC 8707)** — the access token's `aud` must be this server (`OMNIMIND_MCP_PUBLIC_URL`).
4. **Asymmetric signing** (RS256 / ES256 / EdDSA) with a JWKS endpoint; HS256 tokens are refused.
5. **`email` + `email_verified` claims** in the access token, **or** a `userinfo_endpoint` in the issuer's discovery document — the server fetches `email` / `email_verified` from it when the token lacks them (same bearer token; the `sub` must match; `OMNIMIND_MCP_OAUTH_USERINFO=false` disables the fallback).
6. Optional: a `scope` claim limited to our seven MCP scopes.

Known DCR-capable options for MCP: **WorkOS AuthKit** and **Auth0** both document MCP / DCR support; Ory Hydra also implements DCR. **CIMD support changes quickly — verify it on the provider's current docs** before promising Claude's *Use Claude's published identity* option. Pick one issuer; the server validates tokens from exactly one.

### 9.2 Configure the provider

| Setting | Value | Why |
|---|---|---|
| Issuer URL | e.g. `https://<tenant>.authkit.app` / `https://<tenant>.auth0.com/` — must serve `/.well-known/openid-configuration` (or `oauth-authorization-server`) | Goes into `OMNIMIND_MCP_OAUTH_ISSUER` verbatim (trailing slash matters for `iss`). |
| JWKS | The discovery document's `jwks_uri` | Discovered automatically; set `OMNIMIND_MCP_OAUTH_JWKS_URL` only when the provider's discovery is unreachable from the MCP service. |
| Audience / resource indicator | `https://<mcp-host>/mcp` — identical to `OMNIMIND_MCP_PUBLIC_URL` | RFC 8707: clients send `resource=<PUBLIC_URL>` (they learn it from the PRM document); the provider must mint `aud` = that value. Auth0 calls this an "API identifier"; AuthKit a "resource". Wrong audience ⇒ `401 err_jwt_claim_validation_failed`. |
| Scopes | Define the seven MCP scopes (`memory:read`, `memory:write`, `decision:write`, `task:write`, `project:write`, `commitment:write`, `code:write`), or none | A `scope` claim can only **narrow** the identity's scopes (`intersectScopes`); no claim ⇒ the identity's own scopes, which default to read-only. |
| Claims | `email` + `email_verified` in the access token, or a `userinfo_endpoint` | Auto-link needs a verified e-mail (9.4). |
| Dynamic Client Registration | Enabled, public clients (`token_endpoint_auth_method: none`) with PKCE | Required for ChatGPT, Claude *Register automatically*, Cursor, Gemini CLI. |
| CIMD | Enable if offered | Lets Claude / ChatGPT use their published client identities instead of registering. |
| Redirect URIs | Claude: `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`; Claude Code: `http://localhost/callback`, `http://127.0.0.1/callback` (any port); ChatGPT: `https://chatgpt.com/connector_platform_oauth_redirect` | **Verify the Claude and ChatGPT values on the client's current docs** when you register them: the researcher could fetch Anthropic's page (`claude.ai/api/mcp/auth_callback` is confirmed there) but not OpenAI's, and tutorials also show `https://chatgpt.com/oauth/callback`. With DCR/CIMD the client registers its own redirect URI and you register nothing. |
| Token lifetime | Short access tokens (≤ 1 h) with refresh tokens | The server re-verifies `exp` per request with 30 s clock skew; refresh is the client's job. |

### 9.3 Configure our services

| Service | Variable | Value |
|---|---|---|
| **omnimind-mcp** | `OMNIMIND_MCP_OAUTH_ISSUER` | the issuer URL, exactly as it appears in `iss` |
| | `OMNIMIND_MCP_OAUTH_JWKS_URL` | optional override; discovered from the issuer when unset |
| | `OMNIMIND_MCP_OAUTH_AUDIENCE` | optional; defaults to `OMNIMIND_MCP_PUBLIC_URL` — leave unset unless the provider cannot mint that exact string |
| | `OMNIMIND_MCP_OAUTH_USERINFO` | optional, default `true`: fetch `email`/`email_verified` from the issuer's `userinfo_endpoint` when the access token lacks them; `false` disables |
| | `OMNIMIND_MCP_PUBLIC_URL`, `OMNIMIND_MCP_AGENT_KEY` | already set (§3); startup refuses an issuer without either — identity resolution is a delegated call |
| **omnimind-api** | `MCP_OAUTH_ALLOWED_ISSUERS` | the same issuer URL (comma-separated if several gateways); `POST /mcp/identities/resolve` refuses any other issuer with `issuer_not_allowed`, so a misconfigured gateway cannot link identities from an unexpected provider |
| **boardroom-ai** | `OMNIMIND_MCP_OAUTH_ISSUER` | the same issuer URL — `connect-info` then reports `oauthEnabled: true` and the Claude.ai / Claude Desktop / ChatGPT snippets switch to the sign-in steps (§4). Set it **last**, once 9.5 passes, or the page promises a sign-in the server cannot serve |

Redeploy the MCP service, then omnimind-api, then BoardRoom. The MCP log must show `OAuth (issuer …, audience …)` in the auth-mode line.

What the server does per request: verify the compact JWS with `jose` against the JWKS (asymmetric only), require `iss` = issuer, `aud` = audience, `exp` and `sub`, 30 s skew; read `email` / `email_verified` from the payload or, failing that, from `userinfo_endpoint`; then `POST /mcp/identities/resolve {issuer, subject, email?, emailVerified?, clientId?}` as the gateway. The PRM document `GET /.well-known/oauth-protected-resource` (and `…/oauth-protected-resource/mcp` for path-scoped clients) returns RFC 9728 metadata `{ resource, authorization_servers: [issuer], scopes_supported, bearer_methods_supported: ["header"], resource_documentation }` — served only with an issuer; in token-only mode it is `404` and the `WWW-Authenticate` challenge carries no `resource_metadata`. A `401` is what starts the client's sign-in (Claude ignores `WWW-Authenticate` on a `200`).

### 9.4 First login — how an OAuth identity becomes a BoardRoom user

- **Auto-link by verified e-mail.** On the first request from an unknown `(issuer, subject)`, if `email_verified` is true and a BoardRoom user matches the address (case-insensitive) **and owns at least one tenant** (§2), the API creates the identity row: `scopes: ['memory:read']` (read-only, `MCP_OAUTH_DEFAULT_SCOPES`), `tenantId` = the user's **oldest-created owned tenant**, `agentName: oauth:<clientId or issuer host>-<8 chars of the row id>`. The client is now connected, read-only.
- **No e-mail from the provider** (no claims and no usable `userinfo_endpoint`, or `email_verified: false`): the credential is `401 unlinked`. Link it manually from the subject in the MCP service log:
  ```bash
  curl -s -X POST -H "x-admin-key: $OMNIMIND_ADMIN_KEY" -H 'content-type: application/json' \
    -d '{"issuer":"https://<issuer>","subject":"<sub claim>","userId":"<user cuid>","tenantId":"josh-business","scopes":["memory:read"]}' \
    https://omnimind-api-production.up.railway.app/mcp/identities
  ```
  (`scopes` optional — defaults to read-only; the tenant must be owned by that user.) The next request from that token resolves.
- **Widen or move an identity** (the client can only read, or landed in the wrong tenant):
  ```bash
  curl -s -H "x-admin-key: $OMNIMIND_ADMIN_KEY" "https://omnimind-api-production.up.railway.app/mcp/identities?userId=<user cuid>" | jq .
  curl -s -X PATCH -H "x-admin-key: $OMNIMIND_ADMIN_KEY" -H 'content-type: application/json' \
    -d '{"tenantId":"josh-business","scopes":["memory:read","memory:write","decision:write","task:write"]}' \
    https://omnimind-api-production.up.railway.app/mcp/identities/<identity id>
  ```
  The change applies on the client's next request (the delegation cache is evicted synchronously); a live session bound to the old scope digest is refused and the client re-`initialize`s.
- **Revoke:** `DELETE /mcp/identities/:id` → the next request is `401`; the next sign-in from that subject re-links (auto or manual) as a new row.

### 9.5 Verify

```bash
# 1. PRM shows the issuer and our resource
curl -s https://<mcp-host>/.well-known/oauth-protected-resource | jq .
# → { "resource": "https://<mcp-host>/mcp", "authorization_servers": ["https://<issuer>"], "scopes_supported": [ …7… ], "bearer_methods_supported": ["header"], … }

# 2. The challenge now advertises the PRM
curl -s -i -X POST https://<mcp-host>/mcp -H 'content-type: application/json' -d '{}' | sed -n '1p;/^www-authenticate/Ip'
# → 401 · WWW-Authenticate: Bearer realm="omnimind-mcp", resource_metadata="https://<mcp-host>/.well-known/oauth-protected-resource"

# 3. A real token from the provider's test flow (audience = PUBLIC_URL) → initialize 200
JWT=<access token minted for resource https://<mcp-host>/mcp>
curl -s -i -X POST https://<mcp-host>/mcp -H "Authorization: Bearer $JWT" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' | sed -n '1p;/^mcp-session-id/Ip'
# → 200 + mcp-session-id. First call auto-links (9.4): GET /mcp/identities?userId=… now lists the row with scopes ["memory:read"].
# → 401 {"error":"invalid_token"} with "unlinked" in the service log = no verified e-mail reached us → 9.4 manual link.

# 4. Wrong audience → 401
JWT_OTHER=<token minted for a different resource / API>
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<mcp-host>/mcp -H "Authorization: Bearer $JWT_OTHER" -H 'content-type: application/json' -d '{}'
# → 401 (service log: err_jwt_claim_validation_failed aud)

# 5. Audit attribution: entries carry agentId = oauth:<client>-<id>, not the gateway
curl -s -H "x-api-key: $OMNIMIND_API_KEY" "https://omnimind-api-production.up.railway.app/mcp/audit?limit=5&tenantId=<tenant>" | jq '.entries[].agentId'
```

Then set `OMNIMIND_MCP_OAUTH_ISSUER` on BoardRoom (§4), redeploy, and connect one real ChatGPT and one real Claude.ai client per §6.

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
| `503 auth_unavailable` otherwise | OmniMind (or the OAuth issuer's JWKS) unreachable from the MCP service | Private hostname/port in `OMNIMIND_API_URL` — the port must be omnimind-api's `PORT`, not an assumed 3333; `curl` it from the service shell |
| go-live: `precondition: the latest ci.yml run on main is status=… conclusion=…` | `main` is red, or its CI run has not finished | Fix `main` (or wait for the run); nothing was changed — re-run |
| go-live: `precondition: gh api … failed` / `the gh CLI is required` | `gh` missing or unauthenticated (in Actions: no `GH_TOKEN`) | `gh auth login` (laptop); in Actions set `GH_TOKEN: ${{ github.token }}` with `permissions: actions: read` |
| go-live: `precondition: no backup evidence` / `dead-man ping is … h old` | No `--backup-ok` / `--backup-check-url`, or the backup has not run within 26 h | Take a prod `pg_dump` + restore drill (BACKUP-DRILLS.md) and pass `--backup-ok`, or fix the backup service so its dead-man check pings |
| go-live summary: `verify: bogus-token initialize \| FAIL \| 503 auth_unavailable` | Introspection through the gateway is broken: unknown gateway key or wrong private port | §1 "Rotation" for the key; omnimind-api's `PORT` vs the port in the MCP service's `OMNIMIND_API_URL` |
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
| OAuth `401 unlinked` | No verified e-mail reached us (no `email`/`email_verified` claims **and** no usable `userinfo_endpoint`, or `OMNIMIND_MCP_OAUTH_USERINFO=false`), no BoardRoom user with that address owning a tenant, or the identity row was revoked | Link manually: `POST /mcp/identities {issuer, subject, userId, tenantId, scopes?}` (§9.4); or create the user / set a tenant owner (§2) and have the issuer emit `email_verified`; a revoked row stays unlinked until `DELETE /mcp/identities/:id` lets the next sign-in re-link |
| OAuth `401` with reason `issuer_not_allowed` (OmniMind log: "issuer refused by MCP_OAUTH_ALLOWED_ISSUERS") | The API's allow-list is set and does not contain this issuer | Add the issuer to `MCP_OAUTH_ALLOWED_ISSUERS` on omnimind-api (same string as `OMNIMIND_MCP_OAUTH_ISSUER`) |
| OAuth client can only read | Default OAuth scopes are `memory:read` | `PATCH /mcp/identities/:id {"scopes":[…]}` (§9.4), or use an `omt_` token with the scopes you need |
| OAuth identity landed in the wrong tenant | Auto-link bound the oldest-created owned tenant | `PATCH /mcp/identities/:id {"tenantId": …}` (§2) |
| OAuth `401 err_jwt_claim_validation_failed` (aud) | `OMNIMIND_MCP_OAUTH_AUDIENCE` / `PUBLIC_URL` ≠ the resource the issuer minted for | Make audience == `OMNIMIND_MCP_PUBLIC_URL` on both sides |
| PRM returns 404 | OAuth not configured (expected) | Only set the issuer vars if you need OAuth clients |
| ChatGPT offers no header field; claude.ai shows no *Request headers* section | By design: ChatGPT's dialog is OAuth / no-auth only; Claude's *Request headers* is a beta for a limited set of organizations | §9 (OAuth), then set `OMNIMIND_MCP_OAUTH_ISSUER` on BoardRoom too (§4). Claude Desktop can use the `mcp-remote` bridge meanwhile (§6) |
| Claude connector: `401` loops or "Session terminated" in ChatGPT right after connecting | The MCP URL redirects (e.g. `/mcp` → `/mcp/` 307, or http → https on a custom domain): Claude drops `Authorization` on cross-host redirects | Point the client at the final URL (`OMNIMIND_MCP_PUBLIC_URL`); remove the redirect from the proxy / domain config |
| `400 no valid session ID` | Client skipped `initialize` or dropped `mcp-session-id` | Client bug; sessions are required on the 2025-era protocol |
| `404 Session not found` after a pause | Idle timeout or eviction | Client re-initializes; raise `OMNIMIND_MCP_SESSION_IDLE_MS` if it happens mid-conversation |
| Session refused after a token's scopes changed | Session is bound to principal + scope digest | Client re-`initialize`s (new session) |
| `memory_write` returns `extraction: "deferred"` (or the log shows `fact extraction unavailable; raw row … stored, extraction deferred`) | `ANTHROPIC_API_KEY` unset on the MCP service, Haiku rate limit or timeout. The row **is** stored; extraction is retried after 5 s / 30 s / 120 s and the facts then supersede it | Nothing to do for a transient blip (the `memory_write:extract` audit row shows whether the retry succeeded). Persistent → set/rotate the key. Callers must not repeat the call. (Before Phase 8 M1-B2 this was a `FACT_EXTRACTOR_UNAVAILABLE` refusal with nothing stored.) |
| `bench` refuses to run: `--yes` required | `NODE_ENV` is not `development` and the bench performs real writes | Add `--yes` (rows are archived afterwards unless `--cleanup=false`) |
| `Ministry embedding unavailable` | Ollama down | Start Ollama; never fall back |
| `VALIDATION_ERROR … cursor` | Client edited an opaque cursor | Pass `nextCursor` back verbatim |
| `Output validation error … structured content` | OmniMind returned a shape outside the tool's `outputSchema` | Fix the API shape (`packages/shared/src/validation/mcp.schema.ts`); do not loosen the schema |
| Resource read `NO_USER_BOUND` (stdio only) | `OMNIMIND_MCP_USER_ID` unset | Set it, or use tools (which take `userId`) |
| Resource read `TENANT_MISMATCH` | URI tenant ≠ bound tenant | Cross-tenant reads are impossible by design |
