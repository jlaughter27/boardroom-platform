# Dev Roadmap — Phase 8 (from 2026-10-22)

**TL;DR.** The code runs ahead of what can be confirmed about production. Locally, the merged code runs the whole loop green: typecheck 5/5, `pnpm test:e2e` 55/55, `pnpm e2e:live` 22/22. CI on `main` is green as of `fc19563`. In production, nothing about the north star ("one memory every AI can read and write, plus a BoardRoom that uses it") has been shown to work.

What this roadmap does, in order:

1. **Contain.** Rotate the R-103 secrets, take a snapshot, and keep `main` green by closing the remaining moderate advisories and never cancelling main runs.
2. **Make production observable.** Every deploy gets checked against its SHA by a GitHub runner, and `omnimind-mcp` launches behind a go-live script that cannot report false success.
3. **Make the memory one memory, without breaking tenant isolation.** Decide the tenancy of the entity tables (ADR-017) and add `tenantId` to them. Then point the MCP decision, commitment and task tools at the tables BoardRoom actually uses. This starts on W1 day 1.
4. **Fix the trust-breaking UX before the 30-day dogfood starts.** That means raw JSON while streaming, an endless "Thinking...", the fake "Set Deadline", dismissals that reset on reload, gold that fails contrast, and Safari that has never been rendered.
5. **Run the instrumented dogfood** from 2026-11-12 to 2026-12-11 against founder-signed thresholds. The ops floor and the daily-loop surfaces land during it.
6. **Write the verdict and the pre-signup gate in W8.** Only after the verdict does the public OmniMind domain come down.

Up to four agent lanes run in parallel. Founder-only steps use no lane and come with copy-paste acceptance lines.

**Status (2026-10-22):**

- `origin/main` = `fc19563`. PR #23 bumped `@modelcontextprotocol/sdk` to `^1.32.1`.
- **CI on main is green.** Run `39864122262` on `fc19563` completed `success`: verify, Docker (omnimind-mcp), Docker (boardroom-ai), Docker (omnimind-api) and Retrieval IR eval all passed. That includes the first-ever omnimind-mcp image build.
- The previous run, `39860431324` on `cdef1ef`, failed at the dependency audit. Railway deployed `cdef1ef` anyway.
- Neither the `cdef1ef` deploy nor the `fc19563` deploy is verified. The sandbox cannot reach `*.up.railway.app`, and there is no Railway credential.
- `omnimind-mcp` has never been launched, and no OAuth issuer is configured.
- No backups have run since the 2026-05-09 drill row.
- Deploy secrets committed in early history remain recoverable from this **public** repo's git history (risk R-103; the founder has the commit reference), and nothing records a rotation.

---

## How this was built

**Audit.** Three auditors read the repo and ran commands:
- UI/UX produced 29 findings (UI-01…UI-29).
- Engineering and operations produced 24 (ENG-01…ENG-24).
- Product strategy produced 18 (PRD-01…PRD-18).

**Competing drafts.** Two planners each drafted a full roadmap from those audits:
- "Launch-and-trust first" put containment, verification and ops ahead of all polish.
- "Experience first" spent three of four lanes on the decision session, dashboard honesty, contrast and Safari, and ran ops as one parallel lane.

**Cross-examination.** Each planner critiqued the other against the repo. That surfaced four problems:
- Both drafts were stale about the SDK fix.
- ADR-015 is already taken, so the OAuth decision becomes **ADR-016**.
- Launch-first's streaming field names were wrong. The contract uses `situationReading`/`analysis` (`docs/prompts/optimist.system.md:44-55`).
- Experience-first's `/health`→503 would gate Railway deploys, because all three `railway.toml` files use `healthcheckPath="/health"`.

**Synthesis.** The chief architect merged the drafts and decided every disagreement. Each decision is recorded in the Decision ledger.

**Validation.** Two validators checked the result:
- A coverage validator checked findings, dependencies, lanes and the protocol.
- A repo-truth validator checked every claim against code and command output.

They found two blocking and four major issues, all fixed in this revision (see "Validation" at the end).

---

## Milestones at a glance

Week calendar: W1 = 10-22→10-28 · W2 = 10-29→11-04 · W3 = 11-05→11-11 · W4 = 11-12→11-18 · W5 = 11-19→11-25 · W6 = 11-26→12-02 · W7 = 12-03→12-09 · W8 = 12-10→12-16.

| Milestone | Weeks | Goal | Exit criteria (short) |
|---|---|---|---|
| **M0 — Contain and stay green** | W1 | Rotate the leaked secrets. Take a snapshot. Close the moderate advisories. Never cancel main runs. Make deploys identifiable. Add a safe migration-drift guard. Make the status docs true. | Main green (already met on `fc19563`; still green after M0-A1). `/health` has `version` and `/ready` exists. Drift step uses its own shadow DB. Rotation and pg_dump recorded by the founder. BLOCKERS and CURRENT-PHASE are true. |
| **M1 — Verified production, MCP live for token clients, tenant-safe one memory, signature moment honest** | W1–W3 | Automatic post-deploy SHA verification. A go-live script that can't lie. MCP launched for Claude Code and Cursor. Entity tables carry `tenantId` (ADR-017). MCP entity tools write BoardRoom's tables. The decision session and dashboard stop lying. Gold passes AA. | `post-deploy-verify` green on the main SHA for all 3 services (run link). E2E-9 passes: same user, two tenants, no cross-visibility, in CI. No raw JSON while streaming and no endless "Thinking...". Token-pair contrast test passes. |
| **M2 — One memory everywhere, Apple-quality floor, dogfood day 1** | W3–W4 | status_get carries the moat. OAuth front door. Self-serve scope widening. Onboarding "Connect your AI". One client cache. WebKit in CI. Persona palette. Scorecard validated on prod, then day 1 = **2026-11-12**. | Journey ≤12 dashboard requests. WebKit CI green at 393×852 and 820×1180. `/admin/dogfood` tested. Thresholds signed after a first prod report. verify-oauth output recorded. |
| **M3 — Ops floor and daily loop, inside the window** | W4–W6 | Alerts, advisory lock, private networking, agent-key enforcement, a BoardRoom admin path to the private API, rotted tests triaged, Node 22, ⌘K capture, Today, nightly real-stack journey, icons, bundle, copy. | OTel and alerts recorded. Private URL in use and agent key enforced after the soak. Orphan-test guard green. Node 22 docker×3 green. Nightly e2e:live green 3 nights. Device pass #2 with zero P0. |
| **M4 — Verdict and pre-signup gate** | W7–W8 | Turn 30 days of data into a written decision. Spend cap and account export before any non-founder user. Forms and token guard rails. Retire the public API domain after the verdict. | DECISIONS-LOG verdict entry. 402 `budget` tests. `/export` isolation test. Native-select allow-comments gone. Public API domain removed, dogfood report re-run through BoardRoom. |

---

## Lanes

Each lane is one worktree agent producing one PR per item, or one per workstream when the items are S and touch the same files. At most four lanes run at once.

| Lane | Owns | Typical files |
|---|---|---|
| **A — Release, ops & metrics** | CI jobs, health and readiness, deploy verification, the go-live script, test-debt triage, Node runtime, the dogfood scorecard, ops endpoints, the spend cap, the M1 journey harness | `.github/workflows/*`, `scripts/*`, `packages/*/src/routes/health.routes.ts`, `packages/omnimind-api/src/routes/admin.routes.ts`, `packages/boardroom-ai/server/src/routes/admin.routes.ts`, `tests/audit`, Dockerfiles |
| **B — Memory & MCP** | Entity tenancy, MCP tool behaviour, write reliability, entity unification and backfill, status_get, user-scoped OAuth identities, retrieval ranking, capture API, export | `packages/omnimind-api/prisma/schema.prisma` (M1), `packages/omnimind-mcp/src/tools/*`, `packages/omnimind-api/src/{routes,services}/{decisions,commitments,tasks,people,projects,goals}*`, `packages/omnimind-api/src/routes/mcp.routes.ts`, `packages/omnimind-api/src/retrieval/*` |
| **C — Decision & dashboard trust** | Decision-session states, dashboard actions and hierarchy, the entity cache, onboarding connect, Today, journey core steps (from M2), the nightly journey | `client/src/stores/*`, `client/src/pages/{DecisionSessionPage,DashboardPage,OnboardingPage}.tsx`, `server/src/agents/orchestrator.ts`, `tests/e2e/live/journey.mjs` (M2+) |
| **D — Design system & Apple quality** | Tokens and contrast, motion, keyboard access, WebKit/iOS, icons, bundle, copy, forms | `client/src/styles/tokens.css`, `client/src/components/ui/*`, `client/tests/ui-standards.test.ts`, `tools/visual-preview/*`, `client/vite.config.ts` |
| **F — Founder (no agent lane)** | Anything needing Railway, OAuth issuer, GitHub admin, Stripe, a real device, or a product decision | Records evidence in `docs/STATUS/CHANGELOG.md`, `docs/03-operations/BACKUP-DRILLS.md`, `docs/STATUS/DECISIONS-LOG.md` |

### File-ownership rules

These rules prevent collisions. Where two lanes need the same file inside one milestone, an explicit dependsOn sequences them.

- **`ci.yml`:** edits go through Lane A. The one exception is the WebKit job, which Lane D adds in M2-D1 after M1-A3 merges. The bundle budget is a script in M3-D2, and Lane A wires it into CI in M3-A6.
- **`schema.prisma` (M1):** Lane B owns it. M1-C4's migration depends on M1-B4, so the two migrations never race.
- **`DashboardPage.tsx`:** belongs to Lane C. Lane D touches it only after the C item merges: M1-D2 and M1-D4 depend on M1-C4, and M3-D3 depends on M3-C1.
- **`PersonaCard.tsx` and `CognitiveLoadBanner.tsx` (M1):** belong to Lane C. M1-D2 depends on M1-C2 and M1-C4.
- **`tests/e2e/live/journey.mjs`:**
  - In M1, Lane A owns it. M1-A3 adds playwright resolution, a `--browser chromium|webkit` flag, and an autoloader for `tests/e2e/live/checks/*.mjs`.
  - From M2, Lane C owns the core steps.
  - Every other lane adds assertions **only as new files** in `tests/e2e/live/checks/`. Each check receives `{page, api, mcp, metrics}`.
- **`mcp-tokens.routes.ts` and `server/src/services/omnimind-client.ts` (M2):** M2-C2 depends on M2-B2.
- **Shared package:** lanes extend existing, already-exported schema and type files instead of editing the barrel.
  - Lane B: `decision.schema.ts`, `commitment.schema.ts`, `entities.schema.ts`, `mcp.schema.ts` and the matching `*.types.ts`.
  - Lane C: `request-body.schema.ts` + `api.types.ts` (dispatch body), and `user-profile.schema.ts` + `user-profile.types.ts` (dismissals).
- **`ui-standards.test.ts`:** each lane appends rules in its own `describe` block.

### Founder-only items

M0-F1…F4, M1-F1…F7, M2-F1…F4, M3-F1…F4 and M4-F1…F2. They are batched into four sessions:

| Session | Weeks | Work |
|---|---|---|
| 1 | W1 | Snapshot, rotate, protect, hand-verify, tenancy sign-off |
| 2 | W2–W3 | Go-live, GitHub connect, backups, bench, brand-gold pick, issuer pick |
| 3 | W4 | OAuth live, backfill, sign thresholds, device pass #1 |
| 4 | W5–W8 | Alerts, private network, agent key, weekly scorecards, device pass #2, verdict, domain removal |

**What cannot be verified from the sandbox:** production health, Railway settings, branch protection (the gh API returns 403 here), real OAuth providers, real Apple devices and Stripe. These are never marked done on local evidence.

---

## M0 — Contain and stay green (W1)

**Goal:** Remove the fact that makes everything else unsafe: live secrets recoverable from public history. Keep the now-green `main` green. Make deploys identifiable by SHA, add a migration-drift guard before the first new migration, and make the status docs true.

