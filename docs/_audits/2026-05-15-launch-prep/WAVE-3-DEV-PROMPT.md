# Wave 3 — Launch-Day Polish & Roadmapped Features

**Date:** 2026-05-15
**Base branch:** `claude/review-project-status-VgaJ0` (post-Wave-2 merge — commit `7ed355e` or later)
**Target quality bar:** Show HN / Product Hunt launch-day. Linear / Vercel / Stripe polish.
**Estimated total effort:** 18–25 engineer-days across 7 tracks. Parallelizable.

---

## Context for any agent picking this up

Read these first, in order, before opening any file:

1. `/home/user/boardroom-platform/.claude/CLAUDE.md` — architecture, service boundaries, critical rules
2. `/home/user/boardroom-platform/CLAUDE.md` — architectural principles (root)
3. `/home/user/boardroom-platform/docs/STATUS/CURRENT-PHASE.md` — where we are
4. `/home/user/boardroom-platform/docs/_audits/2026-05-15-launch-prep/` — the six Wave 1 audits + three Wave 2 follow-up docs
5. `/home/user/boardroom-platform/docs/contracts/` — API contracts between BoardRoom and OmniMind

**Wave 2 already shipped:** admin guard, Stripe webhook, OAuth state hardening, trust proxy, subscription gating, streaming abort, decision-session persistence, Tailwind typo sweep, "Create a Goal" wire-up, account deletion, client test setup, GitHub Actions CI, 5 critical-path test suites. Do NOT re-do those.

**Pre-existing tech debt to be aware of:**

- `packages/shared/src/utils/validation-helpers.ts` has 4 TS errors blocking root turbo commands (C-FU-01)
- 2 pre-existing `AbortSignal.onabort` type errors in `omnimind-client.ts` and `llm-quality-scorer.service.ts`
- `prisma db push` is used in prod instead of a baseline migration (known)
- 6 server endpoints orphaned after Wave 2 (see `01-feature-wiring.md` dead-endpoint section) — Track J will sweep

---

## Tracks at a glance

| Track | Theme | Effort | Parallel-safe? | Wave 2 deps |
|---|---|---|---|---|
| **D** | Persona + mode education | 2–3 days | Yes | None |
| **E** | Auth completeness (SSO, forgot-password, email verify) | 3–4 days | Yes | Track A's OAuth state lib |
| **F** | Design system overhaul (lucide, Radix, tokens) | 4–6 days | Yes (touches `components/ui/` mostly) | None |
| **G** | Lint & guardrails (Tailwind class rule + CI) | 0.5–1 day | Yes | None |
| **H** | Phase 0.25 security remainders | 2–3 days | Partially (touches different files) | None |
| **I** | Pre-existing TS errors | 0.5 day | Yes | None — should run FIRST so turbo CI works |
| **J** | Test coverage expansion + dead-endpoint sweep | 4–5 days | Yes | None |

**Suggested dispatch order:**
1. Track I first (unblocks turbo CI for the rest)
2. Tracks D, E, F, G, H, J in parallel via worktree isolation

---

## Track D — Persona & Mode Education

**Why:** UX audit issue #2 — the 7-persona system is the product's USP and the UI never explains it. New users see a textarea and a 6-mode selector with no idea what's about to happen.

**Audit references:**
- `03-ux-flows.md` — Top-3 systemic issue #2; Journey 2 friction items 2.1–2.6; P0 recommendation #7
- `06-roadmap-reconciliation.md` — orphan personas (commitment-extraction, email-extractor)

**Deliverables:**

1. **"Meet Your Advisors" first-run modal**
   - File: new `packages/boardroom-ai/client/src/components/decision/MeetAdvisorsModal.tsx`
   - Trigger: opens on first visit to `/decisions/new` per user. Persistence via OmniMind UserProfile (new field `seenAdvisorsTour: boolean`) or localStorage as a launch-day stand-in (file an OmniMind follow-up).
   - Content: 7-card grid (one per persona) with name, color swatch, 1-sentence role, sample probing question. Reuse persona color tokens.
   - Animation: stagger-in with `motion.div` (30ms delay per card).
   - Footer: "Got it — let's go" button + "Don't show again" checkbox (defaults checked).

