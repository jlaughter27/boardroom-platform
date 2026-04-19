# PHASE 10 — Tasks & Prompts

Each task has: scope, files touched, pre-written Claude prompt, verification.

---

## Task 10.1 — Decision spike: WorkOS vs Ory Hydra

**Scope:** 1-day timeboxed comparison. Output: ADR-014 picking one provider, recorded in `docs/DECISIONS.md`.

**Prompt:**
> Compare WorkOS AuthKit and Ory Hydra for serving as the OAuth 2.1 provider in front of OmniMind's `/mcp` endpoint. Read `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §1, §7. Produce a 1-page comparison covering: pricing at 1k/10k MAU, Dynamic Client Registration support quality, audience-binding (RFC 8707) support, hosted vs self-hosted, lock-in risk, time-to-first-working-flow. Recommend one. Write the recommendation to `docs/DECISIONS.md` as ADR-014. Do NOT write any code.

**Verification:** ADR-014 exists; one provider chosen with rationale.

---

## Task 10.2 — Provision provider + capture credentials

**Scope:** Manual ops task. Provision the chosen provider, create `.env` entries.

**Prompt:**
> Walk me through provisioning the OAuth provider chosen in ADR-014 for our staging environment. Output: a step-by-step runbook in `docs/DEPLOYMENT-RUNBOOK.md` under a new section "MCP OAuth provider setup". Include: account creation, redirect URI registration (`https://omnimind-api-production.up.railway.app/oauth/callback`), env vars to add (`OAUTH_PROVIDER_URL`, `OAUTH_CLIENT_SECRET`, etc.), how to test the well-known discovery endpoints. Add the env vars to `.env.example` with placeholder values and one-line comments.

**Verification:** Runbook section exists; `.env.example` updated; manual smoke test of `/.well-known/oauth-authorization-server` returns valid JSON.

---

## Task 10.3 — Install MCP SDK, scaffold `/mcp` route

**Scope:** Add `@modelcontextprotocol/sdk` (TypeScript SDK), create `packages/omnimind-api/src/mcp/` directory with `server.ts`, `transport.ts`, mount under `/mcp`.

**Prompt:**
> In `packages/omnimind-api/`: install `@modelcontextprotocol/sdk` (latest stable) and any required peer deps. Create `src/mcp/server.ts` exporting a `createMcpServer()` factory that uses the SDK's `Server` class. Create `src/mcp/transport.ts` wiring the Streamable HTTP transport adapter. Mount on `/mcp` in `src/index.ts` AFTER global middleware but BEFORE the existing API-key auth wall (MCP uses OAuth, not the api-key). Respect Express middleware ordering documented in `CLAUDE.md`. Add `Mcp-Session-Id` to the CORS exposed-headers list. No tools yet — just the handshake. Verify with `curl -X POST https://localhost:3333/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{...}}'` returns `serverInfo` and `capabilities`.

**Verification:** `pnpm typecheck` clean; integration test in `packages/omnimind-api/tests/integration/mcp/handshake.test.ts` exercising the initialize call passes.

---

## Task 10.4 — Implement OAuth 2.1 protected-resource discovery

**Scope:** Serve `.well-known/oauth-protected-resource` per RFC 9728; serve 401 with `WWW-Authenticate` header from `/mcp` when no token present.

**Prompt:**
> In `packages/omnimind-api/src/mcp/`: add `oauth-discovery.ts` that serves `GET /.well-known/oauth-protected-resource` per RFC 9728. The JSON response MUST include `authorization_servers` pointing at the provider chosen in ADR-014, and `resource` set to the canonical `/mcp` URL. Update the `/mcp` POST handler to return HTTP 401 with `WWW-Authenticate: Bearer realm="...", as_uri="https://omnimind-api-production.up.railway.app/.well-known/oauth-protected-resource"` when the request has no Authorization header. Reference `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §1 for the spec links. Add Zod validation of inbound `Authorization` headers — must start with `Bearer `, base64-decoded JWT body must include `aud` matching our resource URL.

**Verification:** Curl `/.well-known/oauth-protected-resource` returns valid JSON; curl `/mcp` without Authorization returns 401 with the correct `WWW-Authenticate` header.

---

## Task 10.5 — Token validation + audience binding (RFC 8707)

**Scope:** Validate inbound JWTs against the provider's JWKS, REJECT tokens whose `aud` claim doesn't match our resource.

**Prompt:**
> In `packages/omnimind-api/src/mcp/`: add `token-validator.ts` that validates inbound bearer tokens against the OAuth provider's JWKS endpoint. Use `jose` (already a dep) for verification. MUST enforce: `iss` matches the provider's issuer URL, `aud` matches the canonical `/mcp` resource URL exactly, `exp` not expired, `iat` within reasonable skew. Cache JWKS for 1 hour. On audience mismatch, return 401 with `WWW-Authenticate: Bearer error="invalid_token", error_description="audience binding failed"`. Add unit tests in `tests/unit/mcp/token-validator.test.ts` covering: valid token, expired, wrong audience, wrong issuer, malformed. The audience-binding test is non-negotiable per Phase 10 exit criteria.

