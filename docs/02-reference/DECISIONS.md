# Architectural Decision Log

All architectural decisions are logged here with rationale. Check before proposing alternatives.

## ADR-001: Custom Agent Runtime Over Frameworks
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Build ~200-line custom agent runtime. No LangChain, CrewAI, LangGraph.
**Rationale:** 1-2 dev team, <100 users at launch, fan-out/fan-in pattern doesn't need graph cycles. Full stack trace visibility. Zero abstraction leakage. Revisit at Series A.
**Alternatives rejected:** LangGraph (TypeScript SDK immature, 2-3 week migration cost), CrewAI (too opinionated).

## ADR-002: Claude-Only Model Provider for v1
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Anthropic Claude (Sonnet 4.6 + Haiku 4.5) only. No multi-model routing.
**Rationale:** Single prompt format, single compliance regime, single failure mode. DeepSeek is 87% cheaper but China-hosted (compliance risk). Haiku covers "cheap" roles adequately.
**Revisit when:** 5,000+ paying users and dedicated ML ops engineer.

## ADR-003: PostgreSQL + pgvector (No Separate Vector DB)
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** All data in one PostgreSQL instance with pgvector, pg_trgm, tsvector extensions.
**Rationale:** One database. No operational overhead of Pinecone/Weaviate. pgvector sufficient up to ~10M vectors. Hybrid retrieval (structured + FTS + trigram + semantic) in same DB.

## ADR-004: Knowledge Graph Deferred
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** No knowledge graph in v1. Use tags + join table links + hybrid retrieval.
**Rationale:** Current memory count ~10-50 per room. Graph pays off at 500+ memories (~12-18 months). cross-ref.json schema stays empty. Revisit when retrieval metrics degrade.

## ADR-005: Keep Room Model, Add DecisionSession Alongside
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Room is the root aggregate. Don't remove it. Add DecisionSession as sibling.
**Rationale:** Memory, sessions, messages all hang off Room. Removing it is a rewrite with data loss risk. Adding alongside is zero-migration-risk.

## ADR-006: Monorepo with Turborepo
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Single monorepo (packages/shared, packages/omnimind-api, packages/boardroom-ai).
**Rationale:** 1-2 devs. Single PR shows full picture. Shared types as binding contract. Independent Dockerfiles for independent deployment. Revisit when team exceeds 3 devs.

## ADR-007: Two-Agent Build Workflow (Retired)
**Date:** 2026-04-07 | **Status:** Retired
**Decision:** Originally split between Claude Code + DeepSeek. As of 2026-04-07, Claude Code owns everything. DeepSeek split retired for speed.

## ADR-008: Tool Execution via Anthropic SDK Native Tool Use
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Tools are plain TypeScript functions registered in the agent runtime. Persona calls include tool definitions in the Anthropic API request. The agent handles tool_use content blocks, executes the function, returns tool_result, and continues the conversation turn.
**Rationale:** NOT using MCP protocol for v1. MCP is a future migration path for v2. Native tool_use is simpler, fully supported by the Anthropic SDK, and doesn't require a separate server process per tool.
**Alternatives rejected:** MCP servers (operational overhead, premature for 3 tools).

## ADR-009: Background Jobs via node-cron
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Weekly memo, pattern detection, and contradiction scan run as cron jobs within the OmniMind Express process. No separate worker. No Redis.
**Rationale:** Sufficient for <100 users. Graceful shutdown via cron.stop() on SIGTERM. Job duration expected <30s per user. Revisit when job duration exceeds 30s or user count exceeds 500.
**Alternatives rejected:** BullMQ + Redis (operational overhead), separate worker process (deployment complexity).

## ADR-010: Google Calendar via OAuth 2.0 + googleapis SDK
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Standard OAuth 2.0 authorization code flow. Tokens stored encrypted in a dedicated OAuthToken Prisma model. Refresh token rotation handled automatically by googleapis client. Calendar data is read-only for v1.
**Rationale:** Direct integration via googleapis SDK is well-documented and reliable. Tokens encrypted at rest with ENCRYPTION_KEY env var. Read-only avoids write-permission complexity.
**Alternatives rejected:** iCal import (no real-time sync), CalDAV (complex, less adoption).

