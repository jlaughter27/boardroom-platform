# Test Coverage & CI Audit — BoardRoom AI (Launch-Prep)

**Date:** 2026-05-15  
**Scope:** BoardRoom AI (server + client), shared package, root e2e/eval/integration suites, CI absence.  
**Method:** ran `pnpm --filter` test suites locally after `pnpm install` and `pnpm --filter @boardroom/shared run build`; inventoried every test file under the repo (excluding `_disabled/`); cross-referenced against source tree and CLAUDE.md rules.

---

## Executive Summary

**Testing maturity: 5/10.** Server-side foundations are solid; client UI and end-to-end coverage are anaemic; there is no CI gate at all.

**What works:**
- Server unit suite is healthy — 21 files, 145 tests, all green in ~6 s. The genuinely critical resilience code (`omnimind-client.ts` retry/breaker/timeout) has 17 dedicated tests.
- Shared package is tight — 9 files, 125 tests, all green. Zod-schema parity with TS types is covered.
- Architecture and harness are sound (Vitest 3.2 + jsdom + v8 coverage configured).

**Biggest risks (in order):**
1. **No CI gate whatsoever.** `.github/` directory does not exist. Every push to `main` auto-deploys to Railway with no typecheck/test enforcement (confirmed by CLAUDE.md "Known Limitations #1"). One bad merge = production outage.
2. **Client tests are 100% broken** — all 5 client suites fail at import time (missing `@testing-library/jest-dom` and `@testing-library/react` devDeps). 34 written tests have not actually run since the dep was removed.
3. **Zero route-level tests on the server.** 12 route files declaring ~94 endpoints have no integration tests. Auth middleware is tested in isolation but no test exercises the assembled Express app: middleware ordering, SPA fallback exclusions, CORS, helmet.
4. **No tests for the agent orchestrator** (`orchestrator.ts`, 331 LOC — parallel persona dispatch, CEO synthesis, mode routing). `agent.ts` base class has 8 tests, but the orchestrator that wires personas together has none.
5. **Stripe webhook signature verification is untested.** `stripe-service.test.ts` has 4 tests; they cover wrapper functions, not the webhook signature path. Payment fraud surface is unguarded.
6. **E2E suite needs a running stack** (services on localhost:3001/3333 + DB) and is not part of any automated run. No evidence it has been executed recently; no results checked in.
7. **Evals never run in CI, no recorded results.** `eval/results/` is empty. `eval/baselines/` is empty. Pre-deploy script does **not** invoke `npm run eval:*`.

**Net:** the server building blocks are testable and being tested. The seams (HTTP routes, persona orchestration, payment, end-to-end flows, client) are not. Launch-blocking until items 1–5 are addressed.

---

## 1. Inventory

### packages/shared/src/__tests__ (9 files / 125 tests — all passing)

| File | Tests | Covers |
|---|---|---|
| `boardroom-llm-schemas.test.ts` | 15 | Persona output Zod schemas vs TS interface parity |
| `date.test.ts` | 29 | Date helpers, ISO parsing, timezone math |
| `hashing.test.ts` | 3 | Hash utility (non-crypto) |
| `number.test.ts` | 24 | Numeric formatting / clamp / round helpers |
| `string.test.ts` | 17 | String helpers (truncate, slug, etc.) |
| `temporal.test.ts` | 9 | Temporal-validator helpers for memory pipeline |
| `token-counter.test.ts` | 4 | Approximate token counter |
| `validation-helpers.test.ts` | 13 | Zod runtime guard helpers |
| `validation-schemas.test.ts` | 11 | Shared entity Zod schemas |
| `_disabled/hash.test.ts` | — | DISABLED (legacy DeepSeek scaffold) |
| `_disabled/token.test.ts` | — | DISABLED |

### packages/boardroom-ai/server/tests (21 files / 145 tests — all passing)

