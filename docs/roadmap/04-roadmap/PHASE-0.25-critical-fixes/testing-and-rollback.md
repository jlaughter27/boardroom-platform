# Phase 0.25 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 0.25.1 OAuth state | New unit tests in `oauth-state.test.ts` pass: round-trip, tampered, expired, replay. End-to-end: complete a Google Calendar OAuth flow successfully; then forge a callback with a known userId in the state and confirm 401. |
| 0.25.2 Stripe webhook | `stripe listen --forward-to localhost:3001/subscription/webhook` shows 200 for valid signature, 400 for invalid. Replay the same `event.id` twice → second returns 200 immediately (no double-write). Live test: trigger `stripe trigger checkout.session.completed` against staging; verify a `Subscription` row created in OmniMind. |
| 0.25.3 user-profile Zod | `curl -X PATCH /user-profile -d '{"junk":"x","onboardingComplete":true}'` returns 422 with field-level errors. Valid PATCH still succeeds. |
| 0.25.4 RLS facade deletion | `find packages -name "db-audit.ts"` returns empty. `grep -r "getPrismaClient\|attachRLSClient" packages/ --include="*.ts"` returns empty. `npm run typecheck && npm run test` green. `scripts/check-rls-discipline.sh` exits 0. |
| 0.25.5 ENCRYPTION_KEY | `unset ENCRYPTION_KEY && npm run dev -w omnimind-api` exits non-zero with FATAL log. With key set, encrypt → decrypt round-trip works. Corrupted ciphertext throws (test asserts). |
| 0.25.6 version race | New tests in `memory.service.test.ts`: stale `If-Match` returns 409; missing returns 428; two-parallel test with vitest's `Promise.allSettled` — exactly one resolves, one rejects with 409. |

## Smoke test after deploy

1. **OAuth:** disconnect Google Calendar in BoardRoom UI; reconnect; verify it works end-to-end.
2. **Stripe:** in Stripe dashboard, find a recent test webhook delivery to the staging URL — confirm 200 status (it was 400 before this phase).
3. **Profile PATCH:** in BoardRoom UI, update a profile field — confirm it saves. Then via curl with extra junk fields → 422.
4. **OmniMind health:** `/health` returns 200 (verifies the service started, which means `ENCRYPTION_KEY` is set in Railway).
5. **Memory update race:** open two browser tabs to the same memory editor; edit both; save first; save second — second tab should show "memory was updated by another session, refresh to merge."

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 0.25.1 OAuth state | `git revert <commit>`. The unsigned-state behavior returns. Document that integrations are again exposed; this is only acceptable as an emergency revert (keep the rollback window <1 hour). | 5 min |
| 0.25.2 Stripe webhook | `git revert <commit>`. Webhook returns to broken state — subscriptions stop transitioning. Acceptable only if the new code introduced a worse bug (e.g., crash loop). Run the back-fill script again afterward. | 10 min |
| 0.25.3 user-profile Zod | `git revert <commit>`. Mass-assignment hole returns. No data loss in the meantime since validation is read-time. | 2 min |
| 0.25.4 RLS facade | `git revert <commit>` brings back `db-audit.ts` (still unused, still false). Better to fix forward than revert. | 5 min |
| 0.25.5 ENCRYPTION_KEY | `git revert <commit>`. Service comes back up if `ENCRYPTION_KEY` was missing. WARNING: any OAuth tokens written during the rollback window are plaintext — invalidate and re-auth all affected users. | 5 min |
| 0.25.6 version race | `git revert <commit>`. The race comes back. BoardRoom client also needs to revert its `If-Match` sending. | 10 min |

## Special concerns

### OAuth nonce store on restart

The `oauth-state.ts` nonce store is in-memory. A Railway redeploy mid-OAuth-flow loses pending nonces — the user's callback returns 401, and they must restart the OAuth flow. This is acceptable UX for now (rare event, clear failure mode), but document it in `06-risks-and-mitigations/RISK-REGISTER.md`. Real fix is Redis (Phase 13 territory).

### Stripe back-fill

Before deploying 0.25.2, run `scripts/backfill-stripe-subscriptions.ts` against staging first. If staging diverges by more than a few rows, the prod back-fill could be larger than expected. Schedule the prod run during a low-traffic window.

### Memory client breaking change

After 0.25.6 deploys, any cached BoardRoom client that doesn't yet send `If-Match` will get 428s. Roll the BoardRoom side first (it gracefully sends `If-Match`) THEN the OmniMind side. If both ship in the same Railway push, there's a brief window where the OmniMind side requires a header the BoardRoom hasn't been redeployed to send yet. Mitigation: deploy BoardRoom 5 minutes before OmniMind, or accept a short 4xx blip.

## Don't ship unless

- All six new test files pass
- `npm run typecheck && npm run test` green across all packages
- `scripts/check-rls-discipline.sh` exits 0
- Stripe CLI test webhook returns 200 in local dev
- A real OAuth flow completes end-to-end against staging
- `ENCRYPTION_KEY` is set in production Railway env
