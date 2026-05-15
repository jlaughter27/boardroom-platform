# BoardRoom AI — Feature-Wiring Audit (2026-05-15)

**Scope:** `packages/boardroom-ai/client/src/**` + `packages/boardroom-ai/server/src/**`
**Method:** Static read of every page/route + grep for TODO/console.log/stubs/Tailwind typos + endpoint cross-reference.
**Bar:** Show HN / Product Hunt launch-day.

---

## Executive Summary

BoardRoom AI is roughly **70-80% wired** end-to-end on the happy path, but it fails the launch-day bar in several structurally important places. The big-ticket issues are not cosmetic: **sessions are stored only in an in-memory `Map` with a 30-minute TTL** (so Decision Lab, Recent Decisions widget, and any "view past session" deep-link silently expire after restart or 30 min), **the Stripe webhook is mounted behind both `authMiddleware` and `express.json()` so signature verification will always fail**, **the `/admin` route + all `/admin/*` server endpoints are accessible to every signed-in user** (no role check, sidebar item visible to all), **PDF export is hard-501'd**, and **15 Tailwind class strings are corrupted** (`border-borderrounded-md` — concatenated tokens that break both `border-border` and `rounded-*`). Layered on top of that are mocked persona avatars in the session list ("P" letter chips), a dashboard quick-action that routes "Create a Goal" back to itself, integrations cards for Slack/Notion that are pure marketing ("coming_soon"), the simulation-nudge scrolling to a non-existent DOM anchor, and a fistful of `variant="outline"` usages on a `Button` component whose CVA only knows `primary | secondary | ghost | danger | success`. Five server endpoints are dead (no client caller). Onboarding completion is a non-atomic sequence of awaits with no rollback on partial failure.

Below: ~55 findings grouped by page, then dead endpoints + ghost features.

---

## Findings

| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| **F-001** | **P0** | `server/src/routes/sessions.routes.ts:23-34` | Sessions stored only in in-memory `Map` with 30-min TTL + reset on restart. `listSessions` / `getSession` / persona dispatch state all evaporate. `Decision Lab` page, `RecentDecisions` widget, and `/decisions/:id` deep links will return 404 within minutes. Comment even admits "Phase 1 — will persist to OmniMind later" — that promise was not kept. | Persist sessions to OmniMind (new `Session` model) or at minimum to disk; remove TTL or extend to 30 days. | L |
| **F-002** | **P0** | `server/src/index.ts:88,91` + `server/src/routes/subscription.routes.ts:27` | Stripe webhook is mounted under `/subscription/webhook`, which sits behind both the global JWT `authMiddleware` (line 88) and the global `express.json()` body parser (line 50). Stripe webhooks have no JWT cookie → 401. Even if auth bypassed, body parser already consumed the bytes so `Stripe.webhooks.constructEvent` signature check fails. Subscription state will never sync. | Mount the webhook BEFORE `express.json()` and BEFORE `authMiddleware`, using `express.raw({type:'application/json'})` only on that one route. Put it on its own public router. | M |
| **F-003** | **P0** | `client/src/App.tsx:117` + `server/src/routes/admin.routes.ts` (entire file) + `client/src/components/shared/Sidebar.tsx:86` | `/admin` route is gated only by `ProtectedRoute` (any authed user). No `isAdmin` / role check anywhere — neither client nor server. Admin link appears in every user's sidebar. Endpoints expose cross-tenant memories, audit log, agent keys, contradictions, duplicate-merge across all tenants. | Add `role` to `User`, gate sidebar item + route + every `/admin/*` server route. | M |
| **F-004** | **P0** | `server/src/routes/sessions.routes.ts:241-244` | PDF export hard-coded to return 501 `not_implemented`. Client offers no UI selector but `exportSession(id, format)` accepts `'pdf'`. | Either remove pdf path from public API/types or implement (puppeteer / pdfkit). | M |
| **F-005** | **P1** | 15 files across client/src | Corrupted Tailwind class strings: `border-borderrounded-md`, `border-borderrounded-lg`, `border-borderrounded`, `border-border-mx-6` — missing space between two utilities. Both classes are silently dropped by JIT. Affects onboarding GoalsStep, ProjectsStep, ContextStep, PersonaEditor (4 places), EntityLinker (2), MemorySearch (3), DecisionSessionPage (2). | Add the missing space in every occurrence. | S |
| **F-006** | **P1** | `client/src/pages/AdminPage.tsx` (12+ occurrences) | `variant="outline"` used on `<Button>` but `Button` CVA only defines `primary | secondary | ghost | danger | success`. Tailwind class will be undefined → default "primary" gold buttons everywhere on Admin. | Add `outline` variant to `Button.tsx` or replace with `ghost`/`secondary`. | S |
| **F-007** | **P1** | `client/src/pages/AdminPage.tsx:387` | `mergeAdminDuplicates(keepId, archiveId, 'admin')` passes hard-coded string `'admin'` for `userId`. Whatever OmniMind logs for that field will be wrong. | Pass `useAuthStore().user.userId`. | S |