| File | Tests | Covers |
|---|---|---|
| `unit/agent.test.ts` | 8 | Base Agent class: spawn, reason loop, validation hook |
| `unit/auth.test.ts` | 11 | JWT sign/verify, bcrypt hash/verify, cookie helpers |
| `unit/auth-middleware.test.ts` | 16 | `requireAuth`, token extraction, expiry, malformed cookies |
| `unit/auth-rate-limiter.test.ts` | 8 | Login throttle (in-memory) |
| `unit/calculator-tool.test.ts` | 3 | mathjs-backed tool happy/error paths |
| `unit/context-strategy.test.ts` | 6 | Per-persona context slicing (7-10 item cap) |
| `unit/cost-tracker.test.ts` | 4 | Per-session $ accounting |
| `unit/document-read.tool.test.ts` | 5 | Tool: read uploaded doc with size/type guards |
| `unit/export.test.ts` | 3 | Export-session-as-markdown service |
| `unit/memory-extractor.test.ts` | 5 | Post-session memory extraction agent |
| `unit/mode-router.test.ts` | 11 | decide/stress-test/plan/brainstorm persona routing |
| `unit/omnimind-client.test.ts` | 17 | **Resilience layer**: retry on 5xx, no-retry on 4xx, circuit breaker open/half-open, AbortController timeout (→ ETIMEDOUT) |
| `unit/prompt-cache.test.ts` | 4 | LRU prompt cache hit/evict |
| `unit/session-rate-limiter.test.ts` | 4 | Per-user session throttle |
| `unit/streaming.test.ts` | 5 | SSE framing helpers (event/data, comments) |
| `unit/stripe-service.test.ts` | 4 | Wrapper around Stripe SDK calls (no webhook sig tests) |
| `unit/subscription.middleware.test.ts` | 8 | Fails-open behaviour on OmniMind unreachable |
| `unit/sufficiency.test.ts` | 6 | Sufficiency scoring before persona fire |
| `unit/tool-registry.test.ts` | 5 | Registration + per-session invocation limit |
| `unit/validate.test.ts` | 4 | Zod-validate middleware |
| `integration/omnimind-seam.test.ts` | 8 | OmniMind client against mock server (full request/response cycle) |

### packages/boardroom-ai/client/tests (5 files / ~44 tests — **ALL FAILING at import**)

| File | Tests | Covers (would cover) |
|---|---|---|
| `components/ui/Button.test.tsx` | 7 | Button variants, disabled, onClick |
| `components/ui/Input.test.tsx` | 10 | Input change, controlled value, types |
| `hooks/useDebounce.test.tsx` | 7 | Debounce timing, cancel, dep change |
| `stores/auth.store.test.ts` | 10 | Zustand auth store: login/logout/setUser |
| `stores/memory.store.test.ts` | 17 | Zustand memory store CRUD + selectors |

(No tests for: 11 pages, 75 components in `dashboard/decision/memory/integrations/onboarding/shared`, 10 other hooks, 6 other stores.)

### tests/e2e/flows (5 files / 21 tests — require running stack)

| File | Tests | Covers |
|---|---|---|
| `auth-flow.e2e.test.ts` | 4 | Register → login → protected resource → logout |
| `decision-session.e2e.test.ts` | 3 | Create session, persona dispatch, retrieve transcript |
| `entity-crud.e2e.test.ts` | 5 | Person/Goal/Project/Task CRUD round-trip |
| `memory-lifecycle.e2e.test.ts` | 5 | Write → search → supersede → soft-delete |
| `payment-flow.e2e.test.ts` | 4 | Subscription create + checkout session |

### tests/integration (2 files — root-level, separate config)

| File | Covers |
|---|---|
| `auth.integration.test.ts` | Auth integration |
| `session.integration.test.ts` | Session integration |

### tests/audit + tests/golden-scenarios + tests/e2e/phase-e-stub-cleanup-due.test.ts
Used by OmniMind memory subsystem audits — out of BoardRoom scope but counted under root `pnpm test` if invoked broadly.

### packages/omnimind-api/tests (16 active + 4 disabled)
Out of primary scope, but BoardRoom depends on this service contract — included here because the seam test (`omnimind-seam.test.ts`) is the only protection against contract drift.

---

## 2. Test Run Results (2026-05-15 04:14 UTC, this audit)

| Package | Files | Tests | Pass | Fail | Duration |
|---|---|---|---|---|---|
| `@boardroom/shared` | 9 | 125 | 125 | 0 | 1.39 s |
| `@boardroom/boardroom-ai` server | 21 | 145 | 145 | 0 | 6.01 s |
| `@boardroom/boardroom-ai` client | 5 | 0 collected | 0 | **5 suite errors** | 2.43 s |
| E2E (`vitest.e2e.config.ts`) | 5 | — | — | — | not run (needs stack) |
| Integration (`vitest.integration.config.ts`) | 2 | — | — | — | not run (needs stack) |
| Eval runners | 3 | — | — | — | not run (needs stack) |

