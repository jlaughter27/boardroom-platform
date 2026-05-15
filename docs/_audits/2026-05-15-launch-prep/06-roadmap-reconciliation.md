# 06 — Roadmap Reconciliation Audit

**Date:** 2026-05-15
**Scope:** BoardRoom AI (`packages/boardroom-ai/`) + `packages/shared/`. OmniMind API explicitly out of scope (separate audit).
**Sources cross-referenced:**
`CLAUDE.md` (root + `.claude/` + per-package), `docs/STATUS/{CURRENT-PHASE,PHASE-PROGRESS-TRACKER,BLOCKERS,CHANGELOG}.md`, `docs/roadmap/04-roadmap/`, `docs/02-reference/{DECISIONS,FRAGILE-ZONES}.md`.

---

## Executive summary

**Doc / code alignment score: 4 / 10.**

The roadmap is well-engineered as a *forward-looking* document, but it has drifted badly from the *current* state of the codebase. Two parallel realities are running:

1. **`docs/STATUS/CURRENT-PHASE.md` + `CHANGELOG.md`** describe an `OmniMind-MCP` track ("MCP Phase 1..5") that is up through Phase 5 (Solo Go-Live) with admin UI, importance decay, duplicate detection, ministry deferral, and weekly digest — all shipped.
2. **`docs/roadmap/04-roadmap/` + `PHASE-PROGRESS-TRACKER.md`** describe a 19-phase plan where every single row from Phase 0 through Phase 19 is still `todo`. None of the "real" work that has shipped (admin dashboard, MCP server, fact extractor, importance decay, encryption-at-rest, weekly digest, RLS facade deletion, version race fix, OAuth state signing, Stripe webhook idempotency …) is reflected in the tracker.

The `.claude/CLAUDE.md` "Phase Status" table (Phases 0/1/2/3 marked complete) is closest to reality for BoardRoom, but Phase 3 (Integrations) is more partial than claimed and Phase 0.25 critical-security fixes are explicitly listed as `todo` in the tracker while several have actually been done — and the most consequential one (Stripe webhook) has been done **incorrectly** and is still exploitable.

The two most important findings:

- **Phase 0.25 is not finished.** Of six numbered tasks, three are done correctly, one is done weakly, one is done **broken** (Stripe webhook), and two are not done at all on the BoardRoom side. The roadmap claims these are launch-blockers; the audit confirms they are.
- **A new admin surface (Phase 4 of MCP track) has been added with no authorization guard.** Any authenticated user can hit `/admin/*` and read every other user's memories, audit log, agents, and contradictions, plus trigger merges and decay jobs. This is a new finding that does not appear in any roadmap doc — it snuck in during the admin UI work.

**Honesty rating per doc:**
- `.claude/CLAUDE.md` Phase Status table — directionally honest but optimistic on Phase 3.
- `CURRENT-PHASE.md` — honest about the MCP track, silent about everything else.
- `PHASE-PROGRESS-TRACKER.md` — **dishonest by omission**; literally everything is "todo" while material work has shipped.
- `BLOCKERS.md` — frozen on 2026-04-18; ignores actual blockers introduced since.
- `CHANGELOG.md` — accurate for what it covers; covers a small slice of reality.

---

## Phase-by-phase reality table

