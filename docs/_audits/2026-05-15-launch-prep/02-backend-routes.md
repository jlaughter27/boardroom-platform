# BoardRoom AI Server — Launch-Day Backend Audit
**Date:** 2026-05-15
**Scope:** `packages/boardroom-ai/server/src/{routes,services,middleware,agents,tools,index.ts}`
**Bar:** public payment page, cold-traffic ready
**Auditor:** Opus 4.7

---

## Executive Summary

The BoardRoom server is a thin orchestration + proxy layer in front of OmniMind, plus the persona/agent runtime. Architectural shape is correct (no DB access, OmniMind delegated via a resilient client, JWT in httpOnly cookies). However, **the launch bar is not met** as it stands. The biggest issues:

| # | Severity | Theme |
|---|---|---|
| 1 | **P0** | `/admin/*` is mounted behind only the JWT wall — **any authenticated user can list every tenant's memories, audit log, and trigger destructive admin ops** (decay, merge, summarize). |
| 2 | **P0** | `/integrations/gmail/extract` and `/gmail/confirm` accept fully unvalidated bodies, write arbitrary memory rows on the user's behalf, and **bypass `requireSubscription`** (mounted on `/integrations`, not `/sessions` only). All cost-bearing LLM-touching routes outside `/sessions` are unprotected. |
| 3 | **P0** | The subscription gate is the **only thing standing between an unauthenticated user and an LLM bill** — and it has two ways to fail open: `STRIPE_SECRET_KEY` not set (dev path) or any OmniMind error (`catch { next(); }`). Combined with the admin issue, billing is effectively advisory at launch. |
| 4 | **P0** | `subscription.middleware.ts` only protects `/sessions`. Cost-bearing routes outside `/sessions` (cortex/scan, cortex/simulate, cortex/memo/generate, onboarding-bootstrap/{doc,voice}, onboarding/extract-{goals,projects}, integrations/gmail/extract) all bill Anthropic with no plan check. |
| 5 | **P0** | Subscription middleware **fails open on errors** by design (`catch { next(); }`). Documented in CLAUDE.md as "fails open" — that is a launch-day liability for a public payment page. At minimum it must distinguish "OmniMind unreachable" from "real plan check returned" and log/alert. |
| 6 | **P1** | Webhook handler `/subscription/webhook` is mounted **after the `/api` prefix strip and after the auth wall**. The auth wall returns 401 to any request without a cookie. **Stripe webhooks have no cookie** — they will be 401'd in production. (See "Middleware Ordering Review.") |
| 7 | **P1** | `routes/entities.routes.ts` proxies 25+ endpoints to OmniMind with **zero Zod validation** on `req.body` — only `/profile` has a schema. OmniMind is the validator of last resort. Acceptable from a data-correctness lens but breaks the rule "Zod validation at boundaries" (CLAUDE.md anti-pattern #2). |
| 8 | **P1** | `req.body` is fully untyped/unvalidated in sessions routes for `/questionnaire/answers`, `/confirm-memories`, `/check-ambiguity`, `/plan`, `/extract-memories`, `/synthesize`, `/dispatch`. A malformed body causes uncaught exceptions or LLM cost waste. |
| 9 | **P1** | Sessions are **in-process Map** with a 10k cap. Single Railway instance is fine, but: any restart wipes them, **no per-user quota** (one user can fill all 10k slots and DOS others), and the cleanup interval keeps an Express process alive in test environments. |
| 10 | **P1** | `/auth/login` re-implements its own fetch path instead of going through `omnimindClient.request()`. It bypasses the **circuit breaker, retries, timeout, and request-ID propagation** — a partial OmniMind outage will hang logins for the default fetch timeout. |
| 11 | **P2** | The error handler suppresses stack traces in production (good) but the `err.message` is still leaked verbatim. Several throws include path/internal identifiers (`OmniMind GET /memories/xyz: 500`) that surface as `message` to clients. |
| 12 | **P2** | OAuth callback routing in `index.ts` mounts the **entire** `calendarRouter` / `integrationsRouter` as the handler for a single `GET` path. It works only because Express matches the router's first internal route — fragile, surprising, and easy to break when reordering. |

The codebase is otherwise well-structured (custom agent runtime, clean resilience layer, persona prompts externalized, SSE patterns consistent). Most fixes are small and local.

---

## Security Findings (Consolidated)

| ID | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| SEC-01 | **P0** | `routes/admin.routes.ts` (all 9 routes), wired in `index.ts:100` | No admin-role check — every JWT-holding user can read/write **cross-tenant** admin data (`/admin/stats`, `/admin/agents`, `/admin/audit`, `/admin/memories?tenantId=...`, `/admin/contradictions`, `/admin/duplicates`, `/admin/summarize`, `/admin/decay/run`, `/admin/duplicates/merge`). The `omnimindClient.getAdmin*` helpers don't even pass `x-user-id`. Catastrophic data exposure. | Add `isAdmin` flag to JWT payload + `requireAdmin` middleware. Until then, **do not mount `adminRouter`** in production. |
| SEC-02 | **P0** | `index.ts:92` + `subscription.middleware.ts` | Subscription gate only on `/sessions`; all other LLM-touching routes (cortex scans, simulate, memo generate, gmail/extract, onboarding-bootstrap doc/voice, onboarding/extract-goals|projects) charge Anthropic on a free token. Cold-traffic abuse = direct $ loss. | Apply `requireSubscription` to `/cortex`, `/onboarding`, `/onboarding-bootstrap`, `/integrations` and any tool-using path. |
| SEC-03 | **P0** | `subscription.middleware.ts:31-34` | Fail-open on any OmniMind error (`catch { next(); }`). If OmniMind is degraded, every user becomes "subscribed". | Fail-closed for plan checks. If OmniMind is unreachable, return 503 with retry guidance. Add `degraded_billing` log + alert. |
| SEC-04 | **P0** | `routes/entities.routes.ts` (POST/PATCH/DELETE memories, goals, projects, tasks, people, links) | All write paths blindly forward `req.body` to OmniMind. No Zod, no `.strict()`, no size cap. A malicious user can attempt to write arbitrary fields including any OmniMind would silently accept. | Add Zod `.strict()` schemas at the boundary, mirroring the OmniMind input shapes from `@boardroom/shared`. |
| SEC-05 | **P1** | `index.ts:33-49` | CORS: in production `ALLOWED_ORIGINS = []` and the `if (!origin || ...)` permits any request **with no Origin header** (curl, Postman, server-side bots, native apps). Cookies are `sameSite: 'lax'` so cross-site browser CSRF on state-changing POSTs is bounded — but `lax` still allows top-level GET-initiated cross-site cookie sends, and the API has GETs that delete (`DELETE` w/ `lax` is blocked; OK). Document explicitly. | Acceptable, but in prod set `origin: false` unless `CORS_ORIGINS` is non-empty; do not silently allow no-Origin. |
| SEC-06 | **P1** | `services/google-calendar.service.ts:6` | `STATE_SECRET` falls back to `'fallback-dev-secret'` when `JWT_SECRET` is unset. State signing for Google OAuth becomes attacker-knowable. JWT_SECRET is required at startup (`env.ts`), so production should never hit this — but the fallback should be removed to fail loud. | Throw on missing `JWT_SECRET`. |
| SEC-07 | **P1** | `routes/auth.routes.ts:25,71` | `sameSite: 'lax'` is fine, but cookies omit explicit `domain` and there is no `__Host-` prefix. With `secure: true` in prod, exposure is bounded — but a CSRF token for state-changing POSTs is **not** implemented anywhere. Subscription cancel, custom-persona create, memory write, etc. are pure cookie-auth. Same-origin SPA today, but a single XSS = full takeover. | Add a CSRF double-submit token (cookie + header) on state-changing routes, or move to `sameSite: 'strict'` and accept the UX cost. |
| SEC-08 | **P1** | `routes/subscription.routes.ts:27` + `index.ts:88` | Stripe webhook is behind the auth wall. **Real Stripe POSTs have no cookie → middleware returns 401 → webhook silently fails.** Subscription state in OmniMind will drift from Stripe. | Move `app.use('/subscription/webhook', raw({type:'application/json'}), webhookHandler)` **above** `authMiddleware`. The webhook is verified by HMAC signature, not cookies. |
| SEC-09 | **P1** | `routes/onboarding-bootstrap.routes.ts:100-129` | `/onboarding-bootstrap/doc` accepts `text/plain` of up to 5MB or a 5MB file, then sends the entire body to Claude Sonnet. No rate limit. One user can burn $100s in minutes. | Add per-user daily call limit + max input size budget. Apply `requireSubscription`. |
| SEC-10 | **P1** | `routes/onboarding-bootstrap.routes.ts:103` | `req.file.buffer.toString('utf-8')` on arbitrary upload bytes — no MIME check, no PDF parsing. If a user uploads a PDF they get binary noise sent to Claude. | Reject non-text MIMEs (or implement actual PDF extraction). |
| SEC-11 | **P1** | `routes/sessions.routes.ts:43-72` | `validateBody(CreateSessionBodySchema)` is the **only validated body in the file**. All subsequent `req.body as { ... }` casts trust the client. | Add Zod schemas for `questionnaire/answers`, `confirm-memories`. |
| SEC-12 | **P1** | `services/stripe.service.ts:36-39` | Stripe success/cancel URLs come from `APP_URL ?? 'http://localhost:5173'`. If `APP_URL` is unset in prod, payment redirects users to localhost — they appear to have paid but never return. | Make `APP_URL` mandatory in prod; validate in `env.ts`. |
| SEC-13 | **P1** | `routes/integrations.routes.ts:69-88` (gmail/confirm) | Accepts `proposals: Array<...>` with **no validation, no bound on array length, and no Zod schema**. Each iteration triggers an OmniMind write + embedding call. A 10k-item array DOS's both. | Cap array to 50, Zod-validate every field, apply `requireSubscription`. |
| SEC-14 | **P1** | `services/gmail.service.ts:139-146` | The email-extractor prompt is loaded with `readFileSync(resolve(__dirname, '../../../../../docs/prompts/email-extractor.system.md'))`. Five-levels-deep relative path is fragile across local/Docker/Railway. Falls back to a placeholder prompt. **Silent quality degradation on path drift.** | Use the same `loadSystemPrompt('email-extractor')` helper as everywhere else; fail loud if missing. |
| SEC-15 | **P1** | `routes/sessions.routes.ts:23,52` | Session IDs are `session_${counter}_${Date.now()}`. **Monotonic and predictable.** Even though access is gated on `userId` match, the counter leaks how many sessions have ever been created (concurrency disclosure). | Use `crypto.randomUUID()`. |
| SEC-16 | **P2** | `index.ts:104-128` | Error handler returns `err.message` to client in non-prod; in prod it's masked. But `upstream` branch (line 109-115) **returns `err.message` regardless of NODE_ENV**, which can leak OmniMind paths/IDs. | Mask upstream message in prod too. |
| SEC-17 | **P2** | `tools/web-search.tool.ts:23-28` | Serper API call has no timeout, no retry, no domain filter. A Claude that requests 10,000 results is bounded by `TOOL_LIMITS.searchResultsLimit` but the network call itself is unbounded. | Add AbortController timeout; verify upper bound for `numResults` is enforced at definition layer. |
| SEC-18 | **P2** | `tools/calculator.tool.ts` | `mathjs.evaluate()` will execute arbitrary expressions — `mathjs` exposes function-define syntax that has had security advisories historically. Inputs come from Claude, but Claude can be prompt-injected via memory content. | Use `mathjs` `limitedEvaluate` or compile expressions in an isolated scope. |
| SEC-19 | **P2** | `index.ts:31` | `helmet()` is on but with defaults. No explicit CSP. SPA fallback serves `index.html` for any unknown path. | Define a tight CSP, especially for `/settings?payment=success` post-redirect surface. |

---

## Findings by Route File

### `index.ts` (middleware ordering / app wiring)

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| IDX-01 | **P0** | index.ts:84-85 | OAuth callbacks mounted as `app.get('/calendar/callback', calendarRouter)` — passing an entire `Router` as a handler. Express treats the router as a middleware function; matching is "first matching internal route wins". Works today; **breaks silently** if `calendarRouter`'s first internal route changes. | Mount each callback as a dedicated handler function, not the whole router. | S |
| IDX-02 | **P0** | index.ts:88 vs 84-85 | Webhook + OAuth callbacks pre-auth: fine. But `app.use(authMiddleware)` after them then re-mounts the same routers at lines 97-99 — so the routers run again for authenticated requests. There is currently **no enforcement** that the callback handler doesn't appear inside the auth-walled mount. Either path that triggers the callback first is the one used. | Split callbacks into a separate `oauthRouter` mounted only at the top. Remove ambiguity. | S |
| IDX-03 | **P1** | index.ts:62-78 | SPA-fallback exclusion list is a hand-maintained string-prefix match. Adding a new API route requires editing this list or it silently 200's `index.html`. Already a known landmine per CLAUDE.md "middleware ordering". | Mount all API routes under a real `/api/*` prefix server-side and exclude `/api` only. | M |
| IDX-04 | **P1** | index.ts:50 | `express.json()` has no `limit:` set — defaults to 100kb. Bootstrap routes use multer (multipart), but JSON `text` body via `/onboarding-bootstrap/doc` will silently 413 at 100kb. | Set explicit `limit: '1mb'` and document. | S |
| IDX-05 | **P1** | index.ts:54-59 | Hand-rolled `/api` prefix strip mutates `req.url`. Combined with the SPA fallback below it means **two regexes are guarding what's an API route** — they can diverge. | Use `app.use('/api', apiRouter)` instead of regex mutation. | M |
| IDX-06 | **P1** | index.ts:104 | Error handler returns `502 upstream_error` whenever `err.upstream` is truthy. But `err.upstream` is set by `omnimindClient` even on **4xx OmniMind responses** (e.g. validation 422). So a 422 from OmniMind becomes a 502 to the client. Client retry logic + UX assumptions are wrong. | Map status: 4xx upstream → forward status, 5xx upstream → 502. | S |
| IDX-07 | **P1** | index.ts:132-134 | `app.listen` runs on import; no `if (require.main === module)` guard. Tests that import this module will fight over the port. | Guard with main-module check. | S |
| IDX-08 | **P2** | index.ts:33-37 | When `CORS_ORIGINS` is unset in prod, `ALLOWED_ORIGINS = []`. Combined with `!origin` permissive branch (line 42), behavior is "deny browsers without an Origin allowlist; allow everything else". Counterintuitive and undocumented. | Explicit envvar with clear default; fail fast if prod has no CORS_ORIGINS. | S |
| IDX-09 | **P2** | index.ts:104-129 | Error handler logs `err.message` and `req.path` but **no request ID**. Client has no correlation handle. | Generate request ID middleware + include in error log + response header. | S |

---

### `auth.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| AUTH-01 | **P1** | auth.routes.ts:42-74 | `/auth/login` calls `fetch` directly, bypassing the resilience layer (timeout, breaker, retry, request-ID). A flaky OmniMind = client login hangs for default Node fetch timeout. | Add `omnimindClient.verifyUser(email, password)` and route through `request()`. | S |
| AUTH-02 | **P1** | auth.routes.ts:23 | `hashPassword` runs **before** the OmniMind register call. If OmniMind is offline, the user-perceived response is just an error — but the bcrypt round was spent. Trivial DOS amplifier (12 rounds × N) since `registerLimiter` is only 3/hour/IP. | Defer hashing until OmniMind confirms user creation, or move bcrypt server-side at OmniMind. | M |
| AUTH-03 | **P1** | auth.routes.ts:31 | Returns `409` but with `error: 'validation_failed'` — mismatched semantics. Client `ApiError` won't differentiate "email taken" from "bad password length". | Use `error: 'conflict'` and a stable code. | S |
| AUTH-04 | **P2** | auth.routes.ts:9-14 | `OMNIMIND_URL` and `getApiKey` re-derived here instead of using the singleton client. Two sources of truth. | Use `omnimindClient`. | S |
| AUTH-05 | **P2** | auth.routes.ts:77-84 | `/auth/logout` is **public** (mounted before auth wall via `app.use('/auth', authRouter)`). A logout with no cookie is a no-op; fine. But it doesn't verify the cookie before clearing — so any cross-site request can clear the cookie if it bypasses sameSite (it can't with `lax`). Acceptable but document. | None required; document. | — |
| AUTH-06 | **P2** | auth.routes.ts:87-96 | `/auth/me` mounts `authMiddleware` inline despite the whole `/auth` router being public — defensive but redundant since `/auth` is the only public router that needs to mix. Fine; keep. | — | — |
| AUTH-07 | **P1** | middleware/auth.ts:55-71 | `authMiddleware` reads `req.cookies?.boardroom_token` only — no `Authorization: Bearer` support. That's fine for browsers, but **mobile/desktop clients and curl can't auth** without a cookie jar. If launch includes API access for paid users, this blocks it. | Add `Authorization: Bearer` fallback. | S |
| AUTH-08 | **P1** | middleware/auth-rate-limiter.ts:8-16 | `setInterval(...)` runs at module import, has no `unref()`. Keeps Node alive in tests/scripts that import the router. | Use `.unref()`. | XS |
| AUTH-09 | **P2** | middleware/auth-rate-limiter.ts:20 | Rate-limited by `req.ip`. Behind Railway's proxy, `req.ip` is **the load balancer** unless `app.set('trust proxy', true)` is set. **It is not set** → effectively a global rate limit shared across the world. | Set `app.set('trust proxy', 1)` and document. **Critical for launch.** | XS |

