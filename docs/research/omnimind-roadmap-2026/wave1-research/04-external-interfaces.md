# Wave 1 Research — External Interfaces for AI Memory Backends (2025-2026)

> **Scope.** MCP servers, SDKs, markdown export/import, file-based UX (Obsidian-style), BYO-persona platforms. Anchored on primary-source MCP spec rev **2025-06-18**. Claims I couldn't verify from primary sources in this environment are flagged "best-knowledge as of Jan 2026 cutoff."
>
> **Lens.** OmniMind today: HTTP REST only, BoardRoom AI as the sole client. ADR-008 forbids MCP for *internal* tool calls but does not preclude exposing OmniMind *as* an MCP server for external clients.

---

## 1. MCP Server Design in 2026

The MCP spec is now on revision `2025-06-18` and has stabilized around two transports plus an OAuth 2.1 auth story. Production design clusters on four axes:

**Transport.** The 2024 `HTTP+SSE` transport is deprecated in favor of **Streamable HTTP**: a single endpoint (e.g. `https://omnimind.example.com/mcp`) that accepts POSTs and may upgrade to SSE for streaming. Servers SHOULD support both during the 2025-2026 migration window. `stdio` remains preferred for local subprocess servers (desktop integrations); Streamable HTTP is right for a hosted multi-tenant memory backend like OmniMind. Sessions use the `Mcp-Session-Id` header (UUIDs/JWTs). ([transports spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports))

**Resources vs. Tools.** MCP exposes three primitives: `tools` (model-invoked actions), `resources` (model-readable data with URIs), `prompts` (user-invoked templates). The maturing 2026 convention: **read-only data through resources, side-effecting operations through tools.** For OmniMind: `search_memory`, `add_memory`, `link_entities` are tools; rendered decision pages, weekly memos, entity-graph snapshots are resources with stable URIs. Resources support `notifications/resources/updated` so client caches stay fresh.