## ADR-011: Embedding Provider — OpenAI text-embedding-3-small
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** 1536-dimensional embeddings via OpenAI API. Cost: ~$0.02/1M tokens (~$0.00002 per memory). Embeddings generated async on memory write (fire-and-forget, don't block write response). Stored as vector(1536) in PostgreSQL via pgvector.
**Rationale:** Cheapest production-quality embedding model. pgvector keeps everything in one DB. IVFFlat index with 100 lists sufficient for <100K vectors.
**Alternatives rejected:** Voyage AI (fewer docs), local models (no GPU in prod), separate vector DB (operational overhead).

## ADR-012: Custom Persona Storage + Dispatch
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Custom personas stored in CustomPersona Prisma model with system prompt, model tier, tool permissions, activation status. At dispatch time, orchestrator loads both built-in (from .md files) and custom (from DB). Custom personas always use Haiku by default (cost control). Max 3 custom personas per user.
**Rationale:** Extends the persona system without modifying built-in prompts. Custom personas are additive — they fire alongside built-in ones. CEO synthesis receives all outputs.

## ADR-013: Widget System — JSON Config, Not Code
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Dashboard widgets defined as JSON configuration objects stored in UserProfile.dashboardLayout. Each widget has type (enum), position, size, and visibility. Rendered by a WidgetRenderer that maps type → built-in component. No user-uploaded code. Max 8 visible widgets.
**Rationale:** Simple, secure, extensible. New widget types added by devs, configuration by users. Default layout matches current hardcoded dashboard for zero-change upgrade.

## ADR-014: Hybrid Embedding — Ollama for Ministry, OpenAI for Everything Else
**Date:** 2026-05-09 | **Status:** Accepted
**Decision:** `domain: 'ministry'` content is embedded using Ollama `bge-base-en-v1.5` (768-dim, padded to 1536 with zeros). All other domains use OpenAI `text-embedding-3-small` (1536-dim). The Ollama path NEVER falls back to OpenAI — if Ollama is unavailable, the write is refused with a clear error. Padding is applied by `padTo1536()` in `embedding.service.ts`.
**Rationale:** Ministry-domain content (sermon notes, prayer logs, pastoral data) must not leave the local machine. Ollama provides fully local inference at acceptable quality. Zero-padding to 1536 enables cosine similarity against OpenAI embeddings at slight quality cost, which is acceptable given the domain isolation requirement outweighs retrieval precision.
**Alternatives rejected:** OpenAI for all domains (data sovereignty violation for ministry), separate vector column per embedding model (schema complexity, query joins), silently falling back to OpenAI when Ollama is down (security violation — domain isolation is non-negotiable).

## ADR-015: Apple-grade UI foundation
**Date:** 2026-10-20 | **Status:** Accepted | **Reference:** [`UI-FOUNDATION.md`](UI-FOUNDATION.md)
**Context:** The client had the right bones (CSS-variable tokens, Tailwind mapping, Motion, cmdk) but no physics or material layer: a Material easing curve as default, 21 `transition-all`, single-layer black shadows, hover lifts on every card, a hand-rolled modal focus trap, Google-Fonts Inter without optical sizing, and ad-hoc `backdrop-blur`.
**Decision:** Adopt one foundation, additively: self-hosted Inter Variable (`opsz`) + JetBrains Mono; ease-out / ease-in-out / sheet curves with durations under 300 ms and no animation on keyboard-driven paths; layered hue-matched shadows with a hairline and inset highlight; a dark elevation ladder; control / container / capsule radii with concentric nesting; a `.material` recipe reserved for the navigation layer; Base UI (`@base-ui/react`) as the headless layer for Dialog, Tooltip, Select, Tabs, Popover and Menu; Lucide as the single icon set at 1.75 px stroke.
**Consequences:** Every old token name keeps working as an alias, so pages improve without edits; `client/tests/ui-standards.test.ts` fails the build on `transition-all`, ease-in, `scale: 0` entrances, literal z-index, third-party fonts and `backdrop-blur` outside the allow-list. One new runtime dependency (Base UI) replaces ~300 lines of focus/scroll code; drag-to-dismiss sheets, View Transitions (needs React 19.3) and Chromium lensing are deferred.
**Alternatives rejected:** Radix (slowing cadence; shadcn moved to Base UI), React Aria (deeper than we need until date pickers / data grids), keeping hand-rolled primitives (no scroll lock, no `inert`, fragile focus trap), Tailwind v4 migration (no runtime benefit over our CSS-variable tokens; upgrade tool does not handle our config).

## ADR-016: MCP OAuth issuer
**Date:** 2026-10-22 | **Status:** Proposed (decision left for the founder: Phase 8 M1-F6 picks, M2-F1 configures and marks Accepted) | **Reference:** [`docs/runbooks/omnimind-mcp.md`](../runbooks/omnimind-mcp.md) §9
**Context:** `omnimind-mcp` is an OAuth 2.1 **resource server only**: it validates JWTs from exactly one configured issuer (`OMNIMIND_MCP_OAUTH_ISSUER`, optional `_JWKS_URL` / `_AUDIENCE`), publishes RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource`, binds the audience per RFC 8707, reads `email` / `email_verified` from the token or the issuer's `userinfo_endpoint`, and auto-links a verified e-mail read-only to the user's oldest owned tenant. There is no built-in authorization server and none will be built (`.claude/CLAUDE.md` Known Limitation 14; Phase 8 "Not doing"). Without an issuer, ChatGPT cannot connect at all (its connector dialog offers only OAuth or no authentication) and most claude.ai organizations cannot (the *Request headers* beta is limited). No issuer has been chosen or configured. This decision was previously referred to as the "ADR-014 provider spike"; ADR-014 is Hybrid Embedding and ADR-015 is the Apple-grade UI foundation, so it is numbered ADR-016.
**Decision criteria (Phase 8 M1-F6):**
1. Dynamic Client Registration for public clients with PKCE (`token_endpoint_auth_method: none`) — what ChatGPT, Claude's *Register automatically*, Cursor and Gemini CLI use.
2. Access-token `aud` = `OMNIMIND_MCP_PUBLIC_URL` (the provider mints exactly the resource indicator the client sends).
3. `email` / `email_verified` in the access token, **or** a `userinfo_endpoint` the server can call with the same bearer token.
4. Bonus: Client ID Metadata Documents (CIMD) — preferred by Claude and ChatGPT, but only used when the authorization-server metadata advertises it; otherwise clients fall back to DCR.
Also record, per M1-F6, whether the founder's ChatGPT plan offers write tools (decides whether ChatGPT is a read or a write client in the dogfood scorecard).
**Server constraints any candidate must meet (not weighed, already enforced):** asymmetric signing (RS256 / ES256 / EdDSA) with a JWKS endpoint — HS256 tokens are refused; one issuer at a time.
**Candidates:** WorkOS AuthKit and Auth0. Both document MCP / DCR support per runbook §9.1. CIMD support changes quickly and must be checked on each provider's current docs at decision time. The decision also needs per-candidate notes on redirect URIs (runbook §9.2) and any plan or price limits the founder finds.

| Criterion | WorkOS AuthKit | Auth0 |
|---|---|---|
| 1. DCR, public clients, PKCE | _to verify_ | _to verify_ |
| 2. `aud` = `OMNIMIND_MCP_PUBLIC_URL` | _to verify_ | _to verify_ |
| 3. `email` / `email_verified` or userinfo | _to verify_ | _to verify_ |
| 4. CIMD (bonus) | _to verify_ | _to verify_ |

**Decision:** None yet. The founder picks one provider in M1-F6 and records the result per criterion above.
**Consequences (whichever is chosen):**
- Adds one external identity dependency; the MCP service trusts exactly that issuer. Changing providers later re-links every OAuth identity (new `(issuer, subject)` pairs).
- Configuration order is fixed (runbook §9.3, M2-F1): the issuer on `omnimind-mcp` (go-live re-run with `--oauth-issuer`) and `MCP_OAUTH_ALLOWED_ISSUERS` on omnimind-api first; `OMNIMIND_MCP_OAUTH_ISSUER` on boardroom-ai **last**, once verification passes (`scripts/verify-oauth.sh`, to be added by M2-A2), or Settings promises a sign-in the server cannot serve.
- OAuth identities start read-only (`memory:read`); widening is the admin `PATCH /mcp/identities/:id` until M2-B2 ships self-serve scopes.
- OAuth is **not** a dogfood day-1 gate: if it slips, ChatGPT and claude.ai active days are pro-rated from the OAuth date (Phase 8 Decision ledger).
**Alternatives rejected:** a built-in authorization server (Known Limitation 14; Phase 8 "Not doing"); token-only access for ChatGPT (impossible — no header field in its connector dialog).