---

### `sessions.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| SESS-01 | **P0** | sessions.routes.ts:23, 47-52 | Sessions stored in process memory, 10k cap shared across **all users**. One abusive user fills the map → all other users get `503 capacity_exceeded`. | Per-user cap (e.g. 20 active), LRU eviction, or persist to OmniMind. | M |
| SESS-02 | **P1** | sessions.routes.ts:27-34 | `setInterval` cleanup not `.unref()`'d. | Add `.unref()`. | XS |
| SESS-03 | **P1** | sessions.routes.ts:88, 103 | `createdAt: new Date().toISOString()` returns **now** every call instead of the session's actual created time (which is stored as `session.createdAt: number`). The client sees the wrong timestamp on every refresh. | `new Date(s.createdAt).toISOString()`. | XS |
| SESS-04 | **P1** | sessions.routes.ts:117, 134, 163, 191, 208 | SSE dispatch / synthesize / questionnaire / plan / extract-memories all bypass `validateBody`. `req.body` is read in some without type guard. | Add Zod schemas or at least `.parse({}).optional()`. | S |
| SESS-05 | **P1** | sessions.routes.ts:108-119 | Dispatch route: if `getOrchestrator()` throws (no API key), `next(err)` runs but the response **has not been initialized as SSE** yet — so the global error handler will try to set headers on a non-SSE response. Fine. But once `orchestrator.dispatch(...)` runs, `initSSE` is called inside — if anything throws **after** `initSSE` but before `res.end()`, `next(err)` will hit the global handler which tries `res.status().json()` on an already-flushing SSE response → "headers already sent" log spam. | Wrap dispatch/synthesize/streamSSE in try/catch that emits `{type:'error'}` + `res.end()` instead of `next(err)`. | M |
| SESS-06 | **P1** | sessions.routes.ts:175-179 | `/questionnaire/answers` accepts `answers` array unbounded, concatenates into `session.question` indefinitely. Subsequent dispatch sees a megabyte-long question → token waste. | Cap answers count and string length; Zod. | S |
| SESS-07 | **P1** | sessions.routes.ts:221-225 | `/confirm-memories` accepts `accepted: number[], modified: {index,changes}[], rejected: number[]` with **no validation**. `modified[i].index` is used as an array index downstream — out-of-bounds or negative leaks behavior. | Zod. | S |
| SESS-08 | **P2** | sessions.routes.ts:138-152 | `/check-ambiguity` creates a new `Anthropic` client per call — bypasses prompt cache, no shared instrumentation. | Use orchestrator's existing client. | S |
| SESS-09 | **P2** | sessions.routes.ts:204-211 | Same — per-call `new Anthropic({apiKey})`. | Shared client. | S |
| SESS-10 | **P2** | sessions.routes.ts:43 | Route receives `roomId?: string` from body but never uses it. Dead field; rooms are Phase 2 stub. | Remove from schema or wire `// TODO: rooms`. | XS |
| SESS-11 | **P2** | sessions.routes.ts:241-243 | `/export?format=pdf` returns `501` — fine, but client API contract should reflect it. | Document in api.ts. | XS |

