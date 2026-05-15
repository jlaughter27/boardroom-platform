# Wave 2 Track B — Follow-up TODOs

Generated as a byproduct of shipping the four Track B P0 fixes (a129640,
44a4c4a, cfce9ac, 3236dd6). These are deliberately scoped OUT of the launch-day
fixes to keep the surface area small. Each item is either a hardening pass on
what shipped or a known limitation explicitly accepted by the task spec.

## F-001 / SESS-03 — Decision Session Persistence
- [ ] **Re-fetch on dispatch start, not just cache hit.** The current cache may
      hold a snapshot from a prior process if two BoardRoom instances scale up.
      Right now we're single-instance, so this is fine — but if/when we scale
      out, the dispatch route should re-hydrate from OmniMind on cache hit too.
- [ ] **Persist questionnaire enrichment without rewriting `question`.** The
      route still mutates `session.question` in place; ideally we'd store
      `enrichedQuestion` separately so the original survives audit. (F-121)
- [ ] **Garbage-collect the in-memory cache aggressively under memory
      pressure.** Currently capped at 10k entries with a 1h idle eviction.
      Acceptable for launch; revisit at scale.
- [ ] **DecisionSession schema migration**: the schema now has `mode`,
      `deletedAt`, `updatedAt`. `prisma db push` on prod will add these as
      nullable / auto-managed. If the table has existing rows, the `updatedAt`
      backfill may need a manual `UPDATE ... SET updated_at = created_at`.
- [ ] **List endpoint pagination**: BoardRoom GET /sessions accepts limit/offset
      but the client (DecisionLab) doesn't yet paginate. Add a "Load more"
      surface or revert to a fixed 20.
- [ ] **Phase 0.25.6 version-race**: still unfixed. Did not fall out naturally.

## F-005 — Tailwind typos
- [ ] **Add a lint rule.** A simple grep-based pre-commit hook (or a custom
      Tailwind safelist) would have caught all of these. Without it the same
      class of bug will recur.
- [ ] **Sweep remaining design-token usages.** The audit calls out other
      phantom tokens in 03-ux-flows.md and 04-aesthetic-design-system.md;
      those are Wave 3.

## F-030 — Dashboard "Create a Goal"
- [ ] **Surface `createGoal` errors via toast.** The entities store's
      `createGoal` already exposes an `error` state; the modal closes
      optimistically. If validation fails, the user gets no feedback.
- [ ] **After successful goal creation, dispatch a refetch.** The widget
      grid re-evaluates `hasWidgetData` only on entity-store changes; verify
      the modal-closing happens AFTER the store has been updated, not before.

## F-100 — Account deletion
- [ ] **30-day hard-purge job.** Right now soft-delete sets `deletedAt`,
      anonymizes the email, and zeroes the password hash, but doesn't cascade
      to: memories, decisions, goals, projects, tasks, people, commitments,
      cortex artifacts. Add a daily node-cron job in omnimind-api that
      hard-deletes all rows for users with `deletedAt < NOW() - 30 days`.
      (CASCADE on User PK handles team memberships, sessions, decisionSessions,
      profile — but NOT memories/entities, which are merely scoped by
      `userId` without an FK.)
- [ ] **Allow account-recovery window.** Add a server-side flag check so support
      can flip `deletedAt = NULL` within 30 days and restore the account.
- [ ] **Audit log row for every account deletion.** Currently we only log to
      stdout; a tamper-evident audit row (admin-readable) would be ideal.
- [ ] **Re-issue cookie clear on the BoardRoom redirect.** The current client
      does `window.location.href = '/login'`; the server already
      `res.clearCookie`d, but a defensive client-side cleanup of any Zustand
      state would be cleaner than relying on the hard reload.
- [ ] **Stripe subscription cancellation.** Deletion does NOT cancel an active
      Stripe subscription. Charges will continue until card expiry or chargeback.
      Add a `stripe.subscriptions.cancel()` call to the delete pipeline.

---

Filed: 2026-05-15.
