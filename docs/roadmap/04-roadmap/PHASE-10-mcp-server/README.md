# PHASE 10 — Memory MCP Server

**Time budget:** 4-6 weeks (research-validated; original 2w estimate was wrong — OAuth 2.1 + DCR is the long pole)
**Sequence:** First phase of the make-it-10 stretch. Runs immediately after Phase 9 (purge) closes mem0 core.
**Owner:** dev
**Confidence:** MED (OAuth 2.1 surface is large; DCR via WorkOS/Hydra de-risks but adds an external dependency)

---

## What this is

Expose OmniMind's memory + decision + persona surface as a **production MCP server** at `https://omnimind-api-production.up.railway.app/mcp`, conforming to MCP spec revision **2025-06-18**.

Concretely:

- **Streamable HTTP transport** at `/mcp` (not the deprecated 2024 HTTP+SSE shape). Single endpoint accepts POST, may upgrade to SSE for streaming. Sessions identified via `Mcp-Session-Id` header.
- **OAuth 2.1 + PKCE + Dynamic Client Registration** via **WorkOS** or **Ory Hydra** — do NOT roll our own OAuth provider. The audit, token-rotation, and consent-screen surface is multi-week and security-critical.
- **Token audience binding (RFC 8707)** enforced — tokens issued for `omnimind.example.com/mcp` must be rejected if presented elsewhere. This is the primary 2024-vintage MCP attack vector that 2025-2026 audits flagged.
- **Tool surface (v1, conservative):**
  - `searchMemories` — hybrid retrieval, returns top-k with snippets
  - `createMemory` — write to user's memory store via the validation pipeline
  - `getEntity` — fetch a Person/Goal/Project/Task by ID
  - `findRelatedEntities` — recursive-CTE 1-2 hop traversal (relies on Phase 4)
  - `getDecisionContext` — fetch a Decision plus its assumptions and linked memories
- **Resources:** `memory://{id}`, `decision://{id}`, `entity://{type}/{id}`, `persona://{name}`
- **Defer to v2:** entity-graph mutations (`linkEntities`, `createGoal`), persona invocation (`invokePersona`)
- **Submit to Anthropic Connector Directory** post-launch — practical go-to-market channel for Claude Desktop / Claude.ai users.

---

## Why now

1. **Distribution wedge.** The mem0 core is "just an API" until external clients can use it. MCP is the 2026 equivalent of a Slack app — paste a URL into Claude Desktop and it works.
2. **External validation of the entity graph.** Nothing exposes integration bugs faster than a third-party agent calling `findRelatedEntities` with edge-case inputs.
3. **OAuth surface forces multi-tenant isolation discipline.** Per-tenant scope binding will surface any seam-level leaks in retrieval.

## Prerequisites

- Phase 0-9 complete (mem0 core stable; eval gates green)
- `findRelatedEntities` exists (Phase 4)
- HNSW index live (Phase 3) — search latency must be <100ms p95 to make MCP usable
- **WorkOS or Hydra account provisioned** before code work starts
- Production HTTPS domain stable (Railway custom domain or `.up.railway.app`)

## Exit criteria

- [ ] `/mcp` endpoint responds to MCP `initialize` handshake; returns capabilities
- [ ] OAuth 2.1 flow works end-to-end from Claude Desktop (manual test)
- [ ] DCR live — `POST /oauth/register` returns a `client_id` without human approval
- [ ] All 5 tools registered, schema-validated, exercised by integration test
- [ ] Token audience binding enforced (test: token from another resource returns 401)
- [ ] Refresh-token rotation verified for public clients
- [ ] Per-tenant isolation: user A's MCP token cannot access user B's memories (eval scenario)
- [ ] Submitted to Anthropic Connector Directory; entry visible
- [ ] `docs/contracts/mcp-server.contract.md` written
- [ ] `docs/prompts/` unchanged (this phase exposes existing logic, doesn't add personas)

## Dependencies

- **Upstream:** Phase 4 (entity graph traversal); Phase 9 (no `_disabled/` cruft for auditors to ask about)
- **Downstream blocks:** Phase 13 SDK (the SDK references the same OAuth + tool surface for parity); Phase 14 observability (MCP traffic must be observable from day one)
- **Concurrency:** Can ship in parallel with Phase 11 (markdown export) — no shared files

## Blast radius

- **Net-new code surface.** New routes, new auth subsystem, new tool registry. Almost no existing files change.
- **Risk concentration:** OAuth misconfiguration. Mitigated by using a managed provider (WorkOS or Hydra) and by the audience-binding test in exit criteria.
- **Rollback:** disable the `/mcp` route via env flag (`MCP_ENABLED=false`); existing OmniMind clients (BoardRoom) unaffected because they use `x-api-key`, not OAuth.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