| Phase | Doc-claimed status | Actual code status | Delta | Notes |
|---|---|---|---|---|
| **Phase 0 — Foundation cleanup** | `todo` in tracker, "complete" in `.claude/CLAUDE.md` | Partial. No log drain wired; no dead-code drop pass (Deepgram WS proxy still sitting in `server/src/transcription/deepgram-proxy.ts` unused). | Tracker stale | `docs/STATUS/BLOCKERS.md` still lists "No log drain wired" as a phase-blocker. |
| **Phase 0.25 — Critical security fixes** | All 6 numbered tasks `todo` | 3 fixed correctly, 1 partial, 1 broken, 2 not done in BoardRoom | See dedicated matrix below. **Launch blocker.** |
| **Phase 0.5 — Eval harness** | `todo` | Not started in BoardRoom. `eval/` directory exists at repo root but no MRR/nDCG runner. | Aligned (both say `todo`) | Roadmap blocker: no log drain, no eval harness. |
| **Phase 1 — Schema alignment** | `todo` | Not started; `MemoryEntry.version` exists but is unused for optimistic concurrency. | Aligned | — |
| **Phase 2 — Pattern extraction + write loop** | `.claude/CLAUDE.md` says complete; roadmap tracker says `todo` | Cortex routes + service stubs exist on BoardRoom side (`cortex.routes.ts` proxies to OmniMind: `/patterns/scan`, `/memo/generate`, `/contradictions/scan`, `/simulate`). UI in cortex store + `SimulationPanel.tsx`. But no `MemoryWriteEvent` durability layer. | `.claude/CLAUDE.md` claim is overstated | The user-facing surface ships; the durability layer the roadmap calls "Phase 2" does not. |
| **Phase 3 — Integrations** | `.claude/CLAUDE.md` says "Partial" | Calendar + Gmail + Stripe routes mounted. Custom personas wired. Gmail extract + confirm exist. **No transcription route mounted on the server** despite `transcription.service.ts` being implemented (only called from `onboarding-bootstrap.routes.ts`). Voice recorder UI exists (`client/components/onboarding/VoiceRecorder.tsx`) and is bound to onboarding only. | Honest, but punch list below. | |
| **Phase 4+ (Collaboration)** | "Future" | `// app.use('/rooms', roomsRouter); // TODO: Phase 2` in `index.ts:101`. No room routes implemented. `Room`, `Participant`, `AdvisorMessage`, `MeetingOutput` Prisma models exist but no BoardRoom surface. | Aligned (not started) | — |
| **MCP Phases 1–5 (in `CURRENT-PHASE.md`)** | "Phase 5 — Solo Go-Live (in flight)" | Largely shipped: MCP package, admin UI, audit log, agent registry, session summarizer, weekly digest, importance decay, duplicate detection. **But Admin UI has no role guard (see findings).** | Doc accurate for shipped scope, but skips the new vulnerability it introduced. | — |
| **Phases 6–19 (roadmap)** | All `todo` | Not started, as expected. | Aligned | — |

---

## CLAUDE.md rule + anti-pattern + integration-gap compliance

### Critical Rules (root + `.claude/CLAUDE.md`, 10 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | Never delete working code to "simplify." | PASS | No instances of recent destructive simplification seen. |
| 2 | OmniMind owns data; BoardRoom calls via HTTP only. | PASS | `grep prisma\\.` in BoardRoom returns 0 hits. Boundary intact. |
| 3 | All LLM outputs validated with Zod before reaching users. | MOSTLY PASS | `SynthesisReportSchema.parse`, `QuestionnaireResponseSchema.parse`, `DoerTaskBreakdownSchema.parse`, `ExtractedGoalsSchema.parse`, `ExtractedProjectsSchema.parse` all enforced. **Exception:** persona dispatch path in `orchestrator.ts:106,152` calls `reasonStreaming` which streams raw text to the client; whatever Zod validation lives inside the agent is opaque from the route layer. |
| 4 | Types live in `packages/shared`. | PASS | All BoardRoom imports of entity types are from `@boardroom/shared`. |
| 5 | Persona prompts live in `docs/prompts/*.system.md`. | PASS | `prompt-loader.ts` walks up to find `docs/prompts/`; all loads route through it. No hardcoded prompts found in TS files outside of `_REFERENCE-old-personas.md`. |
| 6 | Every memory write goes through validation pipeline. | NOT VERIFIABLE FROM BOARDROOM | BoardRoom only proxies to OmniMind; the pipeline lives there. **BUT** the proxy at `entities.routes.ts:224` (`POST /memories`) and `integrations.routes.ts:69-87` (`POST /gmail/confirm`) accept arbitrary `req.body` and forward verbatim — no client-side Zod gate. OmniMind is the only thing guarding the pipeline. |
| 7 | Max 7-10 context items per persona call. | PASS | `RETRIEVAL_CONFIG.maxItemsPerPersona = 10`, `maxItemsCEO = 15`. `context-strategy.ts` propagates the cap into every `/context/for-persona` request. Enforcement depends on OmniMind honoring `maxItems`. |
| 8 | No other LLM providers in v1. | PARTIAL FAIL | OpenAI is allowed by ADR for embeddings, but `transcription.service.ts` also uses OpenAI Whisper as a fallback (intentional, scoped). Deepgram is in `transcription.service.ts` and the (unused) WS proxy. ADR-002 wording reads as "Claude only" for reasoning — these are transcription/embedding utilities, so likely intent-compliant but not explicit in the ADR. |
| 9 | No framework deps for agent orchestration. | PASS | `agents/` is ~5 files, all in-house. |
| 10 | Zod schemas must match TS interfaces. | NOT AUDITED | Out of scope here; cross-package schema sync should be its own audit. |

