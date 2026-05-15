# UX Flow Audit — BoardRoom AI

**Date:** 2026-05-15
**Auditor:** Claude (Opus 4.7) — code-only walkthrough
**Method:** Reconstruction from React source. App was not run.
**Target bar:** Linear / Vercel / Notion polish. Show HN front-page traffic.

---

## Executive Summary

**Overall UX maturity: 5.5 / 10.**

The product has tasteful brand work (warm gold, custom illustrations, motion language, persona color system), a real Cmd+K palette wired with cmdk, a thoughtful onboarding bootstrap path (mega-prompt → paste/upload/voice), and emotional moments (confetti celebration, AI nudges). That's real, intentional craft. Not a hackathon UI.

But there are launch-blocking defects. The most damaging is a **systemic Tailwind class-concatenation bug** (`border-borderrounded-lg`, `border-borderrounded-md`, `border-borderrounded`, `border-border-mx-6`) that appears in **at least 9 files** across critical paths — the main decision input textarea, the memory search bar, the memory filter chips, every onboarding free-text step, the custom persona editor, the memory entity linker. These classes are invalid Tailwind. The intended border/radius is silently missing, leaving inputs visually unfinished. A reviewer who pulls up `/decisions/new` or `/memory` will see broken inputs in 5 seconds.

The second systemic issue is **education debt**. The product is built around a 7-persona system whose value depends entirely on the user understanding what each persona does. The persona names appear; nothing explains them. There is no first-run tooltip, no "why these advisors?" link, no demo session, no sample question. A new user landing on `/decisions/new` is shown a textarea and a 6-mode selector with no examples. The product is mute about itself.

The third is **inconsistency**. EmptyState exists in two parallel implementations (`components/shared/EmptyState.tsx` and `components/ui/EmptyState.tsx`). Two separate filter-bar styles inside Decision Lab vs Memory Explorer. Color systems mix `text-info`, `text-success`, `bg-green-500`, `text-red-600`, `bg-red-600/20` — half via tokens, half via raw Tailwind colors, which means dark/light mode parity is luck-of-the-draw. The same product, depending on which page you're on, feels like it was built by three different people.

**Top 3 systemic issues**

1. **Broken Tailwind classes in 9+ critical files.** Inputs in the decision flow, memory search, onboarding, and personas render without their intended borders/radius. Visible bug on first contact.
2. **Zero persona/mode education.** The core value prop — 7 distinct AI advisors — is asserted but never demonstrated. No tooltips, no "what does Critic do?" affordances, no sample decisions, no demo mode.
3. **Color/token inconsistency + duplicate components.** Two EmptyState components, raw Tailwind colors mixed with design tokens, two confidence-color scales (`HIGH/MEDIUM/LOW/SPECULATIVE` mapped to `success/warning/warning/destructive` — LOW and MEDIUM share a color), two filter-bar visual languages.

---

## Journey 1 — Signup → First Session

### Walkthrough narrative

A first-time visitor lands at `/login`. The marketing panel on the left is genuinely strong: warm-gold gradient blobs, a clear hero ("Your AI-powered executive team"), three feature bullets with icons, three rotating testimonials with progress dots. Brand work here is Linear-tier. The form column on the right is clean. Toggle to register, fill name/email/password (8-char min), click "Get started."

You land on `/onboarding`. The header says "Welcome to BoardRoom — Let's set up your AI advisory board in a few minutes." Step 0 is the optional **Bootstrap step** — a clever "copy mega-prompt → paste into ChatGPT → bring back the response" idea. The user can upload a .md/.txt/.pdf, paste text, record audio, or skip. There's an `Optional · 2 min` pill, a collapsible prompt preview, and a clear `Skip · 5 questions, 3 minutes` escape hatch. This is one of the best moments in the product.

Skip lands you in step 1 of 5 (AboutYou → Goals → Projects → People → Context). Steps animate left/right via Framer Motion. Each step shows `Step N of 5`. Goals and Projects offer LLM extraction. Final step posts the completion call, then a **confetti CelebrationScreen** with 25 warm-gold particles plays for 2 seconds before navigating to `/`.

The dashboard greets you with `Good morning, Josh — All systems nominal`, three primary onboarding cards (Create a Goal / Start a Decision / Add Team Members), and your widget grid (empty state).

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 1.1 | No "what is BoardRoom" explainer on `/login`. Hero copy is poetic ("AI-powered executive team") but a stranger doesn't know if this is therapy, project management, or AI chat. | P1 |
| 1.2 | Register flow asks only name/email/password — no SSO (Google, GitHub, Apple). Solo founders are SSO-native. Every extra password is friction. | P0 |
| 1.3 | No email verification step shown. Users go straight from register → onboarding. Means typo'd emails get accounts. | P1 |
| 1.4 | No forgot-password flow visible in `LoginPage.tsx`. Search confirms: no `forgot` route exists. Day-one defect. | P0 |
| 1.5 | Mega-prompt bootstrap is clever but unexplained. The user reads `Copy this prompt → paste into ChatGPT → bring response back` and has no idea why this works or what they get back. Needs a 1-sentence "this generates a structured briefing about you that pre-fills the next 5 steps." | P1 |
| 1.6 | Voice recorder offered with no preview/playback (depends on VoiceRecorder impl — needs verification). User clicks record, talks, has no idea what they sent. | P1 |
| 1.7 | Onboarding steps are technically skippable (`onSkip={handleNext}` on Goals/Projects/People) but the UI offers no visible "Skip" affordance other than what WizardStep renders — friction depends on WizardStep design. The mental model "every step has a skip" isn't taught. | P2 |
| 1.8 | Validation: only `AboutYou` blocks Next (`nextDisabled={!data.role.trim()}`). Goals/Projects/People/Context can be empty and produce an "advisory board" with literally zero context. The system should warn at completion: "You haven't given us anything — your advisors will be generic." | P1 |
| 1.9 | Celebration screen redirects after 2 seconds with no way to slow it down. If the user wants to re-read "You're all set!" it's already gone. Add a "Take me there" button as the active interaction rather than a forced timer. | P2 |
| 1.10 | Dashboard greeting computes `firstName = user?.name?.split(' ')[0] ?? 'there'` — fine — but `subtitle = 'All systems nominal'` is the default for a brand-new user. Reads as cold/IT-ops. First-day subtitle should be "Welcome — start by analyzing your first decision" or similar. | P2 |
| 1.11 | The three onboarding cards on the empty dashboard point at `/` (Create a Goal), `/decisions` (Start a Decision), `/people` (Add Team Members). "Create a Goal" routes to `/` — i.e. the page you're already on. Dead link. | P0 |
| 1.12 | Bootstrap path uses `navigator.clipboard.writeText`; falls back to `document.execCommand('copy')` (deprecated). Modern browsers in non-HTTPS contexts will still fail silently. No error toast on copy fail. | P2 |
| 1.13 | `OnboardingGate` re-fetches user profile on every protected-route mount with no caching — flash-of-loading-spinner every time the user navigates. | P1 |
| 1.14 | Onboarding has no "step indicator" / progress bar at the page level — it relies on `Step N of 5` text in WizardStep. There's no "you've come this far" visual. | P2 |

