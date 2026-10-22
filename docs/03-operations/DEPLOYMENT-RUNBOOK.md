# Deployment Runbook — Railway

> Everything you need to deploy, debug, and maintain the BoardRoom platform on Railway.

## Services

| Service | Railway Name | Public URL | Internal URL |
|---------|-------------|------------|--------------|
| BoardRoom AI | boardroom-ai | `https://boardroom-ai-production-1092.up.railway.app` | — |
| OmniMind API | omnimind-api | `https://omnimind-api-production.up.railway.app` | `omnimind-api.railway.internal` |
| OmniMind MCP | omnimind-mcp | `https://omnimind-mcp-production.up.railway.app/mcp` (public — external MCP clients connect here; `/health` for probes) | `omnimind-mcp.railway.internal` (unused; nothing inside Railway calls it) |
| PostgreSQL | (Railway plugin) | — | `postgres.railway.internal:5432` |

The MCP service is built from `packages/omnimind-mcp/Dockerfile` (no Prisma, no prompts, no bash; `CMD node dist/index.js http`), calls omnimind-api over the private network and serves one hosted Streamable HTTP endpoint for every user and client. Full operator path: `docs/runbooks/omnimind-mcp.md`.

## Environment Variables

### omnimind-api

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | PostgreSQL connection string | Railway Postgres plugin (auto-set) |
| `OMNIMIND_API_KEY` | Shared secret for service-to-service auth | Generate with `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Anthropic API key | console.anthropic.com |
| `OPENAI_API_KEY` | OpenAI API key (embeddings only) | platform.openai.com |
| `ENCRYPTION_KEY` | AES-256-GCM key for OAuth tokens + ministry memories. **Must be exactly 64 hex chars; required in production (startup fails otherwise).** | `openssl rand -hex 32` |
| `OMNIMIND_ADMIN_KEY` | Gates `/admin/*`, `POST /mcp/agents` and the `/mcp/identities` admin routes via `x-admin-key`. Unset in prod → those routes return 503 — set it **before** running keygen or setting tenant owners (MCP live checklist step 0). | `openssl rand -hex 32` |
| `MCP_OAUTH_ALLOWED_ISSUERS` | Comma-separated issuer URLs `POST /mcp/identities/resolve` accepts; unset = any issuer the gateway verified. Set it to the MCP service's `OMNIMIND_MCP_OAUTH_ISSUER` when OAuth is on | runbook §9, optional |
| `OMNIMIND_REQUIRE_AGENT_KEY` | `true` → MCP callers must present a verified `x-agent-key` (default `false`, legacy header triple accepted) | optional |
| `AGENT_RATE_AUDIT` / `AGENT_RATE_NON_AGENT_MULTIPLIER` / `IP_RATE_LIMIT_MULTIPLIER` | Rate-limit tuning (defaults 5000 / 5 / 5) | optional |
| `SHUTDOWN_DEADLINE_MS` | Hard exit deadline for graceful shutdown (default 25000) | optional |
| `EMBEDDING_PROVIDER` | `openai` (default) or `mock` (deterministic sha256 vectors — CI only, never prod) | Phase 6 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` | Tracing on when the endpoint is set; service name `omnimind-api`. See `OBSERVABILITY.md` | Phase 6, optional |
| `REFLECTION_SCHEDULE` / `REFLECTION_THRESHOLD` | Nightly capsule reflection job (default `30 2 * * *`, threshold `0.8`) | Phase 6, optional |
| `COMMITMENT_NUDGE_SCHEDULE` | Daily commitment nudges, SQL only (default `0 7 * * *`) | Phase 6, optional |
| `PORT` | Injected by Railway automatically | Do not set manually |

### boardroom-ai

| Variable | Description | Source |
|----------|-------------|--------|
| `JWT_SECRET` | Secret for JWT signing | Generate with `openssl rand -hex 32` |
| `OMNIMIND_API_KEY` | Must match omnimind-api's value exactly | Same value as above |
| `ADMIN_EMAILS` | Comma-separated allowlist for `/admin` in BoardRoom. **Unset → `/admin` is 403 for everyone (fail-closed).** | e.g. `joshlaughter27@gmail.com` |
| `LLM_RATE_LIMIT_PER_HOUR` / `LLM_RATE_LIMIT_WINDOW_MS` | Per-user token bucket on every LLM endpoint (defaults 60 / 1h) | optional |
| `OMNIMIND_API_URL` | URL to reach OmniMind | `https://omnimind-api-production.up.railway.app` |
| `ANTHROPIC_API_KEY` | Anthropic API key | console.anthropic.com |
| `OMNIMIND_API_URL` (private) | Preferred: `http://omnimind-api.railway.internal:3333` once OmniMind binds `::` — see `PRIVATE-NETWORKING.md` | Phase 6 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` | Tracing on when the endpoint is set; service name `boardroom-ai`; `traceparent` propagates to OmniMind | Phase 6, optional |
| `DEBATE_ROUND2` / `MAX_REBUTTALS` | Round-2 defend/concede protocol (default `true` / `3`) | Phase 6, optional |
| `OMNIMIND_MCP_PUBLIC_URL` / `APP_PUBLIC_URL` | Hosted MCP endpoint (`https://<mcp-host>/mcp`, same value as the MCP service) and BoardRoom's own public origin (optional; falls back to the request origin), served by `GET /api/mcp/tokens/connect-info` and rendered into Settings → Connected AI tools snippets | runbook §4 |
| `OMNIMIND_MCP_OAUTH_ISSUER` | Same issuer as the MCP service, **only** when OAuth mode is configured: makes `connect-info` report `oauthEnabled: true`, so the Claude.ai/Desktop snippets show the sign-in path first and the ChatGPT snippet shows OAuth steps (ChatGPT has no header field; claude.ai's *Request headers* is a limited beta) | runbook §4 / §9, required for ChatGPT |
| `PORT` | Injected by Railway automatically | Do not set manually |

### omnimind-mcp

| Variable | Description | Source |
|----------|-------------|--------|
| `OMNIMIND_API_URL` | `http://omnimind-api.railway.internal:3333` (private, http) | see `PRIVATE-NETWORKING.md` |
| `OMNIMIND_API_KEY` | Must match omnimind-api's value exactly | Same value as above |
| `OMNIMIND_MCP_AGENT_KEY` | `omk_…` of the gateway agent `omnimind-mcp-gateway` (keygen with `mcp:delegate` + all seven grantable scopes — `MCP_GATEWAY_CEILING_SCOPES`; the row's scopes are the **ceiling** for every token, `token ∩ (gateway − mcp:delegate)`, and `mcp:delegate` alone denies everything). The server **refuses to start** in token/OAuth mode without it, and a key OmniMind does not know (keygen 409 without the SQL upsert) makes every client `503 auth_unavailable` | runbook §1 |
| `OMNIMIND_MCP_TOKEN_AUTH` | `true` — accept per-user `omt_` tokens via `POST /mcp/tokens/introspect` | runbook §3 |
| `OMNIMIND_MCP_API_KEY` | Legacy static bearer; **leave unset** on the hosted gateway | — |
| `OMNIMIND_MCP_STATIC_AGENT_KEY` | Legacy static mode only: that identity's own `omk_` key (the gateway key is never used for static callers). Not set on the hosted gateway | runbook §10, optional |
| `OMNIMIND_MCP_AGENT_NAME` / `OMNIMIND_MCP_TENANT_ID` / `OMNIMIND_MCP_SCOPES` / `OMNIMIND_MCP_SOURCE_WEIGHT` | **Not read by the hosted gateway** (token/OAuth mode takes identity, tenant and scope ceiling from the agent row behind `OMNIMIND_MCP_AGENT_KEY`). Needed only for the legacy static bearer, stdio, `bench` and `smoke` | runbook §3 |
| `OMNIMIND_MCP_ALLOWED_HOSTS` | Exact bare public host, e.g. `omnimind-mcp-production.up.railway.app` (+ custom domain) | runbook §3 |
| `OMNIMIND_MCP_TRUST_PROXY` | `true` on Railway: key the per-IP auth-failure limiter (30/min, 429) on the right-most `X-Forwarded-For` instead of the proxy's address | runbook §3 |
| `OMNIMIND_MCP_PUBLIC_URL` | `https://omnimind-mcp-production.up.railway.app/mcp` — PRM `resource`, default audience, snippet URL; must equal BoardRoom's value | runbook §3 |
| `OMNIMIND_MCP_APP_URL` | BoardRoom public URL (`search`/`fetch` result links only) | — |
| `OMNIMIND_MCP_DOCS_URL` | PRM `resource_documentation` override | optional |
| `OMNIMIND_MCP_OAUTH_ISSUER` / `OMNIMIND_MCP_OAUTH_JWKS_URL` / `OMNIMIND_MCP_OAUTH_AUDIENCE` | OAuth resource-server mode (JWKS discovered when unset; audience defaults to `PUBLIC_URL`); PRM is 404 without an issuer | runbook §9, optional |
| `OMNIMIND_MCP_OAUTH_USERINFO` | `true` (default): when the access token lacks `email` / `email_verified`, fetch them from the issuer's `userinfo_endpoint` with the same token; `false` disables the fallback | runbook §9.4, optional |
| `OMNIMIND_MCP_WRITE_EXTRACT` | `sync` (default) or `async` when `memory_write` p95 > ~20 s | runbook §7c, optional |
| `OMNIMIND_MCP_SESSION_IDLE_MS` | Idle session timeout (default 1800000) | optional |
| `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` | `30000` — positive credential-cache TTL (ms), clamped 5000..300000; bounds only how long an idle client keeps a session after revocation (a data call on a revoked token fails at once) | optional |
| `ANTHROPIC_API_KEY` | Haiku fact extraction in `memory_write` | console.anthropic.com |
| `PORT` | Injected by Railway automatically (server listens on `::`) | Do not set manually |

### backup (services/backup — Railway cron service)

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | Source database | `${{Postgres.DATABASE_URL}}` |
| `R2_BUCKET` / `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 destination + token | Cloudflare dashboard |
| `BACKUP_RETAIN_DAYS` | Remote retention (default 30) | optional |
| `BACKUP_ENCRYPT_KEY` | AES-256 passphrase for the dump file; keep next to `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `BACKUP_HEALTHCHECK_URL` | Dead-man ping on success | optional |
| `DRILL_DATABASE_URL` / `DRILL_API_HEALTH_URL` | Restore drill only (scratch DB) | see `BACKUPS.md` |

### Critical: OMNIMIND_API_URL

Currently uses the **public** domain. For lower latency, switch to Railway's private networking: `http://omnimind-api.railway.internal:PORT`. Requires both services on the same Railway private network.

## Docker Build Architecture

All three services use multi-stage Docker builds with `pnpm deploy --legacy` for production node_modules. CI's `docker` matrix builds `boardroom-ai`, `omnimind-api` and `omnimind-mcp` from the repo root with `packages/<service>/Dockerfile`.

### Build sequence (both services):
1. Install ALL deps (including devDeps) in builder stage
2. Build shared package (`tsc` with `rm -f tsconfig.tsbuildinfo` first)
3. Copy shared dist to `node_modules/@boardroom/shared/`
4. Build service-specific code
5. `pnpm deploy --prod --legacy` creates standalone deploy output
6. Runner stage copies deploy output's node_modules (real files, not symlinks)
7. Overlays shared dist on top

### omnimind-api additional steps:
- `prisma generate` runs before tsc (needs generated types)
- Generated `.prisma` client copied from pnpm store to stable path
- `npm install -g prisma@6.19.3` in runner for migrations at startup
- `docker-entrypoint.sh` runs extensions + `prisma db push` + starts server

### omnimind-mcp differences:
- No Prisma, no `docs/prompts`, no entrypoint script — `CMD ["node","dist/index.js","http"]`
- `tests/` is excluded by its tsconfig, so copying the package in does not compile vitest suites
- Docker `HEALTHCHECK` probes `GET /health` on loopback (compose only; Railway uses `railway.toml`)
- `jose` (OAuth JWT validation) is a runtime dependency — the lockfile must carry it or `--frozen-lockfile` fails

## Railway CLI Commands

```bash
# Link to project
cd /path/to/boardroom-platform
railway link

# View logs
railway service boardroom-ai
railway logs --lines 50
railway logs --build --latest --lines 30

# Switch service context
railway service omnimind-api
railway logs --lines 50

# Set variables
railway variables set KEY=value

# Redeploy
railway redeploy -y

# Generate public domain (if missing)
railway domain -s omnimind-api
```

## Common Issues & Fixes

### Build fails: "shared declarations not found"
**Cause**: Stale `tsconfig.tsbuildinfo` cached by TypeScript incremental compilation.
**Fix**: Already handled in Dockerfiles (`rm -f tsconfig.tsbuildinfo` before tsc). If it recurs, check that `*.tsbuildinfo` is in `.gitignore`.

### Build fails: pnpm "frozen-lockfile" mismatch
**Cause**: `pnpm-lock.yaml` out of sync with package.json changes.
**Fix**: Run `pnpm install` locally, commit the updated lockfile.

### Runtime: "Cannot find module 'express'"
**Cause**: pnpm workspace symlinks don't resolve in Docker runner stage.
**Fix**: Already handled via `pnpm deploy --legacy --prod`. If it recurs, check that the COPY order in the runner stage pulls from `/app/deploy-output/node_modules`.

### Runtime: Prisma 7.x schema error
**Cause**: `npx prisma` downloads latest (7.x) which broke the `datasource url` syntax.
**Fix**: Already handled — prisma@6.19.3 installed globally in omnimind-api runner. Do NOT use `npx prisma` in the runner stage.

### Health check fails / "Application not found"
**Cause**: Service listens on wrong port. Railway injects `PORT` env var.
**Fix**: Both services now check `process.env.PORT` first. Do not hardcode port values.

### boardroom-ai: "Authentication required" on page load
**Cause**: Static files served after auth middleware, or API requests missing `/api` prefix rewrite.
**Fix**: Static serving registered before auth wall. `/api` prefix stripped by middleware before route matching.

### omnimind-api: "P3009 failed migration"
**Cause**: A previous migration attempt failed and is stuck in `_prisma_migrations` table.
**Fix**: `prisma migrate resolve --rolled-back <migration_name>` or use `prisma db push` (current approach).

## Deploy Checklist

1. Verify `npm run typecheck` passes locally
2. Verify `npm run test` passes locally (110+ tests)
3. Commit and push to `main`
4. Railway auto-builds on push (~60s build time)
5. Check build logs: `railway logs --build --latest --lines 30`
6. Check health: `curl https://boardroom-ai-production-1092.up.railway.app/health`
7. Check health: `curl https://omnimind-api-production.up.railway.app/health`
8. Both should return `{"status":"ok"}`
9. If the MCP service changed: `curl https://omnimind-mcp-production.up.railway.app/health` → `{"status":"ok","uptime":…,"sessions":…}` and the checklist below

## MCP live checklist

**One-command path:** `pnpm go-live:mcp -- --project <railway project id> --owner-email <e-mail> --backup-ok --yes` (`scripts/mcp-go-live.sh`; `--dry-run` first) runs steps 0–4 and 6–8 below idempotently and prints a summary table. Before any write it aborts unless the latest `ci.yml` run on `main` is `success` (via `gh api`) and backup evidence exists (`--backup-ok`, or `--backup-check-url` with a dead-man ping < 26 h); it reads omnimind-api's `PORT` for the private URL (setting `PORT=3333` explicitly when unset), sets `OMNIMIND_MCP_WRITE_EXTRACT=async`, and fails verification when a bogus `omt_` token gets anything but `401 invalid_token` (even with `--no-token`); from a phone, GitHub → Actions → *MCP go-live* after adding the `RAILWAY_TOKEN` secret (`.github/workflows/mcp-go-live.yml`, runs with `--no-token`: mint the first token in Settings afterwards). Dashboard-only leftovers it prints: config-as-code path `packages/omnimind-mcp/railway.toml`, connecting the service to the GitHub repo (what makes pushes to `main` redeploy it), OAuth (step 5), `OMNIMIND_REQUIRE_AGENT_KEY=true` (step 9). See `docs/runbooks/omnimind-mcp.md` "One-command path".

The step-by-step is `docs/runbooks/omnimind-mcp.md` (§0–§7 in that order — each step creates what the next one needs — plus §9 for OAuth, which ChatGPT and most Claude.ai organizations require). Tick these before telling anyone to connect a client:

0. **Prerequisites** (runbook §0): **main is green** (latest `ci.yml` run on `main` = success) and **a backup exists** (a fresh prod `pg_dump` with a restore-drill row in `BACKUP-DRILLS.md`, or the backup dead-man pinged within 26 h) — the go-live redeploys omnimind-api and migrations run at boot; omnimind-api's `PORT` is known (`PORT=3333` set explicitly, or the MCP service's `OMNIMIND_API_URL` uses the real one — `PRIVATE-NETWORKING.md`); `OMNIMIND_ADMIN_KEY` set on omnimind-api (keygen, `/admin/*` and the identities routes are `503 admin_disabled` without it); `ADMIN_EMAILS` set on boardroom-ai; `GET /admin/tenants` lists the three tenants; lockfile carries `jose`; CI `docker (omnimind-mcp)` is green.
1. **Gateway agent** (§1): `keygen --agent omnimind-mcp-gateway --tenant josh-business --scopes "mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write"` (`mcp:delegate` + all seven grantable scopes = the ceiling; `mcp:delegate` alone denies every tool). Save the `omk_` key. `GET /mcp/agents?tenantId=josh-business` → `.agents[]` shows the row with those scopes. Rotating later = `ON CONFLICT` SQL or a new agent name, never a bare re-run (409).
2. **Tenant owners** (§2): `PATCH /admin/tenants/:id {ownerUserId}` with `x-admin-key` for each tenant; `GET /admin/tenants` shows no `null` owners — token minting is refused for tenants the user does not own.
3. **Deploy the MCP service** (§3): Railway service `omnimind-mcp`, build context = repo root with `RAILWAY_DOCKERFILE_PATH=packages/omnimind-mcp/Dockerfile` and the config file path set to `packages/omnimind-mcp/railway.toml`; public domain generated; **all** variables from the table above incl. `OMNIMIND_MCP_AGENT_KEY` from step 1 (the service will not start without it). Deploy log shows the auth-mode line (`omt_ tokens (introspection)`, no `static key`) and `allowedHosts: <public host>` (not `loopback only`); `curl /health` → three keys.
4. **BoardRoom variables** (§4): `OMNIMIND_MCP_PUBLIC_URL` (identical to the MCP service's), `APP_PUBLIC_URL`, and `OMNIMIND_MCP_OAUTH_ISSUER` only after step 5 passes; redeploy boardroom-ai.
5. **OAuth (§9) — required for ChatGPT and most Claude.ai organizations.** ChatGPT's connector dialog has no header field and claude.ai's *Request headers* section is a limited beta, so per-user tokens alone do not reach them. Pick a DCR-capable issuer (WorkOS AuthKit, Auth0; check CIMD on its current docs), set audience = `OMNIMIND_MCP_PUBLIC_URL`, make sure `email`+`email_verified` are in the token or a `userinfo_endpoint` exists, register Claude's and ChatGPT's redirect URIs (verify on the clients' current docs); then `OMNIMIND_MCP_OAUTH_ISSUER` (+ optional `_JWKS_URL`, `_AUDIENCE`, `_USERINFO`) on the MCP service, `MCP_OAUTH_ALLOWED_ISSUERS` on omnimind-api, and only then `OMNIMIND_MCP_OAUTH_ISSUER` on boardroom-ai. Verify per §9.5: PRM shows the issuer, a provider test-flow JWT → `initialize` 200 (auto-link read-only, or `POST /mcp/identities` to link manually), wrong audience → 401. Skip only while no ChatGPT / claude.ai user needs in.
6. **Mint a token** in BoardRoom Settings → Connected AI tools (§5) — the tenant list is non-empty only after step 2.
7. **Install per client** (§6): one real client per family connected (Claude.ai connector via OAuth or the *Request headers* beta, Claude Code with `--scope user`, Cursor; ChatGPT via OAuth only — it cannot send a header token). The MCP URL must not redirect (`/mcp` vs `/mcp/`): Claude drops `Authorization` on cross-host redirects and ChatGPT reports "Session terminated".
8. **Verify** (§7): `POST /mcp` without a token → `401`, `WWW-Authenticate: Bearer realm="omnimind-mcp"`, body `{"error":"unauthorized"}`; with a bogus token → `401`, `error="invalid_token"`, body `{"error":"invalid_token"}` (403 on either = allowed hosts wrong; a burst → `429`); in OAuth mode `curl /.well-known/oauth-protected-resource` → `resource` equals `OMNIMIND_MCP_PUBLIC_URL` (404 in token-only mode is expected). `initialize` + `tools/list` with the token → 20 tools (pipe SSE through `mcpjson` before `jq`); `GET /mcp/audit?limit=20&tenantId=<tenant>` → `.entries[]` carry `agentId` = the token's `mcp-token:<slug>-<id>` name; revoke → the next call fails at once (`PRINCIPAL_REVOKED`, then `401 invalid_token`; an idle session may linger up to 30 s). `bench --n 10 --user <id>` (`--yes` outside `NODE_ENV=development`; in-process `memory_write` + server-side p95 from `/mcp/audit/stats`): p95 < 10 s; the tool warns above 20 s → set `OMNIMIND_MCP_WRITE_EXTRACT=async`. Time `status_get` over the public URL: p95 < 1.5 s.
9. After the gateway is the only MCP writer: `OMNIMIND_REQUIRE_AGENT_KEY=true` on omnimind-api.

---

## Post-audit operator checklist (2026-10-02)

Required before/at the first deploy of the remediation branch:

1. **Rotate the five leaked secrets** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `JWT_SECRET`, `OMNIMIND_API_KEY`, `ENCRYPTION_KEY`) on Railway. They are recoverable from git history (`.env.deploy`, commit `0c3700a`). `ENCRYPTION_KEY` must now be 64 hex chars; rotating it makes previously encrypted OAuth tokens undecryptable (users re-connect Google) — there are no encrypted ministry rows yet (gate still on).
2. Set `OMNIMIND_ADMIN_KEY` (omnimind-api) and `ADMIN_EMAILS` (boardroom-ai).
3. `UPDATE tenants SET owner_user_id = '<your user cuid>' WHERE id IN ('josh-personal','josh-business','tgfc-ministry');` — session summaries are skipped (logged once per tenant) until this is set.
4. For each legacy stdio MCP agent config, add `OMNIMIND_MCP_AGENT_KEY=<omk key from keygen>`. The hosted HTTP service instead uses the gateway agent key + `OMNIMIND_MCP_TOKEN_AUTH=true` + `OMNIMIND_MCP_ALLOWED_HOSTS=<public host>` (see "MCP live checklist"); the single static `OMNIMIND_MCP_API_KEY` is only for a personal self-run HTTP instance (which carries its own agent key as `OMNIMIND_MCP_STATIC_AGENT_KEY`).
5. Point the Stripe webhook at `https://<boardroom-host>/subscription/webhook` (it now lives before the auth wall; signature verification is active).
6. First boot runs `0_init` baseline resolution automatically on the existing DB (entrypoint detects fresh vs existing). Watch the deploy log for `Migrations deployed`.
7. Optional one-off: rows whose importance already decayed before this fix keep their decayed value as `base_importance`; restore with `UPDATE memory_entries SET base_importance = 0.5 WHERE base_importance < 0.4 AND recall_count = 0;` if you want them back in persona retrieval.