2. **Persona hover tooltips on PersonaCard + sidebar legend**
   - File: `packages/boardroom-ai/client/src/components/decision/PersonaCard.tsx`
   - Wrap card avatar/name in a Radix Tooltip (depends on Track F shipping the new Tooltip primitive — or use the existing one and replace later).
   - Tooltip content: 1-sentence role + "What does this persona look for?" bullet (3 items max).
   - Pull persona metadata from a new file: `packages/boardroom-ai/client/src/lib/persona-metadata.ts`.

3. **Mode picker tooltips**
   - File: `packages/boardroom-ai/client/src/pages/DecisionLabPage.tsx` (mode selector component)
   - Each mode button gets hover-tooltip: "Decide" / "Stress-Test" / "Plan" / "Quick Take" / "Clarify" / "Review" → 1 sentence describing the persona mix + use case.
   - Source of truth: `server/src/personas/mode-router.ts` `MODE_CONFIGS`.

4. **Sample question chips below decision input**
   - File: new `packages/boardroom-ai/client/src/components/decision/SuggestionChips.tsx`
   - 4–6 example questions shown ONLY when textarea is empty: "Should I hire a co-founder or stay solo?", "Is this pricing too aggressive?", "Should I take the seed round on these terms?", etc.
   - Clicking a chip populates the textarea + focuses it.
   - Disappear after first input.

5. **Persona-flavored micro-copy**
   - File: `packages/boardroom-ai/client/src/hooks/useStreaming.ts` (or wherever "Thinking…" is rendered)
   - Replace the generic "Thinking…" with persona-specific copy: Critic = "Sharpening knives…", Optimist = "Spotting upside…", Doer = "Mapping next steps…", Technician = "Inspecting the wires…", etc.
   - 1 string per persona, in `persona-metadata.ts`.

6. **Wire orphan personas (defer if scope tight)**
   - `commitment-extraction.system.md` has a prompt, service, cost tracking — but no route invokes it. Wire it into the decision-session synthesis pipeline OR file as Wave 4. (Roadmap audit finding.)
   - `email-extractor.system.md` is a Gmail integration prompt with no `loadSystemPrompt` callsite in BoardRoom. Verify it's actually used by Gmail extract route; if not, file as Wave 4.

**Acceptance:**
- New user lands on `/decisions/new` → modal appears within 100ms of mount → can dismiss → doesn't reappear
- Hover any persona → tooltip in <200ms with role + 3 bullets
- Hover any mode → tooltip with description
- Empty textarea shows 4–6 chips; non-empty hides them
- Streaming UX shows persona-flavored copy
- All copy reviewed for brand voice (warm, direct, opinionated — not corporate)

**Test plan:**
- Unit: `MeetAdvisorsModal` opens on `seenAdvisorsTour: false`, doesn't on `true`. `SuggestionChips` shows on empty input, hides on non-empty.
- E2E (deferred to Track J): full first-decision flow with tour shown then dismissed.

---

## Track E — Auth Completeness

**Why:** UX audit P0 #2 (no SSO), P0 #3 (no forgot-password), 1.4 (no email verification). Solo founders are SSO-native; every extra password is friction; password-reset is a day-one essential.

**Audit references:**
- `03-ux-flows.md` Journey 1 friction items 1.2, 1.3, 1.4
- Wave 2 Track A delivered OAuth state hardening — reuse the signed-JWT-with-nonce pattern for OAuth login state

**Deliverables:**

1. **Google OAuth login**
   - Reuse `services/google-calendar.service.ts` OAuth client config (scopes change).
   - New route: `GET /auth/oauth/google` (redirect) + `GET /auth/oauth/google/callback`.
   - New service: `packages/boardroom-ai/server/src/services/google-auth.service.ts`.
   - On callback: lookup-or-create User by email (handle existing-password users gracefully — link account), issue JWT cookie, redirect to `/`.
   - Scopes: `openid email profile`. NOT calendar/gmail — those stay separate consent flows.
   - State protection: use the same signed-JWT + nonce pattern from Wave 2 Track A.
   - Client: `LoginPage.tsx` adds "Continue with Google" button + divider; same for register flow.
   - Env vars: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Document in `.env.example`.

