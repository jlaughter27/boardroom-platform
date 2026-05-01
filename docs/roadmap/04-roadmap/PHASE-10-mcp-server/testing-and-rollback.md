# PHASE 10 — Testing & Rollback

## Verification

**Per-task verification** lives in `tasks-and-prompts.md`. The phase-level gates:

1. **Handshake:** `curl -X POST $URL/mcp -d '{"jsonrpc":"2.0","method":"initialize",...}'` returns `serverInfo` + `capabilities` listing 5 tools and 4 resource schemes.
2. **OAuth round-trip from Claude Desktop:** manually paste `https://omnimind-api-production.up.railway.app/mcp` into Claude Desktop's connector settings, complete the OAuth flow, observe `searchMemories` callable from a Claude conversation. Capture the screen recording for the Connector Directory submission.
3. **Audience binding:** issue a token with `aud="other.example.com/mcp"`, present it to our `/mcp`, expect 401 with `error="invalid_token"`.
4. **DCR:** `POST /oauth/register` with a minimal client metadata payload returns a `client_id` and `client_secret` without manual approval. Verify the new client can complete a token flow.
5. **Per-tenant isolation:** `npm run eval:all` includes `mcp-tenant-isolation` and exits 0.
6. **Token rotation:** request a refresh; confirm old refresh token is invalidated (single-use).
7. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:retrieval && npm run eval:personas` all green.

## Rollback

**Soft rollback (zero-downtime):**
- Set `MCP_ENABLED=false` in Railway env. The `/mcp` route returns 404. BoardRoom AI keeps working because it uses the `x-api-key` path, not OAuth.
- Existing OAuth tokens become unusable; clients see 404 on retry. No data corruption — MCP is a read-mostly surface and writes pass through the same validation pipeline as everywhere else.

**Hard rollback (revert):**
- Revert the merge commit. New routes, new files. Almost no existing files mutated (only `index.ts`, CORS config, `.env.example`).
- WorkOS/Hydra account stays provisioned; it's external and idempotent.
- If MCP-created memories need to be removed: `DELETE FROM "MemoryEntry" WHERE "createdVia" = 'mcp'` (the `createdVia` column should be added in Task 10.7's pipeline call). Run as a manual SQL migration; do NOT add this to a Prisma migration.

**Failure modes to watch:**
- **JWKS endpoint flap.** Token validation calls JWKS on cold cache. If provider is down, all MCP calls 401. Mitigation: cache TTL 1h; fall back to last-known-good keys for an additional hour with a logged warning.
- **Notification storm.** `notifications/resources/updated` could fan out hundreds of events on a bulk write. The feature flag `MCP_RESOURCE_NOTIFICATIONS_ENABLED` is the kill switch.
- **Connector Directory rejection.** Submission may bounce on screenshot quality or scope wording. Iterate on `docs/contracts/mcp-connector-submission.md` and resubmit.
