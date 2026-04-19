# Wave 1 — Security Audit

**Scope:** boardroom-ai (server) + omnimind-api + shared package
**Branch:** feature/folder-migration
**Date:** 2026-04-18
**Posture:** Pre-PMF, single-tenant per user, two services on Railway, no CI gate.
**Bias:** Honest. Skip enterprise nitpicks. Surface things that would burn a real customer **tomorrow**.

---

## A. CRITICAL findings

### A1. OAuth callback hijack — anyone can attach Google tokens to any user account
**Files:** `packages/boardroom-ai/server/src/routes/calendar.routes.ts:21-29`, `packages/boardroom-ai/server/src/routes/integrations.routes.ts:31-40`, `packages/boardroom-ai/server/src/index.ts:82-87`
**Severity:** 5/5
**Attack:**
1. Attacker calls `/calendar/auth-url` (or `/integrations/gmail/auth-url`) with their own session cookie. They never need to complete the flow — they only need a Google authorization code.
2. The `state` parameter is set to the *attacker's* userId by the auth-url generator (`google-calendar.service.ts:24` — `state: userId`).
3. Attacker captures their own valid auth `code` from Google's redirect.
4. Attacker hand-crafts: `GET /calendar/callback?code=<their_code>&state=<VICTIM_USER_ID>`. Since `userIds` are CUIDs, they can be discovered via the `/auth/me` race in shared rooms, leaked logs, or session URLs that include the userId.
5. `handleCallback(victimUserId, attackerCode)` runs and writes the **attacker's** Google tokens into the victim's `OAuthToken` row.
6. Victim now reads the **attacker's** Gmail and Calendar inside the BoardRoom app — content injection attack. Or attacker reverses it: tricks victim into clicking a crafted callback URL that puts the **victim's** tokens under the attacker's userId in some flows where the auth-url generator can be poisoned (state is not signed).

The state parameter is also unauthenticated and unsigned. The classic OAuth CSRF pattern is broken. Worse, the routes that should be public (callbacks) are mounted with `app.get('/calendar/callback', calendarRouter)` (line 83) — but `calendarRouter` defines its `/callback` *inside* the router, so the effective path is `/calendar/callback/callback`, **which doesn't match Google's redirect**. The actual `/calendar/callback` is served by the `app.use('/calendar', calendarRouter)` mount at line 96, which is **behind** the auth wall (line 87). So either:
- (a) Google's redirect is currently 401-ing in production (broken integration), OR
- (b) someone fixed it server-side and the in-repo logic is stale.

Either way: when this flow does work, state is wide open to forgery.

**Fix:**
1. Replace `state: userId` with a signed, short-lived JWT containing `userId + nonce + exp` (5 min). Verify in callback before calling `handleCallback`.
2. Move the actual public callback paths above the auth wall: `app.use('/calendar/callback', publicCalendarCallbackRouter)` with the handler extracted to its own file. Same for Gmail.
3. Bind the nonce to a short-lived row (Redis or in-memory map) keyed by userId so a code can't be replayed.
**Effort:** ~3 hours. Use `jsonwebtoken` (already in deps) for the signed state.

---

### A2. Stripe webhook is unreachable AND signature-verification is broken
**Files:** `packages/boardroom-ai/server/src/routes/subscription.routes.ts:27-35`, `packages/boardroom-ai/server/src/index.ts:49,87,90`
**Severity:** 5/5
**Attack / failure mode:**
1. `app.use(express.json())` is mounted globally at `index.ts:49`. By the time the `/subscription/webhook` handler runs, `req.body` is already a parsed object, **not a Buffer**. `stripe.webhooks.constructEvent(payload, signature, secret)` requires the raw bytes. Every webhook will throw → 400 → Stripe retries 3 times → marks the endpoint as failing.
2. `app.use('/subscription', subscriptionRouter)` (line 90) is mounted **after** the auth wall (line 87 — `app.use(authMiddleware)`). Stripe sends webhooks with no JWT cookie, so the request gets a 401 before it ever reaches the webhook handler.

Net result: subscriptions never transition `TRIALING → ACTIVE`, payment failures never propagate. Users stay on free trial forever, or paying users get cut off when their `currentPeriodEnd` lapses without a renewal write.