2. **GitHub OAuth login (optional for v1; file as Wave 4 if time-pressed)**
   - Same pattern as Google.
   - GitHub doesn't always expose email — handle the "no public email" case by requesting `user:email` scope and calling `/user/emails`.

3. **Forgot-password flow**
   - Client: `LoginPage.tsx` adds "Forgot password?" link → `/forgot-password` page.
   - Server: `POST /auth/forgot-password` accepts `{email}` → if user exists, generate signed token (15-min TTL), send email with reset link. Always return 200 (don't leak email existence).
   - Server: `POST /auth/reset-password` accepts `{token, newPassword}` → verify token, update User, invalidate any existing sessions for that user (rotate JWT secret per-user OR add `passwordChangedAt` and reject older JWTs).
   - New OmniMind endpoints: `POST /auth/password-reset-token` (issue), `POST /auth/password-reset` (consume).
   - Email transport: use existing Gmail/SMTP setup (check `omnimind-api/src/services/weekly-digest.service.ts` for the existing send pattern).
   - Pages: new `client/src/pages/ForgotPasswordPage.tsx`, `client/src/pages/ResetPasswordPage.tsx`.

4. **Email verification (preferred but deferrable)**
   - On register: create User with `emailVerifiedAt: null`, send verification email with signed token.
   - `GET /auth/verify-email?token=...` → consume token, set `emailVerifiedAt`, redirect to `/`.
   - Gate cost-bearing routes on verified email in prod (or add a soft banner urging verification but don't block).
   - File as a separate commit so it's easy to revert if it slows real signups during dogfooding.

**Acceptance:**
- Click "Continue with Google" → consent → land at `/` authed
- Click "Forgot password" → enter email → check email → click link → reset → log in with new password
- Existing JWT for that user is invalidated post-reset
- Email verification (if shipped): unverified users see banner; cost routes gated only if `REQUIRE_VERIFIED_EMAIL=true` env

**Test plan:**
- Unit: token signing/verifying, expiry handling, idempotency
- Integration (supertest): callback with valid state succeeds, with replayed nonce fails, missing email in profile handled
- Manual: full Google flow against staging Google project (will need OAuth consent screen approval for prod domain)

---

## Track F — Design System Overhaul

**Why:** Aesthetic audit (`04-aesthetic-design-system.md`) 5/10 maturity, ~52 findings. Token foundation is real but execution is intermediate. Launch-day requires Linear / Vercel discipline.

**Audit references:** `04-aesthetic-design-system.md` — all of it. Top-10 designer-callable issues are the priority.

**Deliverables (in this order — each is a discrete commit):**

1. **Adopt lucide-react** — replace ALL 57 inline SVGs across the client.
   - Add `lucide-react` to `boardroom-ai/package.json` deps.
   - Grep for `<svg` in `client/src/` → replace each with the equivalent `lucide-react` icon (`<Pencil />`, `<X />`, `<Check />`, etc.).
   - Standardize size: `className="h-4 w-4"` for inline, `h-5 w-5` for buttons, `h-6 w-6` for headers. Stroke width: lucide default (2) everywhere.
   - Delete any `components/ui/icons/` legacy folder if it exists.

2. **Adopt Radix UI primitives for Dialog, Tooltip, Popover, DropdownMenu**
   - Add `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu` to deps.
   - Replace hand-rolled `Modal.tsx` with a thin wrapper over `Dialog.*` (portal, scroll-lock, ESC, exit animation included).
   - Replace `Tooltip.tsx` with `Tooltip.*` wrapper. Fixes the clipping bug (audit finding).
   - Keep our existing styling — wrap, don't replace, the API surface.
   - Update all callers (the typed-confirm modal from Wave 2 Track B should now use the new Dialog).

3. **Tokenize the radius scale**
   - In `tokens.css`: define `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full` (e.g., 4 / 6 / 8 / 12 / 9999px).
   - In `tailwind.config.*`: map `rounded-sm`/`md`/`lg`/`xl` to these tokens.
   - Grep `rounded-` in `client/src/` → audit each occurrence. The "right" radius for each surface: inputs/buttons = md, cards = lg, badges/pills = full, modals = lg. ~150 replacements expected.

4. **Tabular numerals utility**
   - Add `font-variant-numeric: tabular-nums` to `tokens.css` as `.tabular-nums` (Tailwind already has this).
   - Apply to: `AnimatedCount`, `Progress` percentage, all "X hours ago" / time-ago labels, stat cards in Admin/Dashboard, decision-count badges.
   - Grep for `Date|.toFixed|%` in client renders, audit.

5. **Form-control height alignment**
   - Pick one canonical height: `h-9` (36px). Apply to `Button`, `Input`, `Select` trigger. Audit any custom form components for drift.

6. **Button variant hover correction**
   - Fix `Button` `danger` and `success` variants: hovers must DARKEN, not lighten. In `Button.tsx` CVA config: `hover:bg-red-700` (not `red-400`), `hover:bg-emerald-700` (not `emerald-300`).
   - Add proper dark-mode hover variants too.
   - Tabular check: every variant has discrete `default`, `hover`, `active`, `disabled`, `focus-visible` styles.

7. **Persona color tokens — dark-mode aware**
   - Move hardcoded persona colors from inline classes into `tokens.css` as `--persona-optimist`, `--persona-critic`, etc., with light/dark variants.
   - Update `client/src/lib/persona-colors.ts` (or wherever colors live) to read from tokens.

8. **Sidebar tokens wired**
   - `Sidebar.tsx` uses `text-white/40`, `text-white/60` directly. Replace with the defined `--color-sidebar-foreground{,-muted,-subtle}` tokens. Audit ID: top-10 #4.

9. **Phantom Tailwind classes**
   - Already mostly fixed in Wave 2 Track B (`bg-text-tertiary`, `border-t-line`). Re-grep to confirm zero remain. Add a regex check as part of Track G's lint rule.

10. **Duplicate `EmptyState` resolution**
    - Two implementations exist: `components/ui/EmptyState.tsx` and `components/shared/EmptyState.tsx`. Standardize on `ui/EmptyState.tsx`. Delete the shared one. Update all imports.

11. **Toast pause-on-hover + ARIA**
    - `Toast.tsx`: pause auto-dismiss timer on mouseenter, resume on mouseleave. Add `role="status"` and `aria-live="polite"` for non-error variants; `role="alert"` + `aria-live="assertive"` for error.

12. **Motion language tokens**
    - In `tokens.css`: define `--motion-duration-fast`, `--motion-duration-base`, `--motion-duration-slow` (120 / 200 / 320ms) and `--motion-ease-standard`, `--motion-ease-emphasized`.
    - Reference from Framer Motion `transition` props via a shared `motion.config.ts`.
    - Respect `prefers-reduced-motion` everywhere — global handler that swaps `duration: 0` when set.

13. **`--text-base` ↔ Tailwind `text-base` alignment**
    - Audit finds `--text-base` is 14px but Tailwind default `text-base` is 16px. Decide canonical body size (14px is fine for SaaS density), then either rename the token or override Tailwind's `text-base` to 14px in config. Audit caller sites for surprises.
    - Drop the `font-display` alias if it's identical to `font-sans`.

**Acceptance:**
- Zero inline `<svg>` in `client/src/`
- Zero hand-rolled modal/tooltip/popover
- Single radius scale, used consistently
- All numeric renders are tabular
- No light-mode hover-lightening on destructive actions
- Sidebar uses tokens
- Reduced-motion respected globally
- `pnpm typecheck` clean post-merge

**Test plan:**
- Storybook OR a `/dev/components` test page that renders every primitive in every state (default/hover/active/disabled/error/loading) for visual verification
- Unit tests for `Button`, `Input`, `Select`, `Dialog`, `Tooltip` ARIA roles and keyboard behavior
- Manual contrast check (DevTools axe) on the 11 pages

---

## Track G — Lint & Guardrails

**Why:** Wave 2 fixed 15+ corrupted Tailwind class strings. We need a guardrail so this never ships again. Same for phantom token classes.

**Deliverables:**

1. **ESLint rule: no concatenated Tailwind class strings**
   - Add `eslint-plugin-tailwindcss` to devDeps.
   - Enable `tailwindcss/no-contradicting-classname` and `tailwindcss/classnames-order`.
   - Custom rule (in `eslint.config.js` or new `eslint-rules/no-class-concat.js`): error if a `className` string contains `[a-z]-[a-z]+rounded` or `[a-z]-[a-z]+border` (the patterns that broke us) or matches a known phantom-class regex.

2. **CI grep gate for phantom tokens**
   - Add a step in `.github/workflows/ci.yml`: `! grep -rE 'bg-text-tertiary|border-t-line|border-borderrounded' packages/boardroom-ai/client/src/`
   - Returns non-zero if any found; fails CI.

3. **Husky + lint-staged pre-commit hook (optional)**
   - Run `eslint` only on staged files
   - Adds friction to commits, but stops bad classes at source
   - File as optional — discuss with team before adopting

4. **Prettier + ESLint config audit**
   - Confirm both configs exist and agree
   - Add `pnpm lint` script that runs project-wide
   - Add `lint` job to CI alongside typecheck/test/build

**Acceptance:** intentionally introduce `border-borderrounded-lg` in a file → ESLint flags it → CI fails the PR.

---

## Track H — Phase 0.25 Security Remainders

**Why:** Phase 0.25 in the roadmap had 6 critical security tasks. Wave 2 Track A delivered 0.25.1 (OAuth state) and 0.25.2 (Stripe webhook). The other 4 remain.

**Audit references:**
- `docs/STATUS/PHASE-PROGRESS-TRACKER.md` Phase 0.25 rows
- `02-backend-routes.md` security section
- `06-roadmap-reconciliation.md` Phase 0.25 launch-blocker matrix

**Deliverables:**

1. **Phase 0.25.3 — Mass-assignment Zod on `PATCH /user-profile`**
   - File: `packages/boardroom-ai/server/src/routes/user-profile.routes.ts` (and OmniMind equivalent)
   - Define a strict Zod schema for the allowed update fields. Use `.strict()` so unknown keys are rejected, not silently dropped. Reject attempts to update `id`, `email` (without re-verification flow), `role`, `subscription`, `createdAt`, `deletedAt`, `isAdmin` — the obvious privilege-escalation fields.
   - Add a test: PATCH `{name: 'ok', isAdmin: true}` → 400, isAdmin unchanged in DB.

2. **Phase 0.25.4 — Delete `db-audit.ts` RLS facade + CI grep gate**
   - File: `packages/omnimind-api/src/lib/db-audit.ts` (or wherever the facade lives — read `06-roadmap-reconciliation.md` for pointers)
   - The facade gives the impression of row-level security but doesn't enforce it. Delete the file. Replace any callers with direct Prisma calls that explicitly include `where: {userId, deletedAt: null}` guards.
   - Add a CI grep that fails if anyone references the deleted module name OR uses raw `prisma.X.findMany()` without a `userId`/`tenantId` filter (regex-based; flag false positives in a known-allow list).

3. **Phase 0.25.5 — `ENCRYPTION_KEY` fail-closed across all envs**
   - Files: `packages/omnimind-api/src/lib/crypto.ts`, all `src/lib/env.ts` files
   - Current behavior (per CLAUDE.md memory layer rule): dev passthrough if `ENCRYPTION_KEY` unset. That's a foot-gun — a misconfigured prod-like staging could silently store plaintext.
   - New behavior: fail-closed in all environments EXCEPT when `NODE_ENV=test` OR `ALLOW_PLAINTEXT_DEV=true` is explicitly set. Both should log a loud warning on startup if used.
   - Test: env without key + `NODE_ENV=production` → process exits 1 within 100ms of startup.

4. **Phase 0.25.6 — `MemoryEntry.version` race fix — `If-Match` propagation in BoardRoom client**
   - File: `packages/boardroom-ai/server/src/services/omnimind-client.ts`
   - `updateMemory` currently doesn't send a version header. OmniMind already supports `If-Match: <version>` and returns 409 on conflict (per Roadmap audit finding).
   - Add `version` parameter to `updateMemory(userId, memoryId, body, version)`. Send as `If-Match` header. On 409, surface to caller (don't silently retry).
   - Update all callers in BoardRoom to pass the version they read (typically from the prior GET response).

5. **Bonus — token meter + per-user cost cap**
   - `docs/STATUS/PHASE-PROGRESS-TRACKER.md` Phase 0.25 unnumbered items: "Per-tenant token meter (`User.tokensUsedToday`) — initial cap"
   - Schema: add `User.tokensUsedToday: Int @default(0)`, `User.tokenMeterResetAt: DateTime`.
   - Middleware: on each LLM-cost route, check meter; if `tokensUsedToday > LIMIT`, return 429 with quota error. Reset daily via existing cron infrastructure.
   - Env: `DAILY_TOKEN_LIMIT_PER_USER` (default 200k for launch).
   - File as a separate commit so it's gateable behind a `TOKEN_METER_ENABLED` env flag for initial rollout.

**Acceptance:**
- Mass-assignment attempt rejected with 400, no privilege escalation possible
- `db-audit.ts` deleted, no broken imports, CI gate present
- Prod without ENCRYPTION_KEY fails to start
- Concurrent memory updates produce 409 from OmniMind, surfaced to user
- Token-budget exhaustion produces 429 with clear quota message

**Test plan:** supertest for each route + boundary fuzz on the Zod schemas.

---

## Track I — Pre-Existing TS Errors

**Why:** Three pre-existing TS errors block root turbo commands (C-FU-01) and clutter CI logs. Should land FIRST so Track G can wire `tsc --noEmit` into CI cleanly.

**Errors to fix:**

1. **`packages/shared/src/utils/validation-helpers.ts`** — 4 TS errors introduced commit `3e01bc2` (per C-FU-01). Read the file, identify the failure mode (likely Zod v3 → v4 surface changes that the partial fix from `MCP Phase 1` didn't cover). Patch each.

2. **`packages/boardroom-ai/server/src/services/omnimind-client.ts:99`** — `AbortSignal.onabort` overload mismatch in `fetch`. The undici `AbortSignal` and the DOM `AbortSignal` types diverge.
   - Likely fix: cast `signal as AbortSignal` at the boundary, OR upgrade `@types/node` if there's a newer version that aligns the lib types.
   - Alternative: use a small typed-wrapper helper that takes the modern `AbortController` and produces a `RequestInit`-compatible signal.

3. **`packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts:74`** — same root cause as #2.

**Acceptance:**
- `pnpm -w typecheck` (workspace root, via turbo) produces zero errors
- CI workflow can be simplified to use root turbo commands (revert Track C's C-FU-01 workaround)
- `pnpm build` succeeds at workspace root

**Effort:** Half a day. Should be the first track dispatched.

---

## Track J — Test Coverage Expansion + Endpoint Sweep

**Why:** Test audit says ~94 server endpoints have zero tests, orchestrator was untested (Wave 2 added 7 cases), the 7 user journeys lack E2E coverage. Launch-day requires confidence.

**Audit references:**
- `05-test-coverage.md` — primary
- `01-feature-wiring.md` dead-endpoint list

**Deliverables:**

1. **Supertest coverage on all BoardRoom server routes**
   - For each route file in `packages/boardroom-ai/server/src/routes/`, add a `.test.ts` sibling.
   - Standard test per route: unauthenticated → 401, authenticated happy path → 200, validation failure → 400, downstream OmniMind error → propagates with correct status.
   - Mock `omnimind-client` at the boundary. Do NOT spin up a real DB.
   - Aim for 70%+ statement coverage on routes/.

2. **Service-layer tests for high-risk services**
   - `extraction.service.ts`, `stripe.service.ts` (idempotency dedup — covers the SUB-09 case skipped from the webhook tests), `google-calendar.service.ts` OAuth state signing (replay rejection), `gmail.service.ts` prompt-loading path, `omnimind-client.ts` resilience (timeout, retry, breaker — there's an `omnimind-seam.test.ts` already; extend it).

3. **Delete or test the orphaned endpoints**
   - Per Wiring audit, 7 server endpoints have no client caller: `POST /sessions/:id/plan`, `/questionnaire`, `/questionnaire/answers`, `/extract-memories`, `/confirm-memories`, `GET /cortex/memo/history`, `GET /outcome-reviews` (non-`/pending`).
   - For each: either (a) wire the missing client caller (if the feature was meant to ship) OR (b) delete the route and any client API types that refer to it. Document the decision per route in commit messages.

4. **Playwright setup + 7 journey E2E tests**
   - Add `@playwright/test` to devDeps at workspace root.
   - Config: `playwright.config.ts` at root. Tests in `tests/e2e/playwright/`. Run against `pnpm dev` (or a `pnpm preview` build).
   - 7 flows (one test file each):
     - signup-onboarding-first-decision
     - decision-session-streaming-and-export
     - memory-crud
     - people-directory-crud
     - integrations-oauth (mock the IdP)
     - billing-checkout-and-portal
     - admin-tab-access-control (negative: non-admin gets 403; positive: admin sees all 6 tabs)
   - Add Playwright job to CI (matrix: chromium only for v1).

5. **Eval baselines refresh**
   - `eval/baselines/` and `eval/results/` are empty per audit. Hand-label 35 queries (or generate via Claude) and commit as the retrieval baseline.
   - Wire `pnpm run eval:retrieval` into the pre-deploy script (`scripts/pre-deploy-check.sh`).

6. **Coverage reporter**
   - Add `c8` or `@vitest/coverage-v8` to devDeps.
   - `pnpm test:coverage` script at workspace root.
   - CI uploads coverage as an artifact (no enforcement threshold for v1 — establish baseline first).

**Acceptance:**
- Server route coverage ≥70% statements
- Orphaned endpoints decided (kept-and-tested OR deleted)
- 7 Playwright journey tests pass against a clean signup
- Eval baseline committed and runnable

**Effort:** 4–5 days. Largest track.

---

## Cross-track conventions

- **Branch model:** each track runs in a worktree (`isolation: "worktree"`). When done, push the worktree branch; the merging session integrates into `claude/review-project-status-VgaJ0`.
- **Commits:** one logical fix per commit. Reference audit IDs in the commit message footer.
- **Tests:** every fix must come with a test, OR a `.skip` with a reason. No untested code.
- **No new dependencies without justification.** When adding (lucide, Radix, Playwright, etc.), confirm bundle-size impact in the PR description.
- **Follow-ups:** if a fix is bigger than expected, ship a minimum viable version and file follow-ups in `docs/_audits/2026-05-15-launch-prep/track-{letter}-followups.md`.
- **CLAUDE.md compliance:** every change must respect the Critical Rules and Anti-patterns in the root and `.claude/` CLAUDE.md.
- **Don't re-do Wave 2 work.** Re-read Wave 2 follow-ups before starting.
- **Pre-existing errors:** if Track I has shipped, root `pnpm typecheck` must remain green. If Track I has NOT shipped, use per-package commands and don't enforce typecheck on the AbortSignal lines.

## Verification gates (per track, before push)

1. `pnpm typecheck` clean (after Track I — per-package before Track I)
2. `pnpm test` green (all `.skip`s justified with a TODO)
3. New routes/services have tests
4. No regressions in Wave 2 test suites (157 passing as of merge `5fb1894`)
5. CHANGELOG.md updated with a Wave 3 Track X entry
6. PHASE-PROGRESS-TRACKER.md updated to mark Phase 0.25.3/4/5/6 done (Track H)

## End-state of Wave 3

- Launch-day visual + behavioral polish bar met
- Auth complete (SSO, password reset, optionally email verification)
- Phase 0.25 closed
- 7 Playwright E2E journeys covering the product
- ~70% statement coverage on BoardRoom server
- Design system runs on lucide + Radix + tokens; zero hand-rolled primitives
- ESLint gates protect against the class-string and phantom-token bugs
- Pre-existing tech debt cleared

After Wave 3 the product is genuinely ready for HN front-page traffic. Anything remaining is Wave 4: collaboration / multi-user / scale.

---

**End of dev prompt.** Hand this file to any agent or split across worktrees. Each track has enough context to execute independently.