### Anti-patterns to avoid (root CLAUDE.md, 5 items)

| # | Anti-pattern | Status | Evidence |
|---|---|---|---|
| 1 | Direct DB access from BoardRoom | NONE FOUND | — |
| 2 | Bypassing Zod validation | OCCURS | Proxy routes in `entities.routes.ts` and `cortex.routes.ts` forward `req.body` to OmniMind with no schema check. Mass-assignment surface (Phase 0.25.3). Only `PATCH /profile` and a few auth endpoints validate. |
| 3 | Hardcoded persona logic in TS | NONE FOUND | All persona logic lives in `docs/prompts/*.system.md` and `PERSONA_CONFIGS`. |
| 4 | Ignoring Goal→Project→Task relationships | OCCURS | The persona context strategy fetches separate entity slices per persona (`context-strategy.ts:13-20`) without pulling the linked entity chain. No code in BoardRoom requests the GP-linked DAG. This is the "Module Integration Gap #4" from root CLAUDE.md, still unaddressed. |
| 5 | Siloed persona analysis without shared context | OCCURS | Each persona promise in `orchestrator.dispatch` (lines 73-107) independently calls `getContextForPersona` — no shared SessionContext, no persona-to-persona references. Anti-pattern #5 is the **current** design. |

### Module Integration Gaps (root CLAUDE.md, 4 gaps)

| # | Gap | Current state | Delta vs CLAUDE.md description |
|---|---|---|---|
| 1 | Persona Module — siloed context | **No progress.** `context-strategy.ts` is exactly the file described as the problem. | No fix attempted. |
| 2 | Roadmap Module — no temporal planning | **No progress.** No `RoadmapService` in BoardRoom; no `/roadmap` endpoints; no timeline UI. | No fix attempted. |
| 3 | Task Management — no extraction pipeline | **Partial.** `runDoer()` in orchestrator produces `DoerTaskBreakdown`; `extraction.service.ts` proposes memory extractions. **But there is no path from Doer's task breakdown into `POST /tasks` via OmniMind.** `client/pages/DecisionSessionPage.tsx` does not call `omnimindClient.createTask` from synthesis. | Half-built. |
| 4 | State sharing across personas | **No progress.** Each persona gets a separate context fetch; no SessionContext entity chain. | No fix attempted. |

---

## Phase 0.25 launch-blocker matrix

