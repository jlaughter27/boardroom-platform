# Execution State — Live

> **Read this first.** Any new session resuming this work loads this file before anything else.
> **Updated by:** the master execution prompt at the end of every meaningful chunk of work.
> **Generated:** 2026-04-30 (initial bootstrap)

---

## Where we are

**Active workstream:** Documentation tree consolidation (Phase A → E), then product MASTER-DEV-PLAN (P0-1 through P5).

**Decided answers (locked):**

| Question | Decision | Source |
|---|---|---|
| MASTER-DEV-PLAN sibling repo | Port into this repo at `docs/02-reference/` | User, 2026-04-30 |
| Active branches | Close/rebase: claim agent best judgment | User, 2026-04-30 |
| STATUS + _meta promotion | Real promotion (top-level), not symlink/stub | User, 2026-04-30 |
| `_deprecated/` tier | YAGNI for now, skip | User, 2026-04-30 |
| LOAD-MAP.json curation | Yes, hand-maintain alongside auto-gen INDEX.json | User, 2026-04-30 |
| DECISION-1 (wave4 disposition) | 1A: archive + edit CHANGELOG.md:262 | Claude+debate validator, 2026-05-01 |
| DECISION-2 (sibling provenance) | 2B-with-SHA: port working-copy + SHA-256 in commit msg | Debate validator OVERTURN, 2026-05-01 |
| DECISION-3a (quizzical-hopper) | Verify Tailwind build → cherry-pick 6e06597 + defense-in-depth follow-up → delete branch (amended) | Phase D entry validator, 2026-05-01 |
| DECISION-3b (distracted-satoshi) | 3b-ii: defer post-Phase-D; PR author handles rebase | User, 2026-05-01 |
| DECISION-3a-amendment outcome | Pre-step 0a verified main IS broken; outcome (b) confirmed; cherry-pick + path-anchored follow-up commit; locked plan stands with rationale clarification | Validator + user, 2026-05-01 |

---

## Phase ledger

| Phase | Status | Exit criteria | Last update |
|---|---|---|---|
| A — Inventory | done | files.json, summary.md, orphans.md, hubs.md exist | 2026-04-30 |
| B — Target tree design | done | `PHASE-B-PROPOSAL-V2.md` ratified by 3 validators | 2026-04-30 |
| C — Migration map | done | `PHASE-C-MIGRATION-MAP.md` v1.2 PASS_WITH_NOTES from arch+risk round 3 | 2026-05-01 |
| D — Execute migration (move + stubs + code edits + CI) | active | PR opened with all 6 validators green | 2026-05-01 |
| E — Stub cleanup | pending | Phase E tripwire fires → cleanup PR merged | — |
| P0-1 — Unified Prisma migration | blocked-on-D | All 10 new + 7 extended models in one migration | — |
| P0-2 — Feature flag system | blocked-on-D | Orphan migration reconciled + new flag stack live | — |
| P0-3 — Cortex scheduler refactor | blocked-on-P0-1 | Pluggable registry + shadow-mode | — |
| P0-4 — Input layer (IL-1..4) | blocked-on-P0-2 | Quick Capture live in dogfood | — |
| P0-5 — Output layer (OL-1, OL-3) | blocked-on-P0-2 | Brief generator + export hub scaffolds | — |
| P0-6 — Eval harness expansion | blocked-on-P0-3 | 3 new scenario types covered | — |
| Phase 1-5 (product) | not-started | Per `docs/MASTER-DEV-PLAN.md` (after port) | — |

---

## Last checkpoint

`docs/_inventory/CHECKPOINT-phase-C.md` — 2026-05-01. Phase C exits with `PHASE-C-MIGRATION-MAP.md` v1.2 ratified by architecture + risk validators (round 3, both PASS_WITH_NOTES, both `stuck_state_signal: false`).

**Phase D entry status (2026-05-01, post-validator):** all pre-steps complete. Then a divergence audit revealed `docs/roadmap/` (151 files), REALITY-BASELINE, wave3-reviews are absent on origin/main. Strategic pivot to **Zeta plan** (split into 3 PRs): PR 1 ships roadmap+bug-fixes off origin/main; PR 2 = Phase D bucket migration on top; PR 3 = Phase 0/1 prep deferred.

- §10 pre-step 0a: COMPLETE. Verified main's Tailwind broken (CSS=4612 bytes / 0 utility classes vs feature/folder-migration's 39590 bytes / 162 classes). Outcome (b) confirmed.
- §10 pre-step 0b': COMPLETE. Cherry-picked 6e06597 (chore branch SHA 8bd228d) + defense-in-depth (e805f57). Will be DROPPED on rebase after PR 1 merges (superseded by `80534c2` brand polish + `dfe895a` prompt-loader/postcss work).
- §10 pre-step 0c: COMPLETE. `claude/quizzical-hopper` deleted from origin.
- §10 pre-step 0d: COMPLETE. `docs/_inventory/` committed to chore branch (`6dcdffc`).
- §11 cascade gate: SATISFIED (snapshot 11756f6 is empty, branch ref preserved, dangling worktree is inert).
- Local main has accidental cherry-pick (9184f25) from validator's `/tmp/main-tailwind-check` — not pushed; reset to origin/main after PR 1 merges.