---

### `entities.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| ENT-01 | **P1** | entities.routes.ts:39-58, 71-89, 103-121, 135-153, 224-243, 294-312 | All POST/PATCH write paths forward `req.body` to OmniMind without Zod validation. Only `/profile` (line 189) is validated. | Add Zod schemas for each entity type, sourced from `@boardroom/shared`. | M |
| ENT-02 | **P1** | entities.routes.ts:32, 64, 96, etc. | List endpoints don't support query params (limit, offset, status filters). `omnimindClient.listGoals(userId)` has no filter arg. The client UI must page-through everything → unbounded payloads. | Pass through query string like memories does (line 202). | M |
| ENT-03 | **P1** | entities.routes.ts:202, 251 | Building query string by parsing `req.url` with `new URL(req.url, 'http://localhost')` — works, but Express provides `req.query`. The current approach **forwards arbitrary query keys** to OmniMind (no allowlist). | Allowlist + use req.query. | S |
| ENT-04 | **P1** | entities.routes.ts entire file | Memory write (`POST /memories`) bypasses the **validation pipeline** rule in CLAUDE.md ("Every memory write goes through the validation pipeline"). The route trusts OmniMind to enforce it. That's correct architecturally but no test confirms OmniMind rejects bad inputs forwarded here. | Add integration test: BoardRoom → OmniMind invalid memory → expect 422. | S |
| ENT-05 | **P2** | entities.routes.ts:189-194 | `UpdateProfileSchema.strict()` is the **only** strict schema; other endpoints accept extra fields silently. | Make all schemas strict. | S |