**Client failure message (all 5 suites, identical):**

```
Error: Failed to resolve import "@testing-library/jest-dom/vitest" 
from "client/tests/setup.ts". Does the file exist?
File: packages/boardroom-ai/client/tests/setup.ts:1:7
  1 | import "@testing-library/jest-dom/vitest";
```

Setup also imports `@testing-library/react` (`cleanup`) — also absent. Tests themselves import these libraries from individual files; none are installed.

---

## 3. Fix-It List

### Fix #1 — Client testing-library deps (BLOCKS ~44 tests)

`packages/boardroom-ai/package.json` — add to `devDependencies`:

```jsonc
{
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2"
  }
}
```

Then:

```bash
pnpm install
pnpm --filter @boardroom/boardroom-ai run test:client
```

No code changes required — `client/tests/setup.ts` already imports `@testing-library/jest-dom/vitest` and `cleanup` from `@testing-library/react`.

### Fix #2 — Wire client tests into pre-deploy

`scripts/pre-deploy-check.sh` currently runs only `packages/omnimind-api` tests (line ~16). Replace step 2 with:

```bash
echo "2/8 Running tests..."
pnpm --filter @boardroom/shared run test
pnpm --filter @boardroom/boardroom-ai run test
cd packages/omnimind-api && npx vitest run && cd ../..
```

### Fix #3 — Empty `eval/baselines/` and `eval/results/`

These directories exist but contain no baseline JSON for the 10 scenarios. Either:
- Run `npm run eval:all` once with the live stack and commit `eval/baselines/*.json` (paired with each scenario), or
- Add a `.gitkeep` + comment explaining the bootstrap procedure.

Without baselines, the eval runners have nothing to regress against.

### Fix #4 — Root `pnpm test` runs `turbo run test` but no `test` script exists in `packages/shared`

Actually verified: `packages/shared/package.json` has `"test": "vitest run"`. Good. But `turbo.json` `test` task has `dependsOn: ["^build"]`, so first run requires `pnpm --filter @boardroom/shared run build` for downstream packages — that's already what we did, document this in the runbook.

---

## 4. Coverage Analysis (qualitative)

| Area | Source files | Test files | Coverage |
|---|---|---|---|
| Server routes (`server/src/routes/`) | 12 | **0** | **NONE** — no `*.routes.test.ts` exists |
| Server middleware (`server/src/middleware/`) | 5 | 4 | HIGH — auth (×2), rate limiters (×2), validate, subscription all tested |
| Server services (`server/src/services/`) | 11 | 4 | LOW — only `omnimind-client`, `stripe-service`, `cost-tracker`, `prompt-cache` tested; no tests for `extraction.service`, `gmail.service`, `google-calendar.service`, `commitment-tracker`, `transcription.service`, `llm-quality-scorer`, `streaming-quality`, `export.service` (note: there is an `export.test.ts` but it covers an older path) |
| Agent runtime (`server/src/agents/`) | 5 | 4 | MEDIUM — `agent.ts`, `memory-extractor.ts`, `streaming.ts`, `sufficiency.ts` covered. **`orchestrator.ts` (331 LOC, the persona dispatch core) has zero tests.** |
| Personas (`server/src/personas/`) | 2 | 2 | HIGH — `context-strategy` + `mode-router` both covered |
| Tools (`server/src/tools/`) | 4 | 3 | HIGH — calculator, document-read, tool-registry. `web-search.tool.ts` has none. |
| Client pages | 11 | 0 | NONE |
| Client components (ui/) | ~15 | 2 (Button, Input) | LOW |
| Client components (feature: dashboard/decision/memory/integrations/onboarding/shared) | ~60 | 0 | NONE |
| Client hooks | 11 | 1 (useDebounce) | LOW (and broken) |
| Client stores | 8 | 2 (auth, memory) | MEDIUM (and broken) |
| Client `lib/` (api client, motion, cn) | 3 | 0 | NONE |

---

## 5. Critical-Path Gaps (Must Have Before Launch)

