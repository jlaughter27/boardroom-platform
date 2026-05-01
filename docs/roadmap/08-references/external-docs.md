# External Documentation — Curated Links

For when you need the primary source. Each link is followed by what it covers and when in the roadmap you'd reach for it.

---

## LLM platforms

### Anthropic SDK + API

- **Claude API reference:** https://docs.anthropic.com/en/api — Messages API, tool use, streaming, vision. Reach for this when implementing or debugging any direct Anthropic call.
- **Tool use docs:** https://docs.anthropic.com/en/docs/build-with-claude/tool-use — native `tool_use` content blocks. ADR-008 says we use these, not MCP, for internal tool calls. The agent runtime in `packages/boardroom-ai/server/src/agents/agent.ts` is built around this primitive.
- **Prompt caching:** https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching — 1h TTL caching, ~10% cost on cached tokens. Apply to long persona system prompts and shared retrieval context.
- **Message Batches API:** https://docs.anthropic.com/en/docs/build-with-claude/message-batches — 50% cost reduction for ≤24h-latency-tolerant work. Phase 15 of the ops roadmap migrates cortex jobs to this.
- **Building effective agents:** https://www.anthropic.com/research/building-effective-agents — Anthropic's published agent guidance. Validates omnimind's "give the agent a filesystem and let it write/read" stance and the custom-runtime approach.
- **Embeddings docs (recommends Voyage):** https://docs.anthropic.com/en/docs/build-with-claude/embeddings — Anthropic has no first-party embedder; recommends Voyage. Relevant if/when ADR-011 (OpenAI text-embedding-3-small) is revisited.
- **Context management / memory tool:** https://www.anthropic.com/news/context-management — late-2025 server-managed scratchpad. Useful pattern reference; orthogonal to our memory store.

### OpenAI (embeddings only — ADR-011)

- **Embeddings API reference:** https://platform.openai.com/docs/api-reference/embeddings — `text-embedding-3-small` (1536-dim) is what we use. 2,048 inputs per request max. 8,192 token-per-input cap.
- **New embeddings announcement:** https://openai.com/index/new-embedding-models-and-api-updates/ — pricing and dim options.

---

## Database + ORM

### Prisma

- **Connection management:** https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections — pool sizing, timeouts.
- **PgBouncer integration:** https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer — `?pgbouncer=true&connection_limit=1`. Phase 14 of the ops roadmap.
- **Migration baselining:** https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining — the SOP for moving from `prisma db push` to `prisma migrate deploy`. Phase 14 of the ops roadmap.
- **Read replicas extension:** https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/read-replicas — `@prisma/extension-read-replicas`. Phase 16+ of the ops roadmap.
- **Expand-and-contract pattern:** https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern — zero-downtime schema migration recipe.

### pgvector

- **README:** https://github.com/pgvector/pgvector — install, index types (IVFFlat, HNSW), distance ops.
- **0.8.0 release notes:** https://github.com/pgvector/pgvector/releases/tag/v0.8.0 — iterative scans, halfvec, query planning improvements.
- **Performance docs:** https://github.com/pgvector/pgvector#performance — tuning `m`, `ef_construction`, `ef_search`. Reach for this in Phase 3 (HNSW migration).
- **Supabase HNSW guide:** https://supabase.com/blog/increase-performance-pgvector-hnsw — practical tuning recipes.

### PostgreSQL extensions and patterns

- **pg_trgm:** https://www.postgresql.org/docs/current/pgtrgm.html — trigram fuzzy match. Used in `packages/omnimind-api/src/retrieval/trigram-search.ts`.
- **tsvector / FTS:** https://www.postgresql.org/docs/current/textsearch.html — full-text search. Used inline in `fulltext-search.ts`.
- **Recursive CTEs:** https://www.postgresql.org/docs/current/queries-with.html — for the entity-graph traversal in Phase 4 (`relationship.service.ts::findRelatedEntities`).
- **GiST + tstzrange (bi-temporal):** https://www.postgresql.org/docs/current/rangetypes.html — for full bi-temporal support, if ever adopted (currently bi-temporal-lite via three columns).