---

### `admin.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| ADM-01 | **P0** | admin.routes.ts entire file | **No admin role check.** Any authenticated user can read cross-tenant memories, audit logs, contradictions, trigger summarize / decay / merge. Mounted at line 100 of index.ts with no guard beyond JWT. | Add `requireAdmin` middleware reading `isAdmin` from JWT or a UserProfile field. Block mount in prod until shipped. | M |
| ADM-02 | **P1** | admin.routes.ts:25,38,53,71 | `req.query as Record<string, string>` — Express types query as `ParsedQs`, can be arrays / objects, not strings. Passing those to `omnimindClient.getAdminMemories({tenantId: ['a','b']})` produces `URLSearchParams` of `[object Object]`. | Validate query with Zod. | S |
| ADM-03 | **P2** | admin.routes.ts:62-67, 86-91 | Triggers (summarize, decay) are POSTs with no body — fine. But they have **no rate limit and no idempotency key**. Hammering them runs heavy jobs in parallel. | Idempotency token + rate limit per user. | S |

---

### `cortex.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| COR-01 | **P0** | cortex.routes.ts:24, 51, 71, 89 | `/patterns/scan`, `/memo/generate`, `/contradictions/scan`, `/simulate` all trigger LLM-heavy background jobs in OmniMind. **Not behind `requireSubscription`**. | Apply `requireSubscription`. | S |
| COR-02 | **P1** | cortex.routes.ts:89-94 | `/simulate` accepts `req.body` (chosenPath, sessionQuestion) without validation. Forwarded to OmniMind which calls Claude Sonnet. | Add Zod. | S |
| COR-03 | **P1** | cortex.routes.ts:17, 44, 65 | Same query-string-from-req.url anti-pattern as entities.routes.ts. | req.query + allowlist. | S |
| COR-04 | **P1** | cortex.routes.ts:78-83 | `PATCH /contradictions/:id` accepts arbitrary body. The Cortex contradiction model has a `dismissedReason` field — an attacker can patch a contradiction that **belongs to another user** if OmniMind doesn't enforce ownership (it does via x-user-id, but no defense-in-depth here). | Add Zod + verify ownership at OmniMind. | S |

