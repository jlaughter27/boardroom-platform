# Phase 0.25 — Tasks and Prompts

Six atomic tasks; ~16 hours total over 3 focused days.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 0.25.1 | OAuth state signing (A1) | `boardroom-ai/server/src/services/google-calendar.service.ts`, `gmail.service.ts`, `routes/calendar.routes.ts`, `routes/integrations.routes.ts`, `index.ts`, new `lib/oauth-state.ts` | Forging a callback returns 401; callback routes mounted publicly | 3h |
| 0.25.2 | Stripe webhook fix (A2) | `boardroom-ai/server/src/index.ts`, `routes/subscription.routes.ts`, new `routes/stripe-webhook.routes.ts` | Stripe CLI test webhook returns 200; signature verifies | 3h |
| 0.25.3 | Mass-assignment Zod (A3) | `omnimind-api/src/routes/user-profile.routes.ts`, `packages/shared/src/validation/user-profile.schema.ts` | PATCH with extra keys returns 422 | 30m |
| 0.25.4 | Delete RLS facade (A4) | Delete `omnimind-api/src/lib/db-audit.ts`; clean exports in `lib/db.ts` | File gone; no references remain | 1h |
| 0.25.5 | `ENCRYPTION_KEY` fail-closed (A5) | `omnimind-api/src/lib/env.ts`, `lib/crypto.ts` | Service crashes if missing in any env | 1h |
| 0.25.6 | `MemoryEntry.version` race fix (B1) | `omnimind-api/src/services/memory.service.ts`, `routes/memories.routes.ts`, `packages/shared/src/types/memory.types.ts` | Two parallel PATCHes → second returns 409 | 2h |

---

## Task 0.25.1 — Sign the OAuth state parameter and re-mount callback routes

**Prompt:**

> You are fixing security finding A1 from `docs/research/omnimind-roadmap-2026/wave1-audit/security-audit.md`. The OAuth state parameter is currently set to plain `userId`, allowing callback hijacks.
>
> **Step 1.** Create `packages/boardroom-ai/server/src/lib/oauth-state.ts`:
>
> ```ts
> import jwt from 'jsonwebtoken';
> import { randomBytes } from 'crypto';
>
> const NONCE_TTL_MS = 5 * 60 * 1000;
> const nonceStore = new Map<string, { nonce: string; expires: number }>();
>
> export function issueOAuthState(userId: string): string {
>   const nonce = randomBytes(16).toString('hex');
>   nonceStore.set(`${userId}:${nonce}`, { nonce, expires: Date.now() + NONCE_TTL_MS });
>   return jwt.sign(
>     { userId, nonce, exp: Math.floor(Date.now() / 1000) + 5 * 60 },
>     process.env.JWT_SECRET!,
>     { algorithm: 'HS256' }
>   );
> }
>
> export function verifyOAuthState(state: string): { userId: string } {
>   const decoded = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; nonce: string };
>   const key = `${decoded.userId}:${decoded.nonce}`;
>   const record = nonceStore.get(key);
>   if (!record || record.expires < Date.now()) {
>     throw new Error('oauth_state_replay_or_expired');
>   }
>   nonceStore.delete(key);
>   return { userId: decoded.userId };
> }
> ```
>
> Add a sweep that drops expired nonces every minute (use `setInterval` on module load with `unref()`).
>
> **Step 2.** Edit `packages/boardroom-ai/server/src/services/google-calendar.service.ts` (and the gmail equivalent). Find the `auth-url` generator that does `state: userId`. Replace with `state: issueOAuthState(userId)`.
>
> **Step 3.** In each route's `/callback` handler, replace `const userId = req.query.state` with `const { userId } = verifyOAuthState(req.query.state as string)`. Catch the throw and return 401.
>
> **Step 4.** Open `packages/boardroom-ai/server/src/index.ts`. The current ordering puts `/calendar/callback` and `/integrations/gmail/callback` *behind* the auth wall (they're accessed by Google's redirect, which has no JWT cookie). Extract just the callback handlers into a new `routes/oauth-callbacks.routes.ts` and mount it BEFORE the auth wall:
>
> ```ts
> // Before authMiddleware
> app.use('/oauth-callbacks', publicCallbackRouter);  // /calendar, /gmail
> app.use(authMiddleware);
> ```
>
> Update Google OAuth client config and the redirect URIs in Google Cloud Console to point to the new public path.
>
> **Step 5.** Add unit tests in `packages/boardroom-ai/server/tests/unit/oauth-state.test.ts`: (a) round-trip signing and verifying, (b) tampered state fails, (c) expired state fails, (d) replay (same nonce twice) fails.
>
> Run `npm run test -w packages/boardroom-ai/server`. All green.