| Task | Code location | Required behavior | Current state | Verdict |
|---|---|---|---|---|
| **0.25.1 — OAuth state signing (A1)** | `services/google-calendar.service.ts:8-26`, `routes/calendar.routes.ts:22-31`, `routes/integrations.routes.ts:32-41` | JWT-signed nonce with TTL + single-use replay protection. | HMAC over `${provider}:${userId}` with `STATE_SECRET = JWT_SECRET || 'fallback-dev-secret'`. **No TTL, no nonce, no replay protection.** Falls back to insecure default if `JWT_SECRET` unset. | **PARTIAL FIX. Still vulnerable.** Token never expires; harvested state can be replayed indefinitely. |
| **0.25.2 — Stripe webhook (A2 + A4)** | `index.ts:50`, `routes/subscription.routes.ts:27`, `services/stripe.service.ts:45` | Raw body + signature verification + mounted **above** auth wall + idempotency table | Two compounding bugs: **(a)** `express.json()` runs at `index.ts:50` BEFORE `subscriptionRouter` is mounted, so `req.body` is parsed JSON by the time the per-route `raw({type:'application/json'})` would normally fire — signature verification will fail on every event. **(b)** `subscriptionRouter` is mounted **after** `authMiddleware` at `index.ts:91`; Stripe redirects have no JWT cookie → 401 unauthorized. **(c)** No idempotency table → replayed events double-write. | **BROKEN. Critical launch blocker.** Webhook has never worked in production. |
| **0.25.3 — Mass-assignment Zod (A3)** | `omnimind-api/src/routes/user-profile.routes.ts` (out of scope) | `.strict()` Zod on PATCH | Cannot verify (out of scope), but `boardroom-ai/server/src/routes/entities.routes.ts:11-24` mirrors with `.strict()` for `PATCH /profile`. **Other proxy routes do not validate.** | **PARTIAL.** The named route is fixed; sibling mass-assignment surfaces (`POST /memories`, `POST /goals`, `POST /projects`, `POST /tasks`, `POST /people`, `POST /custom-personas`, `PATCH` variants of all) all forward `req.body` unchecked. |
| **0.25.4 — Delete RLS facade (A4)** | `omnimind-api/src/lib/db-audit.ts` | File deleted, grep gate added | Out of scope here (OmniMind file). | NOT AUDITED IN THIS REPORT. |
| **0.25.5 — `ENCRYPTION_KEY` fail-closed (A5)** | `omnimind-api/src/lib/{env,crypto}.ts` | Throw on missing in any env | Out of scope (OmniMind). BoardRoom's own `lib/env.ts:3-10` does not require `ENCRYPTION_KEY` at all (BoardRoom doesn't encrypt anything itself). | NOT AUDITED. |
| **0.25.6 — Version race fix (B1)** | `services/memory.service.ts` (OmniMind) + `services/omnimind-client.ts` + `routes/memories.routes.ts` | `If-Match` header propagated by BoardRoom | `omnimind-client.ts` and `entities.routes.ts:231-236` do not read or forward `If-Match`. **Even if OmniMind enforces it, BoardRoom always wins the race because it never sends a version.** | **NOT DONE on BoardRoom side. Launch blocker for any concurrent edit.** |
| **Unnumbered: per-tenant token meter** | `User.tokensUsedToday` + meter | Not present. | Cost tracker exists (`services/cost-tracker.ts`) but no per-tenant cap enforced. | NOT DONE. |
| **Unnumbered: DATABASE_URL pool params** | `DATABASE_URL=…?connection_limit=25&pool_timeout=15` | BoardRoom doesn't connect to DB → N/A. | N/A | — |
| **Unnumbered: p-limit on Sonnet (20) and Haiku (50)** | Anthropic call sites | Concurrent-call cap | No `p-limit` import in BoardRoom. `orchestrator.dispatch` uses `Promise.allSettled` across all personas with no concurrency cap; a single mode-`decide` request fires ~6 Sonnet/Haiku calls in parallel; multiple users multiply this. | NOT DONE. Real risk during a launch-day traffic spike. |
| **NEW finding — Admin route role guard** | `routes/admin.routes.ts` + `middleware/auth.ts` | Only admin users should reach `/admin/*` | The admin proxy has **no role check**. Any authenticated user can GET `/admin/memories?tenantId=…&q=…` and read every other tenant's data, or POST `/admin/duplicates/merge` to merge other users' records. No `isAdmin` field on JWT or User. | **CRITICAL launch blocker.** Trivial cross-tenant data exfiltration. |
| **NEW finding — `JWT_SECRET` fallback in OAuth state** | `services/google-calendar.service.ts:6` | Should throw if unset | `STATE_SECRET = process.env.JWT_SECRET \|\| 'fallback-dev-secret';` — silently insecure if env loading fails in any environment. | **Launch blocker (security).** |

---

## Phase 3 (Integrations) completion punch list

What's missing to call Phase 3 "complete":

