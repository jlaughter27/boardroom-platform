# Public SDK (TypeScript First, Python Second)

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

Third-party developers integrating OmniMind today have to read the OpenAPI docs (which don't exist yet), hand-roll an HTTP client, reinvent retry/timeout/circuit-breaker logic, parse SSE streams themselves, and manage error types. That's a >2-day onboarding tax that kills adoption. Stripe's SDK is the reason every fintech can ship payments in an afternoon; we want the same dynamic for memory.

A first-party SDK also gives us a concrete artifact to dogfood: BoardRoom's existing `omnimind-client.ts` is essentially a private SDK. Publishing it (with a stable contract) means BoardRoom uses the same code as every other consumer, which forces the contract to stay honest.

## Approach

### Languages, in order

1. **TypeScript first** (Node + browser + Deno + Bun). All our consumers, BoardRoom, marketplace personas, MCP clients written in TS, almost every Anthropic-ecosystem developer.
2. **Python second**. Data scientists, batch importers, Jupyter users. Ship 6-12 weeks after TS once the codegen pipeline is stable.
3. **Skip Go and Rust** until paying customers ask. Maintenance cost is non-trivial; demand is hypothetical.

### Codegen, not hand-written

Stripe and OpenAI codegen their SDKs. We do the same:

1. Convert existing Zod schemas (in `packages/shared/src/validation/`) to OpenAPI 3.1 using **`zod-to-openapi`** (or **`@asteasolutions/zod-to-openapi`**, which integrates cleanly with Express route registration).
2. Emit a single `openapi.yaml` artifact in CI on every push to `main`.
3. Run **`openapi-typescript`** + **`openapi-fetch`** for the TS SDK skeleton, plus a thin hand-written wrapper for resource namespacing, retry/breaker, and SSE.
4. For Python: run **`openapi-python-client`** or **Stainless / Speakeasy / Fern** if budget allows.

The hand-written layer stays small (< 1,500 LOC); generated types do the heavy lifting.

### Resource-based namespacing (mirror Stripe)

```ts
const omnimind = new Omnimind({ apiKey, baseUrl })

await omnimind.memories.create({ content: '...', domain: 'business' })
await omnimind.memories.search({ query: 'pricing', limit: 10 })
await omnimind.decisions.list({ since: '2026-04-01' })
await omnimind.personas.invoke('critic', { prompt: '...' })

for await (const chunk of omnimind.personas.invokeStream('doer', { prompt })) {
  process.stdout.write(chunk.text)
}
```

### Header-based versioning (mirror Stripe)

- Server supports N and N-1.
- Clients send `Omnimind-API-Version: 2026-04-18` per request.
- Default if omitted: account-pinned version (set on first request, opt-out).
- **No `/v1/` URL prefix.** It collapses the version dimension into the route and forces big-bang migrations. Every API-versioning post-mortem from the last decade lands on header-based.

### Resilience layer ported from `omnimind-client.ts`

The existing client already has timeout (`OMNIMIND_TIMEOUT_MS`), retry (`OMNIMIND_RETRY_MAX`), and circuit breaker (`OMNIMIND_BREAKER_*`) configured by env. The SDK ports the same defaults and exposes them as constructor options:

```ts
new Omnimind({
  apiKey,
  timeoutMs: 10000,
  retryMax: 3,
  breaker: { threshold: 5, cooldownMs: 15000 },
})
```

Retry rules: GET/HEAD on 502/503/504 + network errors only. 4xx never retries and never trips the breaker. `breaker.toJSON()` exposed for monitoring.

### Typed errors

```ts
class OmnimindAPIError extends Error { code: string; requestId: string; statusCode: number }
class OmnimindAuthError extends OmnimindAPIError {}
class OmnimindRateLimitError extends OmnimindAPIError { retryAfter: number }
class OmnimindValidationError extends OmnimindAPIError { issues: ZodIssue[] }
class OmnimindCircuitOpenError extends Error {}
```

Don't throw generic `Error`. Every error carries `requestId` for support correlation.

### Tree-shaking

Dual ESM/CJS, sub-resources as separate exports (`@omnimind/sdk/memories`), no side effects in `index.ts`. OpenAI v4+ and Anthropic do this well; we copy the pattern.

### Streaming (SSE)

First-class. Used for `personas.invokeStream`, future `memories.searchStream` (long-running hybrid retrieval). `AbortController` throughout. The TypeScript stream parser borrows from the Anthropic SDK rather than reinventing.

## Schema impact

**None.** The SDK is a generated client over the existing REST API. The only repo-level change is a new package: `packages/sdk-typescript/`.

## API surface

The SDK is the API surface — but the OpenAPI spec it's generated from must be authoritative. Add a CI gate: **schema diff fails the build** if a Zod schema changes without a corresponding OpenAPI artifact regen and a CHANGELOG entry.

## Phases

- [`../04-roadmap/PHASE-13-sdk/`](../04-roadmap/PHASE-13-sdk/) — TypeScript SDK (canonical numbering; was tagged "Phase 12" by Builder 4)
- Python SDK is "Phase 13.5"; ships when TS has 3+ external consumers

Estimated effort: ~3-4 weeks for TypeScript SDK + ~1 week for the codegen pipeline (research-validated; original 2-3w underestimated the OpenAPI-from-Zod work). Python SDK reuses the codegen pipeline and adds ~1 week of language-specific polish.

## Risks

- **Codegen drift.** If we let hand-written code wander away from the generated types, every codegen run becomes a merge. Mitigation: keep hand-written wrapper thin (< 1,500 LOC); enforce in PR review.
- **Versioning discipline.** Every breaking change to a Zod schema is a breaking change to the SDK. Mitigation: per-route `Omnimind-API-Version` validation; deprecation log on every old-version request.
- **Streaming spec stability.** SSE message format must be locked down (event names, JSON envelope). Mitigation: version the stream envelope itself (`stream-v1` event prefix).
- **npm namespace squatting.** `@omnimind/sdk` may be taken. Mitigation: register the org early; fallback to `@boardroom/omnimind`.
- **Python ecosystem fragmentation.** `requests` vs. `httpx` vs. `aiohttp`. Mitigation: pick `httpx` (sync + async, modern), document the choice in the SDK README.

## Success metrics

- < 5 minutes from `npm install @omnimind/sdk` to a successful `memories.create` call
- 100% type coverage on the SDK surface (no `any` except in user-supplied generics)
- ≥ 5 third-party integrations within 90 days of npm publish
- Zero "the SDK and the API disagree" GitHub issues in the first 30 days post-launch
- p95 retry-success rate ≥ 99% on transient 5xx (proxy for resilience layer correctness)

## Dependencies on other features

- **Webhooks event bus** (Phase 13) — must ship BEFORE the SDK so SDK consumers don't reduce to polling
- **Observability suite** (Phase 13) — `requestId` in every SDK error needs a place to be searchable
- **Memory MCP server** (Phase 10) — shares the OpenAPI source-of-truth; both flow from the same Zod schemas
- **Per-tenant cost controls** (Phase 14) — SDK errors must surface `OmnimindRateLimitError` with a clear `retryAfter` so consumers can back off