---

## Task 0.25.2 — Fix Stripe webhook (raw body + above auth wall)

**Prompt:**

> Security finding A2: the Stripe webhook handler is double-broken — `express.json()` parses the body before the handler can verify the signature, AND the handler is mounted behind the auth wall so Stripe's signature-only POSTs get 401'd.
>
> **Step 1.** Create `packages/boardroom-ai/server/src/routes/stripe-webhook.routes.ts`. Move the webhook handler logic out of `subscription.routes.ts` into here. The handler must accept `req.body` as a `Buffer` (not parsed JSON) and call `stripe.webhooks.constructEvent(req.body, sig, secret)`.
>
> **Step 2.** In `packages/boardroom-ai/server/src/index.ts`, mount BEFORE both `express.json()` and the auth wall:
>
> ```ts
> // After helmet/cors/cookie-parser, BEFORE express.json()
> app.post('/subscription/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
>
> app.use(express.json());
> // ...rest of public routes...
> app.use(authMiddleware);
> ```
>
> **Step 3.** Remove the webhook handler from `subscription.routes.ts`. The router still owns the user-facing subscription endpoints behind the auth wall.
>
> **Step 4.** Add idempotency to the webhook (data-integrity finding A4). Create a `processed_stripe_events` table in OmniMind via a new migration:
>
> ```sql
> CREATE TABLE processed_stripe_events (
>   id text PRIMARY KEY,
>   processed_at timestamptz NOT NULL DEFAULT now()
> );
> ```
>
> The webhook handler does `INSERT ... ON CONFLICT DO NOTHING` first; if the conflict happens, return 200 immediately (already processed).
>
> **Step 5.** Test locally with Stripe CLI: `stripe listen --forward-to localhost:3001/subscription/webhook`. Trigger a test event: `stripe trigger checkout.session.completed`. Verify 200 response in CLI, signature verified.
>
> **Step 6.** Run a manual back-fill: query Stripe for all currently-active subscriptions, verify each has a corresponding `Subscription` row in OmniMind. For any drift, call `omnimindClient.updateSubscription` to reconcile. Write a one-off script in `scripts/backfill-stripe-subscriptions.ts`.
>
> **Step 7.** Add an integration test in `packages/boardroom-ai/server/tests/integration/stripe-webhook.test.ts` that sends a webhook with valid signature → 200, invalid signature → 400, replayed event → 200 (no double-write).

---

## Task 0.25.3 — Add Zod schema to `PATCH /user-profile`

**Prompt:**