---

### `calendar.routes.ts` + `integrations.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| CAL-01 | **P1** | calendar.routes.ts:22-30 + integrations.routes.ts:32-41 | Two OAuth callback handlers (`/calendar/callback`, `/integrations/gmail/callback`). Each is **mounted publicly** (no JWT) — correct since Google redirects with no cookie. But they trust `verifyState(state, 'calendar'|'gmail')` for the userId. If `JWT_SECRET` is the same as `STATE_SECRET` and is leaked once, an attacker can forge OAuth callbacks to attach a victim's Google account to their own session. | Use a separate `OAUTH_STATE_SECRET` env var. | S |
| CAL-02 | **P1** | calendar.routes.ts:33-39 | `/calendar/events?start=&end=` accepts arbitrary date strings via `new Date(...)`. `new Date('abc') → Invalid Date`. Then `.toISOString()` throws inside the Google client call. User gets a 500. | Validate with Zod (z.string().datetime()). | S |
| CAL-03 | **P1** | services/google-calendar.service.ts:80-91 | Inside `getEvents`, a `client.on('tokens', async (...) => { saveOAuthToken })` is registered **every call**. The OAuth2Client is created per call so leaks are bounded, but if the handler throws inside the async callback, **the rejection is unhandled** (Node will log + crash on newer versions). | Wrap in try/catch. | S |
| CAL-04 | **P1** | services/google-calendar.service.ts:115-118 | `try { ... } catch (_err) { return [] }` — silently swallows all errors including network 500s and quota exceeded. User sees "no events" instead of "calendar connection broken". | Log and surface a status string. | S |
| INT-01 | **P0** | integrations.routes.ts:69-88 | `POST /integrations/gmail/confirm`: `proposals` array, no validation, no length cap. Each item triggers `omnimindClient.createMemory` → OpenAI embedding API call. **Pay-per-write, unbounded.** | Cap to 50, Zod-validate. Apply `requireSubscription`. | S |
| INT-02 | **P1** | integrations.routes.ts:59-66 | `POST /integrations/gmail/extract`: triggers Claude Haiku, no rate limit, no sub check. | Apply `requireSubscription` + rate limit. | S |
| INT-03 | **P1** | services/gmail.service.ts:139-146 | Prompt loaded via deep relative readFileSync; falls back to "Extract important information..." placeholder if path drift. Silent quality degradation. | Use `loadSystemPrompt('email-extractor')`. | S |
| INT-04 | **P1** | integrations.routes.ts:18-22 | `/integrations` GET returns `[gmail, calendar]` shape — but `gmail` object includes `.type: 'gmail'` spread from `getStatus`, and `calendarStatus` doesn't include `.type` at all (added by spread). Client must handle both shapes. | Normalize at service layer. | S |
| INT-05 | **P2** | integrations.routes.ts:33 + calendar.routes.ts:26 | Both check `if (!code || !userId)` and render `Invalid OAuth state` as text. Real OAuth errors (`?error=access_denied`) are not handled — user sees a blank "Invalid OAuth state" page on user-cancel. | Redirect with `?integration_error=...` to settings. | S |

---

