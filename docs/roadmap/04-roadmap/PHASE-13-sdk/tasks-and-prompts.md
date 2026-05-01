# PHASE 13 — Tasks & Prompts

---

## Task 13.1 — API surface audit + cleanup

**Scope:** Documentation + light cleanup. Audit every existing route for naming, casing, error shape consistency. Output: a list of breaking-but-acceptable cleanups vs. accept-the-warts decisions.

**Prompt:**
> Walk every route file in `packages/omnimind-api/src/routes/`. Produce `docs/contracts/api-surface-audit.md` listing for each endpoint: HTTP method, path, current request body shape (snake_case or camelCase?), current response shape (envelope? raw?), error shape, pagination convention. Flag inconsistencies. For each inconsistency, recommend: (a) fix now (breaking change to BoardRoom — accepted because we own it), (b) fix in v2 (document the wart), or (c) leave (already consistent). Goal: every endpoint follows the same rules — camelCase for JSON fields, consistent error envelope `{ error: { code, message, requestId, details? } }`, paginated lists return `{ data, pagination: { cursor, hasMore, limit } }`. NO code changes yet — review the list with me.

**Verification:** Audit doc exists; reviewed and approved.

---

## Task 13.2 — Apply cleanup fixes; add error envelope middleware

**Scope:** Apply the "fix now" items from Task 13.1. Add a global error-envelope middleware so every error response has the same shape.

**Prompt:**
> Apply the "fix now" recommendations from `docs/contracts/api-surface-audit.md`. Add an error-envelope middleware in `packages/omnimind-api/src/middleware/error-envelope.ts` that wraps any thrown error or returned non-2xx into `{ error: { code, message, requestId, details? } }`. The `requestId` reads from `req.id` (already set by the existing correlation-ID middleware). Update BoardRoom's `omnimind-client.ts` to parse the new envelope. Run the full eval suite to catch regressions: `pnpm test && npm run eval:all`.

**Verification:** All tests + evals green.

---

## Task 13.3 — Zod → OpenAPI spec generation

**Scope:** Add a route `GET /openapi.json` that emits the generated spec at runtime (not at build, to avoid drift).

**Prompt:**
> In `packages/omnimind-api/src/openapi/`: add `spec-generator.ts`. Use `@asteasolutions/zod-to-openapi` (or equivalent). Walk all Zod schemas in `packages/shared/src/validation/` and all route registrations to produce an OpenAPI 3.1 document. Add `info.title = "OmniMind API"`, `info.version = "2026-04-18"`, contact, license. Define security schemes (`x-api-key`, `OAuth2`). Tag operations by resource (`memories`, `decisions`, etc.). Mount as `GET /openapi.json` (public, no auth — same as `/health`). Add a snapshot test that compares the generated spec against a checked-in `openapi.snapshot.json`; fail CI on unintentional drift. Verify the spec validates against the official OpenAPI 3.1 JSON Schema.

**Verification:** `curl https://localhost:3333/openapi.json | jq` returns valid OpenAPI; snapshot test green.

---

## Task 13.4 — SDK package scaffold

**Scope:** New top-level package `packages/omnimind-sdk/`. Configure for ESM-first dual ESM/CJS publish, types, tree-shaking.

**Prompt:**
> Create `packages/omnimind-sdk/`. `package.json`: name `@omnimind/sdk`, version `0.1.0`, type `module`, exports map for ESM + CJS + types, `sideEffects: false`, peer deps minimal (zod and ws if needed for SSE in Node), dependencies on `openapi-fetch` (or chosen client). `tsconfig.json` strict ES2022 commonjs/ESM dual output. Add to root `pnpm-workspace.yaml` and `turbo.json` build pipeline. Scaffold `src/index.ts` exporting an `OmniMind` class with constructor `(config: { apiKey?: string, accessToken?: string, apiVersion?: string, baseUrl?: string, dangerouslyAllowBrowser?: boolean })`. No real implementation yet — just the shape. Add a placeholder README.

**Verification:** `pnpm build` produces dist/ with both ESM and CJS; `pnpm typecheck` green; package can be locally linked into a test app.

---

## Task 13.5 — Codegen pipeline

**Scope:** Wire `openapi-fetch` (or chosen tool) to consume the spec from Task 13.3 and emit typed clients in `packages/omnimind-sdk/src/generated/`.

**Prompt:**
> Add a script `packages/omnimind-sdk/scripts/codegen.ts` that fetches `http://localhost:3333/openapi.json` (or reads from a file), runs `openapi-typescript` to produce `src/generated/types.ts`, and emits typed wrapper files (`src/generated/memories.ts`, `src/generated/decisions.ts`, etc.) using `openapi-fetch`'s `createClient`. Add `pnpm codegen` task to the package's package.json. Add a CI step that runs codegen and fails if `src/generated/` has uncommitted changes (catches API drift). Document the workflow in `packages/omnimind-sdk/CONTRIBUTING.md`.

**Verification:** `pnpm codegen` produces a clean diff against the checked-in generated files when the API hasn't changed; produces a real diff when an endpoint is added.

---

## Task 13.6 — Resource-namespaced public surface