> Security finding A3: `omnimind-api/src/routes/user-profile.routes.ts` accepts arbitrary PATCH data with no validation.
>
> **Step 1.** In `packages/shared/src/validation/user-profile.schema.ts`, define `UpdateUserProfileSchema`:
>
> ```ts
> import { z } from 'zod';
>
> export const UpdateUserProfileSchema = z.object({
>   onboardingComplete: z.boolean().optional(),
>   displayName: z.string().min(1).max(100).optional(),
>   timezone: z.string().max(64).optional(),
>   workStartHour: z.number().int().min(0).max(23).optional(),
>   workEndHour: z.number().int().min(0).max(23).optional(),
>   focusBlockMinutes: z.number().int().min(15).max(240).optional(),
>   riskProfile: z.string().max(2000).optional(),
>   cognitivePatterns: z.string().max(5000).optional(),
>   // Add other writable fields here. Match the entity service exactly.
> }).strict();
>
> export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileSchema>;
> ```
>
> Verify against the actual `UserProfile` Prisma model. Do NOT include `userId`, `id`, `createdAt`, `updatedAt`, or any FK fields — those are not user-writable.
>
> **Step 2.** Mirror the structure in the BoardRoom-side `entities.routes.ts:UpdateProfileSchema` so that both ends agree (CLAUDE.md rule 10).
>
> **Step 3.** In `packages/omnimind-api/src/routes/user-profile.routes.ts`, apply via `validateBody(UpdateUserProfileSchema)` middleware (already exists). 422 on parse failure with field-level details.
>
> **Step 4.** Add unit test that PATCHes with `{ userId: 'other', junk: 'bad', onboardingComplete: true }` and expects 422 with both `userId` and `junk` flagged as unknown.
>
> Export the new schema from `packages/shared/src/index.ts`.

---

## Task 0.25.4 — Delete the RLS facade

**Prompt:**