**Exit criteria**
- [x] `gh run list --branch main --limit 1` → run `39864122262` on `fc19563`, `success`. `gh run view 39864122262 --json jobs` shows verify, Docker (boardroom-ai), Docker (omnimind-api), Docker (omnimind-mcp) and Retrieval IR eval all `success`. *Met 2026-10-22.*
- [ ] The first main run after M0-A1 merges is also all-5-`success`. `pnpm audit --prod --audit-level high` exits 0, and `pnpm audit --prod` lists neither `qs` nor `ip-address`.
- [ ] Unit tests in all three services assert that `GET /health` returns 200 with a `version` field, and that `GET /ready` returns 503 when its dependency check fails.
- [ ] The CI retrieval-eval job runs `prisma migrate diff … --exit-code` against a **separate** `omnimind_shadow` database and passes. The eval database is untouched.
- [ ] *Founder-recorded:* a CHANGELOG entry dated W1 names the five rotated secrets (names only). A BACKUP-DRILLS.md row records the manual prod pg_dump (size, sha256, restore row counts).
- [ ] *Founder-recorded:* hand-verification of the live deploy is in CHANGELOG: migrate-deploy lines, `/health`, and the three PR #22 probes.
- [ ] `docs/STATUS/BLOCKERS.md` is dated W1 and lists only open blockers, each with owner and date.
- [ ] `CURRENT-PHASE.md` says "PR #22 merged as cdef1ef, PR #23 as fc19563; main CI green; deploy unverified".
- [ ] `grep -c '^model ' packages/omnimind-api/prisma/schema.prisma` (43 today) matches every model count in `.claude/CLAUDE.md`.

### M0 · Lane A — Stay green, identifiable deploys

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M0-A1 | **Re-scoped: main is already green on `fc19563`.** Add pnpm overrides `qs >=6.16.0` and `ip-address >=10.7.4`; root `package.json:43` is still `"ip-address@<=10.3.0": ">=10.3.1"`. Change `ci.yml` to `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. Add a weekly `schedule:` audit-only job. | `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` | `pnpm audit --prod --audit-level high` exits 0. `pnpm audit --prod` lists no qs or ip-address. The first main run after merge has all 5 jobs `success`. Two quick pushes to a scratch branch cancel the older run, while two merges to main both finish. `gh run list --event schedule --workflow ci.yml` shows a run within 7 days. | S | — | ENG-02, ENG-04 |
| M0-A2 | Add `version: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev'` to `/health`, and keep it **HTTP 200**: all three `railway.toml` set `healthcheckPath="/health"`. Add `GET /ready`, returning 503 when: the DB check fails (api); OmniMind is unreachable (boardroom-ai); upstream OmniMind `/health` over `OMNIMIND_API_URL` fails (mcp). BoardRoom's SPA fallback is a predicate (`app.ts:116`, B-102), not a prefix list. | `packages/omnimind-api/src/routes/health.routes.ts`, `packages/boardroom-ai/server/src/routes/health.routes.ts`, `packages/boardroom-ai/server/src/app.ts`, `packages/omnimind-mcp/src/transports/http.ts` | Per-service vitest: `/health` has `version` and stays 200 even when the dependency mock rejects. `/ready` returns 503 when `prisma.$queryRaw` rejects (api), when the omnimind client throws (boardroom), and when the upstream fetch fails (mcp). Boardroom test: `GET /api/ready` is not `index.html` in production mode. Package totals stay ≥ the baselines (shared 151, mcp 255, api 1,175, server 284, client 436). | M | — | ENG-03, ENG-06, ENG-07 |
| M0-A3 | Migration drift guard, landing before the first new migration of the phase (M1-B4, M1-C4). In the retrieval-eval job, **create a separate shadow DB in the same pgvector service**: `PGPASSWORD=eval psql -h localhost -U eval -d omnimind_eval -c 'CREATE DATABASE omnimind_shadow'`, then enable `vector`, `pg_trgm` and `btree_gin` in it. Run `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://eval:eval@localhost:5432/omnimind_shadow --exit-code`. **Never pass `$DATABASE_URL`**: `ci.yml:117` points it at the live `omnimind_eval` DB, and Prisma resets shadow databases. Add unit tests for the fresh, existing and unknown branches of `prisma/scripts/detect-baseline.cjs`. | `.github/workflows/ci.yml`, `packages/omnimind-api/prisma/scripts/detect-baseline.cjs`, `packages/omnimind-api/tests` | The CI step is green on main. A row-count check on `omnimind_eval` after the step equals the count before it, which proves the eval DB was untouched. The PR description links a deliberate red run where schema.prisma was edited without a migration. The detect-baseline tests pass. | S | M0-A1 | ENG-21 |

### M0 · Lane D — Status truth and scope freeze (docs only)

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M0-D1 | Status truth pass. (1) Rewrite `BLOCKERS.md` (dated 2026-04-18) around the real blockers: Railway credentials, R-103, OAuth issuer, backups, branch protection. (2) Update `CURRENT-PHASE.md`. (3) Add a shipped-phase (5.5/5.7/6/7/7.5) → roadmap-phase mapping with SHAs to `PHASE-PROGRESS-TRACKER.md`. (4) Add the tracker state legend from "How to run a lane": `todo → in-progress → in-review → merged → done`. (5) Rewrite `CURRENT-STATE.md` (2026-04-11) and `PROJECT-BRIEF.md` (which says Sonnet 4.6). (6) Fix the model count to 43. (7) Create **ADR-016 (Proposed): MCP OAuth issuer** in `DECISIONS.md` (ADR-014 is Hybrid Embedding, ADR-015 is the Apple-grade UI foundation), and repoint runbook §9 and the PHASE-10 README to it. | `docs/STATUS/BLOCKERS.md`, `docs/STATUS/CURRENT-PHASE.md`, `docs/STATUS/PHASE-PROGRESS-TRACKER.md`, `docs/01-orientation/CURRENT-STATE.md`, `docs/01-orientation/PROJECT-BRIEF.md`, `docs/02-reference/DECISIONS.md`, `.claude/CLAUDE.md`, `docs/runbooks/omnimind-mcp.md`, `docs/roadmap/04-roadmap/PHASE-10-mcp-server/README.md` | `python3 scripts/check-doc-links.py` passes. `grep -n "ADR-014" docs/runbooks/omnimind-mcp.md` returns no OAuth references. No BLOCKERS entry is already resolved in CHANGELOG. The tracker has the state legend and one row per item in this file. | S | — | ENG-23, PRD-13 |
| M0-D2 | Phase triage and a do-not-build list, as a `DECISIONS-LOG.md` entry. Keep: the Phase 10 remainder and the Phase 14 minimum. Shrink: Phase 11, to a one-shot export (M4-B1). Park with triggers: 12, 13, 16, 18, 19. Kill for now: 17. Also record this file's "Not doing" list. | `docs/STATUS/DECISIONS-LOG.md`, `docs/roadmap/04-roadmap/ROADMAP-OVERVIEW.md` | One row per phase 10–19 with a status and a named trigger. The Phase 12 trigger cites `.claude/CLAUDE.md` Known Limitation 13. | S | — | PRD-12, PRD-18 |

### M0 · Founder — containment

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M0-F1 | Take a manual prod `pg_dump` before any rotation, migration or go-live. Migrations run at boot (`docker-entrypoint.sh`). Store the dump off-Railway, then run `services/backup/restore-drill.sh` against it. | `docs/03-operations/BACKUP-DRILLS.md` | A row with date, size, sha256 and restore row counts for MemoryEntry, Decision and User. restore-drill exit 0 is recorded. | S | — | ENG-05 |
| M0-F2 | Rotate the five R-103 secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `JWT_SECRET` (this logs everyone out), `OMNIMIND_API_KEY` (change it on both services in one window) and `ENCRYPTION_KEY` (re-encrypt the stored OAuth tokens, or reconnect Google). Revoke the old model keys at the providers. Record the repo-visibility decision. | `docs/STATUS/CHANGELOG.md` | The CHANGELOG entry lists the five names and the time. The pre-rotation `OMNIMIND_API_KEY` gets 401 on `GET /memories`. A memory written after rotation has `has_embedding=true` within 30 s. | S | M0-F1 | ENG-01, ENG-09, PRD-01 |
| M0-F3 | Turn on branch protection for `main`, requiring verify, docker×3 and retrieval-eval. Enable Railway's wait-for-CI / check-suite gating per service; confirm the option's name in the dashboard. | `docs/STATUS/CHANGELOG.md` | Founder-run `gh api repos/jlaughter27/boardroom-platform/branches/main/protection` lists the five checks. The Railway setting is recorded. | S | M0-A1 | ENG-04 |
| M0-F4 | Hand-verify the live deploy (expected: `fc19563`) until M1-A1 exists. (1) Railway logs show `migrate deploy` applying `20261018000000_mcp_tokens` and `20261018000001_mcp_identity_hardening`. (2) `/health` responds on both services. (3) The three PR #22 probes pass: `/theme-init.js` is served under CSP; `x-agent-id` without the full triple → 400 `partial_agent_identity`; a dashboard load gets no 429. | `docs/STATUS/CHANGELOG.md`, `docs/STATUS/BLOCKERS.md` | Each observed result is in CHANGELOG. Any failure becomes a BLOCKERS entry before M1-F1. | S | — | PRD-01, ENG-03 |

---

## M1 — Verified production, MCP live for token clients, tenant-safe one memory, signature moment honest (W1–W3)

**Goal:**
- Every deploy is verified against `main`'s SHA from a GitHub runner.
- The go-live script stops reporting false success.
- `omnimind-mcp` is launched with async-safe writes, backed up and connected to GitHub.
- Entity tables gain `tenantId` under ADR-017, so re-pointed MCP tools keep the one-tenant-per-token rule.
- MCP entity tools write the first-class Decision, Commitment, Task, Person and Project rows.
- The decision session and dashboard stop lying, and the brand gold passes AA.

Lanes B and C start W1 day 1, in parallel with M0. Lane B starts with M1-B0 and M1-B2. Lane C starts with M1-C3.

**Exit criteria**
- [ ] A `post-deploy-verify` run on main shows `/health.version == <main HEAD SHA>` on boardroom-ai, omnimind-api and omnimind-mcp, with all non-skipped probes passing. *The founder records the run link in CHANGELOG.*
- [ ] `pnpm test:go-live` passes with new cases: API PORT≠3333, upstream 503 → fail, `OMNIMIND_MCP_WRITE_EXTRACT=async` in MCP_VARS, red main CI → abort.
- [ ] ADR-017 (entity tenancy) is Accepted. The migration adding `tenant_id` to decisions, commitments, tasks, people, projects and goals passes the M0-A3 drift step and fresh-DB `migrate deploy` in CI.
- [ ] The CI `e2e` job runs `pnpm test:e2e` on every PR: ≥56 tests, including `tests/e2e/E2E-9-mcp-entity-roundtrip.test.ts`. That file proves that **one user** holding contexts in `josh-personal` and `josh-business` cannot see the other tenant's Decision, Commitment or Task. E2E-2, E2E-5 and E2E-7 stay green.
- [ ] `node packages/omnimind-mcp/dist/index.js smoke` reports 20 tools, 3 prompts and 4 resource templates.
- [ ] Client tests prove that:
  - no streaming card renders `{` or a JSON key;
  - `persona_error` renders an error card with Retry and never "Thinking...";
  - `/decisions/:id` with no responses shows the stored question;
  - "Set Deadline" opens EntityForm;
  - dismissals survive a store re-init.
- [ ] The `tests/e2e/live/checks/cls.mjs` check asserts cumulative layout shift ≤0.05 during dispatch, and `pnpm e2e:live` passes locally.
- [ ] The `ui-standards.test.ts` token-pair rule passes in both themes: `--color-primary-foreground` on `--color-primary` is ≥4.5:1.
- [ ] *Founder-recorded:*
  - the go-live summary table is all ok;
  - `tools/list` = 20 from Claude Code and from Cursor;
  - the `/mcp/audit` agentId is `mcp-token:<slug>-<id>`;
  - revoke → 401;
  - `bench --n 10 --yes` p95 < 10 s and status_get p95 < 1.5 s;
  - the backup dead-man has pinged within 26 h, with a restore row dated W2–W3;
  - a push to main changes the MCP `/health.version`.

