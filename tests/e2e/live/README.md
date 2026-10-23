# Live-stack end-to-end journey

`journey.mjs` drives the **real** stack with a real browser and no mocks:

1. Browser (Playwright, Chromium): register through the UI → onboarding gate → `PATCH /profile` → dashboard (counts the API fan-out and any 429) → seed memories, a goal, a project and two memory→entity links → knowledge graph renders and settles → memory explorer → decision lab → create a decision session.
2. Operator step 2 from the MCP runbook: `PATCH /admin/tenants/josh-business { ownerUserId }` with `x-admin-key`.
3. Settings → Connected AI tools → New token → Create token (reads the one-time `omt_` value from the page).
4. MCP golden path over Streamable HTTP with that token: `initialize` → `tools/list` (20 tools) → `memory_write` → `memory_search` → `status_get`.
5. Cross-client visibility: BoardRoom `GET /memories?q=` and the Memory Explorer show the memory the MCP client wrote (`agentId = mcp-token:<slug>`, `sourceType = MCP_AGENT`).
6. Pluggable checks: every `checks/*.mjs` runs as its own step on a fresh signed-in page while the MCP token is still live (contract and owners: [`checks/README.md`](checks/README.md)).
7. Revoke the token in BoardRoom → the open MCP session is refused (`PRINCIPAL_REVOKED`).
8. No uncaught page errors or CSP refusals during the whole journey.

Flags: `--browser chromium|webkit` (default `chromium`, or env `E2E_BROWSER`; WebKit screenshots go to `out/webkit/`) and `--dry-run` (resolve playwright and the engine, validate every check, launch nothing). `playwright` is a root devDependency.

Screenshots and `results.json` land in `tests/e2e/live/out/` (git-ignored). Each step prints `✓`/`×` with a one-line detail.

## Bring up the stack (what the 2026-10-20 run used)

```bash
# Postgres 16 + pgvector on 5433 (docker-compose.test.yml, or a local cluster)
psql -h 127.0.0.1 -p 5433 -U postgres -c "CREATE DATABASE boardroom_stack OWNER test_user;"
psql -h 127.0.0.1 -p 5433 -U test_user -d boardroom_stack -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql -h 127.0.0.1 -p 5433 -U test_user -d boardroom_stack -c "INSERT INTO tenants (id, name) VALUES ('josh-business','Business'),('josh-personal','Personal'),('tgfc-ministry','Ministry') ON CONFLICT (id) DO NOTHING;"
(cd packages/omnimind-api && DATABASE_URL=postgresql://test_user:test_password@127.0.0.1:5433/boardroom_stack ./node_modules/.bin/prisma db push --accept-data-loss --skip-generate)

export DATABASE_URL=postgresql://test_user:test_password@127.0.0.1:5433/boardroom_stack
export OMNIMIND_API_KEY=stack-e2e-service-key OMNIMIND_ADMIN_KEY=stack-e2e-admin-key ADMIN_EMAILS=admin@boardroom-e2e.test
export ENCRYPTION_KEY=$(printf '0%.0s' $(seq 1 64)) ANTHROPIC_API_KEY=e2e-dummy-not-used JWT_SECRET=e2e-jwt-secret-local-only
export OMNIMIND_API_URL=http://127.0.0.1:3333 OMNIMIND_MCP_PUBLIC_URL=http://127.0.0.1:3334/mcp APP_PUBLIC_URL=http://localhost:3001
unset OPENAI_API_KEY   # embeddings go to the outbox; hybrid search still works on FTS + trigram

# OmniMind (the harness entrypoint skips env validation and binds the port itself)
(cd packages/omnimind-api && PORT=3333 ../../node_modules/.bin/tsx ../../tests/e2e/harness/api-entrypoint.ts &)
# BoardRoom in production mode so it serves client/dist (build it first: pnpm --filter @boardroom/boardroom-ai build)
(cd packages/boardroom-ai && NODE_ENV=production PORT=3001 ../../node_modules/.bin/tsx server/src/index.ts &)
# Gateway agent + MCP HTTP server (keygen prints the omk_ key once; keep it out of logs)
(cd packages/omnimind-mcp && ../../node_modules/.bin/tsx src/index.ts keygen --agent omnimind-mcp-gateway --tenant josh-business \
   --scopes "mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write" --source-weight 1.0)
(cd packages/omnimind-mcp && PORT=3334 OMNIMIND_MCP_TOKEN_AUTH=true OMNIMIND_MCP_AGENT_KEY=omk_… \
   OMNIMIND_MCP_ALLOWED_HOSTS=127.0.0.1:3334,localhost:3334 OMNIMIND_MCP_APP_URL=http://localhost:3001 \
   OMNIMIND_MCP_WRITE_EXTRACT=async ../../node_modules/.bin/tsx src/index.ts http &)

# Run it (use localhost, not 127.0.0.1: the production cookie is Secure and Playwright's
# request context only sends Secure cookies to localhost over http)
BOARDROOM_URL=http://localhost:3001 OMNIMIND_URL=http://127.0.0.1:3333 MCP_URL=http://127.0.0.1:3334/mcp \
OMNIMIND_ADMIN_KEY=$OMNIMIND_ADMIN_KEY OMNIMIND_API_KEY=$OMNIMIND_API_KEY node tests/e2e/live/journey.mjs
```