### `onboarding.routes.ts` + `onboarding-bootstrap.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| ONB-01 | **P0** | onboarding.routes.ts:12-39, 42-69 + onboarding-bootstrap.routes.ts:100-167 | All four routes call Anthropic with **no subscription gate, no rate limit**. `/onboarding-bootstrap/doc` and `/voice` can burn Claude Sonnet 3000-token outputs unbounded. | `requireSubscription` + per-user-per-day cap. | S |
| ONB-02 | **P1** | onboarding.routes.ts:14-18 | Returns `400 {error: 'text is required'}` not the standard `{error:'validation_failed', details:[...]}` shape. Client error UX diverges. | Use `validateBody` + Zod. | S |
| ONB-03 | **P1** | onboarding-bootstrap.routes.ts:103-122 | If user passes JSON body `{text: ...}` with multer's `upload.single('file')` middleware — multer parses multipart only. JSON body parsing fails silently and `req.body.text` is `undefined`. The fallback message "Provide either a `file` or `text`" is misleading. | Split routes or skip multer when content-type is JSON. | S |
| ONB-04 | **P1** | onboarding-bootstrap.routes.ts:64 | Uses `MODEL_MAP.sonnet` for bootstrap extraction (3000 tokens). Combined with no rate limit, this is the highest-cost route in the app. | Move to Haiku unless quality test proves Sonnet is needed; add rate limit. | M |
| ONB-05 | **P2** | onboarding-bootstrap.routes.ts:43-52 | `extractJsonBlock` uses regex + indexOf — fragile for nested braces in fenced JSON. | Try `JSON.parse(raw)` first, fall through. | S |
| ONB-06 | **P2** | onboarding.routes.ts:31-37 | `text/plain` Claude output parsed with `replace(/```json\n?/g, '')` — same brittle pattern repeated across the codebase. | Extract shared `parseJsonResponse(rawText)` helper. | S |

---

### `subscription.routes.ts` + `subscription.middleware.ts` + `stripe.service.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| SUB-01 | **P0** | subscription.routes.ts:27 + index.ts:88 | Webhook is mounted under `/subscription` which is **behind** `authMiddleware`. Stripe POSTs have no cookie → 401 → subscription state never syncs. | Mount `/subscription/webhook` as public **before** the auth wall, with `raw({type:'application/json'})`. | S |
| SUB-02 | **P0** | subscription.middleware.ts:8 | `if (!process.env.STRIPE_SECRET_KEY) { next(); return }` — entire dev bypass active any time the env var is unset. If Railway env is misconfigured at deploy, **every user gets free access** without warning. | Require `STRIPE_SECRET_KEY` in `env.ts` validation when `NODE_ENV=production`. | XS |
| SUB-03 | **P0** | subscription.middleware.ts:31-34 | `catch { next(); }` — any error from OmniMind (timeout, breaker open) means everyone is "subscribed". | Fail-closed: 503 + log. | S |
| SUB-04 | **P1** | subscription.middleware.ts:23-26 | `PAST_DUE` lets the user through but sets `X-Subscription-Warning` header. Header is unread by current client. Either remove or wire it. | Wire in client; show banner. | S |
| SUB-05 | **P1** | stripe.service.ts:36-39 | `APP_URL ?? 'http://localhost:5173'` — see SEC-12. Critical for prod redirects. | Require `APP_URL` in prod env validation. | XS |
| SUB-06 | **P1** | stripe.service.ts:23-25 | `asRecord` cast is used 12+ times to access Stripe v22 fields. Some of these fields (`current_period_end`) may not exist on a `CheckoutSession` (only on `Subscription`). `as number` then `* 1000` on `undefined` = `NaN` → `new Date(NaN)` → invalid date stored in OmniMind. | Use proper Stripe types from SDK. | M |
| SUB-07 | **P1** | stripe.service.ts:50 | `STRIPE_WEBHOOK_SECRET` check is `if (!stripe || !STRIPE_WEBHOOK_SECRET) return;` — silently returns OK to Stripe, **causing Stripe to mark the webhook as delivered**, with no event processed. State drift forever. | Return 500 if misconfigured so Stripe retries. | S |
| SUB-08 | **P1** | stripe.service.ts:67, 89, 106 | Uses `subscription.current_period_end` which on Stripe **2024+ webhook payloads** moved to `subscription.items.data[0].current_period_end`. Type cast hides it. Manual test required. | Verify against actual Stripe payload. | S |
| SUB-09 | **P2** | subscription.routes.ts:32 | Webhook handler returns 400 on any error, but Stripe interprets 400 as "do not retry". Real failures (e.g. OmniMind down) should return 5xx for retry. | Return 500 on internal failures. | S |
| SUB-10 | **P2** | subscription.routes.ts:11, 20, 40 | Three places: `if (!stripeService.isConfigured()) res.json(null)`. Returning `null` from `/checkout` makes the client UX silently no-op. Better to 503. | Return 503 with config error. | S |

---

### `custom-personas.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| CP-01 | **P1** | custom-personas.routes.ts:21, 30 | POST/PATCH forward `req.body` (system prompt, tool permissions, model tier) to OmniMind unvalidated. A user can attempt to grant themselves `'web_search'` tool by submitting `toolPermissions:['web_search']`. Whether the persona then *uses* the tool depends on `orchestrator.ts:131-132` which filters by `tools.filter(t => cp.toolPermissions.includes(t.name))`. → **A user can grant their custom persona web_search access** (paid Serper API key) regardless of subscription. | Zod-validate + restrict `toolPermissions` to a tier-based allowlist. | S |
| CP-02 | **P1** | custom-personas.routes.ts entire | Not behind `requireSubscription`. Custom personas are a paid feature per pricing. | Apply `requireSubscription`. | XS |
| CP-03 | **P2** | orchestrator.ts:126 | Custom persona prompt is **string-concatenated** with the JSON schema example. A custom persona system prompt that ends mid-quote breaks the appended schema example. | Use a structured template builder. | S |

---

### `health.routes.ts`

| ID | Sev | File:Line | Issue | Fix | Effort |
|---|---|---|---|---|---|
| HLT-01 | **P2** | health.routes.ts:7-20 | `/health` always returns 200 even when degraded. Railway probes will think the service is up when OmniMind is down. | Return 503 when `omnimindConnected: false`. | XS |
| HLT-02 | **P2** | health.routes.ts | Doesn't expose circuit breaker state (`omnimindClient.breaker.toJSON()`) which CLAUDE.md says should be on the health endpoint. | Add `breaker: omnimindClient.breaker.toJSON()`. | XS |

---

## Middleware Ordering Review (`index.ts`)

