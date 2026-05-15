# Track D — Persona & Mode Education — Follow-ups

**Audit ID:** UX-#2-edu
**Wave:** 3
**Shipped:** 2026-05-15

This document captures the follow-ups deliberately deferred from Track D's
launch-day scope. None are launch-blocking.

---

## 1. Move `seenAdvisorsTour` flag to OmniMind UserProfile (planned)

**Current state:** The "Meet your advisors" first-run tour persists its
dismissal in `localStorage` under the key `boardroom:seenAdvisorsTour`.
This is documented as a launch-day stand-in in
`MeetAdvisorsModal.tsx` and `DecisionSessionPage.tsx`.

**Why it matters:** Today, users see the tour again every time they log in on
a new device or clear their browser data. The "Don't show again" promise is
only honoured per-browser.

**Proposed solution:**

1. Add a `seenAdvisorsTour: Boolean @default(false)` (or `tourSeenAt: DateTime?`)
   field to the `UserProfile` model in `packages/omnimind-api/prisma/schema.prisma`.
2. Add `PATCH /profile` support (or extend the existing patch endpoint) to
   accept this flag.
3. In `MeetAdvisorsModal`, replace the `localStorage` read/write with a hook
   that reads from `useProfileStore` and dispatches a server PATCH on dismiss.
4. Keep `localStorage` as an offline-first fallback / optimistic UI cache.

**Owner:** OmniMind track.
**Effort:** ~0.5 day.

---

## 2. Orphan personas — both are actually wired (no work needed)

The Wave 3 spec asked Track D to verify two "orphan personas" flagged by the
roadmap audit. Investigation outcome:

- `docs/prompts/commitment-extraction.system.md` → **wired**.
  Loaded by `packages/boardroom-ai/server/src/services/commitment-tracker.ts:29`
  via `loadSystemPrompt('commitment-extraction')`. The commitment-tracker is
  invoked by the decision-session pipeline.
- `docs/prompts/email-extractor.system.md` → **wired**.
  Loaded by `packages/boardroom-ai/server/src/services/gmail.service.ts:143`
  via a direct `readFileSync` of the prompt file (not through `loadSystemPrompt`,
  which is why the roadmap audit's grep missed it).

**Recommendation:** No code action. The audit finding was a false positive.
Consider tightening the orphan-persona check in
`docs/_audits/.../06-roadmap-reconciliation.md` to also scan for
`readFileSync(.*\.system\.md)`.

**Owner:** Track J (test coverage / dead-endpoint sweep) can sweep this when
it runs.
**Effort:** trivial.

---

## 3. Tooltip primitive moved to Radix mid-Track-D (already done)

The Wave 3 spec assumed Track F's Radix Tooltip migration was still pending
while Track D worked. By the time Track D wired its persona/mode tooltips,
Track F had already swapped `components/ui/Tooltip.tsx` to a Radix-backed
wrapper. Track D's call-sites are compatible with the new API.

**No action required.** Recorded here for completeness.

---

## 4. Sidebar "advisor legend" not yet shipped (deferred)

The Wave 3 spec mentioned "PersonaCard + sidebar legend" tooltips. The
PersonaCard tooltips ship in this track. A dedicated "advisor legend" sidebar
component does not currently exist in the codebase — the persona grid IS the
de-facto legend during a decision session.

**Recommendation:** If user research shows confusion persists post-launch
(specifically: users hover personas but still don't understand them), add a
collapsible "Who are these advisors?" sidebar on the decision-session page
that reuses `PERSONA_META` and the `MeetAdvisorsModal` card layout.

**Owner:** Future UX iteration (post-launch).
**Effort:** ~0.5 day.

---

## 5. SuggestionChips localisation / personalisation (deferred)

The current six sample questions in `SAMPLE_DECISION_QUESTIONS` are static
and English-only. Two reasonable next steps once we have data:

- **Personalise** chips based on the user's recent goals (pulled from
  OmniMind). A user whose active goals are all hiring-related should see
  hiring questions first.
- **Localise** chips when we ship i18n.

**Owner:** Phase 2.5+ once OmniMind goal context is exposed to the client.
**Effort:** ~1 day for personalisation, ~plus i18n track.

---

## 6. Persona tooltip on the synthesis card (deferred)

The synthesis card (`SynthesisPanel.tsx`) displays the CEO output but does
not currently surface a CEO persona tooltip. The Wave 3 audit (issue 2.13)
specifically calls out that users don't know "why there is a CEO" or what
makes synthesis different from individual persona outputs.

Track D shipped the tooltip on the PersonaCard which covers the analyst grid
and the CEO when CEO appears as a card. The synthesis-panel CEO label is a
distinct surface and was out of scope for this track.

**Owner:** Track D follow-up or Track F polish pass.
**Effort:** ~30 minutes.