Notes:

- The register limiter is 3 per hour per IP and in-memory; restart BoardRoom between runs.
- Without a real `ANTHROPIC_API_KEY`, `memory_write` in the default `sync` mode stores the prose as one raw row and answers `extraction: "deferred"` (Phase 8 M1-B2; it used to be refused with `FACT_EXTRACTOR_UNAVAILABLE`). `OMNIMIND_MCP_WRITE_EXTRACT=async` stores the raw row first and defers extraction, which is what this run uses.
- WebKit sign-in: see [WebKit and the Secure cookie](#webkit-and-the-secure-cookie) below.
- `pnpm test:e2e` (the `E2E-*` harness suite) is a different, narrower gate: it boots OmniMind + the MCP stdio server on its own and asserts on DB rows. The older `tests/e2e/flows/*` files target a previous API contract and are not wired into any script.

## WebKit and the Secure cookie

**Status (2026-10-23, RD-9f): not reproduced — WebKit is not installed in the agent sandbox.** `node tests/e2e/live/journey.mjs --browser webkit --dry-run` resolves Playwright 1.56.1 and reports `webkit executable: missing (run: pnpm exec playwright install webkit) — /opt/pw-browsers/webkit-2215/pw_run.sh`; only Chromium is preinstalled there. Everything below is the diagnosis and the fix path, to be confirmed on a machine with WebKit.

**What goes wrong.** BoardRoom runs with `NODE_ENV=production` so it serves `client/dist`, and in production the `boardroom_token` cookie is set `Secure` (`server/src/routes/auth.routes.ts`). The stack is plain HTTP. Chromium treats `http://localhost` as a secure context and keeps a `Secure` cookie set over it (that is why the run above uses `localhost`, not `127.0.0.1`). WebKit — Playwright's Linux WebKit in particular — does not reliably make that exception, so "register through the UI" can succeed (the server answers with `Set-Cookie`) while the browser drops the cookie. The first symptom is the next step: `new user is gated to onboarding` bounces back to `/login`, or `auth/me reflects the registered user` gets 401.

**How to confirm.** Install WebKit (`pnpm exec playwright install webkit`, plus `pnpm exec playwright install-deps webkit` once per machine — it needs apt/root), bring up the stack as above, then run with `--browser webkit`. Right after registering, `await context.cookies()` (or the `02-after-register` shot under `out/webkit/`) shows whether `boardroom_token` was stored. If it is absent while the `/auth/register` response carried `Set-Cookie: boardroom_token=…; Secure`, this is the cause.

**Fix path (preferred): give the journey HTTPS.** Keep the production cookie exactly as it ships and put a throwaway TLS front in front of the local stack, for the WebKit run only:

```bash
# one-off self-signed cert for localhost (never commit it)
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
  -addext "subjectAltName=DNS:localhost" -keyout /tmp/e2e-key.pem -out /tmp/e2e-cert.pem
# a ~15-line node:https → http://127.0.0.1:3001 reverse proxy on https://localhost:3443
# (no dependency: pipe each req/res through node:http.request, forwarding headers incl. Cookie / Set-Cookie)
BOARDROOM_URL=https://localhost:3443 … node tests/e2e/live/journey.mjs --browser webkit
```

The journey then needs one change: `browser.newContext({ …, ignoreHTTPSErrors: true })` when `BOARDROOM_URL` is `https:`, so the self-signed certificate is accepted. Express needs `trust proxy` only if a check asserts on `req.secure`; the cookie itself is unaffected. This tests the real `Secure; HttpOnly; SameSite=Lax` cookie in a real WebKit.

**Fallback (harness only, if TLS is not an option): bridge the cookie.** After the UI registration, if `context.cookies()` has no `boardroom_token` under WebKit, sign in from Node (`fetch(APP + '/auth/login')`), read the token from `Set-Cookie`, and `context.addCookies([{ name: 'boardroom_token', value, url: APP, httpOnly: true, secure: false, sameSite: 'Lax' }])`. The server only verifies the JWT, so the rest of the journey runs; the step must report that the browser's own cookie storage was bypassed, because it no longer proves WebKit sign-in.

**Not a fix:** an env flag that turns `secure` off on the production cookie. The journey exists to exercise production settings; a switch that weakens the auth cookie must not exist in the server.
