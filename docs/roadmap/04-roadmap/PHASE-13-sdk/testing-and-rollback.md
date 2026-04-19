# PHASE 13 — Testing & Rollback

## Verification

1. **Unit tests** for every resource method, error class, signature verification, streaming, and resilience layer. Target ≥90% coverage on the SDK package (higher than the project default because public-API regressions are expensive).
2. **Codegen drift CI:** any API schema change without regenerating SDK fails CI. Forces discipline.
3. **Integration test against staging:** `examples/sdk-integration-test/` runs nightly; failures page the on-call.
4. **Bundle size budget:** `size-limit` config in `packages/omnimind-sdk/`. Fails if browser import exceeds 50KB minified+gzipped.
5. **Cross-runtime smoke:** the integration test runs in Node 20, Deno 1.40, Bun 1.0. CI matrix for the SDK package.
6. **Webhook verification round-trip:** copy a real signed delivery from Phase 12 evals, paste into a unit test, assert `constructEvent` returns the expected typed envelope.
7. **Resilience parity:** an automated comparison test invokes the same fault sequence against `omnimind-client.ts` and the SDK; behavior must match.
8. **Manual:** publish a release candidate as `@omnimind/sdk@0.1.0-rc.1`, install in a fresh repo, run the quickstart from the SDK README verbatim. If anything in the README is wrong, fix the README, not the SDK (the README IS the public surface).

## Rollback

**Soft rollback:**
- Server-side: nothing special required. SDK calls hit the same endpoints as curl; if the server is healthy, SDK clients are healthy. The server's `Omnimind-API-Version` middleware is a no-op for v1, so removing it doesn't break anyone.
- npm package: `npm deprecate @omnimind/sdk@0.1.0 "Use 0.1.1 instead"` if a bad version ships. Within 72h of publish, `npm unpublish` is allowed; after, deprecate-only.

**Hard rollback (revert):**
- Revert the merge. The new package directory is removed; no impact on `omnimind-api` or `boardroom-ai` since they don't import the SDK.
- Server-side `/openapi.json` route and error-envelope middleware are reverted. **Audit:** if BoardRoom's `omnimind-client.ts` was updated in Task 13.2 to consume the new error envelope, the revert restores both sides in lock-step.

**Failure modes to watch:**
- **Generated code drift.** Regenerating without API changes produces a diff: codegen tool version drift. Pin tool version in `package.json`.
- **Missing AbortSignal handling.** Streaming a long persona invocation, user navigates away, connection leak. Test explicitly.
- **Browser CORS.** Browser imports hit CORS preflight. Server CORS config must allow the API key header (or, for OAuth flows, no API key needed). Document this loudly in the SDK README.
- **Webhook helper version skew.** A v2 envelope shape (Phase 12 may version up later) needs a new SDK version. Helper signature includes `data_schema_version` so callers can switch on it.
- **OpenAPI generator quirks.** `zod-to-openapi` may not handle every Zod construct cleanly (refinements, transforms). For unsupported schemas, hand-augment the spec in a `spec-overlay.json` merged at generation time.
