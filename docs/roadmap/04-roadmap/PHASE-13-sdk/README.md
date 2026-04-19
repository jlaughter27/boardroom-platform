# PHASE 13 — Public TypeScript SDK

**Time budget:** 3-4 weeks (research-validated; original 1.5w underestimated codegen pipeline + streaming + webhook helpers)
**Sequence:** After Phase 12 (webhooks). The SDK ships webhook helper types and event-handler ergonomics that depend on the locked envelope shape.
**Owner:** dev
**Confidence:** HIGH (Stripe/OpenAI/Anthropic patterns are well-established; biggest risk is bikeshed on API surface)

---

## What this is

Ship `@omnimind/sdk` on npm. The SDK is the **second** way to integrate with OmniMind (MCP is the first; raw HTTP is the third). Targets:

- **Languages:** TypeScript first (Node + browser + Deno + Bun). Python second on demand. Go/Rust deferred.
- **Codegen:** generated from a Zod-derived OpenAPI spec, not hand-written. Uses Stainless / Speakeasy / Fern OR a Zod→OpenAPI→openapi-fetch pipeline. Stripe and OpenAI are reference implementations.
- **Resource-namespacing:** `omnimind.memories.create({...})`, `omnimind.decisions.list()`, `omnimind.personas.invoke('critic', {...})`. Mirrors Stripe.
- **Versioning via header:** `Omnimind-API-Version: 2026-04-18`. Server supports current and previous versions. NO `/v1/` URL prefixes — that collapses the version axis into the route.
- **Tree-shakeable:** ESM-first with dual ESM/CJS, sub-resources as separate exports (`@omnimind/sdk/memories`), no side-effects in index.
- **Streaming first-class:** `for await (const chunk of client.personas.invokeStream(...))`. Powered by the Fetch + ReadableStream + EventSource patterns used by Anthropic + OpenAI SDKs. AbortController throughout.
- **Typed errors:** `OmnimindAPIError`, `OmnimindAuthError`, `OmnimindRateLimitError`, `OmnimindValidationError`. Each has `.code`, `.requestId`, `.statusCode`. Never throw generic `Error`.
- **Resilience baked in:** port the existing `omnimind-client.ts` retry + circuit-breaker layer so third-party integrators get reliability for free.
- **Webhook helpers:** `omnimind.webhooks.constructEvent(rawBody, signatureHeader, secret)` validates the HMAC and returns a typed `OmnimindEvent` (envelope from Phase 12).
- **Browser-safe:** the package can be imported in the browser; the constructor accepts a `dangerouslyAllowBrowser: true` flag (Stripe pattern) since the API key flow targets server-side use, but a future browser-friendly auth (PKCE flow against the OAuth provider from Phase 10) is documented.

---

## Why now

1. **External developers cannot integrate without it.** Curl-against-our-API works for hobbyists; production integrations need types, retries, streaming, and webhook helpers.
2. **Marketing surface.** "We have a TypeScript SDK" is a credibility marker for indie hackers and early B2B prospects.
3. **Forcing function on API consistency.** The codegen pipeline surfaces every endpoint's inconsistencies (snake_case vs camelCase, inconsistent pagination, missing types). Fix them as one batch instead of piecemeal.

## Prerequisites

- Phase 10 (MCP) complete — the SDK uses the same OAuth provider for browser flows
- Phase 12 (webhooks) complete — envelope shape locked
- Decision: codegen tool (Stainless vs Fern vs Speakeasy vs hand-rolled openapi-fetch). Default: openapi-fetch for v1 (zero vendor lock-in), revisit Stainless if multi-language demand emerges.
- All Zod schemas in `packages/shared/src/validation/` audited for OpenAPI-generation friendliness

## Exit criteria

- [ ] `@omnimind/sdk` published to npm under `@omnimind` org (or whatever the agreed name is)
- [ ] Resource-namespaced surface: `memories`, `decisions`, `entities`, `personas`, `webhooks`, `commitments`, `cortex`
- [ ] Streaming: `personas.invokeStream()` works; AbortController honored
- [ ] Typed errors with `.code`, `.requestId`, `.statusCode`
- [ ] Header versioning via `Omnimind-API-Version`
- [ ] Webhook helpers verified against Phase 12 mock fixtures
- [ ] Retry + circuit breaker behavior matches `omnimind-client.ts` (audit by direct comparison)
- [ ] OpenAPI spec at `https://omnimind-api-production.up.railway.app/openapi.json` (Zod-generated)
- [ ] Codegen pipeline runs in CI; SDK regenerated on every API schema change
- [ ] Integration test repo (`omnimind-sdk-integration-tests`) exercises every resource against a staging environment
- [ ] README with quickstart, error handling, streaming, webhook verification examples
- [ ] Bundle size: <50KB minified+gzipped for browser import (tree-shaken)
- [ ] Works in Node 20+, Deno 1.40+, Bun 1.0+, modern browsers (Chrome/Firefox/Safari latest 2)

## Dependencies

- **Upstream:** Phase 10 (MCP/OAuth), Phase 12 (webhooks/envelope)
- **Downstream blocks:** Phase 17 Persona Marketplace (personas may include SDK-using example code), and any future B2B sales motion
- **Concurrency:** Cannot ship in parallel with Phases 10 or 12 (depends on both)

## Blast radius

- **Mostly net-new code in a new top-level package** `packages/omnimind-sdk/`. Does NOT modify existing packages.
- **Server-side change:** add `/openapi.json` route in `omnimind-api`. Add the `Omnimind-API-Version` header parsing middleware and a version-aware request router (most v1 endpoints are unchanged; the middleware is a no-op for now but the plumbing must exist).
- **Risk:** SDK public surface is hard to take back. Once published, breaking changes require a new major version. Spend time on Task 13.1 (API audit) before generating.
- **Rollback:** `npm unpublish` is allowed within 72h; after, deprecate the version with a clear migration message. The server keeps working for any client (curl, MCP, BoardRoom) regardless of SDK status.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