### Missing-states table

| State | Status | Note |
|---|---|---|
| Empty (no widgets) | Yes | 3 onboarding cards, but "Create a Goal" routes nowhere useful |
| Loading | Skeleton (`DashboardSkeleton`) | Good fidelity |
| Error | `ErrorBanner` on entities/cortex errors | OK |
| Mobile | Layout collapses to single column | OK but not validated visually |
| 404 register email | Not visible | Likely server toast only |
| Captcha / rate-limit | Not visible | Bot-flood risk on launch |

### Recommendations

- **(P0)** Add Google/GitHub OAuth. Solo founders won't make passwords.
- **(P0)** Add forgot-password flow + email verification.
- **(P0)** Fix "Create a Goal" dead link on empty dashboard — either build the goal-creation modal or remove the card.
- **(P1)** Add a 60-second product video or interactive demo to `/login` left panel for first-time visitors (toggle below the testimonials).
- **(P1)** Bootstrap step: add a 1-sentence "Why this works" tooltip near the copy button.
- **(P1)** Pre-completion review screen in onboarding: "You shared 0 goals / 2 projects / 0 people. Add more for sharper advice, or finish." This is the moment to upsell context.
- **(P2)** First-day dashboard subtitle should be context-aware: "Your advisory board is ready — start with a decision."

---

## Journey 2 — First Decision Session

### Walkthrough narrative

User clicks "Decisions" in the sidebar. `DecisionLabPage` loads, shows `0 decisions analyzed`, an empty-state illustration ("No decisions yet"), and a primary `Start Your First Decision` button. Click → `/decisions/new`.

`DecisionSessionPage` in phase `input` shows: centered "New Decision" heading, subtitle "Describe your question, choose a mode, then analyze," a textarea (`What decision are you wrestling with?`), a 6-card mode selector (Decide/StressTest/Plan/Clarify/Review/QuickTake with emoji), and two buttons: `Analyze` (primary) and `Check Clarity` (ghost).

The user types a question, picks Decide, clicks Analyze. The page transitions to phase `personas`: question shown at top with mode badge, persona grid (3 cols on lg) with 6 cards. Each persona card cycles through Waiting (3 pulsing dots + "Thinking…") → Streaming (text with a blinking caret + persona name + Haiku/Sonnet badge) → Complete (situation reading, key assumptions, analysis, recommendation, uncertainties, confidence bar).