Order today (lines 32-101):
1. `helmet()`
2. `cors({ credentials: true })`
3. `express.json()` (no `limit:`)
4. `cookieParser()`
5. `/api` prefix rewrite (regex replace on `req.url`)
6. Static + SPA fallback (prod)
7. Public routes: `/health`, `/auth`, single-handler OAuth callbacks
8. `authMiddleware` — auth wall
9. `/subscription` (no sub check), `/sessions` (sub check), `/onboarding`, `/onboarding-bootstrap`, `/`, `/cortex`, `/calendar`, `/custom-personas`, `/integrations`, `/admin`
10. Error handler

### Findings

| ID | Sev | Issue | Fix |
|---|---|---|---|
| MID-01 | **P0** | Stripe webhook route `/subscription/webhook` is reachable only **after** auth wall. Stripe has no cookie → 401 → silently drops every webhook. **State will drift the moment a trial converts to paid.** | Hoist webhook to a public route, **before** auth, with `raw({type:'application/json'})`. The router-internal `raw({type:'application/json'})` is correctly placed, but the mount point is wrong. |
| MID-02 | **P0** | `app.set('trust proxy', ...)` is **not set**. On Railway, `req.ip` is the platform's reverse proxy. All rate limiters key by IP → effectively one shared bucket worldwide. | `app.set('trust proxy', 1)` after `cors`. |
| MID-03 | **P1** | `express.json()` has no `limit` option (default 100kb). Onboarding-bootstrap's JSON path (5MB allowed via multer) will silently 413 in JSON mode. | `express.json({ limit: '1mb' })`. |
| MID-04 | **P1** | OAuth callbacks `app.get('/calendar/callback', calendarRouter)` mount whole router as handler. Works because Express invokes Router as middleware and the first internal route matches — but if `calendarRouter` is reordered, the public callback could resolve to a route that requires auth. **Hidden invariant.** | Mount each callback as a discrete function: `app.get('/calendar/callback', oauthCalendarCallback)`. |
| MID-05 | **P1** | The SPA exclusion list is hand-maintained string-prefix match. `/api` was already stripped before reaching this guard — so checking `req.path.startsWith('/api')` after the strip is dead code. | Use a single `app.use('/api', apiRouter)` mount + a separate static handler. |
| MID-06 | **P1** | `app.use('/', entitiesRouter)` at line 95 captures **any path** that doesn't match a more specific mount. If the SPA fallback regex misses a path that an entity sub-route covers (e.g. a hypothetical future `/profile` GET), the entity router will eat the SPA route. | Move entitiesRouter under a real prefix like `/entities` or `/api/entities`. |
| MID-07 | **P1** | Error handler treats every error with `err.upstream` set as 502 — including 4xx OmniMind responses. (See IDX-06.) | Conditional status code. |
| MID-08 | **P2** | No request-ID middleware on inbound requests. `omnimindClient` generates its own `x-request-id` per outbound call, so the inbound→outbound chain isn't joined. | Add `req.id = randomUUID()`, propagate to logger + outbound. |

---

## Resilience Review — `omnimindClient`

| ID | Sev | Finding |
|---|---|---|
| RES-01 | ✅ | Timeout, retry (idempotent only), circuit breaker, exponential backoff with jitter all present and correctly implemented. Matches the CLAUDE.md contract. |
| RES-02 | ✅ | 4xx bypasses retry and breaker — correct. |
| RES-03 | ✅ | Per-request `x-request-id` UUID generated and forwarded. |
| RES-04 | **P1** | `/auth/login` bypasses the client (AUTH-01). Login outages cascade. |
| RES-05 | **P1** | `getAdminStats`, `getAdminAgents`, `triggerAdminSummarize` etc. don't pass `userId` (correct for cross-tenant admin), but neither do they pass a tenantId guard — combined with ADM-01, **any user request reaches these.** |
| RES-06 | **P1** | `omnimindClient` constructs a new singleton at module load. `_apiKey` is lazily resolved on first request. Tests have to call `OmniMindClient.reloadApiKey()` — confirm test coverage. |
| RES-07 | **P2** | Breaker is in-memory per-process. On Railway single-instance this is fine; if scaling horizontally, one bad instance opens its breaker, others don't know. Documented in CLAUDE.md as a known limitation. |
| RES-08 | **P2** | `recordSuccess` resets `failures = 0` after a HALF_OPEN success. Two consecutive 5xx after recovery re-open immediately — fine. But there's no metric exposed (counter, last-error, last-success). | 
| RES-09 | **P2** | `mergeAdminDuplicates(body)` calls `request('POST', '/admin/duplicates/merge', body)` — but the third param of `request` is `userId`, not body. **Body is sent as userId and the actual body is undefined.** Bug in client. |
| RES-10 | **P2** | `searchMemories` builds `?q=${encodeURIComponent(query)}&limit=${limit}` but the URL is concatenated into the path string. If `limit` is `Infinity` or `NaN`, it lands in the query string verbatim. Trust the OmniMind validator but defend-in-depth. |

---

## Agent Runtime + Streaming