### LoginPage (`pages/LoginPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-010 | P2 | `LoginPage.tsx:351` | "Terms of Service / Privacy Policy" text rendered as plain text — no links, no policy pages exist. Required for App Store / Stripe / privacy compliance. | Build `/terms` + `/privacy` static pages and link them. | M |
| F-011 | P2 | `LoginPage.tsx:266` | Register placeholder hardcoded to founder's name `"Josh Laughter"`. | Replace with generic ("e.g. Jane Smith"). | S |

### OnboardingPage (`pages/OnboardingPage.tsx` + `hooks/useOnboarding.ts`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-020 | P1 | `useOnboarding.ts:257-334` | `complete()` performs N sequential awaits with no transactional wrapper. Partial failure (e.g. one createGoal 422s) leaves user with some entities saved and `onboardingComplete: false` — next login dumps them back into the wizard with duplicate state. | Batch into a server-side `POST /onboarding/finalize` that runs in a transaction, or at least catch per-entity errors and continue. | M |
| F-021 | P2 | `OnboardingPage.tsx:144` | `useEffect` deps array intentionally omits `addToast` and `showCelebration`. Comment explains "wrapped to prevent firing", but eslint exhaustive-deps is being lied to. Real fix: depend on stable identities. | Add deps or `useEffect` ref-pattern. | S |

### DashboardPage (`pages/DashboardPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-030 | P1 | `DashboardPage.tsx:168` | Empty-state "Create a Goal" quick-action navigates to `/` — i.e. itself. The whole point of this card is to send the user to a goal creation flow which doesn't exist. | Open `EntityForm` in a modal, or route to a dedicated `/goals/new`. | M |
| F-031 | P2 | `DashboardPage.tsx:138` | "Read Memo" nudge scrolls to `#weekly-memo` anchor — no element in `WeeklyMemoCard` carries `id="weekly-memo"`. Click is a no-op. | Add `id="weekly-memo"` to the card wrapper. | S |
| F-032 | P2 | `DashboardPage.tsx:43-203` | No empty-state when entities still loading but `isLoading` returns false fast → user sees "Your dashboard will come alive" even on a working account before data arrives (race). | Couple skeleton to `entitiesStore.isLoading || cortexStore.isLoading`. | S |

### DecisionLabPage (`pages/DecisionLabPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-040 | P0 | `DecisionLabPage.tsx:73` (via F-001) | Session list is built from in-memory store — empty after server restart or 30 min idle. The user sees an "empty state" implying they've never made a decision, which is false. | Inherited from F-001. | L |
| F-041 | P1 | `DecisionLabPage.tsx:181-194` | Persona stack rendered as up to 3 grey circles each containing the letter "P". This is placeholder UI, not actual persona icons (Optimist/Critic/etc have configured icons in shared `PERSONA_CONFIGS`). | Map first `personaCount` ids to `PERSONA_CONFIGS[id].icon`. | S |
| F-042 | P2 | `DecisionLabPage.tsx:29-36` | `FILTER_TABS` includes `clarify` and `review` but omits `quick-take`. Sessions in that mode silently disappear from filter views. | Add the missing tab. | S |
| F-043 | P2 | `DecisionLabPage.tsx:7` | Imports `Avatar` but never uses it (dead import; tsc-strict will fail if `noUnusedLocals` enabled). | Remove import. | S |