**Zeta plan status (2026-05-01):**
- **PR 1** OPEN AS DRAFT: https://github.com/jlaughter27/boardroom-platform/pull/3 — branch `doc-reorg-foundations`, 10 commits cherry-picked from feature/folder-migration (1 Cat A `dc23b2a`/`049293c` roadmap pipeline + 9 Cat B production bug fixes). Title: `feat(docs): roadmap pipeline + production bug fixes (foundations)` — does NOT contain literal "Phase D" so §9.3 tripwire won't fire on this PR.
- **PR 2** PENDING — Phase D bucket migration. Resume after PR 1 merges. Will rebase chore branch onto new origin/main, drop redundant `8bd228d`/`e805f57` Tailwind commits, re-verify §7.2/§7.6 line numbers against post-merge `.claude/CLAUDE.md` and `README.md`, then continue §10 commits 4-12. PR 2 will contain literal "Phase D" and trigger §9.3 tripwire correctly.
- **PR 3** DEFERRED — 13 Cat C/D commits (Phase 0/1 prep, including `97df169` Phase 0.25 security fixes, `803b125` Phase 1 types, `c30df4b` validation-helpers TSC fixes). Open separately when Phase 1 starts.

**Open coordination items added 2026-05-01:**
- `claude/distracted-satoshi` dormancy tripwire re-anchored: now "PR 1 merge + 14d" instead of "Phase D merge + 14d" (PR 1 lands first).
- After PR 1 merges, run a fresh Phase A inventory against new origin/main to update hub counts (the `42 (hub)` and `25 (hub)` counts in the migration map were tabulated against feature/folder-migration's tree; post-PR-1 main may produce smaller numbers).
- Shared TSC has 4 pre-existing errors in validation-helpers.ts (lines 314, 341, 366, 368). PR 1 fixed 1 of 5 errors on main. Remaining 4 fixed by `c30df4b` in PR 3.

---

## Open coordination items

- **`claude/quizzical-hopper`** — pre-step 0a verified main's Tailwind broken. Plan: cherry-pick 6e06597 (preserves Opus Co-Authored-By trailer) + defense-in-depth follow-up commit (path-anchored content paths from 90d8894) on chore branch; then `git push origin --delete claude/quizzical-hopper` per §10 pre-step 0c.
- **`claude/distracted-satoshi`** — left open per DECISION-3b-ii. PR #1 author handles rebase post-Phase-D.
  - **Dormancy tripwire (NEW):** PR #1 had ZERO author activity since 2026-04-08. If still no author activity 14 days after Phase D merges, escalate to user for 3b-iii (close as stale) decision.
  - Path-rename cheat sheet included in Phase D PR description per locked DECISION-3b-ii.
- **`cascade/get-a-grasp-on-this-project-ce9f67`** — RECONCILED 2026-05-01. Branch holds single empty snapshot commit `11756f6` (Windsurf agent auto-checkpoint, 2026-04-09, no file changes). Worktree at `/Users/Joshua/.windsurf/worktrees/.../ce9f67d1` is dangling (gitdir link points to old path) but functionally inert — `git status` from inside it fails, no git ops possible. Branch ref preserved in our repo. §11 WIP gate satisfied via snapshot. No further action needed; do not run `.git/worktrees/` manual deletion (asymmetric risk).
- **Sibling repo deprecation** — separate decision deferred. Once Phase D ports MASTER-DEV-PLAN + MASTER-DREAM-ROADMAP, sibling's `docs/` versions are superseded for those two files. Whether to formally archive/deprecate sibling is a separate user question, not blocking Phase D.
- **Phase E tripwire convention (NEW v1.2):** Phase D PR title MUST contain "Phase D" (literal) so the tripwire grep at §9.3 fires correctly. Convention enforced as §11 pre-condition.
- **P0 follow-up (NEW 2026-05-01) — prompt-loader broken on main.** Bug #2 of orphaned commit 9cea951 documents that `packages/boardroom-ai/server/src/lib/prompt-loader.ts` AND `packages/omnimind-api/src/lib/prompt-loader.ts` use a hardcoded `resolve(__dirname, '../../../../docs/prompts')` that resolves to `packages/docs/prompts` in dev and `/docs/prompts` in prod Docker — neither exists. Every `loadPrompt()` throws ENOENT, masked by `Promise.allSettled`. The migration map §6.3 line 207 silently assumes the walk-up resolver fix is on main (it is not). NOT folded into Phase D (scope expansion = stuck-state trigger per master prompt §3). Track separately. CI's `ls docs/prompts/*.system.md | wc -l` only counts files; recommend adding runtime smoke test to §12.

---

## Anti-drift invariants

These claims must remain true across sessions. If a session finds them false, **stop and reconcile before continuing**:

1. The roadmap pipeline tree (`docs/roadmap/`) is the live source of truth for product roadmap, despite paths being 4 levels deep.
2. The MASTER-DEV-PLAN is currently in `/Users/Joshua/boardroom-platform/docs/MASTER-DEV-PLAN.md` (sibling repo). It will be ported into this repo as part of Phase D.
3. `docs/prompts/*.system.md` files are loaded by `prompt-loader.ts` at runtime. Other files in `docs/prompts/` are NOT loaded by code (orchestrator one-shots). **Note (2026-05-01):** main's prompt-loader is currently broken (P0 follow-up); the file-load contract still holds, the resolver path does not.
4. `BoardRoom → OmniMind via HTTP only` is the inviolable code-architecture rule. Doc reorg never violates this.
5. No mass file moves outside `docs/`. The `packages/` tree's only doc-related changes during Phase D are: (a) sed-replaces of doc-path comments in `packages/shared/src/`, (b) updates to nested `packages/*/CLAUDE.md` files, (c) `Dockerfile` glob tightening, **(d) Tailwind/postcss config remediation per §10 pre-step 0b on the chore branch (added 2026-05-01 per validator H-2; covers `packages/boardroom-ai/client/postcss.config.js` add + `tailwind.config.ts` content-path edit only)**.