| # | Path / Module | Why it must have tests | Suggested test type |
|---|---|---|---|
| 1 | `server/src/routes/auth.routes.ts` — register, login, logout, refresh | Auth is the front door; no current test exercises the route handler end-to-end (cookie set, JWT signed, dup-email 409, malformed body 400). Auth middleware unit tests don't cover this. | supertest + nock for OmniMind, in-process |
| 2 | `server/src/routes/subscription.routes.ts` + webhook handler | **Stripe webhook signature verification is untested.** A bad signature should reject; current code is unvalidated. Replay/idempotency also untested. | unit test with fixture Stripe signed payload |
| 3 | `server/src/agents/orchestrator.ts` lines 1–331 — `CEOOrchestrator.dispatch`, mode→persona resolution, parallel `Promise.allSettled` handling, partial-failure synthesis, CEO last-pass | The product *is* this file. A persona failing should not crash the synthesis; that behaviour is not asserted anywhere. | unit test with stubbed Agent.reason; vitest fake timers |
| 4 | `server/src/agents/streaming.ts` + `server/src/routes/sessions.routes.ts` SSE endpoint | SSE framing is tested but the route that streams it is not. Heartbeats, client disconnect cleanup, backpressure on slow clients. | integration test with `eventsource` client + supertest |
| 5 | `server/src/services/omnimind-client.ts` — **breaker behaviour under sustained 5xx**, half-open recovery, breaker exposed via `breaker.toJSON()` | 17 tests exist; verify they cover half-open → close transition and that breaker emits the right shape for monitoring. (Spot-checked file: states exist, recovery path looks tested; confirm coverage report.) | already covered, audit-only |
| 6 | `server/src/middleware/auth.ts` interplay with SPA fallback | Middleware ordering rule from CLAUDE.md ("This order is load-bearing"). No test asserts that `/api/sessions/:id` requires auth while `/health` does not, in the assembled app. | one mount-time integration test on the real `app` export |
| 7 | `server/src/services/extraction.service.ts` | Decisions/commitments/tasks extracted from session transcripts feed entity links. Untested. | unit test with golden transcript fixtures |
| 8 | `server/src/services/gmail.service.ts` + `google-calendar.service.ts` OAuth token refresh | OAuth refresh on 401 is silent failure territory. Untested. | unit test with mocked googleapis |
| 9 | Error handler (last middleware in chain) | No test that a thrown `ZodError` returns 400 vs 500, that internal errors are scrubbed, that correlation ID is preserved. | unit test on the error handler function |
| 10 | Client `auth.store` + `memory.store` | Tests exist but don't currently run (Fix #1). | fix infra, then they're covered |
| 11 | Client `lib/api.ts` (api client) | Drives every page. Untested. | MSW-mocked test |

---

## 6. E2E Journey Gap List

Mapping the 5 existing flows to a 7-journey rubric:

| # | User journey | Covered? | Gap |
|---|---|---|---|
| 1 | Signup + onboarding wizard | Partial — `auth-flow` covers register/login but not the 4-step onboarding (`onboarding.routes.ts`, voice recorder, goals/projects bootstrap) | Add `tests/e2e/flows/onboarding-flow.e2e.test.ts` exercising `onboarding-bootstrap.routes.ts` start-to-finish |
| 2 | Decision session (the core product) | Partial — `decision-session.e2e.test.ts` has 3 tests but no streaming assertion, no synthesis assertion, no mode-switch coverage | Extend to verify SSE event sequence, persona count by mode, CEO synthesis arrives last |
| 3 | Memory CRUD | Yes — `memory-lifecycle.e2e.test.ts` (5 tests). Adequate. | — |
| 4 | People/Entity CRUD | Yes — `entity-crud.e2e.test.ts` (5 tests). Adequate for Person/Goal/Project/Task. | Add link-table assertions (Goal→Project→Task DAG integrity) |
| 5 | Integrations OAuth (Google Calendar, Gmail, Stripe) | **NONE** | Add `tests/e2e/flows/integrations-oauth.e2e.test.ts` — at minimum, mock OAuth callback handling |
| 6 | Billing (Stripe checkout + webhook) | Partial — `payment-flow.e2e.test.ts` (4 tests) covers checkout creation; no webhook simulation | Add webhook signature verification + subscription lifecycle (active → past_due → cancelled) |
| 7 | Admin / cortex (admin routes, custom personas, weekly memo view) | **NONE** | Add `tests/e2e/flows/admin-flow.e2e.test.ts` — at minimum admin-only access guard + cortex memo retrieval |

---

## 7. Eval State