### DecisionSessionPage (`pages/DecisionSessionPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-050 | P1 | `DecisionSessionPage.tsx:104` | "Export" button uses `window.open('/api/sessions/:id/export?format=json', '_blank')` — opens raw JSON in a tab. No download filename, no PDF, no Markdown, no shareable view. Underwhelming for a launch demo. | Add a proper "Export" modal with at minimum a Markdown download. | M |
| F-051 | P1 | `DecisionSessionPage.tsx:138` | textarea has corrupted class `border-borderrounded-lg` (F-005). | Inherit fix. | S |
| F-052 | P1 | `DecisionSessionPage.tsx:201` | Action bar has corrupted class `border-border-mx-6` — looks like `border-border -mx-6` was intended. Sticky bottom bar will lose its top border and full-bleed. | Insert space. | S |
| F-053 | P1 | `DecisionSessionPage.tsx:215-225` | AI nudge "Run Simulation" scrolls to `[data-simulation-button]` — SimulationButton does NOT carry that attribute. Click is silent no-op. | Add `data-simulation-button` to the rendered Simulation button. | S |
| F-054 | P2 | `DecisionSessionPage.tsx:12` | Imports `PERSONA_CONFIGS` unused. | Remove. | S |
| F-055 | P1 | `client/src/components/dashboard/QuickTakeWidget.tsx:27` | `mode: 'quick-take' as any` cast bypasses type-checking. Failures `catch { /* silently fail */ }` — user clicks Quick Take, nothing happens, no toast. | Type the mode literal, surface errors via `useToastStore`. | S |

### MemoryExplorerPage (`pages/MemoryExplorerPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-060 | P1 | `components/memory/MemoryDetail.tsx:74-84` | "Related Memories" loads `listMemories({ domain, limit: 5 })` — i.e. "any 5 memories from same domain" — not actually related. Misleading label. | Either rename to "Other memories in this domain" or call `searchMemories(memory.title)` for true semantic relatedness. | M |
| F-061 | P1 | `components/memory/MemoryDetail.tsx:435` | Tag removal button is the literal text "x" (lowercase letter), not an icon, not styled. Looks like a leftover. | Use × or `lucide-react` X icon. | S |
| F-062 | P2 | `MemoryExplorerPage.tsx:30-41` | "AI nudge" titled "You have memories that may benefit from entity links" always renders if any memory exists — no logic checks for actually-unlinked memories. Permanent fake nudge. | Compute unlinked count, gate on > 0. | S |
| F-063 | P2 | `components/memory/MemoryDetail.tsx:67-72` | Form reset uses derived `if (title !== memory.title && !editing) setTitle(...)` during render — anti-pattern (setState in render). | Use a `useEffect([memory.id])` reset. | S |

### PeopleDirectoryPage (`pages/PeopleDirectoryPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-070 | P2 | `PeopleDirectoryPage.tsx:8` | Imports `Tabs`, `Avatar` (unused). | Remove. | S |
| F-071 | P2 | `PeopleDirectoryPage.tsx:57` | `catch {}` swallows createPerson errors with no user feedback. | Surface via toast. | S |

### CustomPersonasPage (`pages/CustomPersonasPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-080 | P2 | `CustomPersonasPage.tsx:35` | Delete confirm uses native `window.confirm(...)` — jarring on a polished React/Framer app. | Replace with `Modal` confirmation. | S |
| F-081 | P2 | `components/settings/PersonaEditor.tsx:112,126,139,152` | 4× corrupted Tailwind classes (F-005 family). | Inherit. | S |

### IntegrationsPage (`pages/IntegrationsPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-090 | P1 | `IntegrationsPage.tsx:123-134` | "Slack" and "Notion" cards displayed with `status="coming_soon"` — pure marketing placeholders. They imply forthcoming integrations that are not on any roadmap. Show-HN visitors will email asking when. | Either build them, OR remove the cards. Don't ship promised features that aren't planned. | M |
| F-091 | P2 | `IntegrationsPage.tsx:39-66` | `connectGmail`/`connectCalendar` set `window.location.href = url` — if user blocks the redirect or popup blocker fires, no fallback. Also no in-app banner explaining what scope is being requested. | Add explanation modal, retry button. | M |

### SettingsPage (`pages/SettingsPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-100 | P1 | `SettingsPage.tsx:264-266` | "Delete Account" button hard-disabled with title "Account deletion coming soon". GDPR / privacy regulators require a working data deletion path before launch. | Implement DELETE /auth/account that soft-deletes user + cascades to OmniMind. | M |
| F-101 | P2 | `SettingsPage.tsx:111` | `scrollToSection` sets `activeSection` immediately but doesn't observe scroll position — so once user scrolls manually, the nav highlight is stale. | Use IntersectionObserver. | S |
| F-102 | P2 | `SettingsPage.tsx:248` | `<CalendarSettings />` rendered after Subscription with no anchor id and no entry in `SECTIONS` array. Nav has no "Calendar" item; user can scroll past unaware it exists. | Wrap in `<div id="settings-calendar">` and add to `SECTIONS`. | S |
| F-103 | P2 | `SettingsPage.tsx:237` | "Manage Integrations" uses `window.location.href = '/integrations'` (full page reload) instead of `useNavigate`. Breaks SPA experience. | Replace with `<Link>` or `navigate()`. | S |