**Auth.** OAuth 2.1 with PKCE is mandated for HTTP transports, plus three RFCs that are now MUST: RFC 9728 (Protected Resource Metadata), RFC 8414 (Authorization Server Metadata), RFC 8707 (Resource Indicators). The flow: client hits `/mcp` without a token → 401 with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource` → client discovers AS → OAuth dance → token bound to *this resource* via the `resource` param. STDIO servers explicitly opt out and read credentials from env. Dynamic Client Registration (RFC 7591) is SHOULD, not MUST, but is what makes "paste a URL into Claude Desktop and it works" possible. ([authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization))

**Discovery + SDKs.** Beyond `.well-known/oauth-protected-resource`, capabilities are exposed during the JSON-RPC `initialize` handshake. Anthropic, GitHub, and Cloudflare run **MCP registries** — a curated entry plus a clean OAuth flow is roughly the 2026 equivalent of "ship a Slack app." Use the official **TypeScript SDK** (`@modelcontextprotocol/sdk`) or **Python SDK** — both ship `Server`, transport adapters, Zod-validated schemas, and OAuth helper middleware. Hand-rolling JSON-RPC was a 2024 anti-pattern.

---

## 2. Memory-as-MCP Examples in Production

Three credible reference implementations as of early 2026, plus a long tail of hobbyist builds:

- **mem0 MCP** (`mem0ai/mem0-mcp`). Tools: `add_memories`, `search_memory`, `get_all_memories`, `delete_memory`. Auth = `MEM0_API_KEY` env in stdio mode; bearer over Streamable HTTP for hosted. Heavily used in Cursor + Claude Desktop. Notable: tool surface is *thin* — deliberately doesn't expose mem0's graph internals, just CRUD + search.
- **Letta MCP**. Letta (formerly MemGPT) exposes agents via MCP. Tools include `send_message_to_agent`, `list_agents`, `modify_core_memory_block`. Design choice: agents are first-class — clients address an agent ID, not a memory store. Pulls Letta's stateful loop into Claude Desktop without rewrite.
- **Zep / Graphiti MCP**. Exposes a temporal knowledge graph: `add_episode`, `search_facts`, `get_entity_edges`. Less common in consumer setups, more in enterprise agents needing timeline-aware queries.
- **Custom builds.** Significant hobbyist surface (basic-memory, mcp-mem0, obsidian-mcp variants). Most are stdio-only, env-var auth, no OAuth. Few survive past a few hundred GitHub stars; the bar to "production" is OAuth 2.1 plus multi-tenant isolation.

Honest read: **memory MCPs are mature enough to ship but no one has nailed the UX**. Tool-name conflicts (every memory MCP exports `search_memory`) confuse multi-server setups. There's no convention for "which memory should I write to." Opportunity, not solved problem.

---

## 3. Markdown-as-Data Patterns (Obsidian-Inspired)

Obsidian set the de facto standard for "your knowledge as a folder of markdown." The portable contract has four pieces:

**Vault layout.** Flat or nested folder of `.md` files plus an `attachments/` (or per-note) folder for binaries. No required index; relationships are computed from links. Hidden `.obsidian/` for app-specific config — convention: *user data at root, app state in dotfolders.* Lossless export means OmniMind's data lives at root, OmniMind-specific metadata (embedding hashes, version vectors) in `.omnimind/`.

**Frontmatter.** YAML between `---` fences. Reserved Obsidian keys: `tags`, `aliases`, `cssclass`, `publish`. Everything else user-defined. For OmniMind memories:

```yaml
---
id: mem_01HXYZ...
domain: business
created: 2026-04-18T14:32:00Z
confidence: 0.82
source: session_01HW...
entities: [person:alex_chen, project:q2_pricing]
embedding_hash: sha256:7f2c...
---
```

**Wikilinks.** `[[Project Q2 Pricing]]` resolves by title; `[[Project Q2 Pricing#Decision]]` deep-links to a heading; `[[mem_01HXYZ|the pricing call]]` is alias-display. Wikilinks are **content-addressed**, not path-based — files move freely. OmniMind's entity graph (Person, Goal, Project, Task) maps cleanly: each entity is a markdown file, memories link to them.

**Lossless round-trip.** Three rules: (1) every database field maps to a frontmatter key or a body section with a documented marker, (2) entity-link tables become wikilinks, (3) embeddings aren't exported (they regenerate on import) but their hash is recorded so re-embedding can be skipped if the model version matches.

---

## 4. Git as a Sync Backend

Three patterns are in active use in 2026:

- **Repo-per-user.** `omnimind-vault-{userId}` on user's GitHub. OmniMind holds an OAuth token to push. Pros: simplest mental model; user can fork/share/archive trivially. Cons: scales linearly; private-repo cost is finite.
- **Branch-per-user in one org repo.** OmniMind owns the repo. Pros: cheap, central backup. Cons: violates "your data" — user can't easily detach.
- **Forked-vault (Logseq pattern).** Server holds canonical, user clones, sync via git push/pull. OmniMind exposes a `git remote` endpoint speaking smart-HTTP. Pros: works fully offline. Cons: implementing smart-HTTP is non-trivial — easier to delegate to GitHub.

**Conflict handling.** Markdown + YAML merges *terribly* with line-based git when two clients edit the same memory. Two viable approaches: (a) **last-write-wins per file with a conflict folder** — losing version saved as `_conflicts/{id}-{timestamp}.md`; (b) **per-field CRDT** (Yjs, Automerge) persisted as binary alongside markdown. CRDT is right for live multi-device, but most ship LWW first.

**Encryption at rest.** Private GitHub repo = GitHub is the trust anchor. For paranoid users, **age**-encrypted or `git-crypt` `.md` files give "GitHub holds ciphertext, OmniMind holds the key." Adds friction (no GitHub web preview). Realistic 2026 default: plaintext in private repos with opt-in encryption.

---

## 5. TypeScript SDK Design

Reference points: Stripe (gold standard), Anthropic, OpenAI, Resend. Patterns worth copying:

- **Generated from OpenAPI**, not hand-written. Stripe and OpenAI codegen their SDKs. Tools: `openapi-typescript`, `openapi-fetch`, or **Stainless / Speakeasy / Fern** for full multi-language. The OmniMind play: ship a Zod-derived OpenAPI spec (you already have Zod schemas), then codegen rather than hand-maintain.
- **Resource-based namespacing**: `omnimind.memories.create({...})`, `omnimind.decisions.list()`, `omnimind.personas.invoke('critic', {...})`. Mirrors Stripe.
- **Versioning.** Stripe pins API version per request via `Stripe-Version` header; SDK semver tracks features, not breakage. Right model: `Omnimind-API-Version: 2026-04-18` header, server supports N and N-1. Avoid `/v1/` URL prefixes — they collapse the version dimension into the route and force big-bang migrations.
- **Tree-shaking.** ESM-only or dual ESM/CJS, sub-resources as separate exports (`@omnimind/sdk/memories`), no side effects in index. OpenAI v4+ and Anthropic do this well.
- **Streaming.** First-class SSE (BoardRoom needs it for persona invocation): `for await (const chunk of client.personas.invokeStream(...))`. AbortController throughout.
- **Errors.** Typed subclasses (`OmnimindAPIError`, `OmnimindAuthError`, `OmnimindRateLimitError`) with `.code`, `.requestId`, `.statusCode`. Don't throw generic `Error`.
- **Retry + circuit breaker baked in.** OmniMind's existing `omnimind-client.ts` resilience layer is the right shape — porting it gives third-party integrators reliability for free.

Languages in order: **TypeScript first** (Node + browser + Deno + Bun), **Python second**, Go and Rust on demand only.

---

## 6. Persona Marketplace Patterns

Three live reference points in 2026:

- **Cursor Rules / `.cursorrules`** — text files committed to repos, shared via GitHub awesome-lists. No registry, install flow, or sandbox. Pros: zero infra. Cons: discovery is "scroll a README." `cursor.directory` emerged as a community index but isn't authoritative.
- **ChatGPT Custom GPTs / GPT Store** — central directory, OpenAI handles distribution. Strong discovery, weak monetization, opaque ranking, no version history visible to users.
- **Claude Code Plugins** (2025) — packages skills/agents/commands/hooks; installed from a registry URL or local path. Sandbox via the existing tool-permission model. Versioning via git tags. Closest to "right shape" because plugins are *git-cloneable*, *versioned*, *forkable*.

A persona marketplace for OmniMind would borrow the Claude Code shape:

1. **Persona = a directory**: `prompt.system.md`, `manifest.json` (name, description, target modes, recommended tools), optional `examples/`, `evals/`.
2. **Distribution = git URL**. `omnimind persona install github:author/repo@v1.2`. No central registry needed for v1.
3. **Sandbox = existing validation pipeline**. Imported personas go through Zod validation; tool calls restricted to a manifest-declared subset.
4. **Trust**: signed manifests (sigstore-style) for "verified" personas; everything else loads with a warning. Echoes npm-audit.
5. **Discovery**: thin web UI scraping a community-maintained `awesome-omnimind-personas` repo. Don't build a search engine in v1.

---

## 7. OAuth for MCP Servers — Implementation Reality

The spec is clear (Section 1). The 2026 implementation gotchas:

- **Dynamic Client Registration is make-or-break.** Without it, every user manually copies a `client_id` from your dashboard into Claude Desktop. With it, the client auto-registers and the user just clicks "Authorize." Build DCR or accept 10x lower adoption.
- **Token audience binding (RFC 8707) is now enforced.** Tokens issued for `https://omnimind.example.com/mcp` must be rejected by other servers. Most 2024-vintage MCPs got this wrong (accepted any valid token); 2025-2026 audits found this was a primary source of confused-deputy attacks.
- **Anthropic's Connectors framework.** Claude Desktop and Claude.ai consume third-party MCPs via an OAuth flow that mirrors the spec. Gotcha: Claude expects HTTPS redirect URIs (no localhost), so dev work needs ngrok or Cloudflare Tunnel. The Connector Directory is the practical go-to-market channel.
- **Scopes.** MCP doesn't standardize names. Convention forming: `mcp:tools:read`, `mcp:tools:write`, `mcp:resources:read`. For OmniMind, layer domain scopes: `omnimind:memory:read`, `omnimind:memory:write`, `omnimind:decisions:write`, `omnimind:personas:invoke`.
- **Refresh tokens MUST rotate** for public clients (desktop apps, browser apps).
- **You are now an OAuth provider.** Consent screen, sessions/tokens admin, revocation, audit logs. Multi-week investment — prefer **Ory Hydra**, **Keycloak**, **WorkOS**, or **Auth0** over rolling your own.

---

## 8. File-Based + Database-Backed Coexistence

Hardest design question in this report; **no clean industry consensus** in 2026. Three patterns:

- **Database-primary, file-export as projection.** Database canonical; markdown is read-only export. Re-import is "migration" with conflict review. Pros: simple, schema invariants always hold. Cons: edits in the markdown are lost on next export.
- **File-primary, database as derived index.** Git repo canonical; database is queryable cache. File-watcher (or webhook-on-push) re-derives state. Pros: strongest portability, edits in any editor "just work." Cons: schema enforcement happens *after* the write; embedding regen cost.
- **Bidirectional with event log.** Append-only event log; both file changes (git webhook) and API changes write events; reconciler applies with conflict resolution. Pros: eventual consistency works; full audit trail. Cons: highly nontrivial to build correctly. CRDTs (Yjs, Automerge) handle the merge math but require careful schema design.

**Best practical bet for OmniMind:** start database-primary + scheduled export + conflict-folder on re-import. Defer bidirectional sync to a later phase. Design markdown from day one to be losslessly re-importable even if round-trip isn't real-time.

---

## 9. Webhook / Event Bus for Downstream Integrations

When OmniMind writes a memory, who needs to know? In 2026: the user's Zapier/n8n/Make workflow, a second OmniMind client, an analytics pipeline, the user's calendar/task manager, marketplace personas wanting notification when their memories are referenced.

**Industry pattern: webhooks plus an event bus.**

- **Webhooks** for individual integrations. Stripe is gold standard: signed payloads (`Stripe-Signature` HMAC), at-least-once delivery, exponential backoff, dead-letter after N failures, replay UI, per-endpoint secrets. Svix is the popular OSS-and-managed option.
- **Event bus** for fanout. Postgres LISTEN/NOTIFY works to a few hundred subscribers; Redis Streams or NATS JetStream beyond that. Avoid Kafka unless you need replay across weeks.
- **Event taxonomy.** Noun-verb past-tense: `memory.created`, `decision.synthesized`, `commitment.completed`, `persona.invoked`. Version the schema (`v1` envelope with `data_schema_version` inside). Filter consumer-side, not producer.
- **Outbox pattern.** Write the event to a Postgres `outbox` table in the same transaction as the memory write; a worker drains to webhooks/bus. Every payments system eventually builds this.

A webhook surface unlocks "OmniMind as the brain, every other tool as the hands" without building integrations in-house.

---

## 10. BYO-Model Patterns at the Interface Layer

ADR-002 says Claude only inside OmniMind core. But a custom persona uploaded by a user might want GPT-4o, Gemini, or local Llama. The trick: keep BYO-model **at the interface layer, not in core**:

- **Pattern A: Adapter persona.** Custom persona has a `model_provider` field in its manifest. On invocation, OmniMind doesn't call the LLM — it returns the rendered prompt + context to the *caller*, who calls their own model. OmniMind stays Claude-only; caller handles routing. Clean but pushes complexity to clients.
- **Pattern B: Sidecar inference proxy.** A separate service (`omnimind-byo`) accepts the rendered prompt, calls the user's chosen provider with the user's API key (encrypted in `OAuthToken`), returns the result. OmniMind core never imports any LLM SDK other than Anthropic. Can be open-sourced and self-hosted.
- **Pattern C: MCP server delegation.** Custom persona is itself an MCP server pointed at a different memory backend or model. OmniMind invokes it as a federated tool. Most flexible, most complex.

The interface-layer answer matters because it preserves ADR-002 (Claude inside) while honoring user freedom (their model for their persona). Pattern A is the cleanest first step; B is right once 50+ custom personas exist; C is for the long tail.

---

## Implications for OmniMind Roadmap

**Phase 10 — MCP Server.** Ship `omnimind-mcp` as a Streamable HTTP server at `/mcp` on the existing OmniMind domain. **OAuth 2.1 with Dynamic Client Registration via WorkOS or Ory Hydra** — do not build the OAuth provider in-house; the audit and token-rotation surface is too large. Tools to expose first: `search_memory`, `add_memory`, `list_decisions`, `invoke_persona`, `get_weekly_memo`. Resources: `memory://{id}`, `decision://{id}`, `persona://{name}`. Submit to Anthropic's Connector Directory once stable. Scope conservatively in v1 — read paths and a small write surface only. Defer entity-graph mutation tools (`link_entities`, `create_goal`) to keep the trust story simple. ~4-6 weeks including OAuth integration.

**Phase 11 — Markdown Export.** Vault layout: `memories/`, `decisions/`, `entities/{people,goals,projects,tasks}/`, plus `.omnimind/` for metadata. Frontmatter convention: every database field maps to a YAML key, ISO-8601 dates, lowercase kebab-case tags, entity references as wikilinks. Sync mechanism: **on-demand export to a user-owned GitHub repo via OAuth**; users push/pull manually. Defer real-time bidirectional sync; ship the conflict-folder pattern for re-import. Encryption: optional `age`-based mode in v2. ~3-4 weeks.

**Phase 12 — TypeScript SDK.** Codegen from a Zod-derived OpenAPI spec; ship `@omnimind/sdk` on npm. Resource-namespaced (`omnimind.memories.*`), header-based versioning (`Omnimind-API-Version`), typed errors, SSE streaming, retry/breaker carried from `omnimind-client.ts`. Python SDK as Phase 12.5 if demand emerges. Skip Go/Rust until paying customers ask. ~2-3 weeks for TS plus codegen pipeline (1 week).

**Phase 17 — Persona Marketplace.** **Add it.** The CustomPersona schema is already there; the interface story is what's missing. Scope: git-installable personas (`omnimind persona install github:user/repo@tag`), manifest-declared tool restrictions, signed-manifest verification for "verified" personas, thin discovery UI scraping an `awesome-omnimind-personas` community repo. Defer full marketplace (search, ratings, monetization) until 100+ personas exist. ~4-6 weeks.

**New Phase 13 — Webhook / Event Bus.** **Add it, before the SDK.** Without webhooks, the SDK is "polite polling." With them, OmniMind becomes a real platform. Implementation: outbox pattern in Postgres, signed payloads (HMAC-SHA256), exponential-backoff retry, dead-letter table, per-endpoint secrets, event taxonomy `noun.verb`, consumer-side filtering. Use Svix if budget allows; otherwise hand-roll outbox + delivery worker (~2 weeks). This unlocks Zapier/n8n/Make integrations with no in-house glue.