---

## Web framework + runtime

### Express 4

- **Express docs:** https://expressjs.com/ — middleware order matters. See `docs/FRAGILE-ZONES.md` §2.
- **Helmet:** https://helmetjs.github.io/ — security headers we apply globally.

### Vitest

- **Vitest docs:** https://vitest.dev/ — Vite-native testing framework. Used for unit tests across all packages and the eval runners.
- **Coverage:** https://vitest.dev/guide/coverage — c8 / istanbul backed; `npm run test -- --coverage` from any package.

### Zod

- **Zod docs:** https://zod.dev/ — schemas, refinements, transforms. ADR-012 mandates Zod validation at all boundaries.

---

## Deploy + ops

### Railway

- **Railway docs:** https://docs.railway.com/ — auto-deploy on push, Postgres plugin, env vars, custom domains.
- **Postgres plugin reference:** https://docs.railway.com/reference/postgresql — backup story (plan-dependent), connection limits.
- **Private networking:** https://docs.railway.com/reference/private-networking — for switching `OMNIMIND_API_URL` from public to internal (cuts a public-internet hop).

### Better Stack / Axiom (observability)

- **Better Stack:** https://betterstack.com/ — pino transport, free 1GB/mo, 3-day retention.
- **Axiom:** https://axiom.co/ — APL query language, free 0.5TB/mo. Either is fine; pick one for Phase 0 log drain.
- **OpenTelemetry:** https://opentelemetry.io/ — vendor-portable. `pino-opentelemetry-transport` is the bridge.

---

## MCP + protocols

### Model Context Protocol

- **MCP spec home:** https://modelcontextprotocol.io/ — start here.
- **2025-06-18 transports spec:** https://modelcontextprotocol.io/specification/2025-06-18/basic/transports — Streamable HTTP (the production transport, replaces deprecated HTTP+SSE).
- **2025-06-18 authorization spec:** https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization — OAuth 2.1 + PKCE + RFC 8707 audience binding + SHOULD-DCR. Phase 10 builds against this.

### OAuth 2.1 + DCR

- **RFC 8414 (Authorization Server Metadata):** https://datatracker.ietf.org/doc/html/rfc8414
- **RFC 8707 (Resource Indicators):** https://datatracker.ietf.org/doc/html/rfc8707
- **RFC 7591 (Dynamic Client Registration):** https://datatracker.ietf.org/doc/html/rfc7591 — make-or-break for the "paste a URL into Claude Desktop and it works" UX.
- **WorkOS, Ory Hydra, Keycloak, Auth0** — pick one rather than rolling your own OAuth provider for Phase 10.

---

## Stripe (subscriptions)

- **Stripe webhooks:** https://stripe.com/docs/webhooks — `Stripe-Signature` HMAC, signed payloads, retry semantics. Gold standard for the webhook pattern Phase 13 of the ops roadmap implements (with Postgres outbox).
- **Stripe API reference:** https://stripe.com/docs/api — for billing, subscriptions, invoices.
- **Stripe Node SDK:** https://github.com/stripe/stripe-node — types, idempotency keys, retries.

## Testing

- **Vitest:** see above.
- **Playwright (e2e):** https://playwright.dev/ — used in `tests/e2e/`.

## Other useful references

- **Anthropic Connector Directory** — submit your MCP server to Anthropic's marketplace for distribution to Claude Desktop and Claude.ai users.
- **Model Context Protocol reference servers:** https://github.com/modelcontextprotocol/servers — including the `server-memory` reference (a tiny knowledge-graph server). Hobby-tier; useful as a conformance example.
- **mem0:** https://github.com/mem0ai/mem0 — read for the ADD/UPDATE/DELETE write-loop pattern, not as a dependency.
- **Graphiti (Zep):** https://github.com/getzep/graphiti — read for bi-temporal modeling, not as a dependency.

For omnimind-internal references and decisions, see `08-references/codebase-map.md`, `08-references/adrs/`, and `01-foundations/ADR-INDEX.md`.