| Item | Effort | Why |
|---|---|---|
| Wire transcription route for session input (not just onboarding) | M | `transcription.service.ts` is implemented but only called by `onboarding-bootstrap.routes.ts:148`. Sessions can't accept voice. |
| Wire commitment tracker into session synthesis flow | S | `services/commitment-tracker.ts` exists with `commitment-extraction.system.md` prompt loaded but is never invoked from a route. |
| Stripe webhook actually working (Phase 0.25.2) | M | See blocker matrix. |
| Email scanner UI → flow into `Gmail/extract` | S | `EmailScanner.tsx` component exists; user flow from `IntegrationsPage` is partial. |
| Calendar event → decision-context link | M | `calendarService.getEvents` returns events but no consumer wires them to session context. |
| Custom personas marketplace/discovery UI | M | `CustomPersonasPage.tsx` exists for CRUD; no discovery/install path (this is Phase 17 territory — fine to defer). |
| Subscription middleware: stop failing open | S | `middleware/subscription.middleware.ts:31` swallows all errors and lets request through. ADR-010 should be narrowed (Phase 18 task). |
| Delete `transcription/deepgram-proxy.ts` (dead code) or wire it | S | Phase 0 cleanup item. |

---

## Phase 4+ launch-worthy candidates (ranked by value × effort)

| Rank | Feature | Source phase | User value | Effort | Verdict for launch |
|---|---|---|---|---|---|
| 1 | Task extraction pipeline (Doer → `POST /tasks`) | "Module gap #3" | High — closes the goal→project→task loop the product is sold on | M (1 week) | **IN.** Without it, the "system understands my priorities" promise is hollow. |
| 2 | Timeline view of goals/projects/tasks | Module gap #2 | High — first visualization a buyer asks for | M-L | Stretch. Out for v1; ship the data, defer the viz. |
| 3 | Multi-user rooms (`/rooms` router) | Phase 4 (placeholder TODO) | High for B2B but the product is solo-founder-first per CLAUDE.md | XL | **OUT.** Don't open this can. |
| 4 | Markdown export of decisions/sessions | Phase 11 | Medium — "your data is yours" trust signal | M | Stretch. JSON export already exists in `export.service.ts`; add a `format=md` switch. |
| 5 | Memo digest UI (latest + history) | Cortex phase | Medium — already wired backend; just needs a polished frontend | S | **IN.** Most of the surface area exists in `cortex.store.ts`. |
| 6 | Outcome review UI | Already implemented routes | Medium — closes the feedback loop | S | **IN.** `outcome-reviews/*` routes exist; UI consumer should be verified. |
| 7 | Public TS SDK | Phase 13 | Low until external developer demand exists | L | **OUT.** Premature. |
| 8 | Webhooks | Phase 12 | Low for v1 | L | **OUT.** |
| 9 | Persona marketplace | Phase 17 | Low for v1 | XL | **OUT.** |
| 10 | Cortex memo / pattern dashboard | Cortex | Medium — already partly built | S | **IN.** |

---

## Stub / TODO inventory (BoardRoom-side)

Grouped by area:

| Area | File:line | Stub | Triage |
|---|---|---|---|
| Routing | `server/src/index.ts:101` | `// app.use('/rooms', roomsRouter); // TODO: Phase 2` | Planned (Phase 4+). Leave. |
| Session export | `server/src/routes/sessions.routes.ts:242` | `res.status(501).json({ error: 'not_implemented', message: 'PDF export coming in Phase 2' });` | Stretch; JSON exists. |
| Transcription | `server/src/transcription/deepgram-proxy.ts` | "BOOKMARKED: This is Phase 3+ functionality. Preserved as working code." | Dead code; not imported. Either wire it or delete (Phase 0 cleanup). |
| Orchestrator | `server/src/agents/orchestrator.ts:251` | `throw new Error('FALLBACK_TO_STREAMING');` (control-flow-by-throw) | Smell, not a bug. Refactor to a return-based path. |
| OAuth state | `server/src/services/google-calendar.service.ts:6` | `JWT_SECRET \|\| 'fallback-dev-secret'` | Security bug. |
| Stripe webhook | `server/src/routes/subscription.routes.ts:27` + `index.ts:50/91` | Mounted in wrong order, no idempotency | Security/data-integrity bug. |
| Subscription middleware | `server/src/middleware/subscription.middleware.ts:31-34` | Fails open on errors | ADR-010 — accepted, but should be narrowed pre-launch. |
| Admin guard | `server/src/routes/admin.routes.ts` (whole file) | No role check | Security bug. |
| Memory proxies | `server/src/routes/entities.routes.ts:39,71,103,135,189,224,231,238` | No request-body Zod validation on most POST/PATCH | Mass-assignment surface. |
| Cortex proxies | `server/src/routes/cortex.routes.ts:78-83,89-94` | PATCH/POST forward raw `req.body` | Same. |
| Custom personas proxy | `server/src/routes/custom-personas.routes.ts:20,28` | Same | Same. |
| Integrations Gmail confirm | `server/src/routes/integrations.routes.ts:69-87` | Trusts client to provide `proposals` shape | Same. |
| Sessions store | `server/src/routes/sessions.routes.ts:19-23` | In-memory sessions Map, lost on restart | Documented limitation; raises stickiness need (Phase 19). |
| Memory-extractor prompt id | `server/src/agents/memory-extractor.ts:25` | `loadPrompt('memory-extractor' as any)` (cast to bypass `PersonaId` type) | Type-system bypass. Fix by adding `memory-extractor` to the `PersonaId` union or using `loadSystemPrompt`. |