> Security finding A4: `packages/omnimind-api/src/lib/db-audit.ts` exports `getPrismaClient(userId)` and `attachRLSClient` — neither is imported anywhere. The model list inside is wrong (lists models that don't exist; omits real ones). Worse, the proxy mutates caller arguments in place.
>
> **Step 1.** `git rm packages/omnimind-api/src/lib/db-audit.ts`.
>
> **Step 2.** Open `packages/omnimind-api/src/lib/db.ts`. Remove any imports/re-exports of `getPrismaClient`, `attachRLSClient`, or `systemPrisma` if they came from `db-audit`. Keep only the canonical `prisma` export.
>
> **Step 3.** Search the codebase for any remaining references: `grep -r "db-audit\|getPrismaClient\|attachRLSClient" packages/ --include="*.ts"`. Should return zero matches after deletion. Fix any stragglers.
>
> **Step 4.** Add a CI-grade grep gate. Create `scripts/check-rls-discipline.sh`:
>
> ```bash
> #!/usr/bin/env bash
> # Fails if any prisma.<model>.findMany without userId in where clause
> if grep -rn "prisma\.\(memoryEntry\|decision\|commitment\|person\|goal\|project\|task\|userProfile\)\.findMany" packages/omnimind-api/src --include="*.ts" | grep -v "userId"; then
>   echo "BLOCKED: findMany without userId filter found"
>   exit 1
> fi
> ```
>
> Add to `scripts/pre-deploy-check.sh` ahead of typecheck.
>
> **Step 5.** Document in `docs/architecture/security-boundaries.md` (create if missing): "Today's user-isolation enforcement is route-level `findFirst/findMany({ where: { userId, deletedAt: null } })` discipline. Real Postgres RLS is a hard prerequisite of Phase 4 (Collaboration). The previous `db-audit.ts` proxy was deleted because it gave false confidence."
>
> **Step 6.** Run `npm run typecheck` and `npm run test`. All green.

---

## Task 0.25.5 — `ENCRYPTION_KEY` required in all environments

**Prompt:**

> Security finding A5: `ENCRYPTION_KEY` is only required in production. If unset, `crypto.ts` short-circuits and writes plaintext OAuth tokens to Postgres. `decrypt()` silently passes through corrupted ciphertext.
>
> **Step 1.** Open `packages/omnimind-api/src/lib/env.ts`. The validation list currently has `ENCRYPTION_KEY` only required when `NODE_ENV === 'production'`. Move it to the always-required list. The startup validator must `process.exit(1)` with a fatal log message if missing in any env.
>
> **Step 2.** Open `packages/omnimind-api/src/lib/crypto.ts`. Find `getKey()` — remove the `Buffer.alloc(32, 0)` fallback. Make it throw if `ENCRYPTION_KEY` is missing. Find `encrypt()` and `decrypt()` — remove the short-circuit when key is unset.
>
> Find the silent-failure path in `decrypt()` (the line that returns `text` if AES verification fails). Replace with `throw new Error('decryption_failed')`. Callers must handle.
>
> **Step 3.** Update OAuth token reads (`packages/omnimind-api/src/routes/oauth.routes.ts` and the calendar/gmail services that call `decrypt`) to handle the throw — log the failure and return null/empty (treating the integration as broken rather than passing junk tokens upstream).
>
> **Step 4.** Add a separate dev key. In `.env.example` and `docs/DEPLOYMENT-RUNBOOK.md`, document:
>
> ```
> # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ENCRYPTION_KEY=<64-hex-chars>
> ```
>
> Provide a separate `ENCRYPTION_KEY` for dev/staging/prod — never share across environments.
>
> **Step 5.** Add unit tests for `crypto.ts`: (a) encrypt → decrypt round-trip, (b) decrypt of corrupted ciphertext throws, (c) `getKey()` throws when env is unset.
>
> **Step 6.** Verify the prod `ENCRYPTION_KEY` is set in Railway BEFORE deploying. If not, set it first or the next deploy will crash-loop.

---

## Task 0.25.6 — `MemoryEntry.version` race fix

**Prompt:**

> Data-integrity finding B1: `memory.service.ts::updateMemory` does `version: { increment: 1 }` but never includes the expected version in the `where` clause. Two concurrent PATCHes both succeed; second wins; first loss is invisible.
>
> **Step 1.** Open `packages/omnimind-api/src/services/memory.service.ts`. Find `updateMemory`. Change the signature to accept `expectedVersion: number`:
>
> ```ts
> export async function updateMemory(
>   id: string,
>   userId: string,
>   expectedVersion: number,
>   data: UpdateMemoryInput
> ): Promise<MemoryEntry> {
>   try {
>     return await prisma.memoryEntry.update({
>       where: { id, userId, deletedAt: null, version: expectedVersion },
>       data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
>     });
>   } catch (err: any) {
>     if (err.code === 'P2025') {
>       throw new VersionConflictError(id, expectedVersion);
>     }
>     throw err;
>   }
> }
> ```
>
> Define `VersionConflictError` in the same file or in `lib/errors.ts`.
>
> **Step 2.** Open `packages/omnimind-api/src/routes/memories.routes.ts`. The PATCH handler must read the `If-Match` header, parse to int, and pass to the service. On `VersionConflictError`, return 409 with the current row's version in the body so clients can refetch:
>
> ```ts
> const expectedVersion = parseInt(req.header('If-Match') ?? '', 10);
> if (!Number.isFinite(expectedVersion)) {
>   return res.status(428).json({ error: 'precondition_required', message: 'If-Match header required' });
> }
> // ... call updateMemory, catch VersionConflictError, respond 409
> ```
>
> **Step 3.** Apply the same pattern to `decision.service.ts::updateDecision` and `entity.service.ts::updateEntity` (and any other entity update with a `version` column). Audit also `commitment.service.ts` (data-integrity A5: version increment skipped entirely there).
>
> **Step 4.** Update the BoardRoom client (`packages/boardroom-ai/server/src/services/omnimind-client.ts`) to fetch the current `version`, pass `If-Match`, and on 409 refetch + retry once with the latest version (with caller-visible error if still stuck).
>
> **Step 5.** Document the new contract in `docs/contracts/memory-api.md`: `PATCH /memories/:id` requires `If-Match: <version>`; returns 428 if missing, 409 if mismatched.
>
> **Step 6.** Add unit tests covering: (a) successful update increments version, (b) wrong `If-Match` returns 409, (c) missing `If-Match` returns 428, (d) two parallel PATCHes — first wins, second gets 409.
>
> Run full test suite. Commit.
