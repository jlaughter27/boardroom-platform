# Changelog

Append-only log of work shipped against this roadmap. Most recent at top.

Format: `## YYYY-MM-DD — Phase X — Action`

---

## 2026-10-23 — Phase 8 real-data — Agent wave 3 (RD-1, RD-2, RD-4, RD-5, RD-6, RD-7, RD-9)

**Branch:** `claude/amazing-mccarthy-grvem2` (rides PR #28) | **Status:** Pushed | **Tests:** shared 163, mcp 272, api 1,305, server 309, client 582; e2e 58/58; importer 19/19

Four parallel worktree lanes, integrated on the PR #28 branch:
- **RD-1** Memory Detail renders markdown (sanitizing react-markdown + remark-gfm, no raw HTML); `[[wikilinks]]` resolve via the importer's link rows, then by title, else "Not imported"; "Linked from" via new `GET /memories/:id/backlinks`; card previews are plain text.
- **RD-2** Root cause of reordering: a non-transitive ±0.05 tie rule in `rankAndDeduplicate`, no id tie-breaks in the lexical layers, and a recency boost fed by `/context/for-persona` writes. Fixed with title-weighted FTS (A/D), a total order + id tie-breaks, and no recency boost on `/memories/search`. Synthetic vault-shaped eval corpus + keyword / natural-language slices. `thresholds.json` unchanged.
- **RD-4** Domain budgets are soft: over-budget writes succeed with a `budget` warning; `GET /memories/budget`; Settings panel.
- **RD-5** Importer `--prune` (archive deleted notes, remove dropped wikilinks; mass-prune guard); GET/DELETE `/memories/:id/links` now tenant-scoped for agents; automatic-sync workflow recipe for the private vault repo.
- **RD-6** Graph `memoryLimit` up to 1000 + `stats.memoryTotal`; "Show 200 more"; 500 memories settle in 4.29 s.
- **RD-7** Synthetic vault fixture + `tests/e2e/live/checks/vault-import.mjs`, gated in the CI `E2E` job.
- **RD-9** Rebuttals restored on reload; 20rem waiting/error cards on phones; snippet stacks under Copy at < 640 px; retry banner in the layout; decorative gold on tokens; WebKit cookie fix documented (not reproduced — no WebKit here).

**Open:** RD-8 (ratchet after three green main runs — the new slices restart the count), IVFFlat index built on an empty table (eval noise), persona context empty when a single top note exceeds the token budget (pairs with RD-3), MCP `memory_write` does not surface the budget warning.

---

## 2026-10-23 — Real-data roadmap

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed | **Tests:** docs only

- `docs/roadmap/PHASE-8-REAL-DATA-ROADMAP.md`: the 12 findings of the real-data run (4 fixed in PR #28, 8 open), sequenced into Stage 0 founder unblock → Stage 1 production go-live with the real vault → Stage 2 agent wave 3 (RD-1…RD-9, no founder dependency) → Stage 3 M1 remainder, long-note embeddings, ministry path → Stage 4 Phase 8 M2. Decisions the founder owns and blind spots listed.
- Tracker: "Phase 8 — real-data follow-ups" (RD-0…RD-10). CURRENT-PHASE points at the roadmap.

---

## 2026-10-23 — Real-data end-to-end: 5 production issues found with a real vault and fixed

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed, PR | **Tests:** omnimind-api +7 (limiter 2, FTS 2, batch links 3), server +3 (provider errors), shared schema + interface for batch links, vault importer 12 → 14

Full local stack (BoardRoom production build, OmniMind, MCP gateway) loaded with the founder's real Obsidian vault through `pnpm import:vault`, then driven through the UI and MCP: sign-in, dashboard, Memory Explorer, knowledge graph, retrieval on ~20 real questions, a decision session, token minting, MCP search/fetch/status/graph, an MCP write read back in BoardRoom, tenant isolation, ministry exclusion. No LLM or embedding keys in the sandbox: semantic search and persona answers were not exercised (stated, not mocked). Production is still unreachable from the sandbox. Final run: 16/16 steps, zero console errors. Vault content stays out of this repo.

- **Fixed — POST reads drained the write budget.** The per-user limiter keyed buckets by HTTP method, so `POST /memories/search`, `/context/for-persona`, `/memories/search-similar` and `/memories/validate` counted against the 20/min write budget: one decision dispatch (one `/context/for-persona` per persona) or an MCP client searching hard locked the user out of every POST, writes included. They now share the read budget (`READ_ONLY_POST_PATHS`). The CI retrieval eval was hitting the same 429s.
- **Fixed — full-text search was all-words-or-nothing.** Natural-language questions rarely contain every word of one memory, so the FTS layer returned nothing and recall leaned entirely on embeddings. A ranked any-word pass now fills slots below the strict hits. Labeled IR eval in CI (PR run vs the last `main` run): for-persona recall@10 0.520 → 0.718 (MRR 0.440 → 0.532); `/memories/search` recall@10 0.535 → 0.826 (MRR 0.549 → 0.688); stale-hit rate 0; the eval job no longer sleeps on 429s (7 → 3 min). A local run through the test-harness entrypoint scored higher (0.939 / 0.952) — CI's built-server run is the number of record.
- **Fixed — an imported vault showed an empty knowledge graph.** Wikilinks were not links, every note was an orphan, and orphans are hidden by default. New `POST /memories/links/batch` (≤ 500 links, same ownership/tenant rules, idempotent) and an importer link phase that resolves `[[wikilinks]]` by name/title/alias to memory→memory links. The real vault now renders as a connected graph with labelled communities.
- **Fixed — raw provider JSON on persona cards.** A failed persona showed `401 {"type":"error",…}`; Anthropic API and connection errors now read as one sentence (`personaErrorMessage`) on persona, rebuttal and synthesis failures, with the raw error logged.
- **Harness/expectation notes, not bugs:** session create returns `sessionId`; UI-minted tokens default to read-only (least privilege) — pick *Read & write* to let a client write.
- **Follow-ups (not fixed here):** (1) Memory detail renders raw markdown (headings, bold, tables as pipes, `[[wikilinks]]`) — needs a markdown renderer and clickable wikilinks; (2) single-keyword hybrid scores are nearly flat (≈0.415–0.424 across the top 10) and one run pushed an exact title match out of the top 20 — results varied between identical runs, likely access-recency feedback; the ranker needs a look; (3) a hybrid search's text relevance is weak without embeddings — production has them, but an OpenAI outage degrades search to FTS/trigram.

---

## 2026-10-23 — Vault import: Obsidian vault → OmniMind, synced by path

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed, PR | **Tests:** omnimind-api +1 (dedup opt-out), shared +1 (NUL guard + dedup flag), new `scripts/tests/vault-import.test.mjs` 12/12 (CI step)

- **`scripts/vault-import.mjs` (`pnpm import:vault`, runbook `docs/runbooks/vault-import.md`):** one memory per note under `wiki/` and `.raw/`, written through `POST /memories` (validation pipeline) as agent `vault-import` in one tenant (default `josh-business`, where MCP clients read). Re-running syncs by vault path: new → create, edited → PATCH, unchanged → skip; never deletes. Vault plumbing (log, hot cache, Bases, generated catalogs, lint/tiling reports, alias stubs) is skipped; ministry notes are listed and held back (`MINISTRY_DEFERRED`; never relabelled). Domain-budget preflight (nothing written if a domain would overflow), writes paced under the 20/min user limit, waits out the 200/hour agent limit.
- **`POST /memories` `dedup: false`:** the near-duplicate auto-supersede on agent writes replaces an existing memory's title and content at > 0.92 similarity; in a bulk import that lets one note overwrite another (or an unrelated memory). Opt-out for importers that key their own rows; default unchanged.
- **NUL characters → 422:** a title/content with U+0000 reached the INSERT and Postgres refused it, so OmniMind answered 500 (any client, incl. MCP `memory_write`). Create/update schemas now reject it with a 422.
- **Verified on a local stack with the founder's real vault (private; no vault content in this repo):** every note landed once in `josh-business` (`agent_id = vault-import`, `API_IMPORT`), a second run synced the remainder, a third wrote nothing; tenant-scoped search returned the expected notes; the `josh-personal` tenant saw none. The two bugs above were found by this run.
- **Production run:** after this PR deploys (the server must accept `dedup: false` first), one command from a machine that can reach the API — `docs/runbooks/vault-import.md` "Run it". Rotate the leaked service key (M0-F2) before using it.

---

## 2026-10-23 — Phase 8 — Wave 2: e2e gate in CI, automatic post-deploy verify, AA brand gold, safe onboarding gate

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Merged as PR #26 (`38289fb`), main CI green | **Tests:** client 477 → 502 (+14 M1-D1, +11 M1-D3); shared 155, mcp 272, api 1,209, server 302 unchanged; `pnpm test:e2e` 55/55; `pnpm test:go-live` 181 + 78; `pnpm e2e:live` 24/24 (Lane A, private stack); CLS 0.0092 / 0.0018; audit 0 high

Wave 1 merged as PR #25 (`d9a5bf3`); main CI run 39876543973 green on that SHA. Two lanes ran in worktrees off the synced branch.

- **Lane A — M1-A3:** new CI `e2e` job (pgvector service, full-history checkout) runs `pnpm test:e2e` — the tenant-isolation + scope gate — on every PR. `playwright` 1.56.1 pinned as a root devDependency. `journey.mjs` gains `--browser chromium|webkit` and `--dry-run`, and a formal checks autoloader (fresh signed-in page per check; a failing or malformed check fails its step and the rest still run; an excluded engine is `skipped`, never passed) replacing Lane C's minimal hook; `checks/README.md` contract and `checks/smoke.mjs`. `cls.mjs` is chromium-only (WebKit reports no layout-shift entries).
- **Lane A — M1-A1:** `.github/workflows/post-deploy-verify.yml` (`workflow_run` on CI success for a push to main, plus manual) and `scripts/verify-prod.sh`: polls each service's `/health` until `version` equals the CI run's `head_sha` (15 min), then read-only probes — `/ready` ×3, `/theme-init.js` + CSP, unauthenticated `POST /mcp` → 401 + `WWW-Authenticate`, bogus `omt_` → 401 (503 fails), `partial_agent_identity` only with the `OMNIMIND_API_KEY` secret (else *skipped*). Automatic runs wait until the `BOARDROOM_HOST`, `OMNIMIND_API_HOST`, `OMNIMIND_MCP_HOST` variables all exist, so main is not red before setup or the MCP go-live. Documented in the DEPLOYMENT-RUNBOOK deploy checklist.
- **Lane D — M1-D1:** brand gold passes AA in both themes. Default (a): light `--color-primary` `#b5890a` → `#8f6d07` (white label 3.21 → 4.82:1); variant (b) dark-on-gold labels behind `<html data-gold="dark-label">` (5.44:1). New `--color-primary-hover` and `--color-sidebar-primary`; 41 gold-text usages repointed to `text-primary-text`; dark text on solid gold (1.89:1 in dark mode) fixed on eight surfaces; danger button, avatar initials, sidebar muted text and the login brand panel fixed. `ui-standards` token-pair test (4 states, 25 text + 3 non-text pairs; 12 failures on the old tokens) plus usage rules. `tools/visual-preview/contrast.mjs` sweeps every visible text element: 636 pairs / 0 failing (42 before).
- **Lane D — M1-D3:** `OnboardingGate` redirects only on 404 or `onboardingComplete: false`; 5xx, network errors and an open breaker render the shell with a retry banner instead of sending an onboarded user back to onboarding. MCP snippets scroll inside an `overflow-x-auto <pre>` with a fade; `#main-content` overflowed 2920 > 1040 px before, now none at 1280 and 390 px.
- **Founder:** pick the gold variant (M1-F5; recommendation: (b) dark-label — keeps the brand gold); add the three repo variables (+ optional `OMNIMIND_API_KEY` secret) for post-deploy verify; add the `E2E` check to branch protection with M0-F3.

---

## 2026-10-22 — Phase 8 — Wave 1: four agent lanes, 11 roadmap items to review

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Merged as PR #25 (`d9a5bf3`), CI green | **Tests:** shared 151 → 155; omnimind-api 1,175 → 1,209; omnimind-mcp 255 → 272; server 284 → 302; client 436 → 477; `pnpm test:e2e` 55/55; `pnpm e2e:live` 23/23 (Lane C, private stack); audit: 0 high (2 low, 1 moderate)

Four lanes ran in parallel git worktrees off `c2c6fca`, each with its own gates; they were merged here and the full gate set re-run on the combined branch.

- **Lane A — release & ops (M0-A1, M0-A2, M0-A3, M1-A2):** `qs` / `ip-address` overrides; CI cancels superseded runs except on `main`; weekly `scheduled-audit` job. `/health` reports `version` (`RAILWAY_GIT_COMMIT_SHA`) and stays 200; `/ready` answers 503 until dependencies are up, on all three services. Migration drift guard diffs `migrate deploy` on a separate `omnimind_shadow` DB against `prisma/known-drift.sql` (trigram + IVFFlat indexes, `agent_id` default — `main` already drifted). `scripts/mcp-go-live.sh`: resolves omnimind-api's `PORT`, sets `OMNIMIND_MCP_WRITE_EXTRACT=async`, fails verification unless a bogus `omt_` gets 401, and aborts before any write unless the latest `ci.yml` run on `main` is green **and** backup evidence is given (`--backup-ok` or a healthchecks.io dead-man < 26 h). The *MCP go-live* workflow passes both (`backup_ok`, `backup_check_url`, `actions: read`, `GH_TOKEN`).
- **Lane B — memory (M1-B2):** sync-mode `memory_write` no longer refuses when the extractor is unavailable: it stores the raw row once, answers `ok: true, extraction: "deferred"`, and retries extraction in the background at 5 s / 30 s / 120 s (result kept in the replay cache).
- **Lane C — decision session trust (M1-C3, M1-C1, M1-C2):** a reloaded or undispatched `/decisions/:id` shows its question (H1 + tab title) with Analyze/Edit; Analyze on `/decisions/new` moves to the session URL so reload works. Personas stream `situationReading` / `analysis` prose through a partial-JSON parser with rAF batching — no raw JSON ever renders; CLS during dispatch 0.0092 (budget 0.05, `tests/e2e/live/checks/cls.mjs`). A failed persona shows an error card with Retry (`POST /sessions/:id/dispatch {personaIds}` re-runs only those advisors, no debate round; unknown id → 400 `unknown_persona`); the CEO button reads "Synthesize without Critic" and the synthesis names missing advisors. Fixed on the way: a context-fetch throw left the card waiting forever.
- **Lane D — docs (M0-D1, M0-D2, M1-B0 record):** status truth pass (43 models, BLK-101…105), ADR-016 MCP OAuth issuer and ADR-017 entity tenancy (both Proposed), DEC-004 phase 10–19 keep/park/kill.
- **Integration:** header breadcrumb is desktop-only and truncates — at 390 px the question crumb wrapped word by word over the page (pre-existing on `main`).
- **Founder items unchanged and blocking M1:** M0-F1 pg_dump + restore drill, M0-F2 rotate five secrets, M0-F4 hand-verify deploy, M1-F1 go-live, M1-F6 OAuth issuer, M1-F7 default tenant.

## 2026-10-22 — Phase 8 — Dev roadmap built by a multi-agent debate; main back to green

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed, PR opened | **Tests:** docs only

- **Main CI red → green:** two high-severity advisories against `@modelcontextprotocol/sdk` (<1.32.0, GHSA-46jr-4wx8-v453 and GHSA-22jm-h49p-29qw) were published after PR #22's CI ran, so the audit gate failed on the merge commit `cdef1ef`. PR #23 (`fc19563`) bumped the SDK to `^1.32.1`; main CI run 39864122262 is green on every job, including the first omnimind-mcp Docker build on main. No production exposure: only `omnimind-mcp` uses the SDK and it is not launched.
- **`docs/roadmap/PHASE-8-ROADMAP.md`:** 8 weeks, 5 milestones (M0 contain and stay green → M1 verified production, MCP live for token clients, tenant-safe one memory → M2 one memory everywhere, Apple-quality floor, dogfood day 1 on 2026-11-12 → M3 ops floor and daily loop → M4 verdict and pre-signup gate), 4 agent lanes + founder items, 69 tracked items, 21-row decision ledger, risks, not-doing list, and the exact prompt a lane session uses.
- **How it was built:** 3 auditors (UI 29 findings, engineering 24, product 18) → 2 planners drafting opposite theses (launch-and-trust first vs experience first) → each cross-examined the other against the repo → synthesis with a decision ledger → 2 validators (repo-truth: 41 checks; coverage: 20) → revision fixed 2 blocking + 4 major issues; 17 minor notes left open in the roadmap's Validation section.
- **Security finding surfaced by the audit (founder, urgent):** deploy env values were committed in early history and the repo is **public**; removing the file later does not remove it from history. M0-F2 rotates the five affected secrets; the commit reference is deliberately not written into the public docs.
- `PHASE-PROGRESS-TRACKER.md` gains a Phase 8 section (69 rows, states `todo → in-progress → in-review → merged → done`); `CURRENT-PHASE.md` points at Phase 8.

---

## 2026-10-20 — Phase 7.5 — End-to-end pass on a live local stack: 3 production bugs fixed, live journey added

**Branch:** `claude/amazing-mccarthy-grvem2` (PR #22) | **Status:** Pushed | **Tests:** omnimind-api 1,167 → 1,175 (+8: partial identity, split read budget); client +1 guard rule; `pnpm test:e2e` 55/55 (was 54/55); new `pnpm e2e:live` journey 22/22

Stack: Postgres 16 + pgvector 0.6 on 5433, OmniMind API 3333 (harness entrypoint), BoardRoom 3001 in production mode serving `client/dist`, MCP HTTP gateway 3334 with a keygen'd gateway agent and a token minted in the UI. No mocks, no LLM key (embeddings → outbox; extraction deferred).

- **Fixed — tenant isolation (E2E-5):** an `x-agent-id` without `x-tenant-id` / `x-source-weight` was logged and *ignored*, so the request fell through to the unscoped BoardRoom path and a search returned rows from both tenants of the user. `agent-context` now fails closed: `400 partial_agent_identity { fields }`. Unit tests + E2E-5 updated to the stricter contract; `docs/contracts/omnimind-api.contract.md` records it. BoardRoom never sends agent headers and the MCP server always sends the full triple or an `omk_` key, so nothing legitimate changes.
- **Fixed — UI refused by the API's own limiter:** one dashboard load is 21 reads and the graph page 8 more; OmniMind's per-user budget was `MAX_QUERIES_PER_MINUTE` (20) for every method, so the graph page showed "Rate limit exceeded. Max 20 requests per minute." Reads (GET/HEAD) now get `USER_READ_RATE_LIMIT_PER_MINUTE` (default 120, floor 20, `.env.example`); writes keep 20. Unit tests updated; contract updated. Fan-out itself is still worth trimming (three `/outcome-reviews/pending`, two `/decisions`, two `/commitments` on one load — follow-up).
- **Fixed — production CSP blocked the theme bootstrap:** helmet's default `script-src 'self'` refused the inline `<script>` in `index.html`, so every production load flashed the wrong theme before React applied it. The bootstrap now ships as `client/public/theme-init.js`; `ui-standards` fails on any inline `<script>` in `index.html`.
- **Fixed — two `<h1>` per page:** AppHeader's toolbar title is a `<p>` (`data-testid="app-header-title"`); the page's `PageHeader` keeps the single level-one heading.
- **Added — `tests/e2e/live/journey.mjs` (`pnpm e2e:live`)**: 22-step Playwright + MCP journey (register → onboarding gate → dashboard with fan-out/429 counters → seed + links → graph settles → memory → decisions → session → tenant owner → mint token in Settings → MCP initialize / tools/list (20) / memory_write / memory_search / status_get → BoardRoom and the UI show the MCP-written memory with `agentId mcp-token:…` → revoke → `PRINCIPAL_REVOKED` → no page errors). README documents the stack bring-up.
- **Verified unchanged:** `pnpm test:e2e` harness suite (agent attribution, tenant isolation, sourceWeight, embedding outbox, cross-tenant/ministry/scope bypasses, admin auth) 55/55 on the real stack; MCP gateway refuses unauthenticated `initialize` (401) and revoked sessions within a second.
- **Findings not fixed here:** `tests/e2e/flows/*` (5 files) target a pre-Phase-6 contract (list endpoints are paginated `{items}`, `POST /memories` needs `title` + `sourceType`, `POST /sessions` needs `mode`, archive is `POST /memories/:id/archive`, `/subscription` returns `{configured, subscription}`) and are not wired into any script — rewrite or delete; the in-memory register limiter (3/hour/IP) makes any multi-user e2e from one host restart-bound; `memory_write` in `sync` mode is refused outright when the extractor is down (`FACT_EXTRACTOR_UNAVAILABLE`) — consider storing the raw row and deferring extraction even in sync mode, or set `OMNIMIND_MCP_WRITE_EXTRACT=async` on Railway; without OAuth configured the PRM endpoint is 404 (expected, documented).

---

## 2026-10-20 — Phase 7.5 — Apple-grade UI Phase C: shell, route transitions, controls, graph chrome, decision session

**Branch:** `claude/amazing-mccarthy-grvem2` (PR #22, merge `8af3c5c`) | **Status:** Pushed | **Tests:** client 403 → 436 (+33: route transitions, scroll sentinel, controls, mode selector, configurator, sheet, contrast sampler, two new guard rules); server 284 unchanged

- **React 19.3.1** (`react`, `react-dom`, `@types/*`; lockfile): `ViewTransition` + `addTransitionType` are stable. Base UI, Motion, react-router, react-force-graph-2d, cmdk and the testing libraries unchanged and green.
- **Route transitions:** `shared/Layout.tsx` wraps the page root in `<ViewTransition name="page" update="none">`; `hooks/useRouteTransition.ts` tags direction (`nav-forward` on router link clicks / `useTransitionNavigate()`, `nav-back` / `nav-forward` on popstate from `history.state.idx`); `index.css` slides 10 px + fades in 180 ms on `--ease-out` via `:active-view-transition-type()`, opacity only under reduced motion, no root cross-fade. React's eager (synchronous) popstate transition — which would have made browser back a hard swap — is spent on a no-op update by `RouteTransitionArmer`, rendered before `<BrowserRouter>`; verified mid-flight in both directions by the harness. `PageWrapper` no longer double-animates; ⌘K and keyboard shortcuts navigate through the same path.
- **Shell:** AppHeader flush at rest, `.material` + bottom hairline once the page scrolls under it (`data-scrolled` from an IntersectionObserver sentinel in `main`, never a scroll listener), 56 px constant, search capsule / bell / avatar on one 36 px centre line, secondary text on the on-glass muted step. Sidebar: inset highlight + white-based hairline tokens (`--sidebar-hairline`, `--sidebar-highlight`), the active item is one shared pill (`layoutId`, `springs.snappy`, instant from the keyboard). `ui/PageHeader` (text-3xl, display tracking, text-balance, muted subtitle, 24 px rhythm) on Dashboard, Decision Lab, People, Personas, Integrations, Admin, Memory Explorer, Settings, Graph and New Decision.
- **Controls:** new `ui/Switch` (Base UI Switch) and `ui/Slider` (Base UI Slider, gold fill, drag-only value bubble, `onCommit`), `Tabs variant="segmented"`, `Select size="sm"` + `id`/`title`, `Button size="icon"`. Dashboard configurator (switch + select + ChevronUp/Down icon buttons + Button footer), Settings (Decision Frequency → Select; risk sliders → Slider with the `tnum` readout), Memory Explorer filter row (three Selects on one 36 px row), graph domain + timeline speed → Select. Remaining native selects (MCP token form, entity form, admin, decision-lab filter) carry a `ui-standards: allow select` justification.
- **Graph chrome (reference layering model):** legend bar, minimap and hover card float on `.material` with the hairline ring; canvas, inspector and in-flow controls / timeline stay flat (timeline bar takes the frame radius + hairline). No drawing, force, hull or label code touched. Fix found by the shots: `.material` set `position: relative`, which overrode `absolute` on floating chrome — the recipe now sets only `isolation`.
- **Decision session:** `ModeSelector` is a capsule segmented control with 16 px Lucide glyphs and a one-line helper (input column widened to 768 px so all seven modes sit on one row); `Modal variant="sheet"` (inset side sheet ≥ 640 px, draggable bottom sheet below: Motion `drag="y"` from the grabber / title row, dismiss past 120 px or 600 px/s, `springs.gesture` settle with the gesture velocity, no drag under reduced motion); `SynthesisSheet` opens once when a synthesis finishes and from the panel's header button, the inline panel stays; persona + synthesis cards flat with the hairline edge.
- **Tokens:** `--color-muted-foreground-on-glass` (light `#55534b`, dark `#aaa89f`), applied under `.material` and in the header; `.reduce-transparency` class mirrors `prefers-reduced-transparency` (materials + modal scrim solid).
- **Quality gates:** `tools/visual-preview/shoot-pages.mjs` + `contrast.mjs` (frame-sampled composited background vs text colour, worst 5 %, ≥ 4.5:1 or the shoot fails; results in `manifest.json`), reduced-motion / reduced-transparency variants with DOM asserts, mobile 390×844, mid-flight route-transition shots; `ui-standards.test.ts` adds the `<select` and scroll-listener rules; `UI-FOUNDATION.md` §3 / §6 / §7 / §8 updated. Contrast table (round 4, all pass): header title 17.3 / 14.6, header search 7.6 / 7.5, ⌘K 7.6 / 7.5, legend label 16.9 / 14.7, legend count 7.4 / 7.6, hover card title 15.9 / 13.3, hover card meta 6.1 / 7.5, segment idle 4.9 / 5.5 (light / dark).
- **Deferred:** converting the four remaining native selects (forms pass); a Chromium lens garnish on the graph toolbar (not doing per research); Base UI `Drawer` as a future replacement for the Motion drag path.

---

## 2026-10-20 — Phase 7.5 — Apple-grade UI foundation (Phases A, B, D) merged onto the viz branch

**Branch:** `claude/amazing-mccarthy-grvem2` (PR #22) | **Status:** Pushed | **Tests:** client +25 (standards guard, Modal, primitives); server unchanged

- **Tokens (Phase A):** self-hosted Inter Variable with the `opsz` face + JetBrains Mono Variable (`@fontsource-variable/*`; Google Fonts link removed), `font-optical-sizing: auto`, `text-wrap` pretty/balance, `.tnum`; `--text-4xl`, `--tracking-display/title`; ease-out / in-out / sheet curves with Apple-parameter springs in `lib/motion.ts` (`springs.default` = response 0.55, no bounce) and a global reduced-motion rule; layered hue-matched shadows + 1 px inset highlight + `--hairline`; dark elevation ladder `--surface-1..3`; `--radius-control/container/capsule` + `.concentric`; `.material` / `.material-clear` / `.material-sidebar` with solid fallbacks for no `backdrop-filter` and `prefers-reduced-transparency`; `z-*` tokens mapped in Tailwind; `cn()` taught the token scales
- **Primitives (Phase B) on `@base-ui/react` 1.9:** `shared/Modal` (Dialog: 40 % scrim + blur, hairline ring, CSS `starting-style` on `--ease-sheet`, bottom sheet < 640 px, Base UI focus/scroll-lock/inert; hand-rolled trap deleted), `Tooltip` (+ `TooltipProvider` in `App.tsx`, 300 ms intent delay, origin-aware), `Select`, `Tabs` (shared `layoutId` indicator, instant on keyboard), new `Popover` and `Menu` (solid `surface-2`, never glass on glass); `Button` (explicit transition properties, `active:scale-[0.97]`, `glass` variant, `capsule` shape, width-stable `loading`), `Card` (no hover lift; shadow step; `elevation` 0–3; publishes `--parent-radius/--parent-pad`), `Toast` (material, bottom-right, `springs.snappy`, pause on hover, swipe to dismiss), `CommandPalette` (material, no animation on arrow keys), `Input` on the control radius, `Progress` with `role=progressbar`; `ShortcutsModal` now uses the shared Modal
- **Icons:** `lucide-react` 1.59 at 1.75 px stroke replaces hand-inlined paths in Sidebar, AppHeader, NotificationCenter and both EmptyStates; AppHeader is the material layer with a hairline
- **Sweep:** every `transition-all` replaced with explicit property lists; no `ease-in` entrances; Onboarding enters from 0.96 instead of 0.5; two latent class typos fixed in passing (`border-borderrounded-md`, `border-border-mx-6`)
- **Guardrails (Phase D):** `client/tests/ui-standards.test.ts` fails on `transition-all`, `ease-in`, scale-0 entrances, literal `z-50`/`z-[`, third-party font URLs and `backdrop-blur` outside the navigation layer (documented per-line exception: `// ui-standards: allow backdrop-blur — <reason>`; the graph hover card carries one); `docs/02-reference/UI-FOUNDATION.md`; ADR-015 in `DECISIONS.md`
- Deliberate deviations from the research snippets: dark base colours kept (`#111110` / `#1a1a18`; the ladder builds on them), `--text-xs` stays 12 px, light highlight alpha 0.5, Modal animates with CSS rather than Motion springs, drag-to-dismiss on the mobile sheet deferred (Base UI Drawer later), Tooltip/Popover/Menu have no consumers yet (jsdom-tested, not shot)

---

## 2026-10-20 — Phase 7.5 — Visualization upgrade: communities graph + dashboard chart system + screenshot harness

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed, PR opened | **Tests:** client 378 (was 245); all other packages unchanged

- **Knowledge graph** (`components/graph/`): Louvain communities (`graphology`, seeded, stable relabel across refetches) with smoothed hulls, hull-anchored community labels and a cluster force so the five clusters separate; zoom-tiered node labels with a greedy collision pass; focus glow + gradient source→target edges and particles only on focus edges (off under reduced motion); curved parallel edges, dashed hierarchy/dependency edges; DOM hover card (origin-aware, 180 ms ease-out); minimap with click/drag pan; legend bar doubles as the type filter; keyboard `+ − 0` and arrows; `data-settled` flag; spotlight hits deduped with `×N` badges and community labels hidden while a spotlight is active; asymmetric fit-to-view. Timeline: monotone area sparkline with the active window clipped vivid, eased playback. `Layout.tsx` page wrapper gets `h-full` (graph page overflowed the viewport before)
- **Dashboard chart system** (`components/viz/`, SVG, no chart library): ChartFrame + sr-only table twin, Tooltip, Legend, Glyph, Sparkline, StatTile (+ change-only `AnimatedValue`), ProgressRing, AreaChart (stacked, crosshair, keyboard), BarChart, Heatmap, ReliabilityDiagram; `viz/theme.ts` palettes validated with the dataviz validator (CVD + normal-vision ΔE, lightness/chroma bands); last in-progress week bucket rendered as partial (washed band, dashed boundary, legend note, end label on the last complete week). Dashboard: CockpitRow (memories this week, commitments ≤7 d, decisions awaiting review, LLM spend MTD or decisions committed for non-admins), MemoryPulse heatmap, What's Moving stacked area, CommitmentHorizon inside the nudges widget, LlmCostWidget rebuilt on the primitives; Decision Lab CalibrationPanel on ReliabilityDiagram, WhatChangedCard as a diff-style timeline; `viz.store.ts` (60 s TTL, in-flight dedupe); header stacks on phones. Standards applied: tabular figures everywhere numbers live, no entrance animation on load, no glass on content surfaces, no `transition-all`
- **Visual harness** (`tools/visual-preview/`, `pnpm --filter @boardroom/boardroom-ai visual:preview -- --round <name>`): in-process mock API auto-loading `fixtures/*.mjs` with exact production response shapes (360-node seeded graph, dashboard data), Playwright shots light+dark at 1440×900 / 390×844, frame-time p50/p95 while zooming, `build-standalone.mjs` regenerates the single-file graph preview. Screenshots are not committed (`out/` ignored; this session's rounds live in the session scratchpad)
- Research for the next pass: `docs/research/APPLE-GRADE-UI-2026-10-20.md` (what Apple-grade UI is made of in code, client audit, 4-phase plan); Phases A/B/D in flight on a separate branch
- Follow-ups surfaced, not fixed here: `stores/cortex.store.ts` + `hooks/useNotificationAggregator.ts` read `result.items` unguarded outside any widget error boundary (an unexpected `/cortex/patterns` shape takes down the whole app); `WeekCalendarStrip` logs on a `/calendar/events` 404; endpoints that would remove client-side aggregation: `GET /memories/stats?since&bucket&groupBy`, `GET /commitments?status=OPEN&dueBefore=`, per-model cache-read share in `/usage/llm/summary`

---

## 2026-10-20 — Phase 7 — One-command MCP go-live (laptop + phone)

**Branch:** `claude/amazing-mccarthy-grvem2` (fresh from `main` after PR #21) | **Status:** Uncommitted | **Tests:** `scripts/tests/mcp-go-live.test.sh` (7 scenarios, stubbed railway/curl/openssl/claude) added to CI

- `scripts/mcp-go-live.sh` (`pnpm go-live:mcp`): runbook §0–§7 in one idempotent run — admin key (+ wait for the redeploy via the admin route), gateway agent with `MCP_GATEWAY_CEILING_SCOPES` read from shared, tenant owners (skip owned, warn on a different owner), `omnimind-mcp` service create / variables / domain / `railway up`, BoardRoom variables, first token + `claude mcp add`, §7 verification, summary table (also to `$GITHUB_STEP_SUMMARY`); `--dry-run`, `--yes`, `--no-token`, secrets redacted in every line but the two sanctioned ones; user id resolved through the existing `POST /auth/login {email}` (no admin user-lookup route exists)
- `.github/workflows/mcp-go-live.yml`: `workflow_dispatch` wrapper (dry_run default true, `RAILWAY_TOKEN` project token, `::add-mask::` on the admin + gateway keys, no token minted in CI)
- Railway CLI flags verified against github.com/railwayapp/cli source (v5.71.0, not v4): `variable list/set`, `service list`, `add --service`, `domain` (note `--project` long-only, `-p` = port), `up -s -e -p --detach`, `link -p -e`, token semantics; unverified (docs.railway.com unreachable): `RAILWAY_DOCKERFILE_PATH`, config-as-code path (dashboard-only), project-token rights for `add`/`domain`
- runbook "One-command path" + DEPLOYMENT-RUNBOOK checklist pointer; manual steps kept as the reference

---

## 2026-10-19 — Phase 7 — Blind spots closed, deployment-ready

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed, PR opened | **Tests:** 2,107 passing + 45 eval (was 2,039)

- verified from primary docs (support.claude.com, claude.com/docs, code.claude.com, Gemini/VS Code/Zed source repos; OpenAI secondary): ChatGPT connectors are OAuth or no-auth only (no header field); Claude.ai "Request headers" is a limited beta, otherwise OAuth (CIMD / DCR / own client); Claude Code `--scope user`; Gemini CLI `httpUrl` + `gemini mcp add`; VS Code `type: "http"` + `inputs`; Zed native `url` (no bridge); Windsurf plaintext; clients break on `/mcp` → `/mcp/` redirects — snippets, agent configs, runbook §6/§9 and CLAUDE.md limitation 14 now state these without hedging
- OAuth path made production-usable: OIDC userinfo fallback when access tokens lack `email`/`email_verified` (`OMNIMIND_MCP_OAUTH_USERINFO`), issuer trailing-slash tolerance, cached discovery, admin `POST /mcp/identities` manual link (+ list-all, unlinked attempts logged by subject hash), runbook §9 identity-provider recipe (WorkOS AuthKit / Auth0 / Ory, DCR + resource indicator + redirect URIs), new checklist step 5
- revocation effective immediately for data access: API evicts synchronously; MCP server returns `PRINCIPAL_REVOKED`, evicts the credential, closes the session; `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` (30 s default) bounds only idle sessions
- no-redirect guarantee tested for `/mcp`, `/mcp/`, `/` and the PRM paths; `scripts/pre-deploy-check.sh` covers omnimind-mcp (typecheck, Docker, required files) and probes the live front door when `OMNIMIND_MCP_PUBLIC_URL` is set
- `.env.example` 81 vars (`OMNIMIND_MCP_PRINCIPAL_CACHE_MS`, `OMNIMIND_MCP_OAUTH_USERINFO` added)
- still unverified in the sandbox: first real `docker (omnimind-mcp)` CI build (runs on the PR); OAuth against a real provider

---

## 2026-10-18/19 — Phase 7 — Universal memory MCP front door + searchable graph

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed (2 commits: build `7fce388`, review fixes) | **Tests:** 2,039 passing + 45 eval (was 1,481)

- five lanes against one contract: OmniMind identity API (McpToken / McpOauthIdentity, introspect/resolve, delegated identity, admin tenant + identity routes, audit stats), MCP server front door (static / `omt_` / OAuth JWT principals, PRM, session binding, `search`/`fetch`, instructions, async extract, bench), BoardRoom "Connected AI tools" (tokens + per-client snippets), searchable graph (spotlight, local-first, edge filter, history, timeline, Memory Explorer filters, render tests), ops (Dockerfile, CI matrix, compose, `.dockerignore`, runbook, agent configs, drift fixes)
- four adversarial reviews, all findings fixed: delegated principals moved from deny-lists to a route **allow-list** (closed `/auth/*` reach and self-minted write tokens); rejected `initialize` no longer leaks a server; deferred extraction survives session close; sessions bound to scope digest; failed-auth per-IP limiter; static sessions never carry the gateway key; stuck lazy-fetch and stale-spotlight bugs; select vs focus split (no relayout on click); runbook reordered so nothing is used before it exists and the false rotation claim removed
- new env: `OMNIMIND_MCP_TOKEN_AUTH`, `OMNIMIND_MCP_PUBLIC_URL`, `OMNIMIND_MCP_OAUTH_*`, `OMNIMIND_MCP_APP_URL`, `OMNIMIND_MCP_WRITE_EXTRACT`, `OMNIMIND_MCP_STATIC_AGENT_KEY`, `OMNIMIND_MCP_TRUST_PROXY`, `MCP_OAUTH_ALLOWED_ISSUERS`, BoardRoom `OMNIMIND_MCP_PUBLIC_URL` / `APP_PUBLIC_URL`
- pnpm override `proxy-addr >=2.0.8` (new critical advisory under express, also red on `main`)
- not verified in the sandbox: first real `docker (omnimind-mcp)` CI build; live client dialogs (header-field availability); OAuth against a real issuer

---

## 2026-10-11 — Research — Universal memory MCP and graph UX landscape

**Branch:** `claude/amazing-mccarthy-grvem2` (reset from `main` after #20 merged) | **Status:** Pushed | **Report:** `docs/research/MCP-MEMORY-LANDSCAPE-2026-10-11.md` (+ five evidence notes under `docs/research/mcp-landscape-2026-10-11/notes/`)

- five-researcher study: AI-memory MCP competitors (17 products), PKM tools with MCP + graph views, MCP spec 2026-07-28 + client support matrix, graph-visualization/search UX state of the art, read-only inventory of our own MCP + graph code
- verdict: the data-model bundle (bi-temporal `asOf`, supersede-with-provenance, trigram hybrid retrieval, `Idempotency-Key`, per-agent scopes, decision/commitment/task entities, cortex artifacts, graph UI) is unmatched by any single product; the distribution layer (OAuth remote MCP, multi-user per URL) is commoditized and is where we are behind
- blind spots recorded: spec 2026-07-28 deprecates DCR (Phase 10 assumes it) and removes sessions; no chat client subscribes to resource updates, so "stay up to date" must be turn-time tool calls, not push; HTTP MCP is single-identity per process; richest search (`POST /memories/search`) is not used by Memory Explorer / ⌘K / graph; graph render components have no tests
- ranked roadmap in the report: do-now (OAuth with CIMD + DCR + static clients, public HTTPS install docs per client, ChatGPT `search`/`fetch` pair, freshness contract via `instructions`; ⌘K hybrid-search spotlight, local-graph default + edge-type filter + focus history, timeline scrubber, graph render tests), do-next, do-not

---

## 2026-10-03 — Phase 6 — Independent pre-merge review: 42 findings, 42 fixed

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed | **Tests:** 1,481 passing | **Report:** `docs/audits/REVIEW-2026-10-03.md`

- 2 CRITICAL (every LLM route aborted before its first call because the disconnect handler listened on `req` not `res`; OAuth callbacks swallowed by the SPA fallback), 7 HIGH (read-only agents 403 on hybrid search, superseded-row dedup/consolidate data loss, prompts missing from the OmniMind image, restore drill could never pass, thinking-block parsing, graph relayout on click, "what changed" baseline), 16 MEDIUM, 17 LOW — all fixed with a test that fails on the old code
- three of the HIGH/CRITICAL items were regressions from the previous day's own fixes; see the report's "Pattern worth keeping"
- first CI run on the PR failed typecheck only in CI: the lockfile carried `@types/node` 22 and 25, boardroom-ai declared neither, and the hoisted copy differed between CI and the sandbox (22 requires `AbortSignal.onabort`, 25 dropped it). Fixed by pinning the whole workspace to `@types/node ^22` (root pnpm override + explicit devDependency in boardroom-ai; both images run Node 20)
- first Docker matrix run failed in both images at `RUN bash scripts/check-prompts-integrity.sh`: `node:20-alpine` has no bash, and the script also died under `set -e` because the builder has no `git` (this pre-dated the branch in boardroom-ai's Dockerfile; R-D-01 copied it into omnimind-api's). Script rewritten as POSIX `sh` with the git baseline degrading to the literal floor; both Dockerfiles invoke it with `sh`
- after both fixes the full CI matrix is green on the PR head. First real `retrieval-eval` measurement (mock embeddings, 114 queries, 0 HTTP errors): for-persona recall@10 0.520, MRR 0.440, nDCG@10 0.419, abstention 0.80; `/memories/search` recall@10 0.535, MRR 0.549. Gates unchanged (ratchet needs three green runs on `main`)

---

## 2026-10-02 — Phase 6 — Research backlog implemented (8 moves, 6 lanes)

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed | **Tests:** 1,318 passing (was 896 after the audit)

- foundation: Anthropic SDK 0.131, OTel deps, Prisma migration `20261002100000_phase6_foundation` (Decision forecasts, WeeklyMemo.itemStates, ContextCapsule provenance, MemoryEntry.consolidatedFrom, LlmUsage, IdempotencyKey), `shared/constants/model-config.ts`, `docs/contracts/PHASE-6-CONTRACTS.md`
- omnimind-api: `GET /context/core`, calibration + changes endpoints, `asOf` temporal validity in all four layers, reflection service/job + capsules, commitment nudges job, interactive memo, `/usage/llm`, shared Anthropic client with usage recording, `EMBEDDING_PROVIDER=mock`, OTel, `::` bind; link writers (person/decision/dependency), backlinks, unlinked mentions, people duplicates, hybrid `POST /memories/search`, `supersedes`, `Idempotency-Key` middleware
- boardroom-ai server: cached system blocks + Sonnet 5.5 + effort + Haiku guard, usage rows, debate protocol (rebuttals, ledger, dropped considerations), `premortem` mode, `POST /sessions/:id/decide`, persona-specific retrieval, OTel with verified traceparent, proxies for every new endpoint
- boardroom-ai client: DecisionCommitCard, forecast recap in review, CalibrationPanel, debate view, pre-mortem picker, WhatChangedCard, CommitmentNudgesWidget, interactive WeeklyMemoCard, PeopleDuplicatesBanner, graph backlinks/unlinked mentions/link editors, admin LlmCostWidget
- omnimind-mcp: 18 tools via registerTool (annotations, outputSchema, structuredContent), idempotencyKey, cursor pagination, hybrid memory_search, memory_reflect / memory_consolidate / graph_neighborhood, 4 resources, 3 prompts
- eval/ops: 114-query labeled retrieval gold set + IR runner gated in a pgvector CI job, persona distinctiveness + sycophancy probe, `services/backup/` + restore drill, BACKUPS / OBSERVABILITY / PRIVATE-NETWORKING docs

---

## 2026-10-02 — Phase 6 prep — Knowledge graph view + improvement research

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed

### Knowledge graph (Obsidian-style)
- omnimind-api: `GET /graph` (`services/knowledge-graph.service.ts`, `routes/knowledge-graph.routes.ts`) — one bulk read over Goals/Projects/Tasks/People/Decisions/Commitments + top-N memories and every link table; namespaced node ids, dangling edges dropped, domain filter keeps domain-less neighbours, tenant scoping on memories, no memory content on the wire; 5 unit tests
- shared: `types/graph.types.ts` + `validation/graph.schema.ts` (KnowledgeGraph, query schema with URL coercion)
- boardroom-ai server: `GET /api/graph` proxy with query validation
- boardroom-ai client: `/graph` page (`pages/GraphPage.tsx`, `components/graph/*`) on `react-force-graph-2d` (canvas): hover neighbourhood highlight with fade, click → backlinks inspector, drag, zoom, search-to-focus (`/`), type chips as legend+filter, domain filter, local-graph depth slider 1–3, labels/orphans toggles, `?focus=` deep link, reduced-motion path, bottom-sheet inspector on phones; nav item added
- design tokens: `--color-entity-*` for both themes (validated categorical set, shape per type), `--graph-*` canvas tokens; Tailwind `entity.*`
- contract doc: Knowledge Graph section

### Research
- `docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md` — 1–6 month improvement research (memory architecture, graph UX, decision loops, persona protocol, ops, MCP) with 8 ranked moves

---

## 2026-10-02 — Phase 5.7 — Audit remediation: all 82 findings addressed

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Pushed, 9 commits after the audit report

- deps/infra: lockfile regenerated (BoardRoom Docker build fixed), vulnerable deps patched (26 high → 0), `.github/workflows/ci.yml` (frozen install, typecheck incl. client, tests, audit, Docker builds)
- boardroom-ai server: admin allowlist, SPA fallback predicate + production-mode integration test, Stripe webhook before JSON/auth, trust proxy, CEO double-call removed, 4xx passthrough, OAuth state TTL/nonce, per-user LLM limiter, AbortController on disconnect, quick-take path, Zod on every write, dead services quarantined, context-strategy caps wired
- boardroom-ai client: client typecheck added (35 errors fixed), CommandPalette crash, session race, 401 handling, search sequencing, idempotent onboarding, admin gating, billing error surfacing
- omnimind-api: `0_init` migration + fresh/existing detection, tenant-scoped dedup, domain-aware backfill, non-compounding decay (`base_importance`), tenant-scope enforcement, graceful shutdown + job overlap guards, encryption write path + fail-closed decrypt, admin key, IP-fallback limiters, `x-agent-key` verification + scope enforcement, goal↔project / project↔task link routes
- omnimind-mcp: stateful HTTP transport (SDK-client e2e test), mandatory HTTP key + timing-safe compare + body cap + health, tag-based queries + exact-title task matching, audit redaction, typed validation errors, keygen fixes
- shared: Memory type aligned with Prisma, Zod/TS/Prisma drift fixed, `@boardroom/shared/node` subpath for Node-only utils, `document_read` dropped from TOOL_PERMISSIONS
- docs: contract (headers, link routes), runbook (new env vars + operator checklist), FRAGILE-ZONES, MCP runbook + agent configs, CLAUDE.md limitations

---

## 2026-10-02 — Audit — Full-platform independent code audit (all 4 packages + infra)

**Branch:** `claude/amazing-mccarthy-grvem2` | **Status:** Report only, no code changed

- `docs/audits/AUDIT-2026-10-02.md`: 5 CRITICAL / 16 HIGH / 33 MEDIUM / 28 LOW open findings; first-ever pass over `boardroom-ai` server + client
- CRITICALs: lockfile drift breaks BoardRoom Docker build since PR #17 (R-101); `/admin` reachable cross-tenant by any sign-up (B-101); prod SPA fallback swallows every entity GET (B-102); MCP HTTP transport fails on request 2 (M-101); fresh DB cannot boot under `migrate deploy` (O-104)
- Prior-audit re-verification: 12/39 May findings fixed, 4 partial, 23 open; F-202 mutated into silent write loss (O-101)
- Baseline: typecheck green 5/5, 500 unit tests pass — see "Why green tests did not catch this"

---

## 2026-05-09 — Phase 5 Solo Go-Live — Ministry disable + importance decay + dedup + /admin/duplicates

**Branch:** `claude/fix-memory-layer-production-qdmH8` | **Commits:** `0054de0`, `869f368` | **Status:** Pushed

### Repo cleanup
- `.env.deploy` removed from git tracking; explicit gitignore for deploy secrets
- No worktree branches or open PRs to clean (already done in prior session)

### Ministry domain disabled (D7)
- `memory.service.ts`: `createMemory` + `updateMemory` throw `HttpError(503, MINISTRY_DEFERRED)`
- `memory.tool.ts` (MCP): `memory_write` returns MINISTRY_DEFERRED before calling API
- `error-handler.ts`: `HttpError` class added (enables non-500 status codes from service layer)
- `claude-desktop.json`: `omnimind-ministry` server entry removed
- `tests/audit/D7-ministry-disabled.test.ts`: API + MCP layer assertions
- `CURRENT-PHASE.md`: deferral documented with Phase 6 re-enable criteria

### Importance decay (F.1)
- `importance-decay.service.ts`: `runImportanceDecay()` — -0.05/week, floor 0.0
- `importance-decay-scheduler.ts`: cron Sun 2am, IMPORTANCE_DECAY_SCHEDULE env override
- `index.ts`: wired into start/stop lifecycle
- `admin.routes.ts` (omnimind-api): `POST /admin/decay/run` for manual trigger

### Duplicate detection on write (F.2)
- `memory.service.ts`: `findNearDuplicate()` cosine check at 0.92 before every `createMemory`
- Near-duplicates auto-supersede (calls `updateMemory`) instead of creating new entries
- Dead ministry encryption block removed from `createMemory` (upstream guard makes it unreachable)

### /admin/duplicates UI (F.3)
- `admin.routes.ts` (omnimind-api): `GET /admin/duplicates` + `POST /admin/duplicates/merge`
- `admin.routes.ts` (boardroom-ai): proxy routes for duplicates + decay
- `omnimind-client.ts`: `getAdminDuplicates`, `mergeAdminDuplicates`, `triggerAdminDecay`
- `api.ts`: `DuplicatePair` interface + 3 new API functions
- `AdminPage.tsx`: 6th tab "Duplicates" — threshold selector, pair list, Keep A/B buttons

### Deferred items documented
- Ministry Phase 6+, digest charts, Railway private networking, Redis rate limiting, git history scrub

---

## 2026-05-09 — MCP Phase 3 — Session summarizer + admin API + admin UI

**Branch:** `claude/build-memory-layer-IftGo` | **Commit:** `1f58af9` | **Status:** Pushed

### What shipped

**Session Summarizer:**
- `packages/omnimind-api/src/services/session-summarizer.service.ts` — groups McpAuditLog entries into sessions (30-min gap = new session), calls Claude Haiku to write 2-4 sentence summaries, deduplicates via `findFirst` before writing, stores as SESSION_SUMMARY memories with synthetic `mcp:<tenantId>` userId
- `packages/omnimind-api/src/jobs/session-summarizer.ts` — `*/10 * * * *` cron wrapper, `startSessionSummarizer()` / `stopSessionSummarizer()` wired into index.ts

**Admin API (omnimind-api):**
- `packages/omnimind-api/src/routes/admin.routes.ts` — 6 endpoints: stats, agents, audit (paginated), memories (paginated + searchable), contradictions, summarize trigger

**Admin proxy + UI (boardroom-ai):**
- `packages/boardroom-ai/server/src/routes/admin.routes.ts` — thin proxy to OmniMind /admin/* (no x-user-id needed)
- `omnimind-client.ts` — 6 new admin methods added
- `packages/boardroom-ai/client/src/pages/AdminPage.tsx` — 5-tab admin dashboard (Overview, Memories, Audit Log, Agents, Contradictions)
- `App.tsx` + `Sidebar.tsx` — /admin route registered, nav item added to secondaryNav

### Test status
- omnimind-api: 18 suites fail (pre-existing missing tests/setup.ts — not caused by this session); 199 tests pass
- boardroom-ai server: 145 tests pass (21 suites)
- boardroom-ai client: 5 suites fail (pre-existing missing @testing-library/jest-dom/vitest)
- omnimind-mcp: 43 tests pass (cached)
- Typecheck: 5/5 packages green

---

## 2026-05-09 — MCP Phase 2 — Agents wired, smoke tests passed, keys generated

**Branch:** `claude/build-memory-layer-IftGo` | **Status:** Pushed

### What shipped
- `docs/MEMORY-PROTOCOL.md` — agent protocol: write vs search rules, domain routing, fact quality, session start/end checklist
- `docs/agent-configs/` — 6 configs (claude-desktop, claude-code, cursor, chatgpt-desktop, keygen-commands.sh, SMOKE-TESTS.md)
- `.claude/CLAUDE.md` — Memory Layer section: architecture, 15-tool reference, dogfooding rules, ministry domain rule
- Fixed `keygen.ts`: replaced private bracket access with `registerAgent()` public method
- Fixed `client.ts`: userId moved to `x-user-id` header (not body); added `registerAgent()` method
- Fixed `smoke.ts`: env inheritance for spawned server; all 15 tools verified by name
- Fixed `shared/memory.types.ts` + `memory-config.ts`: added MCP_AGENT + SESSION_SUMMARY enum values (were in DB schema but missing from TypeScript types, causing 422 on writes)

### Smoke test results (live local DB)
- Tier 1: `smoke OK — 15 tools registered` ✅
- T1: memory write (MCP_AGENT source) ✅
- T2: memory update ✅
- T3: memory search ✅
- T4: audit log write ✅
- T5: audit log GET verified ✅
- T6: SCOPE_DENIED for cursor-josh on memory:write ✅
- T7: memory:read allowed for cursor-josh ✅
- T8: wildcard scope (`*`) grants all for boardroom-ai ✅
- T9: prefix wildcard `memory:*` grants memory:write and memory:read ✅
- T10: HTTP Unauthorized without key ✅
- T11: HTTP auth passes, StreamableHTTP handshake proceeds ✅

### 6 agents registered (local DB — re-run keygen-commands.sh against production)
- `claude-desktop-josh` / josh-personal / memory:read,write,context:write,preference:write,person:write / 0.85
- `claude-code-josh` / josh-business / memory:read,write,decision:write,task:write,project:write,commitment:write,code:write / 1.0
- `cursor-josh` / josh-business / memory:read / 0.7
- `chatgpt-desktop-josh` / josh-personal / memory:read / 0.6
- `boardroom-ai` / josh-business / * / 1.0
- `cortex-summarizer` / josh-business / memory:write / 0.8

### Next session
Wait 1 week for real agent usage. Then Phase 3: Admin Viewer + Session Summarizer.
If tool descriptions need tuning based on real usage, do that first.

---

## 2026-05-09 — MCP Phase 1 — Core tools, fact extractor, hybrid embeddings

**Branch:** `claude/build-memory-layer-IftGo` | **Status:** Pushed, ready for PR

### What shipped
- New `packages/omnimind-mcp` package (15 MCP tools, stdio + HTTP transports, keygen CLI, smoke test)
- 15 tools: `memory_write`, `memory_search`, `memory_supersede`, `decision_log`, `task_upsert/status/list/complete/block`, `project_status/summary`, `person_get`, `commitment_log/list`, `status_get`
- Fact extractor (`lib/fact-extractor.ts`): Claude Haiku extracts atomic facts, cosine-dedup at 0.85 threshold, graceful fallback on LLM failure, empty input → empty array
- Hybrid embeddings: Ollama `bge-base-en-v1.5` for `domain=ministry` (768-dim padded to 1536), OpenAI for all other domains. Ministry path NEVER falls back to OpenAI — write refused if Ollama unavailable
- Forgetting curve in `structured-filter.ts`: default search excludes `importance < 0.4 AND lastAccessedAt < 90d`
- `sourceWeight` multiplier wired into `ranker.ts`
- Prisma schema: `Tenant`, `Agent`, `McpAuditLog` models; `MemoryEntry` extended; `MCP_AGENT` + `SESSION_SUMMARY` enum values; migration SQL at `prisma/migrations/20260509000000_mcp_phase_1/`
- MCP audit routes: `POST/GET /mcp/audit`, `POST/GET /mcp/agents`
- Scope enforcement: `requireScope()` with exact, `*`, and `prefix:*` wildcard support
- 43 vitest tests across 7 test files (all passing)
- ADR-014 added: hybrid embedding routing rationale

### Gate results
- `pnpm typecheck` — ✅ 5/5 packages green
- `pnpm test` — ✅ 43/43 tests pass
- `pnpm build` — ✅ 4/4 packages build clean
- Fixed 4 pre-existing Zod v3→v4 errors in `shared/validation-helpers.ts`
- Fixed `@types/node` missing from `omnimind-api` devDependencies
- Excluded dead code (`incremental-embedding.service.ts`, `memory-cleanup-scheduler.ts`) from typecheck

### Next session
Phase 2: Wire agents — keygen for all 6 agents, `docs/MEMORY-PROTOCOL.md`, Claude Desktop config, smoke test checklist, `.claude/CLAUDE.md` memory layer section.

---

## 2026-05-09 — Phase 0, 0.25 — Foundation + Security Fixes

The Wave 4 final validator reconciled the 18-agent pipeline output. No code changes; documentation-only fixes.

**Phase numbering — canonical scheme adopted (Builder 2b's filesystem layout):**
- Phase 12 = webhooks-event-bus (was variously SDK, hardening)
- Phase 13 = sdk (was observability)
- Phase 14 = observability-suite (was migration history)
- Phase 15 = migration-history (was cortex isolation; pull-forward candidate)
- Phase 16 = cortex-isolation (was knowledge-graph deep)
- Phases 17 (persona marketplace), 18 (resilience + multitenant fairness), 19 (horizontal API scale) added to all top-level docs (ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, SUCCESS-METRICS, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA)
- Phantom sub-decimal phases (1.5, 1.6, 2.5, 5/Cortex Pro, "Pre-enterprise") remapped per `04-roadmap/ROADMAP-OVERVIEW.md` "phase-number map" section (Phase 1 durability layer / Phase 0.25 / DEFERRED with named triggers)
- 8 empty stub phase folders deleted by the parent (PHASE-12-sdk, PHASE-13-observability, PHASE-14-migration-history, PHASE-15-cortex-isolation, PHASE-16-knowledge-graph-deep, PHASE-7b-outcome-feedback, PHASE-8-reranker, PHASE-DEFERRED). Canonical phase folder list documented in ROADMAP-OVERVIEW.

**Cross-reference fixes:**
- LANDMINE ID format harmonized to L1..L10 (was a mix of L*, LANDMINE-A1, LANDMINE-D1, LANDMINE-stripe-*, LM-03). Cross-reference table added to top of `06-risks-and-mitigations/RISK-REGISTER.md` mapping Landmine ↔ KI ↔ Risk ID.
- `KNOWN-ISSUES.md` "Fix phase" column rewritten for all 79 KI entries to use canonical phase numbers.
- `LANDMINES.md` "Roadmap home" lines on all 10 landmines rewritten to canonical phases.
- `RISK-REGISTER.md` Section 6 rewritten as canonical risk-by-phase quick map.
- `MASTER-INDEX.md` rewritten to remove ~10 broken links (SOPHISTICATION-RUBRIC, SCALE-CEILING, KNOWN-LIMITATIONS, SCALABILITY-RISKS, EVAL-RISKS, SESSION-KICKOFF-TEMPLATE, SUBAGENT-PATTERNS, REPORTING-BACK, markdown-export, EXTERNAL-LINKS) — now points at the actual files (CAPABILITIES-INVENTORY, RISK-REGISTER §3, AGENT-DISPATCH-PATTERNS, HANDOFF-TEMPLATE, markdown-export-import, external-docs).

**Executor-feasibility fixes:**
- `STATUS/CURRENT-PHASE.md` rewritten: now mentions Phase 0.25 explicitly, adds "Active task (within current phase)" pointer line, surfaces the canonical phase queue.
- `STATUS/PHASE-PROGRESS-TRACKER.md` rewritten: extended through Phase 19, added explicit task IDs per phase (e.g., 0.25.1..0.25.6) so cold-start sessions know which task to resume.
- `STATUS/PHASE-COMPLETION-CRITERIA.md` extended through Phase 19.
- File-path drift fixed in `04-roadmap/PHASE-0.25-critical-fixes/tasks-and-prompts.md` (`user-profile.ts` → `user-profile.schema.ts`, `memory.ts` → `memory.types.ts`); same convention propagated to Phase 1 + Phase 4 + Phase 17 (`extracted-entity.schema.ts`, `relationship-query.schema.ts`, `persona-manifest.schema.ts`, etc.).
- Added security-incident task type (I) to `07-claude-instructions/CLAUDE-WORKFLOW.md` task-type table; added matching pitfall #13 to `07-claude-instructions/COMMON-PITFALLS.md` covering acute-mode triage flow and per-scenario first-actions.

**Time budget reconciliation:**
- Phase 10 (MCP server) revised: 2w → 4-6w per research validation
- Phase 11 (markdown export) revised: 1w → 3-4w per research validation
- Phase 13 (SDK) revised: 1.5w → 3-4w per research validation
- EXECUTIVE-SUMMARY headline calendar revised: p50 24w → ~30w; p90 30w → ~37w
- COST-MODEL per-phase impact table updated for canonical numbering and new phases (12 webhooks, 17 marketplace, 19 horizontal scale)

**Persona-marketplace contradiction resolved:**
- Phase 17 confirmed as PLANNED (real phase folder retained)
- `DEFERRED/persona-marketplace.md` (DEF-014) reframed as alternative-deferral spec with conditions for descope; row in `DEFERRED/README.md` now points at PHASE-17 as canonical home.

**ADR copies (item K) — TODO acknowledged:**
- `08-references/adrs/` README updated to reflect that the 13 ADRs in `docs/DECISIONS.md` have not been split into one-file-per-ADR copies. Flagged a real inconsistency between `01-foundations/ADR-INDEX.md` (ADR-005/006/010/012 headlines) and `docs/DECISIONS.md` (different headlines for those numbers) — left BOTH intact and surfaced for user decision rather than silently rewriting either.

**Files created:** 1 (`docs/_archive/research-wave-3-reviews/wave4-validator-summary.md` — archived in Phase D 2026-05-01; original path was `docs/research/omnimind-roadmap-2026/wave3-review/wave4-validator-summary.md`)
**Files modified:** ~25 across all roadmap subdirectories
**Files deleted:** 0 (parent already removed the 8 empty stub folders)

Next session: Phase 0 (foundation cleanup) is unblocked and ready to execute. Phase 0.25 follows.

---

## 2026-04-18 — Roadmap scaffold — Initial creation

- Created `docs/roadmap/` directory tree (10 top-level dirs, 21 phase folders)
- Wrote entry-point docs: `README.md`, `PROJECT-CONTEXT.md`, `07-claude-instructions/CLAUDE-WORKFLOW.md`, `07-claude-instructions/CONTEXT-LOAD-ORDER.md`
- Wrote initial STATUS docs: `CURRENT-PHASE.md`, `BLOCKERS.md`, `CHANGELOG.md` (this file), `DECISIONS-LOG.md`
- Built by 18-agent pipeline: 4 researchers + 4 auditors + 6 builders + 3 reviewers + 1 final validator
- Subsequent agent waves filled `01-foundations/` through `08-references/`

Next session: pick up Phase 0 from `04-roadmap/PHASE-0-foundation/`.
