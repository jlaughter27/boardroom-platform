# Phase 0.25 — Critical Security and Data-Integrity Fixes

**Time budget:** 3-5 days (one focused work week)
**Confidence:** HIGH (every fix is small and isolated)
**Owner:** Solo dev
**Blast radius:** Medium — touches auth, billing, and the database layer; each fix is small but production-facing

---

## What this phase is

A tightly-scoped wave of CRITICAL and HIGH security/data-integrity fixes pulled from the wave-1 audits (`docs/research/omnimind-roadmap-2026/wave1-audit/security-audit.md` and `data-integrity-audit.md`). These are NOT speculative hardening — every item is an exploitable hole or a real data-loss path that exists in production today.

Six fixes:

1. **OAuth state hijack (security A1)** — sign the OAuth `state` parameter with a JWT containing `userId + nonce + exp`; verify on callback; move callback routes above the auth wall.
2. **Stripe webhook double-fix (security A2)** — mount webhook before `express.json()` and before the auth wall; use `express.raw()` for signature verification.
3. **Mass-assignment on `PATCH /user-profile` (security A3)** — add Zod `.strict()` schema mirroring the BoardRoom-side `UpdateProfileSchema`.
4. **RLS facade decision (security A4)** — DELETE `db-audit.ts`. The `getPrismaClient(userId)` proxy is never imported and gives false confidence. Real Postgres RLS is a Phase 4 prerequisite.
5. **`ENCRYPTION_KEY` fail-closed (security A5)** — require `ENCRYPTION_KEY` in ALL environments. Crash on startup if missing. Remove the silent decrypt-failure passthrough.
6. **`MemoryEntry.version` race fix (data B1)** — add `where: { id, version }` to `update()`; require `If-Match: <version>` header; return 409 on mismatch.

## Why now

Three of these (A1, A2, A5) are **actively exploitable** or actively losing money today:

- A1: any user can attach their own Google tokens to another user's account.
- A2: Stripe webhooks are silently failing — subscriptions never transition `TRIALING → ACTIVE`. Paying users may be falling off as `currentPeriodEnd` lapses with no renewal write.
- A5: a single `NODE_ENV` typo on a Railway redeploy → OAuth tokens written to Postgres in plaintext.

The other three (A3, A4, B1) are not actively burning right now but are landmines that get harder to fix once the schema starts moving in Phase 1.

This phase **must ship before Phase 1**. Phase 1 adds new schema (entity tables) and new migration discipline. Doing that on top of a broken Stripe webhook and a phantom RLS layer is shipping more debt onto a leaky foundation.

## Prereqs

- Phase 0 complete (clean baseline; log drain wired so we can see if the Stripe webhook starts working).

## Exit criteria

| Criterion | How to verify |
|---|---|
| OAuth state is signed JWT with nonce + 5min exp | Forging a callback with someone else's `state` returns 401 |
| Callback routes mounted above auth wall | `curl /calendar/callback` (no cookie) reaches the handler, not the auth middleware |
| Stripe webhook receives raw body | A test webhook from Stripe CLI succeeds signature verification (200 OK) |
| Stripe webhook mounted before auth wall | `curl -X POST /subscription/webhook` (no cookie) reaches the handler |
| `PATCH /user-profile` rejects unknown keys with 422 | `curl -X PATCH ... -d '{"userId":"other","onboardingComplete":true,"junk":"x"}'` returns 422 |
| `db-audit.ts` deleted | `ls packages/omnimind-api/src/lib/db-audit.ts` returns "no such file" |
| Service crashes if `ENCRYPTION_KEY` missing in ANY env | `unset ENCRYPTION_KEY && npm run dev` exits non-zero with a fatal log |
| `decrypt()` throws on failure (no silent passthrough) | Unit test for `crypto.ts` covers a corrupted ciphertext case and expects throw |
| `updateMemory` returns 409 on stale version | Two parallel PATCHes with same `If-Match` → second returns 409 |
| `npm run test` green | Exit 0 with new tests included |

## Dependencies

- **Upstream:** Phase 0 (log drain helps verify Stripe webhook is now firing).
- **Downstream blocker:** Phase 1 should not start until A1/A2/A5 are fixed. Phase 4 (Collaboration, future) is hard-blocked until A4 (real RLS) ships — but A4 in this phase is the *facade deletion*, not real RLS. Real RLS lives in a future Phase 4 prerequisite.

## Time budget detail

| Task | Hours |
|---|---|
| OAuth state signing + callback re-mounting (A1) | 3 |
| Stripe webhook fix + back-fill subscription state (A2) | 3 |
| Mass-assignment Zod (A3) | 0.5 |
| RLS facade deletion (A4) | 1 |
| `ENCRYPTION_KEY` fail-closed (A5) | 1 |
| `MemoryEntry.version` race fix (B1) | 2 |
| Tests for each fix | 4 |
| Verify + deploy + smoke test | 1.5 |
| **Total** | **~16 hours / 3 focused days** |

## Risks accepted

- **A1 mitigation requires a nonce store.** We use an in-memory `Map<userId, {nonce, expires}>` since this phase predates Redis. Loss-on-restart means an attacker has a tiny window after every redeploy where signed state is forgeable. Risk register entry: `06-risks-and-mitigations/RISK-REGISTER.md` notes this is acceptable until horizontal scaling.
- **A4 deletion (not real RLS) is a deliberate scope cut.** Per CLAUDE.md service boundaries and the audit's recommendation, deleting the facade is strictly better than the current state. Real Postgres RLS is mandatory before Phase 4 (Collaboration / multi-user rooms) ever ships, but in this phase the route-level `findFirst({ where: { id, userId, deletedAt: null } })` discipline (verified by the audit as universally applied) IS the security boundary.
- **B1 introduces a new client contract.** Adding `If-Match` is a small breaking change for any external consumer. There are none today (BoardRoom is the only OmniMind client) but it must be documented in `docs/contracts/`.

## Cross-references

- Security findings: `docs/research/omnimind-roadmap-2026/wave1-audit/security-audit.md` §A1-A5
- Data findings: `docs/research/omnimind-roadmap-2026/wave1-audit/data-integrity-audit.md` §A4-B1
- Risk acceptance: `06-risks-and-mitigations/RISK-REGISTER.md` (RLS facade, in-memory nonce store)
- Hard prereq for Phase 1 schema work
- Hard prereq for any future Phase 4 multi-user

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