**Scope:** Hand-write the public surface (`omnimind.memories.*`, etc.) on top of the generated client. This is the part users see.

**Prompt:**
> In `packages/omnimind-sdk/src/resources/`: create one file per resource (`memories.ts`, `decisions.ts`, `entities.ts`, `personas.ts`, `webhooks.ts`, `commitments.ts`, `cortex.ts`). Each exports a class with methods like `list`, `retrieve`, `create`, `update`, `delete` as appropriate. Each method delegates to the generated client and re-throws errors as typed SDK errors. Sub-resources where appropriate (`omnimind.decisions.assumptions.list(decisionId)`). The top-level `OmniMind` class instantiates each resource lazily. Export each resource as a separate sub-path (`@omnimind/sdk/memories`) for tree-shaking. Add unit tests with `nock`-mocked HTTP.

**Verification:** Unit tests green; tree-shake verification: import only `memories`, build a minimal app, bundle size <15KB.

---

## Task 13.7 — Typed errors

**Scope:** Error class hierarchy + parsing logic.

**Prompt:**
> In `packages/omnimind-sdk/src/errors/`: create `OmnimindAPIError` (base), `OmnimindAuthError` (401/403), `OmnimindRateLimitError` (429, exposes `retryAfterMs`), `OmnimindValidationError` (422, exposes `details: ZodFlattenedError`), `OmnimindNotFoundError` (404), `OmnimindServerError` (5xx). Each has `.code`, `.requestId`, `.statusCode`, `.responseBody` (raw), and a meaningful `.message`. Add a parser `parseError(response): OmnimindAPIError` invoked by every resource method on non-2xx. Document in the SDK README with a "switch on instanceof" example.

**Verification:** Unit tests cover every status code class; sample app catches each error type correctly.

---

## Task 13.8 — Streaming (SSE) for `personas.invokeStream`

**Scope:** Async iterator over SSE events from the persona invocation endpoint.

**Prompt:**
> In `packages/omnimind-sdk/src/resources/personas.ts`: add `invokeStream(persona, body, options?)` returning `AsyncIterable<PersonaStreamEvent>`. Use `fetch` with `Accept: text/event-stream`, parse the body via a streaming parser (Node 20+ has WebStreams; use `eventsource-parser` package as a portable option). Honor AbortController passed in `options.signal`. Yield typed events (`PersonaTokenEvent`, `PersonaToolUseEvent`, `PersonaCompletedEvent`). On error mid-stream, throw a typed SDK error and clean up the underlying connection. Add integration test using a mock SSE server.

**Verification:** Integration test green; manual: `for await (const e of client.personas.invokeStream('critic', { ... })) { console.log(e); }` works in Node.

---

## Task 13.9 — Webhook signature verification helper

**Scope:** Port the verification logic to the SDK as a one-call helper.

**Prompt:**
> In `packages/omnimind-sdk/src/webhooks/`: add `constructEvent(rawBody: string | Buffer, signatureHeader: string, secret: string, options?: { toleranceSeconds?: number = 300 }): OmnimindEvent`. Parses the `X-Omnimind-Signature: t=...,v1=...` header, computes HMAC-SHA256 of `${t}.${rawBody}` with secret, constant-time-compares against `v1`, rejects if `t` is older than tolerance. On success, returns the typed envelope (parsed and Zod-validated against the contract from Phase 12). On failure, throws `OmnimindWebhookSignatureError`. Document with a Node Express example in the SDK README.

**Verification:** Unit tests cover valid, expired, wrong secret, malformed header. Cross-validate against fixtures from Phase 12.

---

## Task 13.10 — Resilience layer port

**Scope:** Bring `omnimind-client.ts` retry + circuit-breaker into the SDK.

**Prompt:**
> Read `packages/boardroom-ai/server/src/services/omnimind-client.ts` resilience layer. Port the retry + circuit breaker into `packages/omnimind-sdk/src/transport/resilience.ts`. Configurable via constructor: `timeout`, `retryMax`, `breakerThreshold`, `breakerCooldownMs`. Defaults match the existing client. Wrap every generated request in this layer. Expose `omnimind.transport.breaker.toJSON()` for diagnostics. Add unit tests: 502→retry, 4xx→no retry, 5x consecutive failures→circuit opens, cooldown→half-open→success closes.

**Verification:** Unit tests green; behavior parity with `omnimind-client.ts` verified.

---

## Task 13.11 — Publish + integration test repo

**Scope:** First publish to npm. Create a separate `omnimind-sdk-integration-tests` repo (or directory under `examples/`) that exercises every resource against staging.

**Prompt:**
> Publish `@omnimind/sdk@0.1.0` to npm. Add an `examples/sdk-integration-test/` directory with a Node script that: instantiates the SDK, lists memories, creates a memory, lists decisions, retrieves one, registers a webhook endpoint, deletes it, invokes a persona via stream and prints chunks. Document `pnpm run test:integration:sdk` in the root README. Configure CI to run this on every commit to main against staging credentials. Write a launch blog post draft in `docs/launch/sdk-launch.md` (announcement, code samples, link to Connector Directory).

**Verification:** `npm i @omnimind/sdk` in a fresh project succeeds; integration test passes against staging.
