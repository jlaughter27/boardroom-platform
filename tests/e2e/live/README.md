# Live-stack end-to-end journey

`journey.mjs` drives the **real** stack with a real browser and no mocks:

1. Browser (Playwright, Chromium): register through the UI → onboarding gate → `PATCH /profile` → dashboard (counts the API fan-out and any 429) → seed memories, a goal, a project and two memory→entity links → knowledge graph renders and settles → memory explorer → decision lab → create a decision session.
2. Operator step 2 from the MCP runbook: `PATCH /admin/tenants/josh-business { ownerUserId }` with `x-admin-key`.
3. Settings → Connected AI tools → New token → Create token (reads the one-time `omt_` value from the page).
4. MCP golden path over Streamable HTTP with that token: `initialize` → `tools/list` (20 tools) → `memory_write` → `memory_search` → `status_get`.
5. Cross-client visibility: BoardRoom `GET /memories?q=` and the Memory Explorer show the memory the MCP client wrote (`agentId = mcp-token:<slug>`, `sourceType = MCP_AGENT`).
6. Revoke the token in BoardRoom → the open MCP session is refused (`PRINCIPAL_REVOKED`).
7. No uncaught page errors or CSP refusals during the whole journey.

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
- `pnpm test:e2e` (the `E2E-*` harness suite) is a different, narrower gate: it boots OmniMind + the MCP stdio server on its own and asserts on DB rows. The older `tests/e2e/flows/*` files target a previous API contract and are not wired into any script.