---

## Persona system completeness

The full persona inventory (per `.claude/CLAUDE.md`): **7 core + 6 specialized + 7 cortex = 20**.

| Persona | Prompt file? | Loader call? | Route/handler? | Client surface? | Status |
|---|---|---|---|---|---|
| optimist | ✅ | ✅ (`orchestrator.ts:81`) | sessions dispatch | PersonaCard | OK |
| critic | ✅ | ✅ | sessions dispatch | PersonaCard | OK |
| alternate | ✅ | ✅ | sessions dispatch | PersonaCard | OK |
| technician | ✅ | ✅ | sessions dispatch | PersonaCard | OK |
| questionnaire | ✅ | ✅ (`orchestrator.ts:295`) | `POST /sessions/:id/questionnaire` | Yes | OK |
| doer | ✅ | ✅ (`orchestrator.ts:312`) | `POST /sessions/:id/plan` | Yes | OK |
| ceo | ✅ | ✅ (`orchestrator.ts:215`) | `POST /sessions/:id/synthesize` | SynthesisPanel | OK |
| email-extractor | ✅ | ❌ — no `loadSystemPrompt('email-extractor')` found in BoardRoom | Indirectly via `gmail.service.extractMemoriesFromEmail` (uses inline prompt or implicit?) | EmailScanner | **ORPHAN PROMPT.** File exists; loader does not. |
| memory-extractor | ✅ | ✅ (`memory-extractor.ts:25`, with `as any` cast) | `POST /sessions/:id/extract-memories` | Memory extraction modal | OK with type smell |
| commitment-extraction | ✅ | ✅ (`commitment-tracker.ts:29`) | **No route** invokes `commitment-tracker` | None | **ORPHAN.** Loader wired, service exists, never called. |
| onboarding-goals | ✅ | ✅ | `POST /onboarding/extract-goals` | Onboarding flow | OK |
| onboarding-projects | ✅ | ✅ | `POST /onboarding/extract-projects` | Onboarding flow | OK |
| onboarding-bootstrap | ✅ | ✅ | `POST /onboarding-bootstrap/...` | BootstrapStep | OK |
| sufficiency-check | ✅ | ✅ (`sufficiency.ts:13`) | `POST /sessions/:id/check-ambiguity` | SufficiencyBanner | OK |
| cortex-memo | ✅ | ❌ in BoardRoom (lives in OmniMind) | proxied via cortex.routes | Memo viewer (partial) | OK (delegated) |
| cortex-patterns | ✅ | ❌ in BoardRoom | proxied | List view | OK (delegated) |
| cortex-contradictions | ✅ | ❌ in BoardRoom | proxied | List view | OK (delegated) |
| cortex-simulation | ✅ | ❌ in BoardRoom | proxied via `/cortex/simulate` | SimulationPanel | OK (delegated) |
| `_REFERENCE-old-personas.md` | n/a | n/a | n/a | n/a | Should move to `docs/_archive/`. |

**Orphans:**