- **10 scenario files** in `eval/scenarios/` covering retrieval edge cases (ambiguous queries, cold start, context explosion, contradictory memory, overlapping projects) and 5 "stress" scenarios (emotional user, conflicting projects, follow-up abandonment, hallucination cascade, context collision).
- **3 runners** in `eval/runners/` (`eval-retrieval.ts`, `eval-personas.ts`, `eval-e2e.ts`).
- **4 rubrics** in `eval/rubrics/` (not enumerated here; one per evaluation dimension).
- **`eval/results/` is empty.** No record of any eval ever producing output checked into git.
- **`eval/baselines/` is empty.** No regression baselines.
- **Not wired into pre-deploy.** `scripts/pre-deploy-check.sh` does not call `npm run eval:*`.
- Runners require both services running (`OMNIMIND_URL`, `OMNIMIND_API_KEY`, real Anthropic + OpenAI keys). Expensive — fair to keep out of every-PR CI, but should run nightly or pre-release.

**Recommendation:** treat evals as a separate `release-candidate` gate, not a PR gate. Add `pnpm run eval:all` to a manual GitHub Actions workflow that runs on tagged releases with secrets injected.

---

## 8. CI Gate — Proposal

**Confirmed: no `.github/` directory exists.** Per CLAUDE.md "Known Limitations #1" — manual typecheck/test before push, no enforcement. Railway auto-deploys `main` regardless of test status.

### Minimal launch-day workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.32.1
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @boardroom/shared run build
      - run: pnpm run typecheck
      - run: pnpm run test
      - run: pnpm run build