**Verification:** Unit tests green; manual test: a token issued for a different `aud` returns 401.

---

## Task 10.6 — Tool: `searchMemories`

**Scope:** Wire the existing hybrid-retrieval pipeline into an MCP tool.

**Prompt:**
> In `packages/omnimind-api/src/mcp/tools/`: create `search-memories.tool.ts` registering an MCP tool named `searchMemories`. Inputs (Zod schema in `packages/shared/src/validation/`): `query: string`, `limit?: number (1-50, default 10)`, `domain?: string`, `entityIds?: string[]`. Resolves the calling user from the validated JWT's `sub` claim. Calls the existing `retrieval/context-packager.ts` with appropriate filters. Returns array of `{ id, content, score, domain, createdAt, entities }`. Respect the 7-10 item context cap from CLAUDE.md. Tool description (visible to Claude clients): one paragraph explaining the hybrid retrieval (semantic + FTS + trigram) and what filters do. Add integration test in `tests/integration/mcp/search-memories.test.ts`.

**Verification:** Integration test green; manual test from Claude Desktop returns expected memories.

---

## Task 10.7 — Tool: `createMemory`

**Scope:** Allow MCP clients to write memories. Goes through the validation pipeline (no raw inserts, per CLAUDE.md rule 6).

**Prompt:**
> In `packages/omnimind-api/src/mcp/tools/`: create `create-memory.tool.ts` registering `createMemory`. Inputs: `content: string (1-10000 chars)`, `domain: enum[business|personal|technical]`, `entityRefs?: { type, id }[]`, `confidence?: number (0-1)`. MUST route through `src/memory/validation/pipeline.ts` — no raw Prisma calls. Extract `userId` from JWT `sub`. Returns `{ id, validatedContent, supersededIds }`. Reject if pipeline returns NOOP. Add scope check: token must include `omnimind:memory:write` scope. Add integration test exercising both success and pipeline-rejection paths.

**Verification:** Integration test green; pipeline rejection returns descriptive MCP error.

---

## Task 10.8 — Tools: `getEntity`, `findRelatedEntities`, `getDecisionContext`

**Scope:** Three read-side tools wrapping existing services. Combined into one task because they're structurally identical.

**Prompt:**
> In `packages/omnimind-api/src/mcp/tools/`: create three files (`get-entity.tool.ts`, `find-related-entities.tool.ts`, `get-decision-context.tool.ts`). Each registers an MCP tool. `getEntity({ type, id })` calls existing entity services. `findRelatedEntities({ id, hops?: 1|2, types?: string[] })` calls the recursive-CTE service from Phase 4. `getDecisionContext({ decisionId })` returns the decision + assumptions + linked memories + linked entities. All three require `omnimind:memory:read` scope. Add integration tests for each.

**Verification:** All three tools callable; integration tests green; per-tenant isolation verified (user A cannot fetch user B's entities — returns 404, not 403, to avoid leaking existence).

---

## Task 10.9 — MCP resources

**Scope:** Implement `memory://{id}`, `decision://{id}`, `entity://{type}/{id}`, `persona://{name}` as MCP resources with `notifications/resources/updated` support.

**Prompt:**
> In `packages/omnimind-api/src/mcp/resources/`: create resource handlers for the four URI schemes. Each handler resolves the URI, validates user ownership, returns a markdown rendering. Use the same render helpers as the markdown export (Phase 11) once available, but for Phase 10 inline minimal renderers. Wire `notifications/resources/updated` via Postgres LISTEN on the relevant tables (use a single advisory listener that fans out per session). Add a feature flag `MCP_RESOURCE_NOTIFICATIONS_ENABLED` defaulting to false until Phase 14 observability lands.

**Verification:** Integration test fetches each resource type; subscribe-and-update test verifies notification fires within 2s of a write.

---

## Task 10.10 — Per-tenant isolation eval scenario

**Scope:** Add an eval scenario that two simulated users with separate tokens cannot see each other's data.

**Prompt:**
> In `eval/scenarios/`: create `mcp-tenant-isolation.scenario.ts`. Scenario: provision two test users (A, B), seed each with 5 memories, issue distinct OAuth tokens, exercise all 5 tools (and resource reads) with A's token requesting B's resources. Every call must return either empty results or 404. Add a rubric in `eval/rubrics/mcp-isolation.rubric.md`. Wire into `npm run eval:all`.

**Verification:** `npm run eval:all` includes the scenario and passes.

---

## Task 10.11 — Submit to Anthropic Connector Directory

**Scope:** Documentation + submission task; no code.

**Prompt:**
> Prepare the submission package for Anthropic's Connector Directory. Output: a checklist file `docs/contracts/mcp-connector-submission.md` covering: connector name, description, required scopes, OAuth provider URL, redirect URIs, sample tool calls, screenshot requirements, support email. Reference the live `/mcp` endpoint and `.well-known` URLs. Do NOT submit yet — flag the user to review and submit manually once Phase 10 exit criteria are green.

**Verification:** Checklist exists; user can submit by following it.
