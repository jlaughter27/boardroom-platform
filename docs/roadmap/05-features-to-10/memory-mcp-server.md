# Memory MCP Server

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). In particular, ADR-008 forbids MCP for OmniMind's *internal* tool calls — but exposing OmniMind *as* an MCP server for external clients is a different thing entirely and is in scope.

---

## Problem

BoardRoom AI is the only client of OmniMind today. Every other surface — Claude Desktop, Cursor, ChatGPT custom GPTs, third-party agents, the user's own scripts — has no way in. That's a strategic ceiling: it traps OmniMind's value behind one frontend and forces every BYO-model or BYO-frontend user to either rebuild BoardRoom or do without persistent memory.

The Model Context Protocol (`2025-06-18` revision) standardised how LLM clients connect to remote tools and data. Memory backends like mem0, Letta, and Zep already ship MCP servers; users expect to type a URL into Claude Desktop, click "Authorize," and get their memories back. Without it, OmniMind looks like a closed product. With it, OmniMind becomes the memory layer for *any* compliant client.

## Approach

Ship a **Streamable HTTP MCP server** at `/mcp` on the existing OmniMind Railway domain. One endpoint accepts JSON-RPC POSTs and may upgrade to SSE for streaming responses. Sessions tracked via the `Mcp-Session-Id` header. Auth: **OAuth 2.1 with PKCE + Dynamic Client Registration**, delegated to a managed provider (WorkOS or Ory Hydra). Do not roll our own OAuth provider — the audit, refresh-token rotation, and consent surface is multi-week work.

The MCP layer is a *thin facade* over existing OmniMind services:
- Tools translate to internal service calls (`memory.service.ts`, `decision.service.ts`).
- Writes route through the existing validation pipeline (`memory/validation/pipeline.ts`).
- Reads use the existing hybrid-retrieval stack.
- No new persistence; the MCP layer is stateless apart from session metadata.

The convention forming in 2026: read-only data through `resources` with stable URIs (`memory://{id}`, `decision://{id}`); side-effecting operations through `tools`. We follow it.

## Tool surface (v1 — 5-7 tools, conservative)

| Tool | Direction | Notes |
|---|---|---|
| `search_memory` | read | hybrid retrieval; returns top-N with provenance |
| `add_memory` | write | routes through validation pipeline; returns memory ID |
| `list_decisions` | read | paginated, filterable by domain + date range |
| `get_weekly_memo` | read | returns latest cortex memo |
| `invoke_persona` | side-effect (LLM call) | streams via SSE; only `optimist | critic | doer | technician` exposed in v1 |
| `link_entities` | write | DEFERRED to v2 — keeps trust story simple |
| `create_goal` | write | DEFERRED to v2 |

Resources:
- `memory://{id}` — rendered memory with related entities
- `decision://{id}` — decision page with assumptions and synthesis
- `persona://{name}` — persona manifest (system prompt, recommended tools)

Resources support `notifications/resources/updated` so client caches invalidate on writes.

## Schema impact

**None.** The MCP layer is read-only over existing entities and writes through the existing validation pipeline. The only new persistence is OAuth-related (handled by the provider, not Prisma).

If we self-host the OAuth provider later, we add:

```prisma
// Only if NOT delegating to WorkOS/Hydra
model OAuthClient {
  id              String   @id @default(cuid())
  userId          String
  clientId        String   @unique
  clientSecretHash String
  redirectUris    String[]
  scopes          String[]
  createdAt       DateTime @default(now())
  user            User     @relation(fields: [userId], references: [id])
}
```

For v1, delegate. Skip the table.

## API surface

All under `/mcp`:

- `POST /mcp` — JSON-RPC entry; methods `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `notifications/initialized`, etc.
- `GET /.well-known/oauth-protected-resource` — points at the AS (per RFC 9728)
- `GET /.well-known/oauth-authorization-server` — only if self-hosting AS (RFC 8414)

Scope vocabulary:
- `omnimind:memory:read`, `omnimind:memory:write`
- `omnimind:decisions:read`, `omnimind:decisions:write`
- `omnimind:personas:invoke`

Tokens MUST be audience-bound to `https://omnimind.example.com/mcp` (RFC 8707). Refresh tokens MUST rotate for public clients.

## Phases

- [`../04-roadmap/PHASE-10-mcp-server/`](../04-roadmap/PHASE-10-mcp-server/) — primary phase
- Builds on observability suite (Phase 13) being deferred-but-ready: structured logs from MCP calls go through Pino → OTLP

Estimated effort: ~4-6 weeks including OAuth provider integration.

## Risks

- **Auth complexity.** OAuth 2.1 + DCR + RFC 8707 audience binding + RFC 9728 metadata is a lot of moving parts. Mitigation: delegate to WorkOS or Ory Hydra; do not self-host the AS in v1.
- **MCP spec churn.** The spec is on `2025-06-18`; revisions are still landing. Mitigation: pin to a spec revision, gate breaking changes behind a `protocolVersion` negotiation.
- **Tool-name conflicts.** Every memory MCP exports `search_memory`. Multi-server setups confuse the model. Mitigation: ship with `omnimind_search_memory` aliases too; document the convention.
- **Confused-deputy attacks.** Tokens issued for OmniMind being accepted by other servers. Mitigation: enforce RFC 8707 audience binding from day one.
- **Adoption gating on Connector Directory.** Anthropic curates the Claude Desktop Connector list; rejection delays go-to-market. Mitigation: submit early, build a self-install fallback.
- **Write-surface abuse.** Exposing `add_memory` to arbitrary clients invites prompt-injected memory poisoning. Mitigation: validation pipeline already runs schema → temporal → budget checks; add an "MCP-origin" provenance flag to make audit easier.

## Success metrics

- p95 latency on `search_memory` < 300ms (single-tenant, warm cache)
- Successful end-to-end OAuth flow from Claude Desktop in < 60s
- 100+ external installs within 90 days of submitting to Connector Directory
- Zero confused-deputy incidents (RFC 8707 audit passes)
- < 1% of writes flagged by validation pipeline as malformed (proxy for client SDK quality)

## Dependencies on other features

- **Observability suite** (Phase 13) — needed to monitor a new public surface
- **Webhooks event bus** (Phase 13) — `memory.created` events should fire from MCP writes too (same code path as REST)
- **Per-tenant cost controls** (Phase 14) — `invoke_persona` over MCP must charge against the same per-user budget as BoardRoom invocations
- **Public SDK** (Phase 12) — the SDK can ship before the MCP server, but they share the OpenAPI/contract source of truth