### AdminPage (`pages/AdminPage.tsx`)
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-110 | **P0** | App.tsx:117 + sidebar — see F-003 | Whole page is publicly accessible. | Inherit. | M |
| F-111 | P1 | F-006 | Every Button uses non-existent `variant="outline"`. | Inherit. | S |
| F-112 | P1 | F-007 | Hard-coded `'admin'` userId. | Inherit. | S |
| F-113 | P2 | AdminPage.tsx — no "Refresh" or auto-poll | Stats panel never refreshes — user has to hard-reload to see current numbers. | Add polling or "Refresh" button. | S |
| F-114 | P2 | AdminPage.tsx:447 | After merge, code optimistically removes the pair from state without re-running the duplicate query — adjacent pairs that referenced the now-archived memory will still show but their merge will 4xx. | Re-fetch after merge. | S |

### Server routes — additional issues
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-120 | P1 | `server/src/routes/sessions.routes.ts:88,103` | `createdAt` returned as `new Date().toISOString()` — i.e. always "right now". Even within the 30-min TTL window the time-ago labels in Decision Lab are wrong. | Return the persisted `session.createdAt`. | S |
| F-121 | P1 | `server/src/routes/sessions.routes.ts:169` | `/questionnaire/answers` mutates session in-place via `session.question = ...` — re-running dispatch will run on a mutated question string. Also `questionnaireAnswers` field is not in `SessionState` type — written ad-hoc. | Store enrichment separately from question. Add typed field. | S |
| F-122 | P1 | `server/src/index.ts:101` | `// app.use('/rooms', roomsRouter); // TODO: Phase 2` — leftover commented-out router import. | Remove or implement. | S |
| F-123 | P2 | `server/src/index.ts:67-74` | SPA fallback regex enumerated by hand. If a new top-level route (e.g. `/rooms`, `/notifications`) is added, the team will forget to update this list and the route will serve index.html. | Use a generated allow-list or move all API under `/api/*` prefix only. | M |
| F-124 | P2 | `server/src/routes/integrations.routes.ts:73-86` | Gmail "confirm" loop hardcodes `created++` even if `omnimindClient.createMemory` rejects (no try inside loop), but errors here bubble out and stop the whole loop mid-way — UI gets a 500 after some memories were created. | Wrap per-iteration try, return `{ created, rejected, errors }`. | S |
| F-125 | P2 | `server/src/routes/onboarding.routes.ts:33` | `JSON.parse` on Claude's output with no try/catch — malformed model output triggers 500. | Wrap in try, fall back to `[]`. | S |
| F-126 | P2 | `server/src/routes/admin.routes.ts` | All admin routes are unauthenticated beyond JWT — no per-action audit log, no rate limit. A buggy client could DOS the OmniMind admin endpoints (decay, duplicates scan are expensive). | Add rate limiter + admin-action audit. | M |

### Components — additional issues
| ID | Severity | Location | Issue | Fix | Effort |
|---|---|---|---|---|---|
| F-130 | P2 | `components/dashboard/RelationshipMapWidget.tsx` (35 lines total) | Component very thin — likely just a wrapper. If `useRelationshipData()` reports `!hasEnoughData`, the widget likely renders nothing on dashboards with <3 people, giving an awkward empty slot. | Confirm + add visible empty state. | S |
| F-131 | P2 | `components/memory/MemoryDetail.tsx:104-107` | `handleDeleteLink` swallows errors silently. | Surface to user via toast. | S |
| F-132 | P2 | `components/dashboard/RecentDecisions.tsx:37` | API errors silently swallowed (`.catch(() => {})`). | Log + surface. | S |
| F-133 | P2 | `components/dashboard/QuickTakeWidget.tsx:56` | `catch { /* silently fail */ }`. | Surface to toast. | S |
| F-134 | P2 | `components/decision/PersonaCard.tsx` (not read but used) | Need to verify the streaming display correctly handles `persona_error` events — store nuke streamingPersonas but does PersonaCard render an error state? | Audit. | S |