1. `commitment-extraction.system.md` — prompt + service + cost tracking all exist; no route ever fires it. Either wire into the synthesis flow (recommended; track commitments per session) or remove.
2. `email-extractor.system.md` — referenced as a persona but no loader hits it from BoardRoom. Email extraction in `gmail.service.ts` may use a different mechanism — needs verification.

---

## Proposed launch-day scope

### IN (must ship)

1. **Phase 0.25.2 (Stripe webhook), correctly.** Move handler above auth wall and above `express.json()`. Add `processed_stripe_events` idempotency table. Test end-to-end with Stripe CLI. **Critical.**
2. **Admin route authorization.** Add `isAdmin` claim to JWT (or to OmniMind user lookup) and `requireAdmin` middleware on `adminRouter`. **Critical.**
3. **OAuth state hardening.** Replace HMAC-state with JWT-state including `exp` (5 min) and a server-side nonce store (in-memory is fine for solo). Remove `'fallback-dev-secret'` fallback. **High.**
4. **Phase 0.25.6 client-side `If-Match` propagation.** `omnimind-client.updateMemory` must accept and forward an `If-Match` header; UI must pass version through. **High.**
5. **Zod schemas on proxy mutators.** At minimum: `POST /memories`, `POST /goals/projects/tasks/people`, `POST /custom-personas`. Use `.strict()` mirroring OmniMind schemas. **Medium.**
6. **Subscription middleware: harden the fail-open path** (rate-limit retries; if OmniMind is unreachable for >N seconds, fall closed with friendly message). **Medium.**
7. **`p-limit` on Anthropic concurrent calls** in `orchestrator.dispatch` and `synthesize`. **Medium.**
8. **Wire commitment tracker into post-synthesis** so the existing prompt+service do something. **Low (already built).**
9. **Doer → `POST /tasks` extraction.** Closes the cognitive cohesion promise. **Medium.**
10. **Move `_REFERENCE-old-personas.md` to `docs/_archive/`** and delete `transcription/deepgram-proxy.ts` (or wire it). **Low.**

### OUT (defer)

- Multi-user rooms (Phase 4+ scope per CLAUDE.md).
- Markdown export (Phase 11).
- Public SDK (Phase 13).
- Persona marketplace (Phase 17).
- Webhooks (Phase 12).
- Timeline visualization (gap #2).
- Phase 0.5 eval harness (build after launch; collect 35 real queries from dogfooding instead of hand-labeling).

### Doc hygiene tasks

- `PHASE-PROGRESS-TRACKER.md` is **completely out of sync** with reality. Either back-fill the `done` rows for what's actually shipped, or split the tracker so Phase 0/1/2/3 of the "operational" track is separate from Phase 0/0.25/0.5/1+ of the "memory-system" track.
- `BLOCKERS.md` is dated 2026-04-18 and predates everything in MCP Phase 1–5. Refresh or archive.
- The `.claude/CLAUDE.md` "Phase Status" table should mark Phase 3 as "Partial — see audit 2026-05-15".
- The newly discovered admin-guard vulnerability needs an entry in `BLOCKERS.md` and a row in `STATUS/DECISIONS-LOG.md` capturing the decision to add `requireAdmin`.

---

## Summary of findings (count)

- **Critical (launch blockers):** 4 — Stripe webhook broken, admin route un-guarded, OAuth state fallback insecure, `If-Match` not propagated.
- **High:** 6 — `p-limit` missing, mass-assignment surfaces on 8+ proxy routes, subscription middleware fails open, commitment-tracker orphan, Doer→task gap, control-flow-by-throw in synthesize.
- **Medium:** 12 — context strategy siloed, no shared SessionContext, no `MemoryWriteEvent` durability, no per-tenant token meter, no role-check on admin merge endpoint, prompt-loader type cast, in-memory sessions, fail-open subscription, deepgram-proxy dead code, email-extractor orphan, no PDF export, no markdown export.
- **Low / doc hygiene:** 10+ — tracker desync, blockers stale, `_REFERENCE-old-personas.md` in prompts dir, missing CI workflows, etc.

**Total findings: ~45.**

The roadmap is a great planning document. It is not, today, a description of what is in the codebase. Closing the four critical findings above, plus the admin-guard finding, is the minimum bar for launch.