```

### Required to make this pass

1. **Apply Fix #1** (testing-library devDeps) or the client suite stays broken.
2. **`pnpm-lock.yaml` must be committed and current.** Confirm.
3. **Skip omnimind-api test step if it needs a live DB** — wrap or split into `pnpm test:ci` that only runs pure-unit suites. Current omnimind tests use mocked Prisma, but integration tests under `tests/integration/health.test.ts` and `tests/integration/memories.test.ts` likely require a DB — check before turning on full `turbo run test`.
4. **Mark `test:e2e` and `eval:*` as separate workflows** (manual dispatch or nightly), since they require a running stack and external API keys (Anthropic, OpenAI, Stripe).
5. **Add a branch-protection rule** on `main`: require CI green before merge. This is the actual gate.

### Optional polish

- `concurrency: { group: ${{ github.ref }}, cancel-in-progress: true }` to dedupe PR pushes.
- Matrix on Node 20 + 22 if you care; we ship on Railway which uses Node 20.

---

## 9. Tooling Gaps

| Tool | Configured? | Recommendation |
|---|---|---|
| Coverage reporter (v8) | Yes — configured in all three vitest configs with `provider: 'v8'`, reporters `text/json/html`. | Add `--coverage` to CI test step; upload to Codecov or just enforce a threshold via vitest `coverage.thresholds`. Threshold suggestion: 80% lines for `server/src/agents/`, `server/src/services/omnimind-client.ts`, `server/src/middleware/`. Client thresholds: 50% to start. |
| MSW (request mocking) | No | Add for client store/page tests. Hand-rolling fetch mocks across 11 pages will be unmaintainable. `msw@^2` + setup in `client/tests/setup.ts`. |
| Snapshot tests | No — not used (good; explicit assertions preferred) | Keep snapshot-free for behaviour, but consider one snapshot test per page for shell render to catch accidental regressions. |
| Visual regression | No | Out of scope for launch. Defer to post-launch with Chromatic or Percy. |
| Playwright | No — current e2e uses Vitest + raw `fetch` calls | Adequate for API-level e2e. If you want true browser e2e (click signup → see dashboard), add Playwright as a separate `pnpm run test:browser`. Not launch-blocking. |
| supertest | Not in deps (server e2e currently relies on a fully running server) | Add `supertest@^7` to `boardroom-ai` devDeps so route tests can run in-process without a real port. Critical for closing the routes-coverage gap. |
| nock | Not in deps | Useful for stubbing OmniMind in route tests. Optional — fetch-mock is simpler. |
| `@anthropic-ai/sdk` mock | Ad-hoc in `agent.test.ts` | Centralise into `server/tests/helpers/anthropic-mock.ts` to avoid drift. |

---

## 10. Proposed Test Pyramid (Launch-Day Target)

Current totals (excluding broken client + omnimind): **270 passing tests** across BoardRoom + shared.

| Layer | Now | Launch target | Delta |
|---|---|---|---|
| Shared unit | 125 | 130 | +5 (token-counter edge cases) |
| Server unit | 145 | 200 | +55: orchestrator (~15), routes via supertest (~25), services gaps (gmail, calendar, extraction; ~10), error handler (~5) |
| Server integration | 8 | 25 | +17: stripe webhook (5), SSE endpoint (4), assembled-app middleware ordering (3), OAuth refresh (5) |
| Client unit (stores + hooks) | 0 running | 50 | +50 (fix infra, then add tests for the 6 other stores + 10 other hooks) |
| Client component (RTL) | 0 running | 30 | +30 (15 ui + 15 feature components — pages with logic, not pure presentational) |
| E2E flows | 21 | 40 | +19: onboarding (4), integrations OAuth (4), admin (3), webhook (4), extended decision session (4) |
| Eval scenarios | 10 (defined) | 10 + baselines | establish baseline JSON for each |

**Total launch target: ~485 tests / ~80% covered server, ~50% covered client, all 7 user journeys touched in e2e.**

---

## 11. Effort Estimate (Eng-Days)

| Bucket | Days | Notes |
|---|---|---|
| Fix client infrastructure (Fix #1) + verify ~44 tests run | 0.25 | Two devDeps; trivial |
| GitHub Actions workflow + branch protection (Section 8) | 0.5 | Includes splitting omnimind tests so CI doesn't need DB |
| Server route tests via supertest (12 route files, ~25 tests) | 2 | Includes adding supertest dep + a small fixture harness |
| Orchestrator + streaming endpoint tests | 1.5 | Persona dispatch is intricate; needs careful stubbing |
| Stripe webhook signature + lifecycle tests | 0.5 | One real worry; well-bounded |
| Gmail/Calendar service tests (mocked googleapis) | 1 | OAuth refresh is the only hard part |
| Extraction service + golden fixtures | 0.5 | Mostly data plumbing |
| Client store/hook tests (8 stores, 11 hooks) | 1.5 | After Fix #1; mostly mechanical |
| Client component tests (15 ui + 15 feature) | 2 | MSW setup is the upfront cost |
| New e2e flows (onboarding, integrations, admin, extended decision) | 2 | Requires test fixtures and stack-up scripts |
| Eval baselines + nightly workflow | 1 | Run + commit baselines + scheduled CI |
| Coverage thresholds + reporting | 0.25 | Pure config |
| **Total** | **~13 eng-days** | Single engineer, with the existing codebase open in front of them |

**Critical-path subset (must-have for launch): Fix #1, CI workflow, route tests, orchestrator tests, Stripe webhook tests, error handler test = ~5 eng-days.** Everything else can ship behind launch as a follow-up sprint.

---

## Appendix A — Quick verification commands

```bash
# Repro test results in this audit:
pnpm install
pnpm --filter @boardroom/shared run build
pnpm --filter @boardroom/shared run test
pnpm --filter @boardroom/boardroom-ai run test:server
pnpm --filter @boardroom/boardroom-ai run test:client   # expect 5 suite failures until Fix #1

# Once Fix #1 applied:
pnpm --filter @boardroom/boardroom-ai run test   # both client + server
```

## Appendix B — Files referenced

- `/home/user/boardroom-platform/packages/boardroom-ai/package.json` (root for both client+server, holds devDeps to add)
- `/home/user/boardroom-platform/packages/boardroom-ai/client/tests/setup.ts` (already imports the missing deps — no change needed)
- `/home/user/boardroom-platform/packages/boardroom-ai/vitest.config.ts` (client config)
- `/home/user/boardroom-platform/packages/boardroom-ai/vitest.server.config.ts` (server config)
- `/home/user/boardroom-platform/vitest.e2e.config.ts`, `vitest.integration.config.ts`
- `/home/user/boardroom-platform/scripts/pre-deploy-check.sh` (needs step 2 expansion)
- `/home/user/boardroom-platform/packages/boardroom-ai/server/src/agents/orchestrator.ts` (331 LOC, no tests)
- `/home/user/boardroom-platform/packages/boardroom-ai/server/src/routes/*.ts` (12 files, no tests)
- `/home/user/boardroom-platform/eval/results/` and `eval/baselines/` (both empty)
- No `.github/` directory exists.