When all personas finish, a `✨ Synthesize with CEO` button appears (centered, scaled-in). Click → CEO synthesis streams in. After synthesis, an action bar (Export, New Decision, Run Simulation) appears at the bottom, plus an AI nudge suggesting simulation.

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 2.1 | **CRITICAL: Decision input textarea uses broken class `border-borderrounded-lg`** (DecisionSessionPage:138). This is the single most important input in the product. The intended `rounded-lg` and `border-border` are both missing — the textarea appears unstyled. | P0 |
| 2.2 | **The sticky action bar at synthesis end uses `border-border-mx-6`** (DecisionSessionPage:201) — also broken. Class is invalid. | P0 |
| 2.3 | No persona/mode explanation. Mode names (Decide / Stress Test / Plan / Clarify / Review / Quick Take) are shown with one-line descriptions only. The 7-persona concept — the entire value prop — is invisible to a first-time user. Show, on first session, a 30-second "Meet your advisors" carousel. | P0 |
| 2.4 | No sample questions / templates. A user staring at `What decision are you wrestling with?` with no examples has writer's block. Linear, Notion, ChatGPT all offer suggestion chips. We have none. | P0 |
| 2.5 | "Check Clarity" button is mysterious. What does it do? No tooltip. No explainer. It's a feature the user has to discover by accident. | P1 |
| 2.6 | **No abort/cancel mid-stream.** Once `isDispatching` starts, there is no Stop button. Personas can run for 30+ seconds. User who realizes their question is wrong cannot reclaim control. | P0 |
| 2.7 | Export is buried as a ghost button labeled "Export" with no format options visible inline; it opens `/api/sessions/:id/export?format=json` in a new tab — i.e. dumps JSON to the user. There's no PDF / Markdown / "Email this" / "Copy summary" option. Show-HN crowd will scrape this and laugh. | P0 |
| 2.8 | No share/permalink. Decision sessions live at `/decisions/:id` but there is no Share button, no public-link, no team-share. The product positions itself as "your boardroom" — at minimum the user should be able to send a synthesis to themselves on Slack. | P1 |
| 2.9 | Persona "waiting" state is genuinely nice — pulsing dots — but says "Thinking…" without any sense of *which* persona is thinking *what*. Persona-specific text would delight: "Critic is sharpening knives…" / "Optimist is finding silver linings…" Easy win, big charm payoff. | P1 |
| 2.10 | When the streaming caret appears, the persona badge says "haiku" or "sonnet" — model names. A user does not need to know the model. This is leaky. Replace with confidence/effort indicator if anything. | P1 |
| 2.11 | The synthesis "Disagreement Map" is `defaultOpen={false}` — the most interesting artifact (where do the personas disagree) is hidden behind a click. Open by default. | P1 |
| 2.12 | `sourceMemoryIds: ['mem_abc123', 'mem_def456']` shown raw at the bottom of synthesis. Either link them (clickable → opens memory in Memory Explorer) or remove. | P1 |
| 2.13 | "Synthesize with CEO" copy uses ✨ + "CEO" — and the synthesis card uses 💼 + "CEO Synthesis." The CEO concept is asserted but unexplained. Why is there a CEO? What does CEO synthesis mean differently from the other personas' outputs? | P2 |
| 2.14 | Confidence shown as percentage with a thin progress bar. Good. But no explanation of what 65% confidence *means*. Tooltip: "Confidence reflects how certain this persona is given the context provided." | P2 |
| 2.15 | The Custom Personas wedge into the persona grid with a "Custom" accent badge in the top-right. Fine — but they appear *after* the built-ins, so a user who built their own personas may not see them above the fold. Let the user reorder. | P2 |
| 2.16 | Saving: there's no explicit "save" — sessions persist automatically via `createSession`. But no autosave indicator, no "Saved 2s ago" status. User does not know their work is durable. | P1 |
| 2.17 | If the user navigates away during streaming and returns, `useEffect` re-fetches via `api.getSession(id)` — but the streaming state is lost (only the final response will appear). User has no way to know "personas are still working in the background." | P1 |
| 2.18 | "New Decision" button appears in two places (top-right and the synthesis action bar). Inconsistent labels: top one says "New Decision," bottom says "New Decision." Fine — but no confirmation dialog if the current session has results. If user mis-clicks, they reset state. | P1 |
| 2.19 | The synthesis recommendation is presented as the final word. There is no "Disagree" / "Push back" / "I'll go a different way" UI — the user reads the answer and exits. The product loses the chance to capture user pushback (which is exactly the data needed to learn the user's thinking). | P2 (with strategic upside) |

### Missing-states table

| State | Status | Note |
|---|---|---|
| Loading sessions list | `SessionSkeleton` (4 rows) | OK |
| Empty sessions list | `EmptyState no-decisions` | Good copy + CTA |
| Loading mid-stream | "Dispatching personas…" muted text | Weak; should be persona-level |
| Persona failure / one persona errors | Not handled in UI | If a single persona fails, no indication |
| Network drop mid-stream | Not handled visibly | SSE drop will leave personas in "Thinking…" forever |
| Filtered list empty | "No {filter} sessions found" | OK |
| Export error | Not handled | Opens in new tab; user sees raw error |
| Simulation running | `SimulationButton` shows `isSimulating` | Likely OK; not verified deeply |

### Recommendations

- **(P0)** Fix `border-borderrounded-lg` on the decision input. Then audit every input in the app for the same bug (grep proves 9+ files).
- **(P0)** Persona education layer: first-session modal "Meet your advisors" or expandable cards beside the mode selector.
- **(P0)** 4-6 starter prompts as suggestion chips below the textarea ("Should I raise a seed?" "Should I hire vs. contract for X?" "Pivot or persist?").
- **(P0)** Stop/Abort streaming button.
- **(P0)** Export → PDF + Markdown, with a "Copy share link" option.
- **(P1)** Persona-specific waiting copy.
- **(P1)** Open "Disagreement Map" by default in synthesis. It's the most interesting artifact.

---

## Journey 3 — Memory Exploration

### Walkthrough narrative

User clicks "Memory" in the sidebar. `MemoryExplorerPage` mounts, fires `search()` on first load. Layout splits 55/45: left panel = search + filter row + scrolling list, right panel = detail or empty state.

`MemorySearch` shows a search input with a magnifier icon, a domain text input, three select dropdowns (Class / Status / SortBy), a sort-direction toggle, and `Clear Filters`. The list (`MemoryList`) renders `MemoryCard`s: title, content preview, domain pill, class pill, confidence color, status pill, tags, importance bar, relative timestamp. A `Load more (N remaining)` button at the bottom for pagination.

Right panel: `MemoryDetail` shows title, content (with edit mode), classification, metadata, links, source attribution, with edit/archive controls.

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 3.1 | **The search input uses `border-borderrounded-lg`** — broken class. Also every filter dropdown (`selectClass = 'bg-card border border-borderrounded …'`) → entire filter row is unstyled. This page looks broken on first contact. | P0 |
| 3.2 | The AI nudge at the top says "You have memories that may benefit from entity links" but it appears unconditionally whenever `memories.length > 0` — i.e. forever. Should be dismissable AND condition on actual unlinked memories. | P1 |
| 3.3 | Memory taxonomy is opaque to users. The filter dropdowns expose `MemoryClass` (WORKING / EPISODIC / SEMANTIC / DECISION) and `MemoryStatus` (CONFIRMED / DRAFT / ARCHIVED / SUPERSEDED / REJECTED). These are internal cognitive-science terms. A user has no business seeing "EPISODIC" — they want "Past Conversations." | P1 |
| 3.4 | Confidence color mapping (`HIGH→success, MEDIUM→warning, LOW→warning, SPECULATIVE→destructive`) — LOW and MEDIUM share the warning color. So a user can't visually distinguish them. | P2 |
| 3.5 | The right-pane "Select a memory" empty state is good (icon + helper text), but the visual weight of the right pane when empty is heavy — feels like wasted real estate. On narrow desktops the 45/55 split looks lopsided. | P2 |
| 3.6 | `Load more` button is a single text button — not an IntersectionObserver-driven infinite scroll. Notion / Linear use auto-load. Single-click pagination feels 2010s. | P1 |
| 3.7 | No bulk operations (multi-select → archive / link / export). Power users will need this. | P2 |
| 3.8 | No way to *create* a memory manually from this page. If the user remembers something important after the fact, there's no "+ Add memory" button. | P1 |
| 3.9 | Source attribution: `MemoryCard` shows `sourceType` (MANUAL / MCP_AGENT / SESSION_SUMMARY / etc.) only inside the AdminPage Memories tab — regular users see no "Where did this come from?" trace on their own memory cards. | P1 |
| 3.10 | Tags shown as gray pills with no click affordance. Tags should be clickable filters. | P1 |
| 3.11 | No search debounce visible at the input level, but the hook does debounce 300ms. Loading state during debounce is invisible — user types, sees no feedback for 300ms+search time. | P2 |
| 3.12 | The list footer says `{total} memories total` once `hasMore` is false. Good. But when filters are active, this number should clarify "5 of 47 matching." Currently ambiguous. | P2 |
| 3.13 | MemoryDetail editing flow has `editing` state, but the user has no obvious "Save" affordance from the audit (needs verification). Edits to title without `editing` flag are silently ignored. Confusing. | P2 |
| 3.14 | No diff view for superseded memories. The whole `SUPERSEDED` status is shown but the user can't see *what* superseded it. | P2 |
| 3.15 | Importance bar is decorative-only — no click-to-edit, no explanation of what importance means. | P2 |

### Missing-states table

| State | Status | Note |
|---|---|---|
| Initial empty (no memories yet) | "No memories found / Try adjusting your search" — assumes user is searching, not new. Wrong copy for a brand-new user. | Bug |
| Filtered empty | Same string as above | Ambiguous |
| Loading | 3 SkeletonCard rows | OK |
| Detail empty (none selected) | Icon + helper | OK |
| Error | `ErrorBanner` | OK |
| Bulk action | Not implemented | N/A |
| Memory creation | Not in this page | Should be |

### Recommendations

- **(P0)** Fix broken `border-borderrounded*` classes on search + all filter selects.
- **(P1)** Translate internal taxonomy to user language (EPISODIC → "Past Conversations", SEMANTIC → "Facts You've Told Me", etc.).
- **(P1)** "+ Add Memory" manual capture button on this page.
- **(P1)** Brand-new user empty state with a "Memories will populate as you have decisions and conversations" explainer + 1-click sample-memory.
- **(P1)** Source attribution visible per card.
- **(P1)** IntersectionObserver-based auto-pagination.

---

## Journey 4 — People Directory

### Walkthrough narrative

User clicks "People." `PeopleDirectoryPage` mounts, fetches people if empty. Header: title + `+ Add Person` button. AINudge if `people.length < 3`. Tabs: `Directory` | `Relationship Map`.

Directory tab: search input, grid of `PersonCard`s with edit/delete. Inline `+ Add Person` form (slide-in) with name (required), role, relationship, notes.

Map tab: relationship graph (force-directed?) gated by `hasEnoughData` (≥ 3 nodes).

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 4.1 | "Adding more people improves decision context" nudge shows whenever `people.length < 3` — including when the user is mid-add. Should be dismissable per-session and not show during the add-form open state. | P2 |
| 4.2 | Inline add form is centered in the page flow (not a modal) — fine — but the page has no "+" button in the empty state, only in the header. The empty state CTA says "Click 'Add Person' to get started" — but the button label is `+ Add Person` and toggles to `Cancel`. Empty state should have its own action button. | P2 |
| 4.3 | Relationship field is a free-text input. A solo founder filling out "spouse, cofounder, investor, advisor, mentor, friend" would benefit from suggestions/datalist. Free text guarantees inconsistency, which hurts downstream AI. | P1 |
| 4.4 | No way to link a person to a goal/project/decision from this page. Person is shown in isolation; the most valuable bit of the people directory — *who is involved in what* — requires going to the entity-linker UI in Memory Explorer. Counter to product premise. | P1 |
| 4.5 | No bulk import. Solo founders have 30 stakeholders in their head. Asking them to add one at a time is friction. Need CSV / clipboard import / Google Contacts sync. | P1 |
| 4.6 | Search is name/role/domain — but not notes. If you wrote "trusted advisor for term sheets" in notes, you can't find it via search. | P2 |
| 4.7 | Map tab loads `useRelationshipData` separately on tab activation — likely fetches each time. Should be cached. | P2 |
| 4.8 | Map fallback for `!hasEnoughData` says "You need at least 3 people or projects" — but adding projects on this page is not possible. The instruction is mislocated. | P1 |
| 4.9 | No way to see "decisions involving this person" or "memories about this person" — counter to product premise. Each PersonCard should drill into their entity timeline. | P1 |
| 4.10 | Delete confirmation flow not visible at the page level (presumably inside PersonCard) — needs verification. | P2 |

### Missing-states table

| State | Status |
|---|---|
| Empty directory | EmptyState `no-people` with helper text | OK
| Search no match | Different title via same EmptyState | OK
| Map insufficient data | EmptyState with text | OK (but instruction mislocated)
| Loading | 6 Skeleton cards | OK
| Error | ErrorBanner | OK

### Recommendations

- **(P1)** Datalist-backed relationship suggestions.
- **(P1)** Drill-down per person: timeline of decisions, memories, commitments.
- **(P1)** Bulk import (CSV / Google Contacts).
- **(P2)** Cache graph data; persist tab choice.
- **(P2)** Make the AINudge dismissable.

---

## Journey 5 — Integrations Setup

### Walkthrough narrative

User clicks "Integrations." Loads `/integrations`, shows 4 IntegrationCards in a 2-col grid: Gmail (status from API), Google Calendar (status), Slack (coming_soon), Notion (coming_soon).

Connect → fetches `/api/auth/google/url` → `window.location.href = url`. Standard OAuth dance. After OAuth callback, user returns to `/integrations` (assumed) and sees status `connected`. Disconnect → API call → reload.

If Gmail is connected, an EmailScanner panel appears below the grid.

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 5.1 | The OAuth return URL is not visible from the page code. If the redirect lands the user back somewhere unexpected (e.g. /onboarding), no UX safety net. | P1 |
| 5.2 | No success toast after returning from OAuth. Status flips silently. User has no "✓ Gmail connected — we'll scan your inbox now" confirmation. | P1 |
| 5.3 | Error state for a connect failure shows in the ErrorBanner with the raw error message (`err instanceof Error ? err.message : 'Failed to get auth URL'`). Generic but acceptable. | P2 |
| 5.4 | Disconnect has no confirmation dialog. One-click destruction of an OAuth grant. | P1 |
| 5.5 | "Last synced: {timestamp}" but no manual "Sync Now" button. If the user just sent an important email and wants context immediately, they wait. | P1 |
| 5.6 | Coming-soon cards (Slack, Notion) are styled `opacity-60` and clickable areas inert except for the badge — but they take grid space equal to live integrations, dragging the user's attention to features they cannot use. Either hide them or replace with a "request integration" CTA. | P2 |
| 5.7 | The "manage integrations" affordance in SettingsPage points to `/integrations` via `window.location.href = '/integrations'` (full reload) rather than `useNavigate`. Avoidable jank. | P2 |
| 5.8 | EmailScanner mounts only when Gmail is connected — but the user has no way to *configure* what gets scanned (e.g. label, date range, sender filters) from this page (depends on EmailScanner impl). | P2 |
| 5.9 | OAuth flow shows no permission preview ("BoardRoom will read your email subjects and senders to extract decisions"). Privacy-sensitive users will bail. | P1 |
| 5.10 | No revoke-on-Google reverse-sync. If the user revokes BoardRoom in Google's permission center, BoardRoom's status will say `connected` until next API call fails. Stale state. | P2 |

### Missing-states table

| State | Status |
|---|---|
| Initial loading | 4 Skeleton cards | OK
| Error fetching list | ErrorBanner | OK
| Auth URL not configured | "Gmail integration is not configured on the server." | Plain string, no toast
| Connected + sync recent | Last-synced timestamp | OK
| Connected + sync stale (>24h) | No special UI | Should warn
| Failed sync | Status `error` → Reconnect button | OK
| Coming soon | opacity-60 + "Available in a future update" | OK but takes grid space

### Recommendations

- **(P1)** Success/failure toast on OAuth return.
- **(P1)** Confirmation dialog on Disconnect.
- **(P1)** Manual "Sync Now" + last-sync timestamp pill.
- **(P1)** Privacy preview before redirect (what scopes, what we do with the data).
- **(P2)** Hide coming-soon cards behind a "More" disclosure; replace with a "Request an integration" link.

---

## Journey 6 — Settings / Billing

### Walkthrough narrative

User clicks "Settings." Layout: left nav (Profile/Preferences/Integrations/Subscription/Account, sticky), right content panel with sections in order.

Profile: name + email (disabled), role, industry, decision frequency select → Save Profile button. Risk profile: 4 sliders (financial/technical/people/strategic) → Save Risk Profile. Values: comma-separated input → Save Values. Integrations: a button "Manage Integrations" that does a full page reload. Subscription: `SubscriptionSettings` (loads sub, shows trial/active/past-due/canceled state with appropriate CTA). Calendar settings. Account: Logout + Delete Account (disabled — "coming soon").

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 6.1 | **Three separate Save buttons** (Profile / Risk Profile / Values) instead of one. Notion-tier products autosave. Linear has one Save in the corner. We have three buttons with three loading states. | P1 |
| 6.2 | Risk profile sliders show `riskProfile[key].toFixed(2)` (e.g., `0.75`). What does 0.75 risk tolerance for "people" mean? No labels at the extremes ("Conservative" — "Bold"). The slider is mute. | P1 |
| 6.3 | Values is comma-separated text input. A user types "Growth, Team wellbeing, Innovation" and sees chips. Fine. But there's no drag-to-reorder, no delete-individual-tag. Mistype "Growht" → must clear comma-string and retype. | P1 |
| 6.4 | The "Integrations" section in Settings is a redundant one-button card pointing to `/integrations`. Either inline the integration cards here or remove this section. | P2 |
| 6.5 | "Delete Account" is disabled with `title="Account deletion coming soon"`. Day-one launch with no account-delete = GDPR/CCPA exposure. P0 from a compliance standpoint. | P0 |
| 6.6 | Logout button is a `variant="secondary"` button. Most apps put logout in the user menu (avatar dropdown). Putting it inline in Settings makes it weirdly hard to find. | P2 |
| 6.7 | The Subscription panel mixes raw Tailwind colors (`bg-green-500`, `bg-red-500`, `text-red-600`, `bg-red-600/20`) with design tokens (`text-success`, `bg-primary`). Inconsistent. Will break dark/light parity. | P1 |
| 6.8 | Trialing state hardcodes "Pro Plan — $29/month." Pricing in code; no source of truth from the server. Any pricing change → code deploy. | P2 |
| 6.9 | Cancel subscription uses `window.confirm()` — native browser dialog. Looks 1998. Linear/Stripe show in-app modal confirmations. | P1 |
| 6.10 | Past Due state offers "Update Billing" but routes through `handleUpgrade` (createCheckout). User with a failed card hits a new-checkout flow rather than a Stripe customer-portal — depending on Stripe setup, this could double-charge. Should route to Stripe Customer Portal. | P1 |
| 6.11 | No invoices/billing history. Subscription customers expect downloadable invoices. | P1 |
| 6.12 | Section nav `scrollToSection` does smooth scroll — fine — but `activeSection` is set on click only, never on actual scroll position. So if user scrolls down the page, the left nav stays highlighted on whatever they last clicked. Missing IntersectionObserver. | P2 |
| 6.13 | Mobile: section nav is `hidden md:block`. On mobile, there's no quick jump — user has to scroll past everything. Add a sticky select-dropdown jump on mobile. | P2 |
| 6.14 | Saves use toast confirmations only — no inline "Saved ✓" indicator next to the button. After click, button text reverts and the toast is gone in 4s. User loses confirmation. | P2 |
| 6.15 | Settings has no search-within-settings. With 5+ sections, find-as-you-type would feel premium. | P3 |

### Missing-states table

| State | Status |
|---|---|
| Loading profile | Skeleton | OK
| Profile load error | ErrorBanner | OK
| Save success | Toast | OK (transient)
| Save failure | Toast with raw error | OK
| Subscription dev-mode (no Stripe) | "All features unlocked" badge | Good
| Trialing | Days-left + Upgrade CTA | OK
| Active | Status + cancel | OK (but native confirm)
| Past due | Update billing CTA | Wrong route
| Canceled with grace | "Access until X" + Resubscribe | OK

### Recommendations

- **(P0)** Self-serve account deletion.
- **(P1)** Single Save (or autosave) instead of three Save buttons. Use Stripe Customer Portal for billing changes.
- **(P1)** Slider labels at extremes; values list with deletable chips and reorder.
- **(P1)** Token-only colors (replace `bg-green-500`, `text-red-600` etc).
- **(P1)** Custom confirm-modal instead of native `confirm()`.
- **(P2)** IntersectionObserver-driven section nav highlighting.

---

## Journey 7 — Admin

### Walkthrough narrative

User clicks "Admin" in the sidebar (it sits in the secondary nav alongside Settings/Personas/Integrations — visible to *every* user, no role check at the route level).

`AdminPage` mounts: 6 tabs (Overview / Memories / Audit Log / Agents / Contradictions / Duplicates). Overview shows 6 StatCards (counts) + a "Trigger Session Summarizer" button. Memories tab: cross-tenant memory search/pagination. Audit: tool-call log. Agents: registered MCP agents with scopes. Contradictions: HIGH/MEDIUM/LOW severity alerts. Duplicates: similarity-threshold-based duplicate pair merge UI.

### Friction inventory

| # | Friction | Severity |
|---|---|---|
| 7.1 | **Admin is visible in the sidebar to every authenticated user.** The route is gated only by `ProtectedRoute` (i.e. just-logged-in). There is no `role === 'admin'` check visible. A trial user clicking "Admin" sees the entire system's stats. | P0 (security/privacy) |
| 7.2 | Admin lives next to user settings in the sidebar (secondary nav) — implying it's "user admin" when it's actually "system admin." Misleading information architecture. | P1 |
| 7.3 | Admin is unbranded internal-tools UI: monospace columns, plain selects, no illustrations, no copy. It feels like phpMyAdmin grafted onto a Linear product. Acceptable for ops; jarring for any user who clicks in by mistake. | P1 |
| 7.4 | Tab labels are inconsistent: "Overview" / "Memories" / "Audit Log" (two words) / "Agents" / "Contradictions" / "Duplicates." Either all one word or all phrased as actions. | P3 |
| 7.5 | Memories tab paginates with Previous/Next + offset — same single-button pagination as user-facing MemoryList. Inconsistent with Audit/Memories which both use Previous/Next, but Contradictions and Agents don't paginate at all (fixed-limit fetch). | P2 |
| 7.6 | Duplicates tab "Keep A" / "Keep B" — irreversible merge. No undo. No diff view. No confirmation. One misclick destroys a memory. | P1 |
| 7.7 | Contradictions list has no resolve action. Read-only. The whole point of detecting contradictions is letting the user resolve them. | P1 |
| 7.8 | Audit log uses a `<table>` (good) but has no filtering by tool/agent/tenant. With 1000+ rows, this is unusable. | P1 |
| 7.9 | "Trigger Session Summarizer" button: no confirmation, no progress, no result detail — fires-and-forgets with a single message string. | P2 |
| 7.10 | Severity colors mix tokens and raw Tailwind: `bg-destructive/10 text-destructive` (token) for HIGH, `bg-yellow-100 text-yellow-800` for MEDIUM. Token discipline broken. | P2 |
| 7.11 | StatCards link to nothing. "Memories: 1,847" should be clickable → goes to Memories tab filtered to all. | P2 |
| 7.12 | No CSV export from any tab. Ops users expect to dump audit data. | P2 |

### Missing-states table

| State | Status |
|---|---|
| Loading | Skeletons per-tab | OK
| Empty memories/audit/agents/contradictions/duplicates | Plain "No X" muted text | Bland (could use EmptyState illustrations or be intentional ops-style)
| Error | ErrorBanner | OK
| Mid-merge | "Merging…" button text | OK
| Threshold change | Refetch + count update | OK

### Recommendations

- **(P0)** Gate `/admin` behind a server-side role check; hide sidebar item for non-admins.
- **(P1)** Add resolve-action on contradictions.
- **(P1)** Merge confirmation + diff view on duplicates.
- **(P1)** Audit-log filtering (tool/agent/tenant).
- **(P1)** Brand the admin pages or move them to a separate `/ops` subdomain.

---

## Cross-Cutting Findings

### CC-1. Broken Tailwind class concatenation (CRITICAL, P0)

A search for `border-borderrounded`, `border-border-mx-` etc. surfaces **at least 14 occurrences across 9 files**:

- `pages/DecisionSessionPage.tsx:138, 201` — decision input + sticky action bar
- `components/memory/MemorySearch.tsx:25, 49, 109` — search input + every filter chip
- `components/memory/EntityLinker.tsx:78, 107` — entity linker
- `components/settings/PersonaEditor.tsx:112, 126, 139, 152` — custom persona editor (entire form)
- `components/onboarding/steps/GoalsStep.tsx:48`
- `components/onboarding/steps/ProjectsStep.tsx:50`
- `components/onboarding/steps/ContextStep.tsx:21, 34`

Pattern: someone hand-edited `border border-border rounded-lg` and removed the space → `border border-borderrounded-lg`. Tailwind silently drops the invalid class. The intended border-color and radius are both absent on every input listed above. This is the single most damaging cross-cutting bug in the codebase. Fix takes 30 minutes (regex replace `border-border(rounded(?:-(?:sm|md|lg))?)` → `border-border $1`).

### CC-2. CommandPalette wiring (mostly good, one gap)

`CommandPalette` is mounted in `App.tsx` outside `Layout` — it's available on every authenticated page including onboarding (since `OnboardingPage` is inside `ProtectedRoute`, the palette is mounted but the route layout differs). Cmd+K opens it. Cmd+K in inputs also opens it (`useKeyboardShortcuts` allows it through input-skip).

Goals/Projects/People/Decisions sections only show when there's matching data. Pages section is always visible. Empty state on no match is OK ("No results found.").

**Gap:** Selecting a goal in the palette routes to `/` — i.e. dashboard — with no scroll-to-goal or modal-open behavior. Same for projects. People navigate to `/people` (good). The palette suggests "Goals" is a feature, but selecting one doesn't *do* anything meaningful. Fix: navigate to a goal-detail view or open a modal.

**Gap:** No actions other than "New Decision Session." Should include:
- Toggle theme
- Open Settings
- Sign out
- "Run weekly memo now"
- "Connect Gmail" (if not connected)
- "View shortcuts" (Cmd+/)

**Gap:** No recent-pages section. Linear's Cmd+K shows your last 3 navigated routes.

### CC-3. Motion language

Framer Motion is used heavily and tastefully (`fadeIn`, `slideUp`, `staggerContainer`, `staggerItem`, `scaleIn`, `pageTransition` — all in `lib/motion.ts`). Page transitions exist. Persona cards stagger in. Modal/dialog opens use `scaleIn`.

**Issues:**
- Stagger delays sometimes make a 6-persona grid feel slow (~600ms to fully appear). Cut stagger to 30ms per item.
- `layoutId="nav-indicator"` on sidebar is a delight — it animates the indicator between routes. Good.
- `layoutId="mode-selector"` on ModeSelector — also good.
- No reduced-motion preference respected (search confirms no `prefers-reduced-motion` checks anywhere). WCAG miss.
- Celebration confetti renders 25 particles unconditionally — no reduced-motion fallback.

### CC-4. Empty state inconsistency

Two parallel implementations:
- `components/ui/EmptyState.tsx` — uses custom SVG illustrations, 6 variants (`no-decisions / no-memories / no-people / no-goals / no-data / search-empty`). Branded.
- `components/shared/EmptyState.tsx` — referenced via imports, separate implementation.

DecisionLab + Dashboard use the UI one (good). MemoryList rolls its own inline empty state with a generic 12-pt SVG (bad). MemoryExplorerPage right pane also rolls its own (bad). Settings has no empty states at all. Standardize on `components/ui/EmptyState.tsx` everywhere.

### CC-5. Color token discipline

Mixed throughout. Examples:
- `SubscriptionSettings.tsx`: `bg-green-500`, `bg-red-500`, `bg-red-600/20`, `border-red-600/40`, `bg-red-800/50` alongside `bg-card`, `text-foreground`, `text-success`.
- `AdminPage.tsx`: `text-green-600 dark:text-green-400`, `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30` alongside `bg-destructive/10`.
- `MemoryCard.tsx`: clean — uses tokens only.

Action: ban raw Tailwind color names in lints. All colors via tokens.

### CC-6. Loading-state inconsistency

Mixed:
- `LoginPage`: inline SVG spinner inside button.
- `App.tsx ProtectedRoute`: plain "Loading…" text.
- `DashboardPage`: full Skeleton with title-aligned layout.
- `DecisionLabPage`: 4-row generic Skeleton.
- `IntegrationsPage`: 4 Skeleton cards.
- `SettingsPage`: 3 generic Skeletons.
- `Suspense fallback (PageFallback)`: `<LoadingSpinner size="lg" />` — different style than ProtectedRoute.
- `MemoryList`: animate-pulse hand-rolled SkeletonCard.

Inconsistent. Skeleton fidelity to final layout is high on DashboardPage but generic elsewhere.

### CC-7. Error-message quality

`ErrorBanner` is consistent (used 9+ places). Toast errors throughout. **But** error messages often surface raw `err.message` strings ("Network error", "Failed to load profile") to the user. Better: human-readable error catalog with retry guidance.

Specific high-risk surfaces:
- Decision dispatch failure → store sets `error` → ErrorBanner renders, but no retry button.
- OAuth callback failure → caught and rethrown; user sees only `Failed to get auth URL`.
- Subscription cancel failure → silently swallowed (`catch { /* Failed to cancel */ }`). User clicks Cancel, nothing happens. Worst possible UX.

### CC-8. Accessibility

Decent foundation:
- Skip link in Layout.tsx
- `aria-label` on hamburger, theme toggle, dismiss buttons
- Focus rings via Tailwind
- ARIA on sidebar nav (`aria-label="Main navigation"`)
- Tooltips/aria-hidden on decorative SVGs

Gaps:
- No `prefers-reduced-motion` handling anywhere.
- Tab order not validated.
- Toast notifications: depends on `Toast.tsx` impl — needs aria-live region (likely present given grep showed aria there).
- Modals/sheets close on backdrop click but not all on Escape (CommandPalette uses cmdk which handles it; other modals don't all listen for Escape outside `useKeyboardShortcuts`).
- Color contrast: not measured but `text-muted-foreground` on `bg-card` in some places looks borderline.
- Sliders in Settings have no aria-valuetext explaining the value.

### CC-9. Mobile responsiveness

Layout has Sidebar/MobileDrawer separation, AppHeader has hamburger toggle, decision input flexes to one column. But:

- DecisionLabPage filter tabs (`flex gap-1`) will overflow on small screens (6 buttons → narrow viewport).
- Memory Explorer 55/45 split: `flex flex-col lg:flex-row` — collapses to column on mobile, but the divider (`w-px bg-border`) is hidden on `lg:` only — so on tablet the divider is invisibly broken.
- Settings section-nav is desktop-only — mobile users get no jump-to.
- People Directory grid `md:grid-cols-2 lg:grid-cols-3` — fine.
- Persona grid `md:grid-cols-2 lg:grid-cols-3` — fine.
- Touch targets: Sidebar nav items have `min-h-[44px]` (good). Filter buttons in DecisionLab are `py-1.5` (35-40px tall) — below the 44px iOS guideline.

### CC-10. Information hierarchy

DashboardPage greeting uses a 1px-wide gold accent bar — branded touch, good. Subtitle `All systems nominal` is system-speak; should be user-context-aware ("3 decisions this week, 1 contradiction to resolve").

The hierarchy in DecisionSessionPage during streaming is excellent (mode badge → personas → CEO synthesis → action bar). Hierarchy in MemoryExplorer is decent. Hierarchy in Settings is flat — every section card looks the same, no visual priority for "thing you do daily" (Profile) vs "thing you touch yearly" (Account).

### CC-11. Delight moments inventory

Existing:
- Confetti on onboarding completion (warm gold, 25 particles, 1.5s).
- Rotating testimonials on login with progress dots.
- Persona "Thinking…" pulsing dots.
- Streaming cursor blink during persona output.
- Logo glow (`drop-shadow-[0_0_24px_rgba(212,163,26,0.4)]`) on Logo headers — *chef's kiss*.
- Sidebar `layoutId` nav indicator slides between routes.
- Cmd+K palette with scaled-in entry.

Missing (would tweet-worthy):
- No "Welcome back, Josh — last time you were deciding whether to..." continuity.
- No persona-flavored micro-copy ("Critic is sharpening knives…").
- No keyboard easter eggs (Konami? `?` key for help?).
- No empty-week / Sunday-night ritual flow ("Weekly memo is ready — read it before bed?").
- No share-card image generator (decisions as social cards).
- No /shipped page or "BoardRoom has helped you ship X decisions this year."

### CC-12. Anti-patterns spotted

- `OnboardingPage.tsx` fires `useEffect` with `[error]` only deps + missing `addToast` — likely React-Hooks-rules-of-hooks lint warning suppressed.
- `MemoryExplorerPage` calls `search()` on mount with `// eslint-disable-line react-hooks/exhaustive-deps` — symptomatic of store-coupled effects.
- `SettingsPage.handleCancel` uses `window.confirm` (anti-pattern for branded SaaS).
- `SubscriptionSettings.handleCancel` swallows the error silently (`catch { /* Failed to cancel */ }`) — worst case: user thinks subscription is canceled, charge happens, support ticket.
- The Suspense fallback for lazy routes shows a full-page spinner — better to show a route-shaped skeleton.

---

## Prioritized Recommendations

### P0 — Launch blockers (fix this week)

1. **Fix `border-borderrounded*` Tailwind bug** across 9 files. 30-minute regex fix.
2. **Add Google/GitHub OAuth** to login. Solo founders won't make passwords.
3. **Forgot-password + email-verification flows.** Day-one essentials.
4. **Stop/Abort streaming on Decision session.** Currently impossible.
5. **Fix "Create a Goal" dead link** on empty Dashboard.
6. **Real Export options** — PDF/Markdown, not raw JSON.
7. **Persona/mode education** — first-session "Meet your advisors" modal + suggestion chips below the question textarea.
8. **Self-serve account deletion** — GDPR/CCPA exposure on day one without it.
9. **Gate `/admin` server-side** — currently any authenticated user can see system-wide stats.
10. **Subscription cancel toast** — currently silent fail.

### P1 — Polish required for Show HN

11. Single Save (or autosave) in Settings instead of three Save buttons.
12. Translate internal taxonomy in Memory Explorer (EPISODIC/SEMANTIC → human language).
13. Manual "+ Add Memory" button.
14. People drill-down: timeline per person.
15. Bulk import for People (CSV).
16. Relationship/role datalists in People form.
17. Privacy preview before OAuth redirect.
18. Confirm dialog (in-app, not `window.confirm`) on Disconnect and Cancel Subscription.
19. Past Due → Stripe Customer Portal, not new checkout.
20. Source attribution visible on user-facing memory cards.
21. Infinite-scroll pagination in MemoryList (replace Load More button).
22. Contradictions resolve flow.
23. Merge confirmation + diff in Duplicates tab.
24. Audit-log filtering.
25. `prefers-reduced-motion` respect everywhere.
26. Standardize on `components/ui/EmptyState.tsx`; delete `shared/EmptyState.tsx`.
27. Color-token cleanup; ban raw Tailwind color names.
28. Toast success on OAuth completion.
29. Manual "Sync Now" on integrations.
30. Open "Disagreement Map" by default in synthesis.
31. Persona-specific "Thinking…" copy.
32. Linkify `sourceMemoryIds` in synthesis.
33. Tags clickable as filters in MemoryExplorer.
34. Decision permalink/share button.
35. Real-time session-resume UX (poll/SSE) if user navigates away during dispatch.

### P2 — Quality-of-life

36. IntersectionObserver-based section-nav highlighting in Settings.
37. CommandPalette: theme toggle, sign out, recent pages.
38. Brand-new-user copy variants for empty Memory Explorer ("Memories will appear as you have conversations").
39. Decision Lab filter tab horizontal scroll on mobile.
40. Memory Explorer 55/45 divider rendering bug on tablet.
41. Settings mobile section jump dropdown.
42. Save inline-indicator next to Save buttons (in addition to toast).
43. Cache profile fetch across OnboardingGate mounts.
44. Slider min/max labels in Settings (Conservative ↔ Bold).
45. Reorder/delete chips in Values field.
46. Stagger delays cut to 30ms per item (decision personas + dashboard widgets).
47. CSV export from Admin tabs.
48. StatCards in Admin clickable.
49. Onboarding step-level skip affordance more visible.
50. Bootstrap: explainer tooltip near copy button.

### P3 — Delight + future

51. Persona-flavored micro-copy across the app.
52. Continuity prompt on dashboard ("Last time you were deciding…").
53. Share-card image generator for synthesized decisions.
54. Sunday-night weekly-memo ritual flow.
55. Demo mode (one-click sample tenant for HN visitors).
56. `?` keyboard shortcut for shortcuts modal (in addition to Cmd+/).
57. Recent-pages in command palette.
58. Annual recap page (BoardRoom Wrapped style).
59. Settings find-as-you-type.

---

## Inspiration callouts (steal from these)

- **Linear** — `Cmd+K` recent-pages section, slash-commands inside the palette, IntersectionObserver-driven section nav, single autosave with a "Saved" pill. Their feedback latency to user input is the gold standard.
- **Vercel** — OAuth privacy preview before redirect ("BoardRoom will access: read email metadata, list calendar events"). Their settings page uses a "Save" pill that's only visible when there are changes — no buttons until needed.
- **Notion** — empty states that demonstrate the feature ("Here's a sample memory — click to edit, or delete and write your own"). Their slash-menu surfaces ALL actions including the obscure ones.
- **Stripe** — never use `window.confirm`. Every destructive action gets a branded modal with a "type CANCEL to confirm" pattern for high-stakes operations. Their customer portal handles ALL billing-state edge cases — we should defer to it.
- **Superhuman** — `?` key for shortcuts, persona-flavored micro-copy ("Indexing the universe…"), keyboard-first everywhere.
- **Raycast** — Cmd+K with action types (navigate / run / toggle / external), recent items, fuzzy match across data + actions.
- **GitHub** — share cards as OG images (`/og` route generating PNG of decision summary).
- **Cron / Cal.com** — full-keyboard navigation, focus indicators that look intentional.
- **Granola / Mem** — they share our space (executive note-taking + memory). Both let you click any entity and see its full graph. Both auto-link people. Both have a "what changed this week" digest.

---

## Final Take

This is a serious product with serious craft underneath it — the persona system, the bootstrap mega-prompt, the warm-gold brand, the confetti celebration, the SSE streaming with persona-colored cards. Someone cared. The skeleton is real.

But the surface has 9 files of broken inputs, no SSO, no abort button, raw JSON export, a `window.confirm()` for billing cancellation, an unprotected admin page, and a 7-persona feature that's mute about itself. None of these are deep architecture problems. They are 1-2 day fixes each.

Two weeks of focused P0+P1 polish puts this at an 8/10. It is not currently launch-ready for the front page of HN. It is launch-ready for a 50-person private beta whose feedback you control.

Ship the fixes. Then ship.