---

## Dead Server Endpoints (no client caller)

These routes exist on the server but no code in `client/src/**` calls them. Either build the UI or delete the route.

| Endpoint | File | Status |
|---|---|---|
| `POST /sessions/:id/plan` (Doer) | `sessions.routes.ts:183-194` | Unused — no client UI to trigger Doer mode after dispatch. |
| `POST /sessions/:id/questionnaire` | `sessions.routes.ts:155-166` | Unused — Questionnaire persona is part of normal dispatch; this standalone endpoint is unreached. |
| `POST /sessions/:id/questionnaire/answers` | `sessions.routes.ts:169-180` | Unused — no UI sends clarification Q&A. |
| `POST /sessions/:id/extract-memories` | `sessions.routes.ts:197-211` | Unused — `proposeExtractions` flow never invoked from client. |
| `POST /sessions/:id/confirm-memories` | `sessions.routes.ts:214-231` | Unused — paired confirm step. |
| `GET /cortex/memo/history` | `cortex.routes.ts:42-49` (client: `api.getMemoHistory` defined but never called) | UI to browse historical memos was planned, never built. |
| `GET /outcome-reviews` (non-`/pending`) | `entities.routes.ts:249-256` | Only `/pending` is consumed. |

---

## Ghost Features (UI promises something backend can't deliver)

| Feature | Location | Reality |
|---|---|---|
| **Slack integration** | `IntegrationsPage.tsx:123-128` | "coming_soon" placeholder card. No service, no OAuth, no route, no roadmap entry. |
| **Notion integration** | `IntegrationsPage.tsx:129-134` | Same — pure UI bait. |
| **PDF export** | `client/lib/api.ts:235` (`exportSession(id, 'pdf')`) | Server returns 501. No UI selector exposes it yet — but the typed API does, which is a footgun. |
| **Account deletion** | `SettingsPage.tsx:264` | Button visible but disabled. GDPR compliance gap. |
| **Past Decisions** | `RecentDecisions` widget + Decision Lab list | Built on in-memory store with 30-min TTL — to the user this looks like "my history disappeared" the next morning. |
| **Subscription billing** | All `/subscription/*` flow | Stripe webhook can't verify (F-002) → upgrades won't promote, cancellations won't revoke. The Stripe service exists, but the seam to it is broken. |
| **Admin tooling** | Sidebar "Admin" link visible to all | Opens to fully functional cross-tenant admin. Not a ghost feature — an exposed one. |
| **Related Memories** | `MemoryDetail.tsx` "Related Memories" section | Currently shows "5 random same-domain memories", labeled as related. Cosmetic lie. |
| **Weekly memo "Read" nudge** | `DashboardPage.tsx:138` | Scrolls to `#weekly-memo` which doesn't exist. |
| **"Run Simulation" nudge** | `DecisionSessionPage.tsx:221` | Scrolls to `[data-simulation-button]` which doesn't exist. |
| **Persona avatars in session list** | `DecisionLabPage.tsx:185` | Grey circles with letter "P" — should be the actual persona icons configured in `@boardroom/shared`. |
| **Terms / Privacy policy** | `LoginPage.tsx:351` | Static text only. No `/terms` or `/privacy` pages exist. |
| **Calendar settings nav entry** | `SettingsPage.tsx` SECTIONS | Calendar settings render below "Account" but no nav item points to them. |

---

## Severity totals

| Severity | Count |
|---|---|
| P0 (broken/missing core) | 5 (F-001, F-002, F-003 + F-110, F-004, F-040) |
| P1 (stubbed / load-bearing degraded) | ~25 |
| P2 (cosmetic / minor UX) | ~25 |

## Recommended ship-blockers (the 7 that absolutely must close before public launch)

1. **F-001** — persist sessions (every Decision Lab user will hit this on Day 2).
2. **F-002** — fix Stripe webhook ordering (revenue will not flow).
3. **F-003 / F-110** — gate the Admin route + endpoints + sidebar item.
4. **F-005** — fix the 15 corrupted Tailwind class strings (quick win, visible polish).
5. **F-100** — implement Delete Account (legal requirement before HN traffic).
6. **F-090** — remove Slack/Notion placeholder cards (don't lie to early users).
7. **F-010** — write `/terms` + `/privacy` (Stripe + Google OAuth verification require them).

Everything else can ship as a P1/P2 known-issue list.