**Fix:**
1. Mount the webhook **above** the auth wall and **above** the global JSON parser:
```ts
app.post('/subscription/webhook', express.raw({ type: 'application/json' }), webhookHandler);
// then
app.use(express.json());
```
2. Move the webhook out of `subscriptionRouter` into its own public mount at the top of `index.ts`.
3. Add a manual reconciliation script for any users whose subscription state diverged while this was broken.
**Effort:** 1 hour code + 1 hour to back-fill subscription state from Stripe.

---

### A3. Mass-assignment on `PATCH /user-profile` (no Zod validation on writeable endpoint)
**Files:** `packages/omnimind-api/src/routes/user-profile.routes.ts:20-28`, `packages/omnimind-api/src/services/user-profile.service.ts:27-47`
**Severity:** 4/5
**Attack:**
1. Authenticated user (or anyone with the OmniMind API key) sends `PATCH /user-profile` with `{ "userId": "<other_user_id>", "onboardingComplete": true, … }`.
2. The route has zero Zod schema. `userProfileService.updateProfile` calls `prisma.userProfile.update({ where: { userId }, data: data as any })`. Prisma will accept arbitrary fields including foreign keys, JSON blobs, and possibly bypass field types via `as any`.
3. While `where: { userId }` constrains the row updated, the `data` blob is unfiltered — an attacker can write garbage JSON to `riskProfile` / `cognitivePatterns` (which are then read by Cortex and influence persona output), set `onboardingComplete` to skip flow gating, or attempt to trigger Prisma type-coercion errors that 500 the service.

Worth noting: the BoardRoom side at `entities.routes.ts:11-24` defines `UpdateProfileSchema` with `.strict()`, but there's no equivalent guard on the OmniMind side. If anyone bypasses BoardRoom (leaked API key, internal service-to-service mistake), nothing stops the bad write.
**Fix:** Add a Zod schema mirroring `UpdateProfileSchema` from `entities.routes.ts` directly in OmniMind, applied via the existing `validateBody` middleware. Reject unknown keys (`.strict()`).
**Effort:** 30 minutes.

---

### A4. RLS proxy in `db-audit.ts` is wired but **never used** anywhere — model-list is also wrong
**Files:** `packages/omnimind-api/src/lib/db-audit.ts:1-37,61-221`, `packages/omnimind-api/src/lib/db.ts:18-58`
**Severity:** 4/5
**Findings:**
1. `getPrismaClient(userId)` and `attachRLSClient` exist but **no route or service imports them**. Every route imports `prisma` (the unscoped base client) directly. The RLS guarantee is purely cosmetic.
2. `USER_SCOPED_MODELS` lists models that **do not exist** in the Prisma schema (`memoryChunk`, `cortexSession`, `cortexMessage`, `embeddingJob`, `taskAssignment`, `userPreference`, `userActivity`, `userAchievement`, `userSubscription`, etc.). It also **omits** real user-scoped models like `decision`, `commitment`, `oAuthToken`, `userProfile`, `contradictionAlert`, `weeklyMemo`, `outcomeReviewNudge`, `customPersona`, `subscription`. So even if turned on tomorrow, it would silently fail to protect those models.
3. The proxy mutates the caller's argument in place (`firstArg.where = { AND: [...] }`) — destructive side effect that breaks shared `where` clauses and Prisma's `Prisma.validator` patterns.

Today's defense is the route-level discipline of `findFirst({ where: { id, userId, deletedAt: null } })`. That's the **only** thing keeping cross-user reads from working. Spot-checks (`memories.routes.ts`, `decisions.routes.ts`, `people.routes.ts`, `entity.service.ts`) all do enforce userId filtering, so the practical exposure is low *today* — but the architectural promise documented in CLAUDE.md ("RLS: All queries MUST include user_id filter") is built on a façade.

**Fix (minimum viable):**
1. Delete `db-audit.ts` and the `getPrismaClient`/`attachRLSClient` exports — they're worse than nothing because they create false confidence.
2. Replace with a real Postgres RLS policy on user-scoped tables, set via `SET LOCAL app.user_id = $1` per-request inside a transaction wrapper. This is the only way to make the guarantee enforceable.
3. Until then, add a single grep-based CI check: any new `prisma.<model>.findMany({ where: { ... } })` without `userId` in the where clause fails the build.
**Effort:** RLS policies are a 1-day job. The CI grep gate is 30 minutes and recovers most of the value.

---