### M1 · Lane A — Automated verification, a go-live that can't lie, the e2e gate

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M1-A1 | Add `.github/workflows/post-deploy-verify.yml` (`workflow_run` on CI success on main, plus `workflow_dispatch`) and `scripts/verify-prod.sh`. The script polls each service's public `/health` until `version == github.sha` (15 min timeout), then runs read-only probes: `/ready` returns 200 on all 3 services; boardroom `GET /theme-init.js` returns 200 with a JS content type and a CSP header; an unauthenticated MCP `POST /mcp` returns 401 with `WWW-Authenticate`; an MCP `initialize` with a syntactically valid bogus `omt_` returns 401 `invalid_token` (503 `auth_unavailable` is a failure). The `partial_agent_identity` probe runs only if an `OMNIMIND_API_KEY` Actions secret exists; otherwise it reports `skipped`, never passed. The authenticated read-burst probe is dropped and stays a founder smoke. Hosts come from repo variables. | `.github/workflows/post-deploy-verify.yml`, `scripts/verify-prod.sh`, `scripts/tests/verify-prod.test.sh`, `scripts/pre-deploy-check.sh` | `bash scripts/tests/verify-prod.test.sh` (mock server, same style as `scripts/tests/mcp-go-live.test.sh`) passes these cases: SHA mismatch → exit 1; bogus-token 503 → exit 1; missing secret → "skipped"; all good → exit 0. `bash scripts/verify-prod.sh --dry-run` lists the probes. *The founder records the first real run link.* | M | M0-A2 | ENG-03, ENG-07, ENG-17 |
| M1-A2 | Harden `scripts/mcp-go-live.sh` in four ways. (1) Line 576 hardcodes `:3333`: read the omnimind-api `PORT` variable, or set `PORT=3333` explicitly (`PRIVATE-NETWORKING.md:14`). (2) Add `OMNIMIND_MCP_WRITE_EXTRACT=async` to MCP_VARS. (3) Even under `--no-token`, POST `initialize` with a bogus `omt_` and expect 401 `invalid_token`; 503 is a failure. (4) Add preconditions: the latest main CI run is `success` (via `gh api`), plus `--backup-ok` or a dead-man ping < 26 h old (DEPLOYMENT-RUNBOOK.md:193 step 0). Mirror all of this in `.github/workflows/mcp-go-live.yml` and the runbook. | `scripts/mcp-go-live.sh`, `scripts/tests/mcp-go-live.test.sh`, `.github/workflows/mcp-go-live.yml`, `docs/runbooks/omnimind-mcp.md`, `docs/03-operations/DEPLOYMENT-RUNBOOK.md` | `pnpm test:go-live` passes with new cases: API PORT=8080 → private URL uses 8080; bogus-token 503 → vfail; MCP_VARS contains async; red main → abort before any write; no backup evidence → abort. `pnpm go-live:mcp -- --dry-run --project x --owner-email y` prints the PORT step, the bogus-token check and both preconditions. | M | — | ENG-07, ENG-10, ENG-05, PRD-06 |
| M1-A3 | Add an `e2e` CI job that reuses the retrieval-eval pgvector service pattern to run `pnpm test:e2e` on every PR (the tenant-isolation and scope gate, `vitest.e2e.config.ts:9-11`). Add `playwright` as a root devDependency; `tests/e2e/live/journey.mjs:13-19` resolves an undeclared copy today. In `journey.mjs`, add a `--browser chromium\|webkit` flag (launch at lines 90-91) and an autoloader that runs every `tests/e2e/live/checks/*.mjs` with `{page, api, mcp, metrics}`. Other lanes add journey assertions there. | `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `tests/e2e/live/journey.mjs`, `tests/e2e/live/checks/README.md` | The e2e job is green on the PR, with the log showing ≥55 passing (≥56 once M1-B1 lands). `grep playwright package.json pnpm-lock.yaml` finds it. A sample `checks/smoke.mjs` runs inside `pnpm e2e:live`. `node tests/e2e/live/journey.mjs --browser webkit --dry-run` parses. | M | M0-A1 | ENG-11 |

### M1 · Lane B — Tenant-safe one memory and no lost writes

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M1-B0 | **Entity tenancy decision (ADR-017)**, recorded before any re-point. Today only `MemoryEntry` has `tenantId` (`schema.prisma:224`, default `josh-personal`). `Decision`, `Commitment`, `Task`, `Person`, `Project` and `Goal` are user-scoped only (`userId`, e.g. `schema.prisma:284-286`), and `delegated-user-isolation.ts` pins `userId` only. `decision.service.ts:203-204` already filters memories by tenant "via a shared entity". Re-pointing MCP tools at the entity routes as-is would let a `josh-personal` token read and write the same rows as a `josh-business` token, which breaks "Cross-tenant reads are not possible from MCP tools" (`.claude/CLAUDE.md`, Three Tenants). The decision is option (a): add `tenantId` to the six entity models; agent callers are filtered and stamped with `req.agentContext.tenantId`; non-agent callers (BoardRoom) keep seeing all of the user's rows, as they do for memories today; new non-agent rows take the column default, which the founder picks in M1-F7 (proposed `josh-personal`, matching MemoryEntry). Option (b), filtering through the linked memory's tenant, is rejected because BoardRoom-created entities have no linked memory and would vanish from MCP. Ministry: entity writes from a `tgfc-ministry` context follow the existing `MINISTRY_DEFERRED` gate. | `docs/02-reference/DECISIONS.md`, `docs/STATUS/DECISIONS-LOG.md`, `docs/contracts/omnimind-api.contract.md` | ADR-017 (Proposed) exists with both options, the rejected-option reason and the BoardRoom default-tenant question. The contract doc states the tenant-filter rule for agent callers. `python3 scripts/check-doc-links.py` passes. | S | — | PRD-02 |
| M1-B4 | **Add `tenantId` to the entity tables and scope the entity routes.** Add a Prisma migration: `tenant_id TEXT NOT NULL DEFAULT '<M1-F7 choice>'` plus a `(user_id, tenant_id)` index on decisions, commitments, tasks, people, projects and goals. Existing rows take the default. In the decisions/commitments/tasks/people/projects/goals services and routes: when `req.agentContext?.tenantId` is present, filter reads by it, stamp it on creates, and refuse updates or links to rows in another tenant (404, so existence is not leaked). With no agent context, behaviour is unchanged. Extend the shared Zod schemas and interfaces together (`decision/commitment/entities.schema.ts` and `*.types.ts`). The migration merges only after the founder's pg_dump. | `packages/omnimind-api/prisma/schema.prisma`, `packages/omnimind-api/prisma/migrations`, `packages/omnimind-api/src/routes/{decisions,commitments,tasks,people,projects,goals}.routes.ts`, `packages/omnimind-api/src/services`, `packages/shared/src/validation/{decision,commitment,entities}.schema.ts`, `packages/shared/src/types/{decision,commitment,entities}.types.ts`, `tests/e2e/E2E-9-mcp-entity-roundtrip.test.ts` | omnimind-api tests: an agent context in tenant A gets 404 on tenant B's Decision, Commitment and Task, for both read and PATCH, while a no-agent-context call sees both. The M0-A3 drift step and fresh-DB `migrate deploy` are green. The first half of E2E-9 (API level, same user, two tenants via `tests/e2e/harness/agent-context-factory.ts`) passes. | M | M1-B0, M1-F7, M0-F1, M0-A3 | PRD-02 |
| M1-B1 | Re-point the MCP entity tools at the now tenant-scoped first-class routes:<br>• `decision_log` → `POST /decisions` (today `decision.tool.ts:42` calls createMemory).<br>• `commitment_log`/`commitment_list` → `/commitments` (`commitment.tool.ts:50`).<br>• `task_upsert`/`complete`/`block`/`status`/`list` → `/tasks` (`task.tool.ts:134`).<br>• `person_get` → `/people`; `project_status`/`project_summary` → `/projects`.<br>• `status_get` recentDecisions/tasks/commitments read those routes instead of tag searches (`status.tool.ts:44-48`).<br>Each write also emits a linked memory via `POST /memories` in the same tenant, so it goes through the validation pipeline and search keeps working. The delegated allow-list already permits these paths. Keep 20 tools and the `idempotencyKey` semantics. **Start once M1-B4 merges (target W2).** | `packages/omnimind-mcp/src/tools/{decision,commitment,task,person,project,status}.tool.ts`, `packages/omnimind-mcp/src/lib/client.ts`, `packages/shared/src/validation/mcp.schema.ts`, `tests/e2e/E2E-9-mcp-entity-roundtrip.test.ts`, `docs/MEMORY-PROTOCOL.md` | omnimind-mcp tests are green (≥255), with client mocks asserting the route and body per tool. E2E-9 (MCP level), same user throughout:<br>• `decision_log` from a `josh-personal` token creates a row in `GET /decisions` (no agent context);<br>• `status_get` from a `josh-business` token does **not** show it;<br>• `commitment_log` appears in `commitmentsDueSoon` for its own tenant only;<br>• a BoardRoom-committed decision appears in `status_get.recentDecisions` for a token in the M1-F7 default tenant only.<br>Replaying one `idempotencyKey` creates exactly one Decision and one linked memory. `smoke` reports 20/3/4. | L | M1-B4 | PRD-02 |
| M1-B2 | Sync-mode `memory_write` stores the row and defers extraction instead of refusing. Today `fact-extractor.ts:134-138` throws `FactExtractorUnavailableError` ("Memory not written"). Catch it in `memory.tool.ts`, write the raw content through `POST /memories`, enqueue extraction via `lib/deferred-work.ts`, and return `extraction: 'deferred'`. | `packages/omnimind-mcp/src/tools/memory.tool.ts`, `packages/omnimind-mcp/src/lib/fact-extractor.ts`, `packages/omnimind-mcp/src/lib/deferred-work.ts` | Unit test: when the extractor throws, the tool succeeds, `client.createMemory` is called exactly once, and `output.extraction === 'deferred'`. The existing memory.tool tests stay green. | S | — | ENG-10, PRD-06 |
| M1-B3 | `scripts/backfill-mcp-entities.ts`. It works over OmniMind HTTP with the service or admin key and never uses raw Prisma for memory. It finds tagged decision, commitment and task memories, creates the entity rows **in the source memory's `tenantId`**, and links the source memory. It is idempotent (Idempotency-Key = source memory id) and skips `domain: 'ministry'`. Dry-run is the default; `--apply` is required to write. | `scripts/backfill-mcp-entities.ts`, `scripts/tests` | Fixture test: the first run creates N rows, a second run creates 0, and a dry-run makes 0 writes. Each created row's tenantId equals its source memory's. A dry-run against a locally seeded stack prints per-type, per-tenant counts. | M | M1-B1 | PRD-02 |

### M1 · Lane C — The decision session and dashboard stop lying

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M1-C1 | Stream prose, not JSON. Add a client-only tolerant incremental parser, with no new runtime dependency, that extracts `situationReading` and then `analysis` from partial PersonaResponse text (`docs/prompts/optimist.system.md:44-55`). Buffer deltas and flush once per `requestAnimationFrame`; today `session.store.ts:183-193` calls set() per token. Render a skeleton at the final card's min-height, then swap to the Zod-validated `persona_complete` payload (`agent.ts:159`), which stays the source of truth. One polite `aria-live` region announces completions. Move the "Synthesize with CEO" CTA below the grid or into a sticky footer (`DecisionSessionPage.tsx:312-329`). No prompt changes. | `packages/boardroom-ai/client/src/lib/partial-json.ts`, `client/src/stores/session.store.ts`, `client/src/components/decision/PersonaCard.tsx`, `client/src/pages/DecisionSessionPage.tsx`, `client/tests/lib/partial-json.test.ts`, `tools/visual-preview/fixtures`, `tools/visual-preview/shoot-pages.mjs`, `tests/e2e/live/checks/cls.mjs` | The parser test splits a real persona JSON at **every byte offset**: it never throws, and `situationReading` grows monotonically. PersonaCard test: no `{`, `"situationReading"` or `personaId` text appears while streaming. Store test: 200 deltas in one frame produce ≤2 updates. `checks/cls.mjs` asserts CLS ≤0.05 during dispatch. A visual-preview `decision-session-streaming` page is shot in light and dark. | M | M1-A3 | UI-02 |
| M1-C2 | Failed persona: an error card, a retry and an honest CEO step. Add a `personaErrors` map; today `session.store.ts:208-217` drops the error, and `PersonaCard.tsx:105-121` loops "Thinking..." forever (the infinite loop at line 115 is removed here). Retry calls `POST /sessions/:id/dispatch` with an optional `{personaIds}`, defined in the existing `request-body.schema.ts` plus `api.types.ts`. The orchestrator filters `modeConfig.personas` (`orchestrator.ts:129`) and **does not re-run `runDebateRound`** (`:271`) on a retry, and the ledger notes the late advisor. While an advisor is errored, the CEO CTA reads "Synthesize without Critic". | `client/src/stores/session.store.ts`, `client/src/components/decision/{PersonaCard,SynthesisPanel}.tsx`, `client/src/pages/DecisionSessionPage.tsx`, `server/src/routes/sessions.routes.ts`, `server/src/agents/orchestrator.ts`, `packages/shared/src/validation/request-body.schema.ts`, `packages/shared/src/types/api.types.ts` | Client: `persona_error` → an error card with Retry, and no "Thinking...". Server: `{personaIds:['critic']}` emits `persona_start` only for critic and **zero `rebuttal_start` events**; an unknown id → 400 via validateBody. A shared type-level test proves the schema and interface match. The CTA text includes the missing advisor's name. | M | M1-C1 | UI-03 |
| M1-C3 | Hydrate a reloaded or undispatched session. `DecisionSessionPage.tsx:30` uses `useState('')` and never reads `currentSession.question`. For an existing id, show the question read-only with Analyze/Edit, and keep the blank composer for `/decisions/new`. Align the tab title with the H1 (lines 28 and 194). | `client/src/pages/DecisionSessionPage.tsx`, `client/tests/pages` | Test: `/decisions/:id` with a question and no responses shows the question text and Analyze, with no empty textarea. `/decisions/new` still shows the composer. The e2e:live step-08 screenshot shows the question. | S | — | UI-08 |
| M1-C4 | Make dashboard actions real and dismissals persistent. "Set Deadline", "Define Metrics" and "Resolve" open EntityForm focused on the missing field; today `ProactiveQuestions.tsx:29-46` only dismisses. Persist dismissals in OmniMind: add `dismissedSuggestions Json @default("[]")`, with a per-entry expiry, to `UserProfile` as a Prisma migration. UserProfile has no generic preferences column, and `dashboardLayout` has other semantics. Extend `user-profile.schema.ts`/`user-profile.types.ts` together, and the `user-profile.routes.ts` PATCH. `ui.store.ts:24,43-48` goes through BoardRoom, with a try/catch localStorage cache. A zero-decision account gets a first-run nudge instead of "7+ days" (`DashboardPage.tsx:62-68`). Show the load warning once (lines 81-83). Fix "Create a Goal" → `/` (line 172). Replace the perpetual `animate-pulse` at `CognitiveLoadBanner.tsx:21` with a static indicator. | `packages/omnimind-api/prisma/schema.prisma`, `packages/omnimind-api/prisma/migrations`, `packages/omnimind-api/src/routes/user-profile.routes.ts`, `packages/shared/src/validation/user-profile.schema.ts`, `packages/shared/src/types/user-profile.types.ts`, `client/src/stores/ui.store.ts`, `client/src/components/dashboard/{ProactiveQuestions,CognitiveLoadBanner}.tsx`, `client/src/pages/DashboardPage.tsx` | api: PATCH `{dismissedSuggestions:[{id,until}]}` round-trips, and a bad shape → 400. Client: a dismissed id stays hidden after store re-init (mocked API); "Set Deadline" focuses the deadline field; with 0 decisions there is no "7+ days" copy; the load message occurs once. The CI drift step and fresh-DB `migrate deploy` are green. | M | M0-F1, M0-A3, M1-B4 | UI-04, UI-05 |

### M1 · Lane D — Contrast, motion, keyboard, safe failure

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M1-D1 | Brand gold passes AA on solid surfaces. The PR ships both variants behind tokens.css, with visual-preview shots of login, settings and dashboard: (a) a darker light-mode `--color-primary` so that white clears 4.5:1 (today white on `#b5890a` is 3.21:1); (b) dark-on-gold labels. Repoint the 59 `text-primary` text usages to `text-primary-text`. Add a token-pair contrast test that parses `tokens.css` in both themes: text ≥4.5:1, non-text ≥3:1. | `client/src/styles/tokens.css`, `client/src/components/ui/Button.tsx`, `client/tests/ui-standards.test.ts`, `tools/visual-preview/contrast.mjs` | The new test fails on today's tokens and passes after the change. `text-primary\b` is never used as a text color outside an allow-list. `node tools/visual-preview/contrast.mjs` reports no failing pair on login or settings. | M | — | UI-01 |
| M1-D2 | Reduced motion reaches Motion JS. Wrap the app in `<MotionConfig reducedMotion="user">` in `main.tsx`. Route all 7 `scrollIntoView({behavior:'smooth'})` calls, including `DashboardPage.tsx:135` and `SettingsPage.tsx:77,126`, through a `lib/motion.ts` matchMedia helper. Collapse the login reveal (`LoginPage.tsx:105-173`) to a single 180 ms fade. Drop the AINudge 0.5 s delay and the list staggers. Replace the `WizardStep.tsx:103` infinite loop. Add guard rules: Motion `duration` >0.3 or `delay` >0.1 outside an allow-list fails, and so does any direct `behavior:'smooth'`. Runs after M1-C2 and M1-C4, which own PersonaCard, CognitiveLoadBanner and DashboardPage in M1. | `client/src/main.tsx`, `client/src/lib/motion.ts`, `client/src/pages/{LoginPage,DashboardPage,SettingsPage,DecisionLabPage}.tsx`, `client/src/components/shared/AINudge.tsx`, `client/src/components/onboarding/WizardStep.tsx`, `client/tests/ui-standards.test.ts` | The guard rules pass on the tree and fail on a seeded bad snippet. `grep -rn "behavior: 'smooth'" client/src` returns only `lib/motion.ts`. The `--reduced-motion` visual variant includes decision-session-streaming. | S | M1-C2, M1-C4 | UI-09, UI-10 |
| M1-D3 | A profile-fetch failure must not send an onboarded user to onboarding, and the token reveal must not overflow. `App.tsx:70-75` OnboardingGate redirects only on 404 or no profile; on 5xx, network errors or an open breaker, it renders the shell with a retry banner. Add `min-w-0` at `SettingsPage.tsx:166`. Render the snippets as an `overflow-x-auto <pre>` with a fade edge. Add a visual-preview "token-created-long-url" state. | `client/src/App.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/components/settings/McpTokenCreateForm.tsx`, `tools/visual-preview/fixtures`, `tools/visual-preview/shoot.mjs` | Test: a 503 renders the banner without navigating; a 404 navigates. At 1280 px and 390 px, the shoot asserts `scrollingElement.scrollWidth <= clientWidth`. | S | — | UI-17, UI-06 |
| M1-D4 | Keyboard-reachable cards. Give `Card` an `as="button"`/Link (or asChild) option, and use it at `DecisionLabPage.tsx:173-176`, `RecentDecisions.tsx:73-76` and `DashboardPage.tsx:177`. Remove `hover` from non-interactive cards. Add a ui-standards rule that refuses `onClick` on a non-interactive Card. | `client/src/components/ui/Card.tsx`, `client/src/pages/{DecisionLabPage,DashboardPage}.tsx`, `client/src/components/dashboard/RecentDecisions.tsx`, `client/tests/ui-standards.test.ts` | Test: Tab focuses a past-decision row, and Enter navigates. The guard rule passes. | S | M1-C4 | UI-07 |

### M1 · Founder — tenancy sign-off and launch session

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M1-F7 | Review ADR-017 and pick **which tenant BoardRoom-created entities default to**. The proposal is `josh-personal`, matching the MemoryEntry default at `schema.prisma:224`. Note the consequence: only tokens in that tenant see BoardRoom decisions in `status_get`. | `docs/02-reference/DECISIONS.md` (PR review) | ADR-017 is marked Accepted and names the default tenant. M1-B4's migration default matches it. | S | M1-B0 | PRD-02 |
| M1-F1 | Run MCP go-live with the RAILWAY_TOKEN secret and the project id (the "MCP go-live" workflow, or `pnpm go-live:mcp -- --project <id> --owner-email <e> --yes`). Mint a token, connect Claude Code (`--scope user`) and Cursor, and run runbook §7, including revoke. | `docs/STATUS/CHANGELOG.md` | The go-live summary table is pasted, with all rows ok. `tools/list` = 20 from two clients. The `/mcp/audit` agentId is `mcp-token:<slug>-<id>`. Revoke → 401 `invalid_token`. | S | M0-A1, M0-F1, M0-F2, M1-A2 | PRD-01, ENG-07 |
| M1-F2 | In Railway, connect `omnimind-mcp` to the repo and set its config path to `packages/omnimind-mcp/railway.toml` (`mcp-go-live.sh:603`). Confirm `numReplicas=1` on all 3 services. | `docs/STATUS/CHANGELOG.md` | The next post-deploy-verify run shows the MCP version == the main SHA. Replicas=1 is recorded. | S | M1-F1, M1-A1 | ENG-17, ENG-16 |
| M1-F3 | Deploy `services/backup` (cron `0 3 * * *`) with the R2 vars and `BACKUP_HEALTHCHECK_URL`. Run `restore-drill.sh` against the first artifact. | `docs/03-operations/BACKUP-DRILLS.md` | The dead-man has pinged within 26 h. A restore row is dated W2–W3. | S | M0-F1 | ENG-05 |
| M1-F4 | Benchmark prod with `node packages/omnimind-mcp/dist/index.js bench --n 10 --user <id> --yes`, then time `status_get` over the public URL. | `docs/STATUS/CHANGELOG.md` | Write p95 (target < 10 s) and status_get p95 (target < 1.5 s) are recorded. | S | M1-F1 | PRD-06, ENG-10 |
| M1-F5 | Pick the brand-gold variant in the M1-D1 PR review. | PR comment, `docs/STATUS/DECISIONS-LOG.md` | The merged tokens.css matches the named choice. | S | M1-D1 | UI-01 |
| M1-F6 | Pick the OAuth issuer (WorkOS AuthKit or Auth0) against the ADR-016 criteria: DCR for public clients with PKCE, `aud` = `OMNIMIND_MCP_PUBLIC_URL`, `email`/`email_verified` or userinfo, and CIMD as a bonus. Check whether the founder's ChatGPT plan offers write tools. | `docs/02-reference/DECISIONS.md` | ADR-016 records the provider and the result for each criterion. | S | M0-D1 | PRD-03, ENG-08 |

---

## M2 — One memory everywhere, Apple-quality floor, dogfood day 1 (W3–W4)

**Goal:**
- Bring the moat (forecasts, outcome reviews, contradictions, memo) into every AI client through a tenant-scoped status_get.
- Open the OAuth front door and let users widen their own sign-in scopes.
- Make "Connect your AI" part of first run.
- Collapse the dashboard to one cache.
- Render in WebKit at iPhone and iPad sizes, and fix the persona palette.
- Validate the scorecard on real prod data, then sign the thresholds. **Day 1 = 2026-11-12**, and the window runs to 2026-12-11.

**Day-1 gate (all required):**
- M1-F1 is live.
- M1-B4, M1-B1 and M1-B2 are deployed and verified.
- M1-C1, M1-C2 and M1-C4 are deployed.
- M2-A1 has run once against production.

OAuth is **not** a gate: if it slips, ChatGPT and claude.ai active days are pro-rated from the OAuth date.

**Exit criteria**
- [ ] omnimind-mcp tests cover the status_get fields `pendingOutcomeReviews`, `openContradictions` and `latestMemo`, filtered to the token's tenant. An e2e test shows that a `decision_log` forecast appears in the outcome-review pending list after `reviewAt`. `smoke` still reports 20 tools.
- [ ] omnimind-api tests: user A gets 404 on user B's identity via `/mcp/identities/mine`, and a PATCH beyond the grantable ceiling → 400.
- [ ] `/admin/dogfood` has unit tests for every metric (a–e, superseded-as-current, onboarding-connect rate), each broken down per tenant. Without `OMNIMIND_ADMIN_KEY` it returns 503 `admin_disabled`, and with a wrong key 401. `pnpm tsx scripts/cost-report.ts --days 7` prints $/session on a seeded DB.
- [ ] The `checks/request-budget.mjs` check asserts ≤12 API requests on dashboard load, each path at most once, and zero 429s.
- [ ] The CI `webkit-visual` job is green, with artifacts at 393×852 and 820×1180 and `scrollWidth == clientWidth` on every shot page.
- [ ] The token test asserts every `--persona-*` is ≥3:1 on `--color-card` in both themes, and that the simulated-deutan ΔE between optimist and critic is above the documented threshold.
- [ ] *Founder-recorded:*
  - `scripts/verify-oauth.sh` passes against prod;
  - ADR-016 is Accepted;
  - the backfill dry-run and apply counts;
  - the first `/admin/dogfood` prod output;
  - a signed DOGFOOD-SCORECARD.md and a "Dogfood day 1" CHANGELOG entry;
  - device pass #1 notes.

### M2 · Lane A — Scorecard and OAuth verification

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M2-A1 | Read-only dogfood scorecard and cost report: an admin-only `GET /admin/dogfood?since=&until=` in OmniMind (new `services/dogfood.service.ts`, read-only SQL, no new tables). It computes the following, overall and **per tenant**:<br>(a) per-client active days;<br>(b) cross-client recall, the share of `memory_search`/`search`/`fetch` result ids written by a different agentId (result ids are kept by `omnimind-mcp/src/lib/audit.ts:20-40`);<br>(c) first-call compliance, using the 30-min grouping in `jobs/session-summarizer.ts`;<br>(d) `memory_write` p95 and error rate (reuse `/mcp/audit/stats`, `mcp.routes.ts:401-425`);<br>(e) decision sessions and outcome reviews per week, and $/session from LlmUsage;<br>plus superseded-returned-as-current and the onboarding-connect rate.<br>Implement `scripts/cost-report.ts` (today `// TODO: Implement`) and `scripts/dogfood-report.ts`, calling OmniMind with the admin key until M3-A3 adds the BoardRoom path. Write `docs/STATUS/DOGFOOD-SCORECARD.md` with these thresholds: ≥3 clients each active ≥15/30 days; ≥20% cross-client hits; ≥60% first-call compliance; write p95 < 10 s, errors < 2%, zero lost writes; ≥3 sessions and ≥1 review per week. | `packages/omnimind-api/src/routes/admin.routes.ts`, `packages/omnimind-api/src/services/dogfood.service.ts`, `scripts/cost-report.ts`, `scripts/dogfood-report.ts`, `docs/STATUS/DOGFOOD-SCORECARD.md` | Fixture unit tests cover every metric, including a session-grouping edge case and two agentIds in two tenants. The admin-key tests are as in the exit criteria. Both scripts print every metric against the `pnpm e2e:live` stack. A grep for McpAuditLog prune or `deleteMany` stays empty, which confirms the retroactive scorecard is sound. | M | M1-B1 | PRD-04, PRD-10, PRD-14 |
| M2-A2 | `scripts/verify-oauth.sh` runs the three checks in runbook §9.5: the PRM shows `resource` and the issuer; `initialize` with a supplied JWT → 200; a wrong audience → 401. Test it against the in-process RS256 issuer already used by the omnimind-mcp tests. | `scripts/verify-oauth.sh`, `scripts/tests`, `docs/runbooks/omnimind-mcp.md` | The script test shows each check passing and failing as expected. The runbook references the script. | S | M0-D1 | PRD-03, ENG-08 |

### M2 · Lane B — The moat in every client, self-serve scopes

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M2-B1 | Extend the `status_get` snapshot (`status.tool.ts:36-75`) with `pendingOutcomeReviews` (count + top 3), `openContradictions` (top 3) and `latestMemo` (id + one line). These read from the existing OmniMind routes and are filtered to the token's tenant per ADR-017. `decision_log` accepts an optional `forecast {probability, reviewAt}`, which flows into `POST /decisions`. No new tools; the count stays 20. **This lands before day 1, and MCP tool semantics freeze afterwards.** | `packages/omnimind-mcp/src/tools/{status,decision}.tool.ts`, `packages/shared/src/validation/mcp.schema.ts`, `packages/shared/src/types/decision.types.ts`, `docs/MEMORY-PROTOCOL.md`, `tests/e2e` | The snapshot passes the Zod output schema. e2e: a forecast decision appears in pending reviews after `reviewAt`, and it does not appear for a token in another tenant. Local `status_get` p95 < 1.5 s. `smoke` reports 20. | M | M1-B1 | PRD-09 |
| M2-B2 | Connected sign-ins. OmniMind adds user-scoped `GET/PATCH/DELETE /mcp/identities/mine`, keyed by the caller and capped at the grantable set (`mcp:delegate` refused). The admin routes are unchanged. BoardRoom adds proxy routes in `mcp-tokens.routes.ts` and a "Connected sign-ins" list in `ConnectedToolsPanel.tsx`. Auto-link stays `memory:read` (runbook §9.4). | `packages/omnimind-api/src/routes/mcp.routes.ts`, `packages/boardroom-ai/server/src/routes/mcp-tokens.routes.ts`, `packages/boardroom-ai/server/src/services/omnimind-client.ts`, `client/src/components/settings/ConnectedToolsPanel.tsx`, `packages/shared/src/{validation/mcp-token.schema.ts,types/mcp-token.types.ts}` | api: a cross-user request → 404, and `mcp:delegate` → 400. server: the route requires a JWT. client: toggling `memory:write` calls PATCH and renders the new scope. CI e2e E2E-7 stays green. | M | — | PRD-03 |

### M2 · Lane C — One cache, first-run connect

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M2-C1 | One entity cache. Route the `viz.store.ts` selectors through `entities.store.ts`, with in-flight dedupe and a 60 s TTL. `OutcomeReviewBanner.tsx:15` and `useNotificationAggregator.ts:71` read the shared slice; today `/outcome-reviews/pending` is fetched 3×, `/decisions` 2× and `/commitments` 2×. The `CommitmentNudgesWidget` "Mark done" patches the shared slice. Zod-parse paginated responses in `lib/api.ts` with `@boardroom/shared` schemas, defaulting to empty lists. Wrap dashboard widgets in a local `ErrorBoundary`. | `client/src/stores/{entities,viz,cortex}.store.ts`, `client/src/components/dashboard/{OutcomeReviewBanner,CommitmentNudgesWidget}.tsx`, `client/src/hooks/useNotificationAggregator.ts`, `client/src/lib/api.ts`, `client/src/components/shared/ErrorBoundary.tsx`, `tests/e2e/live/checks/request-budget.mjs` | `checks/request-budget.mjs` asserts ≤12 dashboard-load requests with no duplicate path (21 per CHANGELOG 2026-10-20). Store test: Mark done lowers the useCognitiveLoad overdue count without a refetch. A malformed `{items: undefined}` response renders the empty state. | M | M1-C4 | UI-15, ENG-20, ENG-19 |
| M2-C2 | An optional final onboarding step, "Connect your AI", after Context and before `complete()` (`OnboardingPage.tsx:132-134`). It mints a token inline (`memory:read` + `memory:write`, named after the client) and shows the snippet from `mcp-snippets.ts`. It then polls a new BoardRoom `GET /mcp-tokens/:id/activity`, which **resolves the token id to the caller's own token** before proxying OmniMind `GET /mcp/audit` filtered to that principal, and shows "Connected — first call received". Minting stays subscription-gated (`mcp-tokens.routes.ts:77`). From M2, Lane C owns the journey core, so the onboarding step goes in `journey.mjs` itself. | `client/src/pages/OnboardingPage.tsx`, `client/src/components/onboarding`, `client/src/components/settings/mcp-snippets.ts`, `server/src/routes/mcp-tokens.routes.ts`, `server/src/services/omnimind-client.ts`, `tests/e2e/live/journey.mjs` | server: another user's token id → 404, and the owner gets the latest call. client: the snippet shows, then "first call received" once the mocked endpoint returns a call; Skip completes onboarding. The journey mints a token during onboarding and makes one MCP call. | M | M1-D3, M2-B2 | PRD-07 |

### M2 · Lane D — WebKit, iOS layout, persona palette

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M2-D1 | Add a `--browser webkit` option and iPhone 15 (393×852) and iPad (820×1180) viewports to `tools/visual-preview/shoot.mjs`; lines 100-104 launch Chromium only today. The journey's `--browser` flag already exists from M1-A3. Add a CI `webkit-visual` job (the declared ci.yml exception) that runs `playwright install --with-deps webkit` and uploads screenshots. WebKit runs in CI because this sandbox has only Chromium. WebKit on Linux is not Safari. | `tools/visual-preview/shoot.mjs`, `.github/workflows/ci.yml` | The CI job is green, with artifacts for login, dashboard, decision-session-streaming, settings-token-created, memory and graph. Every shot asserts no horizontal scroll. | M | M1-A3 | UI-18 |
| M2-D2 | iOS layout fixes:<br>• `components/shared/Layout.tsx:36` changes from `h-screen` to `100dvh`, or to document scroll with a sticky header.<br>• Add `viewport-fit=cover` to `index.html:5`.<br>• Inputs are 16px below 640px (`Input.tsx:23` is 14px).<br>• Add a `::-webkit-details-marker` rule.<br>• The AppHeader title appears only after the H1 scrolls away, with one truncated back crumb on phones (`AppHeader.tsx:106-120`).<br>Add guard rules, a `checks/header-height.mjs` check, and `docs/03-operations/DEVICE-PASS-CHECKLIST.md`. | `client/index.html`, `client/src/components/shared/{Layout,AppHeader}.tsx`, `client/src/components/ui/Input.tsx`, `client/tests/ui-standards.test.ts`, `tests/e2e/live/checks/header-height.mjs`, `docs/03-operations/DEVICE-PASS-CHECKLIST.md` | The guard rules pass. WebKit 393 shots show no wrapped breadcrumb (the header-height check). Test: Input has `text-base` below `sm`. The checklist lists pages and states for iOS and macOS Safari. | M | M2-D1 | UI-18, UI-21 |
| M2-D3 | Re-derive the seven persona hues per theme. `tokens.css:105-111` and `289-295` are identical stock Tailwind 500s. Target ≥3:1 on the card surface in each theme, and keep optimist and critic distinguishable under protan and deutan simulation. Add a validation comment block. Give each CalibrationPanel series and each PersonaCard a text label or glyph. | `client/src/styles/tokens.css`, `client/src/components/decision/{PersonaCard,CalibrationPanel}.tsx`, `client/tests/ui-standards.test.ts` | Token test: ≥3:1 on `--color-card` in both themes, and the deutan ΔE between optimist and critic is above the threshold documented in the test. CalibrationPanel test: every series renders a label. | M | M1-D1, M1-F5, M1-C2 | UI-12 |

### M2 · Founder — OAuth, backfill, day 1, device pass #1

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M2-F1 | Configure the issuer: DCR + PKCE, audience, email claims, redirect URIs. Re-run go-live with `--oauth-issuer`. Set `MCP_OAUTH_ALLOWED_ISSUERS` on omnimind-api, then (last) `OMNIMIND_MCP_OAUTH_ISSUER` on boardroom-ai. Connect ChatGPT and claude.ai, and grant `memory:write` through Connected sign-ins. | `docs/02-reference/DECISIONS.md`, `docs/STATUS/CHANGELOG.md` | The verify-oauth output passes. ADR-016 is Accepted. ChatGPT and claude.ai each complete one `search`, with the audit agentId recorded. The scorecard notes whether ChatGPT is a read or a write client. | M | M1-F1, M1-F6, M2-A2, M2-B2 | ENG-08, PRD-03 |
| M2-F2 | Production backfill: confirm a backup < 26 h old, then run `scripts/backfill-mcp-entities.ts` as a dry-run, then with `--apply`. | `docs/STATUS/CHANGELOG.md` | Dry-run and apply counts are recorded per type and tenant. A re-run creates 0. | S | M1-B3, M1-F3 | PRD-02 |
| M2-F3 | Run `scripts/dogfood-report.ts` once against prod, and fix the thresholds if a metric turns out uncomputable. Sign DOGFOOD-SCORECARD.md. Record what the window must decide, then declare day 1. | `docs/STATUS/DOGFOOD-SCORECARD.md`, `docs/STATUS/DECISIONS-LOG.md`, `docs/STATUS/CHANGELOG.md` | The scorecard is signed and dated, there is a "Dogfood day 1" CHANGELOG entry, and the first report is stored. | S | M1-F1, M1-F4, M1-B2, M1-C2, M1-C4, M2-A1, M2-B1, M2-F2 | PRD-04, PRD-01 |
| M2-F4 | Device pass #1 on an iPhone (iOS Safari) and a Mac (Safari), against DEVICE-PASS-CHECKLIST.md on production. File defects as P0 or P1. | `docs/STATUS/CHANGELOG.md` | Notes with device and OS versions and screenshots. P0s are filed via task_upsert. | S | M2-D2 | UI-18 |

---

## M3 — Ops floor and daily loop, inside the window (W4–W6)

**Goal:**
- Detect failures before the founder does.
- Move BoardRoom to the private OmniMind URL and enforce agent identity, while keeping the public API domain until the verdict.
- Give the founder a BoardRoom-proxied admin path that survives the domain's later removal.
- Add the remaining regression nets and move to a supported Node.
- Give daily reasons to open BoardRoom.

MCP tool semantics stay frozen. Retrieval ranking changes are allowed, and each one is logged with its deploy date in the scorecard.

**Exit criteria**
- [ ] `GET /admin/outbox-depth` has tests: the admin key is required, and resolved rows are excluded. OBSERVABILITY.md covers three services and uses `/ready`.
- [ ] A `createJobGuard` unit test proves the second contender skips (pg_try_advisory_lock). `numReplicas=1` is documented in DEPLOYMENT-RUNBOOK.md and FRAGILE-ZONES.md.
- [ ] BoardRoom has `GET /admin/dogfood` (requireAdmin, proxied to OmniMind) with tests. `scripts/dogfood-report.ts --via boardroom` and `cost-report.ts --via boardroom` work against the `pnpm e2e:live` stack. The runbook documents running `keygen`/`bench` from the Railway service shell.
- [ ] The CI e2e matrix leg with `OMNIMIND_REQUIRE_AGENT_KEY=true` is green. `verify-prod.sh` and `pre-deploy-check.sh` make no request to the omnimind-api public host.
- [ ] `tests/audit`, `tests/golden-scenarios`, `tests/integration` and `tests/e2e/flows` are each ported, rewritten or deleted. The orphan-test guard is green. CHANGELOG states the D9 verdict.
- [ ] All Dockerfiles use `node:22-alpine`, and CI uses Node 22 on `ubuntu-24.04`. docker×3 is green. `ConnectedToolsPanel.test.tsx` passes 50/50 in a loop.
- [ ] The CI retrieval-eval job reports the update slice above its 0.27 baseline, with no gated leg below its gate.
- [ ] The nightly `e2e-live-nightly` run is green three nights in a row for empty, one-item and heavy accounts.
- [ ] The `checks/capture.mjs` check proves ⌘K Capture is returned by MCP `memory_search`. The Today view renders within the ≤12-request budget.
- [ ] The ui-standards emoji/glyph rule passes. `check-bundle-size.mjs` runs in CI and passes.
- [ ] *Founder-recorded:*
  - OTel traces, plus the five alerts, the backup dead-man and three `/ready` uptime checks, configured, and a test fire of alert #1 received;
  - BoardRoom switched to the private URL, then a 7-day gateway-only soak, then `OMNIMIND_REQUIRE_AGENT_KEY=true`, each step followed by a green post-deploy-verify;
  - ≥3 weekly scorecard rows;
  - device pass #2 with zero P0.

### M3 · Lane A — Ops hardening, private-API readiness, test debt

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M3-A1 | `GET /admin/outbox-depth` over EmbeddingOutbox (`schema.prisma:927`), as the source for OBSERVABILITY.md alert #4. Update OBSERVABILITY.md to cover omnimind-mcp and use `/ready`. Add `scripts/llm-spend-check.ts` for alert #5 against `/usage/llm/summary?days=1`. | `packages/omnimind-api/src/routes/admin.routes.ts`, `docs/03-operations/OBSERVABILITY.md`, `scripts/llm-spend-check.ts` | api tests as in the exit criteria. The doc lists three services and `/ready`. | S | M0-A2 | ENG-06 |
| M3-A2 | Wrap `createJobGuard` (`jobs/job-guard.ts:15-40`) in `pg_try_advisory_lock`. Document numReplicas=1 as a hard constraint, because MCP sessions live in an in-process Map (`transports/http.ts:292`). | `packages/omnimind-api/src/jobs/job-guard.ts`, `docs/03-operations/DEPLOYMENT-RUNBOOK.md`, `docs/02-reference/FRAGILE-ZONES.md` | A contention unit test passes, and the existing job tests stay green. | S | — | ENG-16 |
| M3-A3 | Prepare for a private-only OmniMind **without breaking founder tooling**:<br>(1) `verify-prod.sh` and `pre-deploy-check.sh` probe through boardroom-ai `/ready` and MCP, not the public API host.<br>(2) Add `GET /admin/dogfood` to BoardRoom's existing `adminRouter` (`app.ts:158`, behind `requireAdmin`/`ADMIN_EMAILS`), proxying OmniMind over `OMNIMIND_API_URL`. `/usage` is already proxied (`app.ts:159`).<br>(3) Give `scripts/dogfood-report.ts` and `cost-report.ts` a `--via boardroom` mode that logs in with founder credentials from env and calls BoardRoom.<br>(4) Document in `docs/runbooks/omnimind-mcp.md` that `keygen`, `bench` and admin `/mcp/identities` operations run from the Railway service shell inside the project (as `PRIVATE-NETWORKING.md:22` already does with `railway shell`), or use M2-B2's self-serve scopes.<br>(5) Add a CI e2e leg with `OMNIMIND_REQUIRE_AGENT_KEY=true`.<br>(6) Update the public-URL references in `docs/agent-configs` and `scripts/step-b-finish.sh` to say they are pre-removal only. | `scripts/verify-prod.sh`, `scripts/pre-deploy-check.sh`, `scripts/dogfood-report.ts`, `scripts/cost-report.ts`, `packages/boardroom-ai/server/src/routes/admin.routes.ts`, `packages/boardroom-ai/server/src/services/omnimind-client.ts`, `.github/workflows/ci.yml`, `docs/runbooks/omnimind-mcp.md`, `docs/agent-configs` | The flag-on e2e leg is green. A boardroom server test: `GET /admin/dogfood` → 403 for a non-admin, and proxies for an admin. Both scripts run with `--via boardroom` against the e2e:live stack. `scripts/tests/verify-prod.test.sh` stays green and asserts no request to the omnimind-api host. | M | M1-A1, M1-A3, M2-A1 | ENG-09 |
| M3-A4 | Triage the rotted root suites. D9 (`tests/audit/D9-cross-tenant-isolation.test.ts:173`) expects a literal `tenant_id = 'josh-personal'`, while `fulltext-search.ts` binds the tenant as a parameter. Replace it with a real-Postgres two-tenant assertion in the e2e harness. Port D8 to `packages/omnimind-api/tests`. Update D3 to 20 tools. Delete or rewrite `tests/e2e/flows`, `tests/golden-scenarios` and `tests/integration`. Add `scripts/check-orphan-tests.mjs` to CI. | `tests/audit`, `tests/golden-scenarios`, `tests/integration`, `tests/e2e/flows`, `tests/e2e/harness`, `packages/omnimind-api/tests`, `vitest.e2e.config.ts`, `scripts/check-orphan-tests.mjs`, `.github/workflows/ci.yml` | The real-DB isolation test passes in CI e2e. The orphan guard fails on today's tree and passes after the triage. CHANGELOG states D9 is drift. | M | M1-A3, M3-A3 | ENG-12 |
| M3-A5 | Node 22 in its own PR: `node:22-alpine` in the 3 Dockerfiles, node-version 22 and `runs-on: ubuntu-24.04` in ci.yml, and the actions flagged in run 39860431324 bumped. Keep Prisma CLI 6.19.3. De-flake `ConnectedToolsPanel.test.tsx:255` with `await waitFor(...)`. | `packages/{boardroom-ai,omnimind-api,omnimind-mcp}/Dockerfile`, `.github/workflows/ci.yml`, `client/tests/components/settings/ConnectedToolsPanel.test.tsx` | docker×3 green. `pnpm typecheck` 5/5. Test baselines met. A 50× loop of the panel test passes (command and output in the PR). The founder attests a green post-deploy-verify. | M | M0-A1, M1-A1, M3-A4 | ENG-13, ENG-22 |
| M3-A6 | Wire M3-D2's bundle budget into CI: one `pnpm --filter @boardroom/boardroom-ai build && node scripts/check-bundle-size.mjs` step in the verify job. Lane A serializes ci.yml edits. | `.github/workflows/ci.yml` | The CI step runs on the PR and passes. A deliberately inflated import fails it (red run linked in the PR). | S | M3-D2, M3-A5 | UI-16 |

### M3 · Lane B — Fresher facts and capture

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M3-B1 | Supersede-aware ranking in `retrieval/ranker.ts`: prefer the newest valid row in a supersede chain, before any RRF work. Add `.github/workflows/eval-nightly.yml` with real OpenAI embeddings (ADR-011, ministry excluded; needs a founder-added `OPENAI_API_KEY` secret). Ratchet `thresholds.json` only after three green main runs. | `packages/omnimind-api/src/retrieval/ranker.ts`, `eval/retrieval/thresholds.json`, `.github/workflows/eval-nightly.yml`, `docs/runbooks/retrieval-eval.md` | Ranker test: a superseded row ranks below its successor. CI mock eval: update-slice recall@10 > 0.27, and for-persona recall@10 ≥ 0.50 (the gate). The nightly artifact exists once the secret is set. The superseded-as-current metric does not rise. | M | M0-A1 | PRD-14, ENG-14 |
| M3-B2 | ⌘K "Capture" action through BoardRoom → OmniMind `POST /memories` (the validation pipeline), with optional typing → `POST /decisions` or `/commitments`. No ministry option while `MINISTRY_DEFERRED` is active. Today `api.createMemory` is only called from `useOnboarding.ts:361,374`. | `client/src/components/ui/CommandPalette.tsx`, `client/src/stores/commandPalette.store.ts`, `client/src/lib/api.ts`, `server/src/services/omnimind-client.ts`, `tests/e2e/live/checks/capture.mjs` | Client tests per type, with a toast and undo. Server test: the request proxies to the correct OmniMind route. `checks/capture.mjs` proves `memory_search` returns the capture. | M | M1-B1 | PRD-08 |

### M3 · Lane C — Today and a nightly real stack

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M3-C1 | A single "Today" section (recent decisions, open tasks and blockers, commitments due soon, pending outcome reviews) read from the shared cache with no new fan-out. It sits at the top on phones. | `client/src/pages/DashboardPage.tsx`, `client/src/components/dashboard` | The request-budget check still holds at ≤12. The WebKit 393 shot shows Today above the fold. | M | M2-C1 | PRD-16, PRD-08 |
| M3-C2 | `.github/workflows/e2e-live-nightly.yml`: boots `docker-compose.yml` and runs the journey for empty, one-item and heavy accounts in Chromium and WebKit, uploading screenshots. Add an env-gated register-limiter allowance in `auth-rate-limiter.ts` that startup **refuses under `NODE_ENV=production`**. MemoryCard titles truncate at word boundaries, and the preview hides when it duplicates the title. AreaChart skips axes and grid for empty series and uses integer count ticks (`AreaChart.tsx:102-103,162`). | `.github/workflows/e2e-live-nightly.yml`, `tests/e2e/live/journey.mjs`, `server/src/middleware/auth-rate-limiter.ts`, `docker-compose.yml`, `tools/visual-preview/fixtures`, `client/src/components/memory/MemoryCard.tsx`, `client/src/components/viz/AreaChart.tsx` | 3 consecutive green nights. Unit test: production plus the flag throws at startup. The truncate and AreaChart tests pass. | M | M1-A3, M2-D1 | UI-19, UI-28, ENG-11 |

### M3 · Lane D — Icons, cold start, copy

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M3-D1 | Replace ~32 emoji and glyph icons with lucide at stroke 1.75 (rotating ChevronRight disclosures, AlertTriangle, Info and so on). Dismiss and close controls become `Button size="icon"` with lucide `X` (`AINudge.tsx:24-27,69-74`). Add a regex guard for those code points in JSX text, and a guard against `hover:text-X` equal to `text-X`. | `client/src/components/decision/{PersonaCard,SynthesisPanel}.tsx`, `client/src/components/dashboard/ProactiveQuestions.tsx`, `client/src/components/shared/AINudge.tsx`, `client/src/pages/LoginPage.tsx`, `client/tests/ui-standards.test.ts` | Both guard rules pass with 0 hits. The AINudge dismiss hit area is ≥32px. | M | M2-D3 | UI-11, UI-29 |
| M3-D2 | Cold start. Add `react-dom/client`, `motion`, `@base-ui/react` and `lucide-react` to `manualChunks` (`vite.config.ts:22-25`). Import shared constants via a subpath so Zod stays out of the entry. Run the auth and profile requests in parallel. Render a shell skeleton instead of the three "Loading..." texts (`App.tsx:31-35,80-85,96-100`). Prefetch route chunks on hover and focus. Add `scripts/check-bundle-size.mjs`, measuring **total initial JS** (entry plus static imports); Lane A wires it into CI in M3-A6. | `client/vite.config.ts`, `client/src/App.tsx`, `client/src/components/shared/Layout.tsx`, `packages/shared/package.json`, `scripts/check-bundle-size.mjs` | A fresh `pnpm --filter @boardroom/boardroom-ai build` records the before and after initial-JS gzip in the PR (the 2026-10-20 dist index was 246,489 B gzip). The budget is set ≥15% below the before figure, and `node scripts/check-bundle-size.mjs` passes locally. Test: the profile request starts before auth resolves. `grep -c "Loading..." client/src/App.tsx` = 0. | M | M2-D2 | UI-16 |
| M3-D3 | Copy voice: replace the three unattributed testimonials (`LoginPage.tsx:11-13`) with value props; remove the unlinked Terms/Privacy claim; use sentence case; remove jargon ("All systems nominal", "Dispatching personas..."); one CTA in empty states; hide the calibration card until the first commit. Add a voice guide to UI-FOUNDATION.md. | `client/src/pages/{LoginPage,DashboardPage,DecisionSessionPage,DecisionLabPage}.tsx`, `docs/02-reference/UI-FOUNDATION.md` | `grep -rn "Series B Startup\|All systems nominal" client/src` = 0. Test: DecisionLabPage with 0 sessions shows exactly one primary CTA and no calibration card. | S | M3-C1 | UI-25 |

### M3 · Founder — ops configuration and cadence

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M3-F1 | Grafana Cloud: set `OTEL_EXPORTER_OTLP_*` on all three services, and configure the five alerts, the backup dead-man and three `/ready` uptime checks, routed to phone and email. | `docs/STATUS/CHANGELOG.md` | A trace screenshot and the alert list are recorded. A test fire of alert #1 is received. | M | M0-A2, M3-A1, M1-F1 | ENG-06 |
| M3-F2 | Do these in order, with a post-deploy-verify run after each: (1) confirm the `::` bind in the omnimind-api deploy log; (2) switch boardroom-ai `OMNIMIND_API_URL` to the private URL; (3) after 7 days of `/mcp/audit` showing only gateway-delegated agentIds, set `OMNIMIND_REQUIRE_AGENT_KEY=true` (runbook step 9). **Keep the omnimind-api public domain until M4-F2**, because founder tooling uses it during the window. This item is not gated on OAuth. | `docs/STATUS/CHANGELOG.md`, `docs/03-operations/PRIVATE-NETWORKING.md` | Two green verify runs, one per env change. The founder confirms the dashboard and MCP `status_get` still work. A request with a spoofed `x-agent-id` and no agent key is refused. | M | M1-F1, M1-A1, M3-A3 | ENG-09 |
| M3-F3 | Weekly scorecard, W4–W7: run `dogfood-report.ts` and `cost-report.ts` (`--via boardroom` once M3-A3 lands), write a 3-question self-log via `memory_write`, and file the top friction via `task_upsert`. | `docs/STATUS/DOGFOOD-SCORECARD.md` | 4 dated rows by the end of W7. | S | M2-F3 | PRD-04 |
| M3-F4 | Device pass #2 after the M3 lanes deploy. | `docs/STATUS/CHANGELOG.md` | Zero P0, and P1s filed. | S | M2-F4, M3-D1, M3-D2 | UI-18 |

---

## M4 — Verdict and pre-signup gate (W7–W8)

**Goal:** Turn the 30-day window (2026-11-12 → 2026-12-11) into a written decision. Guard unit economics and data ownership before any non-founder user. Lock in the polish guard rails. Retire the public OmniMind domain once nothing depends on it.

**Exit criteria**
- [ ] *Founder-recorded:* the DECISIONS-LOG.md verdict entry lists each scorecard metric against its threshold, the BoardRoom-first vs memory-first call, the packaging input, and the phases to unpark.
- [ ] omnimind-api tests at 79%, 80% and 100% of the per-user monthly budget: a warning at 80%, and a 402 `{error:'budget'}` at 100% on non-admin LLM routes. A client test renders the budget message. COST-MODEL.md shows $29 and Sonnet 5.5 pricing, with the cost-report numbers.
- [ ] `GET /export` has a two-user isolation test. Exported entity JSON carries `tenantId` and parses with the shared Zod schemas. Settings has an export button (client test).
- [ ] The dashboard hierarchy test confirms insights render below CockpitRow, and proactive questions render as one grouped list.
- [ ] `grep -rn "migrates with the forms pass" client/src` = 0. The ui-standards rules for raw palette classes, `#hex` in tsx, `text-[<11px]` and uppercase outside the allow-list all pass.
- [ ] *Founder-recorded:* the omnimind-api public domain is removed after M4-F1, a post-deploy-verify run is green, and `scripts/dogfood-report.ts --via boardroom` re-runs successfully afterwards.

### M4 · Lanes

| id | item | files | acceptance | effort | depends on | resolves |
|---|---|---|---|---|---|---|
| M4-A1 | Per-user monthly LLM dollar budget. OmniMind owns LlmUsage: it warns at 80% via `/usage/llm/summary` and returns 402 `{error:'budget'}` at 100% on non-admin LLM routes. BoardRoom renders it like the existing 402 (`session.store.ts:87-88`). Update `COST-MODEL.md` to $29 (`stripe.service.ts:63-64`) and to the Sonnet 5.5 prices in `shared/src/constants/model-config.ts`. | `packages/omnimind-api/src/routes/usage.routes.ts`, `packages/omnimind-api/src/services`, `client/src/stores/session.store.ts`, `docs/roadmap/01-foundations/COST-MODEL.md` | As in the exit criteria. | M | M2-A1 | PRD-10 |
| M4-B1 | Whole-account export, replacing most of Phase 11. OmniMind `GET /export` streams a zip of memories (with validity and provenance), decisions, commitments, tasks, people, goals and projects as JSON (with `tenantId`), plus one Markdown file per entity. BoardRoom proxies it, with a button in Settings. Ministry rows are exported only for their owner, and only while that domain is enabled. | `packages/omnimind-api/src/routes`, `packages/omnimind-api/src/services`, `packages/boardroom-ai/server/src/routes`, `client/src/pages/SettingsPage.tsx` | As in the exit criteria. | M | M1-B4 | PRD-15 |
| M4-C1 | Dashboard hierarchy remainder: move AINudges below CockpitRow (`DashboardPage.tsx:121-141`), group the proactive questions, and remove the decorative stripes. | `client/src/pages/DashboardPage.tsx`, `client/src/components/dashboard/{ProactiveQuestions,StatTile}.tsx`, `client/src/components/shared/AINudge.tsx`, `tools/visual-preview/shoot-dashboard.mjs` | Test as in the exit criteria. At 390×844, the first StatTile number's top is <500 px. | M | M3-C1 | UI-05, UI-24 |
| M4-D1 | Forms pass: replace the 9 allow-listed native selects (`McpTokenCreateForm.tsx:202,220,228`; `EntityForm.tsx:79,94,129`; `AdminPage.tsx:142,409`; `DecisionLabPage.tsx:144`) with `ui/Select size=sm`. Add a Base UI RadioGroup and delete the allow-comments. | `client/src/components/settings/McpTokenCreateForm.tsx`, `client/src/components/ui/Select.tsx`, `client/src/pages/{AdminPage,DecisionLabPage}.tsx` | The grep is 0. WebKit settings shots show no OS-styled select. | M | M2-D2 | UI-20 |
| M4-D2 | Token and type guard rails. Wire `--text-*` (`tokens.css:156-158`) into the `tailwind.config.ts` fontSize. Set an 11px floor. Use sentence-case labels. Map the 29 raw palette classes and 7 hex literals to semantic tokens. | `client/tailwind.config.ts`, `client/src/styles/tokens.css`, `client/src/components/ui/Avatar.tsx`, `client/tests/ui-standards.test.ts` | The rules pass. Before and after shots are attached. | M | M1-D1 | UI-13, UI-14 |
| M4-F1 | The founder writes the dogfood verdict from the scorecard rows. | `docs/STATUS/DECISIONS-LOG.md` | A dated entry with each metric against its threshold. | S | M3-F3 | PRD-04, PRD-11 |
| M4-F2 | Remove the omnimind-api public domain (or restrict it to `/health`) after the verdict. Then run post-deploy-verify, and re-run `scripts/dogfood-report.ts --via boardroom` and `cost-report.ts --via boardroom`. | `docs/STATUS/CHANGELOG.md`, `docs/03-operations/PRIVATE-NETWORKING.md` | The public API host returns 404 or no longer resolves. The verify run is green. Both reports print through BoardRoom. | S | M4-F1, M3-F2, M3-A3 | ENG-09 |

---

## Decision ledger

| Question | Launch-first | Experience-first | Resolution | Why |
|---|---|---|---|---|
| What gates go-live and the dogfood: ops or UX? | Containment, verification and ops first; UX trust fixes in W4–W6, inside the window | UX leads with 3 of 4 lanes; ops is 1 lane plus the founder | **Both, in parallel, each with hard gates.** Containment gates go-live. The UX trust fixes (M1-C1/C2/C4) gate dogfood day 1. | Leaked secrets make any exposure unsafe. Raw JSON, endless "Thinking...", the fake "Set Deadline" and lost dismissals would contaminate BoardRoom metric (e). |
| Should `/health` return 503, or should there be a separate `/ready`? | `/health` stays 200 with `version`; add `/ready` | `/health` returns 503 on dependency failure | **`/health` 200 + `version`; `/ready` 503** (M0-A2) | All three `railway.toml` set `healthcheckPath="/health"`. A 503 there couples deploys to OmniMind migrations and blips. |
| How are deploys verified? | Automatic `workflow_run` with a SHA poll | Manual `workflow_dispatch` by the founder | **Automatic** (M1-A1). Secret-dependent probes report `skipped`, and the read-burst probe is dropped. | Runners can reach `*.up.railway.app`, and Railway deploys every merge. |
| When does PRD-02 (MCP tools → entity tables) start? | W1 day 1 | W3–W4 | **W1 day 1 in Lane B**, as tenancy decision → tenant column → re-point (M1-B0 → M1-B4 → M1-B1) | It gates day 1, and the backfill grows every week of delay. |
| How do re-pointed MCP entity tools keep one-tenant-per-token? | Not addressed | Not addressed | **ADR-017: add `tenantId` to the six entity models. Agent callers are filtered and stamped. BoardRoom (no agent context) sees all of the user's rows. Non-agent rows take a founder-picked default** (M1-B0, M1-F7, M1-B4). E2E-9 uses the same user in two tenants. | Entity tables are user-scoped only (`schema.prisma:284-286` and siblings, versus MemoryEntry `:224`). Without this, a `josh-personal` token reads `josh-business` decisions, which breaks the Three Tenants rule. Linked-memory filtering would hide BoardRoom-created entities. |
| Is the dogfood verdict inside the plan? | Yes (W7–W8) | No | **Yes.** Day 1 is 2026-11-12, the window ends 2026-12-11, and the verdict (M4-F1) lands in W8. | A window that ends after the roadmap never gets judged. |
| When is the brand-gold contrast fixed? | After the verdict | M1, with the founder choosing between two variants | **M1** (M1-D1 + M1-F5) | It is an AA failure (3.21:1), and it changes every later visual. |
| When do Safari/WebKit and real devices come in? | M5 | WebKit CI in M2 plus two device passes | **WebKit CI and iOS fixes in M2; device pass #1 in W4 and #2 in M3** | The founder dogfoods on a Mac and an iPhone, and every screenshot so far is Chromium. |
| Which number does the OAuth ADR get? | ADR-015 | Unnumbered | **ADR-016** (and entity tenancy is ADR-017) | `DECISIONS.md:81` already has ADR-015 (Apple-grade UI foundation). |
| Does OAuth block dogfood day 1? | No; pro-rate | Implicitly yes | **No; pro-rate** | The issuer is the founder item most likely to slip. |
| Where do persisted dismissals live? | Profile route; check the schema first | New column in W1–W2 | **A new `dismissedSuggestions` Json column**, gated on the pg_dump, the drift check, and M1-B4 (so the schema change is serialized) | There is no generic preferences column. OmniMind owns state. Two migrations in one milestone must not race. |
| What does a per-persona retry do with the debate round? | Unspecified | It re-runs | **It never re-runs `runDebateRound`.** Acceptance requires zero `rebuttal_start` events. | `orchestrator.ts:254-292` accumulates responses and always runs the debate, so a re-run means duplicate Sonnet spend. |
| Which streaming fields are shown first? | headline → reasoning | `situationReading` → `analysis` | **`situationReading` → `analysis`** | The contract (`optimist.system.md:44-55`) has no headline field. |
| What does the bundle budget measure? | Not scheduled | Index chunk ≤180 KB | **Total initial JS, ≥15% below a fresh baseline.** Lane A wires the CI step (M3-A6). | An index-only budget passes when bytes just move to other eager chunks. ci.yml is owned by Lane A. |
| Is private networking gated on OAuth? | Yes | No, but with no prep or soak | **No OAuth gate. Repo prep, a 7-day soak, and a verify run per step.** | ENG-09 is unrelated to the issuer. |
| When is the public OmniMind domain removed? | M3, inside the window | M3, inside the window | **After the verdict (M4-F2).** M3-A3 first adds a BoardRoom admin proxy and documents service-shell access. | Founder scripts, keygen, bench and admin calls use `OMNIMIND_API_URL` during the window, and GitHub runners cannot reach Railway private networking. |
| Is the scorecard signed before it has run on prod? | Before day 1 | Before the code existed | **Run once on prod, then sign** | An uncomputable metric found after day 1 would invalidate the window. |
| Does the retrieval update slice gate a milestone? | Hard ≥0.40 | Parked behind a trigger | **An M3 improvement target (>0.27, no gated regression), and the scorecard measures superseded-as-current** | The mock leg's semantic layer is noise, but "stays current" is the core promise. |
| Should the spend cap and self-serve tenants land before signups? | Both in M5 | Both deferred | **The cap and export land in M4. Tenants plus email verification are in Not doing.** | Tenants without verification open an auto-link hole, and there is no email channel this phase. |
| Is there still an SDK bump to do? | Open a PR from the branch | Same | **No. It is already merged as `fc19563`, and run 39864122262 is green.** M0-A1 is only the overrides, cancel-in-progress and the scheduled audit. | `gh run view 39864122262` shows all 5 jobs `success`. |
| When does an agent item count as done for dependsOn? | Not addressed | Not addressed | **`merged` (PR merged, CI green on the merge SHA) satisfies an agent dependency. `done` additionally needs a green post-deploy-verify for items with production acceptance. Founder items need `done` with evidence.** | Without an agent "done" transition, the lane protocol deadlocks on every agent-to-agent dependency. |

---

## Risks

| Risk | Mitigation |
|---|---|
| Founder bandwidth is the critical path. | Founder work is batched into four sessions with copy-paste acceptance lines. Lanes A–D stay busy on code that needs no credential. |
| Secret rotation breaks prod (OMNIMIND_API_KEY mismatch, JWT logout, orphaned Google tokens). | pg_dump first. Rotate OMNIMIND_API_KEY in one window. Hand-verify (M0-F4), then automatic verification on every deploy from M1. |
| The entity-tenancy migration mis-assigns existing rows or hides BoardRoom decisions from MCP. | ADR-017 states the default, and the founder picks it (M1-F7). The migration runs after pg_dump and the drift check. Agent reads return 404 rather than leaking. E2E-9 tests one user across two tenants. The backfill stamps the source memory's tenant. BoardRoom's behaviour is unchanged. |
| Re-pointed MCP tools change behaviour as clients adopt them, and the backfill duplicates rows. | They land before day 1. Names, count (20) and input schemas stay compatible. A test requires exactly one Decision per idempotencyKey. The backfill is dry-run by default and keyed on source memory id. Semantics freeze after day 1. |
| The longer PRD-02 path (B0 → B4 → B1) slips past day 1. | B0 and B4 are S/M and start W1. If B1 is not deployed by 11-11, day 1 moves rather than the gate. Lane B's other items (B2, B3) do not block it. |
| UX fixes slip past day 1. | M1-C1/C2/C4 are day-1 gates. Deploy dates are logged in the scorecard. |
| Client partial-JSON parsing shows garbage. | It is preview only, and the card always swaps to the Zod-validated `persona_complete`. The parser is tested at every byte offset. |
| The migration-drift step damages the eval DB. | It uses a separate `omnimind_shadow` database. A row count before and after proves `omnimind_eval` is untouched. |
| Lanes collide on shared files. | The file-ownership rules plus explicit dependsOn. Journey assertions go in `checks/*.mjs`. The shared barrel is never edited. |
| Playwright WebKit on Linux is not Safari. | Two founder device passes, with zero P0 required on pass #2. |
| Enforcing the agent key or moving to private networking breaks founder tooling. | M3-A3 adds the BoardRoom admin proxy, `--via boardroom` scripts, the service-shell runbook and a flag-on CI leg. A 7-day soak precedes enforcement. Domain removal waits for M4-F2, after the verdict. |
| The sandbox cannot see production. | Every production acceptance item is a GitHub Actions run link or a founder-recorded entry. |
| The OAuth issuer slips. | Day 1 does not wait for it. Days are pro-rated, M2-B2 removes the admin curl, and the scorecard records ChatGPT read/write. |
| The Node 22 move or the overrides break the Docker builds. | Each ships as its own PR, with docker×3 required and Prisma CLI pinned at 6.19.3. |
| Audit rows get pruned. | No McpAuditLog prune exists today, and M2-F3 reconfirms this before signing. |

---

## Not doing (and why)

- **Self-serve tenant provisioning and BoardRoom email verification (PRD-05, impact 4).** These block the first non-founder user, not the founder's dogfood. Auto-link without verification opens an account-binding hole, and there is no email channel yet. *Trigger:* the first invited user; ship tenants, email verification and the email channel together.
- **Outbound email and password reset (the email half of PRD-08).** They need a provider choice. *Trigger:* before signups. Capture (M3-B2) and Today (M3-C1) are scheduled.
- **Pricing and packaging changes, a second Stripe tier, entitlement checks at introspection (PRD-11).** The dogfood exists to decide these. M4-F1 produces the input.
- **A server-emitted human-readable "thinking" stream.** It would change every prompt in `docs/prompts`. M1-C1 gets the same UX without that.
- **UI-22, UI-23, UI-26, UI-27 (impact ≤3).** *Trigger:* they show up as a P1 in a device pass, or as the top friction in the self-log.
- **ENG-15 (Postgres auth limiters) and multi-replica work beyond the advisory lock.** Single replica is the documented constraint (ADR-009, Known Limitation 7). *Trigger:* scale-out or abuse.
- **ENG-18 (subscription fail-open caching).** No paying non-founder users yet. Revisit with PRD-11.
- **ENG-24 (trailer rewrite).** Cosmetic, and main is never rewritten.
- **Scrubbing git history.** Rotation (M0-F2) is the fix. Visibility is the founder's decision.
- **PRD-17 (MCP 2026-07-28 dual-stack).** *Trigger:* a client fails to connect, a second MCP instance, or Q1 2027.
- **Phases 12, 13, 16/18/19 and 17.** Recorded with triggers in M0-D2.
- **A built-in OAuth authorization server, more than 20 MCP tools, multi-model routing, agent frameworks, re-enabling ministry.** Settled by Known Limitation 14, ADR-001, ADR-002 and the sovereignty rule. Ministry never falls back to OpenAI.
- **Leaderboard benchmarking, a graph renderer swap, more UI-foundation passes.** *Trigger:* a measured user-facing gap.

---

## How to run a lane

**Tracker states** (in `docs/STATUS/PHASE-PROGRESS-TRACKER.md`):

| State | Meaning |
|---|---|
| `todo` | Not started |
| `in-progress` | A lane session has claimed it |
| `in-review` | PR open |
| `merged` | PR merged to `main` and the CI run on the merge SHA is all-green |
| `done` | `merged`, plus, for items whose acceptance includes production behaviour, a green post-deploy-verify run on that SHA (or the named founder evidence) |

**Who flips what:**
- The session that opens the PR sets `in-review`.
- Whoever merges sets `merged`. If that didn't happen, the next lane session does it in step 3 by checking `gh pr view <n> --json state,mergeCommit` and `gh run list --commit <sha>`.
- The founder sets `done` for founder items, and for production-acceptance items once the verify run link is recorded.

**Dependency rule:** an agent dependency is satisfied at `merged` or `done`. A founder dependency is satisfied only at `done`, with its evidence present.

Prompt shape (fill in the brackets):

```
You are Lane <A|B|C|D> for Phase 8. Item: <ID> — <item title>.

1. Read docs/roadmap/PHASE-8-ROADMAP.md (this file): the item's row, its milestone's exit criteria,
   the Lanes file-ownership rules, and the Decision ledger rows that mention it. Do not re-litigate
   a ledger resolution.
2. Read .claude/CLAUDE.md "Critical Rules", docs/02-reference/FRAGILE-ZONES.md if the item touches
   Docker, middleware ordering, Prisma, env vars or health checks, and docs/contracts/ if it touches a
   service boundary.
3. Reconcile the tracker: for every row in `in-review`, check `gh pr view <n> --json state,mergeCommit`;
   if merged and `gh run list --commit <sha>` is all-success, set it to `merged`. Then check every
   dependsOn id of your item: agent items must be `merged` or `done`; founder items must be `done`
   with their CHANGELOG/BACKUP-DRILLS evidence. If any is unmet, stop and report the item as blocked.
   Set your item to `in-progress`.
4. Read only the files in the item's "files" column (plus their tests). Start with `status_get` and
   `memory_search "<item topic>"` on the OmniMind MCP if it is connected.
5. Implement. Rules that bind every change: OmniMind owns all persistent data and BoardRoom reaches it
   over HTTP only; Claude is the only LLM provider; no agent frameworks; prompts stay in docs/prompts;
   every memory write goes through the validation pipeline; ministry never falls back to OpenAI;
   change shared Zod schemas and their TS interfaces together; MCP agent callers are tenant-scoped
   (ADR-017); journey assertions go in tests/e2e/live/checks/ unless your lane owns journey.mjs.
6. Run, and paste output into the PR description:
   pnpm typecheck && pnpm test   (per-package totals ≥ shared 151 / mcp 255 / api 1,175 /
   server 284 / client 436, plus the item's new tests)
   pnpm test:e2e                 (if the item touches omnimind-api, omnimind-mcp or shared)
   pnpm e2e:live                 (if the item touches the client or a journey check)
   …and every command in the item's "acceptance" column.
7. Open ONE PR titled "<ID>: <item title>", body = acceptance checklist with evidence.
   Never claim production behaviour from sandbox output; production checks are founder items.
8. Set row <ID> → `in-review` with the PR link; add a dated docs/STATUS/CHANGELOG.md entry; update
   docs/STATUS/CURRENT-PHASE.md if a milestone exit criterion changed state. Record decisions with
   `decision_log` and follow-ups with `task_upsert`; end with `memory_write` summarising what changed
   and what is next.
```

**Founder items** have no agent lane. The founder runs the step, pastes the acceptance evidence into the named file, and sets the row to `done`. Agents treat a founder item as **not done** until that evidence exists.

---

## Validation

Two validators checked the previous revision:

- **Coverage:** every impact-≥4 finding is scheduled or in Not doing, every dependsOn id exists, lane ownership holds, and the protocol is executable.
- **Repo-truth:** every path, line, endpoint and count was checked against the tree and against command output.

Fixes in this revision, each re-verified against the repo on 2026-10-22:

1. **Blocking: tenant isolation (M1-B1, E2E-9, M2-B1, M2-A1).**
   - *Verified:* only `MemoryEntry` has `tenantId` (`schema.prisma:224`). Decision, Commitment, Person, Goal, Project and Task are `userId`-only. `decision.service.ts:203-204` filters memories by tenant. `delegated-user-isolation.ts` pins `userId` only.
   - *Fix:* added M1-B0 (ADR-017 decision), M1-F7 (founder picks the BoardRoom default tenant) and M1-B4 (migration plus tenant-scoped entity routes). M1-B1 now depends on M1-B4. E2E-9 uses the same user in two tenants. The backfill, status_get, the dogfood metrics and export are tenant-aware. ADR-017 was confirmed free: the last ADR is 015.
2. **Blocking: lane-protocol deadlock.** Added the `merged` state, who flips each state, and the rule that agent dependencies are satisfied at `merged`. Step 3 now reconciles `in-review` rows via `gh`.
3. **Major: M0-A3 shadow DB.**
   - *Verified:* `ci.yml:117` sets `DATABASE_URL` to `omnimind_eval`, the live eval DB.
   - *Fix:* the step creates `omnimind_shadow` with `vector`, `pg_trgm` and `btree_gin` (the extensions required by `schema.prisma:15`), and asserts the eval DB is untouched.
4. **Major: public domain removed during the window.**
   - *Verified:* BoardRoom already mounts `/admin` and `/usage` behind `requireAdmin`/`ADMIN_EMAILS` (`app.ts:158-159`), and `scripts/step-b-finish.sh` plus the `docs/agent-configs` files reference the public API host.
   - *Fix:* M3-A3 adds a BoardRoom `/admin/dogfood` proxy, `--via boardroom` script modes and a service-shell runbook. M3-F2 keeps the domain. A new M4-F2 removes it after the verdict and re-runs the report.
5. **Major: lane collisions.**
   - DashboardPage, PersonaCard and CognitiveLoadBanner edits are sequenced: M1-D2 depends on M1-C2 and M1-C4, M1-D4 on M1-C4, M3-D3 on M3-C1.
   - The bundle CI step moved to the new Lane A item M3-A6.
   - journey.mjs is owned by Lane A in M1 (with a checks autoloader and the `--browser` flag) and by Lane C from M2. Other lanes add `checks/*.mjs`.
   - M2-C2 depends on M2-B2.
   - Shared edits go to existing, already-exported files (`request-body.schema.ts`, `user-profile.schema.ts`, etc., confirmed present). The barrel is not edited.
   - M1-C4 depends on M1-B4, to serialize the schema.prisma changes.
6. **Major: stale status.**
   - *Verified:* `gh run view 39864122262 --json jobs` shows all five jobs `success` on `fc19563`.
   - *Fix:* the Status and TL;DR now say main is green. M0 exit criterion 1 is checked. M0-A1 is re-scoped to the overrides (`package.json:43` is still `>=10.3.1`), cancel-in-progress and the scheduled audit.
   - The `cdef1ef` red-deploy note is kept, and the `fc19563` deploy is still marked unverified.

Unchanged and still honest: production, Railway settings, branch protection, OAuth providers, real devices and Stripe cannot be verified from this sandbox. Every such acceptance item is a GitHub Actions run link or a founder-recorded entry.