| ID | Sev | Finding |
|---|---|---|
| AGT-01 | **P1** | `agent.ts:147` — `throw new Error('Max tool rounds exceeded')` after 3 rounds. Caller in orchestrator catches and emits `persona_error`, but the SSE stream is still open with partial data. Client may render half a persona output. |
| AGT-02 | **P1** | `agent.ts:33, 68, 118` — JSON parsing pattern is duplicated 3 times. `JSON.parse(jsonStr)` will throw on Claude returning prose, and the caller catches in `reasonStreaming` (emits error) but NOT in `reason` or `reasonWithTools` (propagates up the stack). Inconsistent client UX. |
| AGT-03 | **P1** | `streaming.ts:43-69` — `streamClaudeResponse` catches errors and sends `{type:'error'}` but does NOT propagate via reject. Caller cannot distinguish success from error except by checking `fullResponse`. |
| AGT-04 | **P1** | `streaming.ts` + `agent.ts` — neither handles **client disconnect** (`res.on('close')`). If the user closes the tab, the Anthropic stream keeps producing tokens (and billing) until completion. |
| AGT-05 | **P1** | `orchestrator.ts:243-251` — A `throw new Error('FALLBACK_TO_STREAMING')` is used as control flow inside a try/catch that catches generic `toolErr`. Real tool errors are silently swallowed. Dead code path. |
| AGT-06 | **P1** | `orchestrator.ts:198-204` — `getDecisions(userId, { status: 'REVIEWED', limit: '5' })` — but the `request` builds `URLSearchParams` from a `Record<string,string>`. If OmniMind expects `limit` as int, passing string is OK. But the function signature is `Record<string, string>` and `limit: '5'` is fine. Confirm OmniMind contract. |
| AGT-07 | **P2** | `orchestrator.ts:120` — Custom persona `modelTier as 'haiku' | 'sonnet'` — no defense against unknown tier strings from OmniMind. |
| AGT-08 | **P2** | `tool-registry.ts:18` — `sessionInvocations` Map grows unbounded. `resetSession()` is exported but never called. After every session, count entries leak. |
| AGT-09 | **P2** | `tool-registry.ts:35` — Per-session cap counts across all tools combined. No per-tool cap. A pathological loop could call `web_search` 100 times. |
| AGT-10 | **P2** | `document-read.tool.ts` is a no-op (returns a stub message). Either implement or remove from registry to avoid confusing Claude. |

---

## Dead / Stubbed Routes

| Path | Status | Notes |
|---|---|---|
| `app.use('/rooms', roomsRouter)` | Stubbed in `index.ts:101` (commented) | Phase 2. Documented in CLAUDE.md. OK. |
| `/sessions/:id/export?format=pdf` | Returns 501 | Phase 2. Client never requests PDF today; remove from API surface or implement. |
| `tools/document-read.tool.ts` | Returns stub strings, performs no work. | **Either implement or unregister.** Currently advertised to Claude as a real tool, wastes tokens on tool_use cycles. |
| `auth.routes.ts:9-14` (getApiKey local helper) | Duplicates `omnimindClient` env. | Remove. |
| `sessions.routes.ts:43` — `roomId` accepted in body, never used. | Phase 2 vestige. | Remove from `CreateSessionBodySchema` or wire. |
| `omnimindClient.getOAuthToken / saveOAuthToken / deleteOAuthToken` | Exist for Google integrations only. OK. | — |
| `commitment-tracker.ts`, `cost-tracker.ts`, `llm-quality-scorer.service.ts`, `streaming-quality.service.ts`, `prompt-cache.ts` (services dir) | Not imported by any route. | Verify with `grep` — if unused, mark experimental or remove from prod build to reduce surface. (Not audited in detail here — separate workstream.) |
| `transcription/` directory | Imported by onboarding-bootstrap voice route only. | OK. |
| `extraction.service.ts`, `export.service.ts`, `memory-extractor.ts` | Imported. OK. | — |

---

## Cross-Reference With Existing Status Docs

`docs/STATUS/BLOCKERS.md` enumerates infrastructure-level blockers (BLK-001..005) — **none overlap with this audit**. The blockers there are about schema migrations and Phase 5a observability; this audit is about route-level security and correctness gaps that have been latent since Phase 1.

**New launch-blockers not currently tracked:**
- SEC-01 / ADM-01 — admin route exposure (no role check)
- SEC-02 / SUB-01 — webhook behind auth wall
- SEC-03 / SUB-02 / SUB-03 — subscription fail-open in two places
- MID-02 — `trust proxy` unset on Railway → global rate limiter
- COR-01, ONB-01, INT-01, INT-02 — LLM-cost routes outside `requireSubscription`

Recommend opening these as `BLK-006..010` in BLOCKERS.md before launch.

`docs/02-reference/FRAGILE-ZONES.md` (per CLAUDE.md) covers Docker, middleware ordering, Prisma, env vars. The middleware-ordering findings (MID-01..08) extend that document — specifically the webhook ordering bug, the SPA-fallback hand-maintained exclusion list, and the `trust proxy` omission, none of which appear to be flagged there yet.

---

## Recommended Pre-Launch Priority

**Must fix before public payment page:**
1. SEC-01 / ADM-01 — gate or unmount `/admin`.
2. SUB-01 / MID-01 — move Stripe webhook above auth wall.
3. SUB-02 — require `STRIPE_SECRET_KEY` in prod env validation.
4. SUB-03 — subscription middleware fail-closed.
5. MID-02 — `app.set('trust proxy', 1)`.
6. COR-01 / ONB-01 / INT-01 / INT-02 — apply `requireSubscription` to all LLM-cost routes.
7. SEC-04 / ENT-01 — Zod-validate write paths in entities + custom-personas.
8. SUB-06 / SUB-08 — verify Stripe v22 webhook payload field locations (current_period_end moved).
9. AUTH-08 / SESS-02 / SESS-03 — `.unref()` intervals; fix createdAt regression.
10. IDX-06 — error handler maps 4xx OmniMind correctly.

**Should fix in launch week:**
- AUTH-01 (login bypasses resilience layer)
- SESS-01 (per-user session cap)
- INT-03 (gmail prompt path drift)
- SEC-06 (state secret fallback)
- AGT-04 (client disconnect → token bleed)

**Quality bar items (post-launch):**
- AGT-01..10
- ENT-02 (list query params)
- ENT-05 (strict schemas)
- HLT-01 (health-degraded status code)
- CP-03 (template builder)

Total findings: **80** across 11 route files, 3 service files, and middleware/agents/tools. ~12 P0, ~45 P1, ~23 P2.