### A5. `ENCRYPTION_KEY` is optional in non-production — OAuth tokens stored in plaintext
**Files:** `packages/omnimind-api/src/lib/crypto.ts:5-15`, `packages/omnimind-api/src/lib/env.ts:9`
**Severity:** 4/5
**Issue:**
- `getKey()` returns `Buffer.alloc(32, 0)` (32 zero bytes) when `ENCRYPTION_KEY` is unset.
- `encrypt()` and `decrypt()` short-circuit and return plaintext when `ENCRYPTION_KEY` is unset.
- `validateOmniMindEnv()` only requires `ENCRYPTION_KEY` when `NODE_ENV === 'production'`.

If `NODE_ENV` is anything other than literally `"production"` (typos, staging, preview deploys, dev databases that get promoted) — Google access tokens, refresh tokens, and Gmail tokens are written to Postgres in cleartext. A backup leak or a single SQL access then becomes an account-takeover for every connected Google account.

Also: the `decrypt` function silently returns the input string unchanged when decryption fails (`crypto.ts:32`). This means a forged or corrupted token row will quietly succeed and pass plaintext-as-token to Google API calls — the failure is invisible.

**Fix:**
1. Make `ENCRYPTION_KEY` required in **all** environments. Crash on startup if missing.
2. Remove the dev passthrough. Use a separate dev key.
3. Replace silent decrypt failures with explicit throws — log + null return at minimum.
**Effort:** 1 hour + dev-environment doc update.

---

## B. HIGH findings

### B1. `/auth/user/:id` allows arbitrary user lookup with only an API key
**Files:** `packages/omnimind-api/src/routes/auth.routes.ts:67-82`
**Severity:** 3/5
**Attack:** Anyone with `OMNIMIND_API_KEY` (BoardRoom service, leaked log, internal misconfig) can `GET /auth/user/<any_id>` and enumerate users by ID. Returns email + name + teamId. Combined with the unscoped `x-user-id` header, this is a stepping stone for cross-user reads.
**Fix:** Require an `x-user-id` header that matches `:id`, OR add a service-level "system" header that distinguishes BoardRoom's auth flow from arbitrary lookups. Apply `validateUserExists` middleware (which exists at `middleware/user-validator.ts` but is unused).
**Effort:** 30 minutes.

### B2. The `validateUserExists` middleware is dead code
**File:** `packages/omnimind-api/src/middleware/user-validator.ts:13-83`
**Severity:** 3/5
**Issue:** Middleware exists and looks correct (CUID regex, DB existence check, partial-PII logging). It is **never imported or mounted**. Every entity route does its own ad-hoc `if (!userId) return 400` check, but no one validates the userId is real or matches the JWT subject.

Concrete consequence: if `OMNIMIND_API_KEY` leaks, the attacker just supplies `x-user-id: <victim_cuid>` and reads everything. There's no defense-in-depth between the API-key gate and Prisma.

**Fix:** Mount `validateUserExists` globally after `apiKeyAuth` in `omnimind-api/src/index.ts` (skip on `/health` and `/auth/*`). Cache user-existence lookups for 60s to avoid the per-request DB hit.
**Effort:** 1 hour.

### B3. Subscription middleware fails open on **all** errors, including auth errors
**File:** `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts:31-34`
**Severity:** 3/5
**Issue:** The `catch {}` block lets the request through unconditionally. If OmniMind is down, that's the documented design (ADR-noted). But it also fails open on:
- 401 (API key rotated, BoardRoom out of sync) — paying users still hit free-tier features fine, but so do free trials past expiry.
- 422 (bad request) — same.
- Network DNS issues that mean **every** subscription check fails open.

Since the pricing model is a 14-day trial then $29/mo, every hour OmniMind is unhealthy is free service for non-payers.
**Fix:** Add a 60-second cache of the last-known subscription status per user. On error, fall back to the cached value rather than blanket-allow. Log distinct error classes.
**Effort:** 2 hours.

### B4. Rate limiters are in-memory and reset on each Railway redeploy
**Files:** `packages/boardroom-ai/server/src/middleware/auth-rate-limiter.ts:8-16`, `packages/boardroom-ai/server/src/middleware/session-rate-limiter.ts:14`, `packages/omnimind-api/src/middleware/rate-limiter.ts:9-22`
**Severity:** 3/5
**Attack:** Brute-force login in real time. The login limiter caps at 5 attempts / 15 min / IP. Auto-deploy on push (per CLAUDE.md) means a determined attacker just waits for any commit to land — the in-memory `Map<string, RateBucket>` resets to empty. Average several deploys per day on an active project = several free brute-force windows daily. Also there's no per-account lockout — only per-IP — so an attacker on a botnet bypasses entirely.
**Fix:** This is the limitation called out in CLAUDE.md ("scaling beyond 1 instance"). For now, add a per-account counter (`UserLoginAttempt` table) with a lockout after N failures regardless of IP. Real fix: Redis-backed rate limiter. The `_disabled/rate-limiter-redis.ts` file in git status suggests this was tried and reverted.
**Effort:** Per-account counter: 2 hours. Redis: 1 day.

### B5. SSE session store is unbounded in-memory
**Files:** `packages/boardroom-ai/server/src/routes/sessions.routes.ts:20-21,34-43`
**Severity:** 3/5
**Attack:** Authenticated user POSTs `/sessions` thousands of times. `sessions.set(id, session)` accumulates without TTL. RAM grows until the Railway instance OOMs and restarts (taking everyone's in-flight sessions with it). Already rate-limited at 50 sessions/day/user (`SESSIONS_PER_DAY` constant), but with N users, scale is `N * 50 / day` of session objects living forever.
**Fix:** Add a sweep that drops sessions >24h old. Or back the store with OmniMind (the file comment says "Phase 1 — will persist to OmniMind later").
**Effort:** 1 hour for sweep, larger refactor for persistence.

### B6. CORS is wide open in dev (`cors()` with no options on OmniMind)
**Files:** `packages/omnimind-api/src/index.ts:38`
**Severity:** 2/5
**Issue:** `app.use(cors())` accepts all origins. The API-key gate prevents browser-based exploitation (browsers don't have the key), but combined with helmet's default `frame-options: SAMEORIGIN` being possibly weakened by OmniMind being a separate origin, it leaves room for clickjacking-adjacent attacks against admin/debug endpoints if any are added. Low impact today; high impact when someone adds a debug UI.
**Fix:** Restrict OmniMind CORS to BoardRoom's origin only. Service-to-service doesn't need any CORS at all (no preflight from a server).
**Effort:** 15 minutes.

### B7. Logger leaks raw request body / Prisma errors in dev mode (and dev mode is leaky)
**Files:** `packages/omnimind-api/src/lib/db.ts:65-72`, `packages/omnimind-api/src/index.ts:8`
**Severity:** 2/5
**Issue:** Prisma query logging in development includes `query` + `params` (line 6 of db.ts: `log: ['query', 'error', 'warn']`). Params contain user content including potentially passwordHashes (during register/login). If `NODE_ENV` is misconfigured on a staging deploy, password hashes hit the logs.

Also, the global error handler at `boardroom-ai/index.ts:122-127` returns `err.message` to the client when not in production. If `NODE_ENV` is unset on a deploy (Railway misconfig), users get raw stack traces and messages including DB schema names.

**Fix:** Default to production-safe logging unless `NODE_ENV === 'development'` *and* a `BOARDROOM_DEBUG=true` flag is set. Sanitize `passwordHash` from any Prisma query params before logging.
**Effort:** 1 hour.

---

## C. MEDIUM findings

### C1. JWT has no audience/issuer claims, no key rotation
**Files:** `packages/boardroom-ai/server/src/middleware/auth.ts:43-53`
**Severity:** 2/5
JWT is signed with HS256 + a single shared secret, no `aud`/`iss`. If `JWT_SECRET` is reused across environments (dev = staging) a token from one environment is valid in another. There's no `kid` header for key rotation — rotating the secret immediately invalidates every active session.
**Fix:** Add `aud: 'boardroom'`, `iss: 'boardroom-ai'`, and on verify check both. For rotation: support reading two secrets (current + previous) for a migration window.
**Effort:** 1 hour.

### C2. Memory entity links endpoint trusts `entityId` without ownership check
**Files:** `packages/omnimind-api/src/routes/memories.routes.ts:150-176`
**Severity:** 2/5
`POST /memories/:id/links` verifies the memory belongs to the user, but does **not** verify that the `entityId` (e.g. a goalId) belongs to the user. A user could link their memory to another user's goal, creating a graph edge that exposes the existence of cross-user entities (low — IDs are CUIDs, hard to guess) and could pollute the entity graph if any consumer trusts it.
**Fix:** Validate `entityType + entityId` ownership before insert.
**Effort:** 1 hour.

### C3. Cortex `/cortex/contradictions/scan` is an open LLM-spend trigger
**Files:** `packages/omnimind-api/src/routes/cortex.routes.ts:77-84`
**Severity:** 2/5
A POST with no body params calls Anthropic Haiku in a loop (one batch per 5 project pairs). User with N=20 projects = 190 pair comparisons = 38 Haiku calls per scan request. Combined with the route's only rate limit being the global 60/min, a malicious or buggy client can drive significant Anthropic spend. Same pattern in `/cortex/patterns/scan`, `/cortex/memo/generate`, `/cortex/simulate`.
**Fix:** Add a per-user, per-day cap on Cortex trigger endpoints (e.g., 5 manual scans/day). Persist counter in OmniMind (use existing `userPreference`-like model or add `CortexUsage`).
**Effort:** 2 hours.

### C4. No content-length / payload-size guard on file-like endpoints
**Files:** `packages/boardroom-ai/server/src/index.ts:49`, `packages/omnimind-api/src/index.ts:39`
**Severity:** 2/5
BoardRoom: `express.json()` with no `limit` — defaults to 100kb, which is fine. OmniMind has `limit: '1mb'`. The Gmail extraction endpoint sends body content up to 5000 chars, and `extraction.service.ts` paths can include transcripts. A user uploading a 1MB+ memory body will hit the OmniMind limit (good) but the BoardRoom side's 100kb default could surprise on long sessions.
**Fix:** Set explicit limits matching expected use (`{ limit: '512kb' }` BoardRoom, keep 1mb OmniMind). Document in `docs/contracts`.
**Effort:** 15 minutes.

### C5. Per-process circuit breaker on `omnimind-client.ts` is single-instance only
**Files:** `packages/boardroom-ai/server/src/services/omnimind-client.ts:27-63`
**Severity:** 1/5
Documented limitation. With one Railway instance per service today, fine. When you scale to N instances, each has its own breaker — N times the failures before any single breaker opens. Same story as the rate limiters.
**Fix:** Same Redis answer, same someday timeline.

### C6. `createMemory` doesn't enforce user-quota / memory budget at the route level
**Files:** `packages/omnimind-api/src/services/memory.service.ts:8-71`
**Severity:** 1/5
The validation pipeline (`runValidationPipeline`) does enforce a budget, but a malicious user can spam create attempts indefinitely if the budget logic short-circuits early or accepts before persistence. Combined with the embedding queue (fire-and-forget), this is a path to drain OpenAI embedding spend.
**Fix:** Add per-user per-day memory creation limit at the route layer (e.g., 200/day default, configurable). Track in OmniMind.
**Effort:** 2 hours.

---

## D. Defenses present and working

These are real and worth crediting:

- **Timing-safe API key compare** (`omnimind-api/src/middleware/auth.ts:42`) — uses `timingSafeEqual` with length pre-check.
- **bcrypt 12 rounds** for password hashing (`boardroom-ai/server/src/middleware/auth.ts:36`).
- **httpOnly + Secure (in prod) + SameSite=Lax** cookies (`auth.routes.ts:18,48`). Right defaults for first-party cookie auth.
- **AES-256-GCM** for OAuth token encryption when key is set (`omnimind-api/src/lib/crypto.ts:14-21`). IV per encryption, auth tag verified.
- **Zod validation** is consistently applied at the route boundary for `POST/PATCH` on memories, decisions, people, projects, goals, custom-personas (sampled 5+ routes — all use `safeParse` + 422 on failure).
- **userId filtering** is consistently present at every query in the routes I sampled (`memory.service.ts:74-77`, `decision.service.ts:36-67`, `entity.service.ts:26-95`). The discipline holds even though the RLS proxy wrapping it is broken.
- **Soft-delete filter** (`deletedAt: null`) is applied uniformly on read paths.
- **Helmet** is mounted on both services (default config — could be hardened but not absent).
- **Stripe webhook signature verification** is *attempted* (`stripe.service.ts:48`) — it's broken for a different reason (A2), but the right primitive was reached for.
- **Express middleware ordering** is documented as load-bearing in CLAUDE.md and the actual ordering in `index.ts` matches the doc (modulo the subscription/webhook bug).
- **Resilience layer**: timeout + retry-with-jitter + circuit breaker on `omnimind-client.ts` is a thoughtful, correct implementation. 4xx never trips the breaker; only idempotent methods retry.
- **JWT secret validated at startup** with a `FATAL` exit (`auth.ts:12`). Same for `OMNIMIND_API_KEY`.
- **Rate limiters exist on auth endpoints** (5/15min login, 3/hour register) — better than nothing, real attackers will need to wait for redeploys to bypass.

---

## E. Compliance gaps (SOC 2 Type 1 / GDPR)

This is pre-PMF, so be sober: do not chase SOC 2 yet. But here are the things that would block a compliance review:

1. **No audit log** of access to user data. OmniMind logs queries in dev only; production logs only errors. SOC 2 CC7.2 (logging) requires immutable access logs for sensitive data reads.
2. **No data deletion flow.** "Soft delete" leaves data forever in `deletedAt`-marked rows. GDPR Art. 17 (right to erasure) requires hard-delete or pseudonymization within 30 days of request. Cortex memos / pattern detections will keep referencing memory IDs that no longer have content.
3. **Encryption key derivation is direct hex import.** `Buffer.from(key, 'hex')` with no KDF and no key versioning. SOC 2 CC6.1 needs documented key management — even minimally, a `key_version` column on `OAuthToken` and a `kid` lookup.
4. **No data residency control.** Single Railway region, no region-pinned database. Becomes blocker for any EU enterprise customer.
5. **PII in JWT.** Email is in the JWT body — fine technically, but PII-in-token complicates GDPR data-export accounting. Move to userId-only and look up email per request.
6. **No DSAR (data subject access request) endpoint.** GDPR Art. 15 — needs `GET /me/export` returning all user data. Doable in a day.
7. **Subscription billing** has no PCI scope today (good — Stripe-hosted checkout). Keep it that way.
8. **No SSO / no MFA.** Password + JWT only. Real customers will ask for at least Google OAuth login (separate from Calendar OAuth) within the first 10 enterprise conversations.

**Verdict for pre-PMF:** acceptable. Don't pursue SOC 2 until you have 10+ paying enterprise users actively asking. Do build the deletion flow and audit log proactively — both are 10x harder to retrofit than to build.

---

## F. Roadmap implications

**Block these on shipping (must fix BEFORE any wave 1+ feature work):**

- **A1 (OAuth state hijack)** — Phase 3 (Integrations) is currently live and exposed. Fix in this wave or pull integrations from production.
- **A2 (Stripe webhook)** — Phase 3 (Stripe billing) is broken. Confirm whether subscriptions are actually transitioning today; if not, this is silently bleeding revenue. Fix this wave.
- **A5 (Encryption key dev-passthrough)** — fix this wave, it's a 1-hour change with 24-hour blast radius if a single env var typo happens on a Railway redeploy.

**Add to existing roadmap phases:**

- **Phase 2 (Cortex Intelligence — already complete):** retroactively add per-user spend caps (C3) before opening Cortex to non-trial users. One bad scan loop = $100s in Anthropic spend.
- **Phase 3 (Integrations — partial):** complete the OAuth fix (A1), add ownership validation on entity links (C2). Add per-account login lockout (B4) since social-engineered Gmail account takeovers will start in this phase.
- **Phase 4 (Collaboration — future):** **do not start** until A4 (real Postgres RLS) is in place. Multi-user rooms = multi-tenant queries = the route-level discipline is no longer sufficient. Roadmap that as a Phase 4 prerequisite, not a Phase 4 feature.

**New phase recommendation — "Phase 2.5 Security Hardening" (1 week):**

| Item | Effort | Wave |
|---|---|---|
| OAuth state signing (A1) | 3h | This wave |
| Stripe webhook fix + back-fill (A2) | 2h | This wave |
| Mass-assignment Zod (A3) | 30m | This wave |
| ENCRYPTION_KEY required (A5) | 1h | This wave |
| Mount validateUserExists (B2) | 1h | This wave |
| Per-account login lockout (B4) | 2h | This wave |
| Subscription cache (B3) | 2h | Next wave |
| Real Postgres RLS (A4) | 1d | Next wave (blocks Phase 4) |
| Audit log table + writes (compliance #1) | 2d | Before first enterprise conversation |
| DSAR + hard-delete (compliance #2,#6) | 1d | Before first EU customer |

**Defer until paid scale (>500 users):**

- B5 (session store TTL only, not full migration)
- C4, C5, C6 — known-knowns, not exploitable today
- Multi-region, MFA, SSO

**One non-finding worth saying out loud:** the route-level userId discipline is good. The team clearly wrote `findFirst({ where: { id, userId, deletedAt: null } })` as muscle memory across 17 route files. That's the actual security boundary today and it's holding. Don't break it during the migration; add the RLS layer underneath, not instead.

---

**Word count: ~2,650.**
