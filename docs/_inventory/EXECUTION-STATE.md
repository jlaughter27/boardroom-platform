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

**Phase D entry status (2026-05-01, post-validator):**
- §10 pre-step 0a: COMPLETE. Verified main's Tailwind broken (CSS=4612 bytes / 0 utility classes vs feature/folder-migration's 39590 bytes / 162 classes). Validator independently re-verified by cherry-picking 6e06597 onto clean main → produced 37961 bytes / 162 classes. Outcome (b) confirmed; my 4th-outcome amendment was based on a false CWD inference (vite `root` does not change `process.cwd()`); locked plan stands with rationale clarification.
- §10 pre-step 0b': COMPLETE. Branched `chore/docs-phase-D-migration` off `origin/main` (SHA 7604ad9). Cherry-picked 6e06597 (new SHA 8bd228d, Opus Co-Authored-By trailer preserved). Build verification on chore branch: CSS=37961 bytes / 162 utility classes. Defense-in-depth follow-up commit (e805f57) replaces relative content paths with `path.resolve(__dirname, ...)` anchored via `fileURLToPath(import.meta.url)`. Re-built: identical 37961 bytes / 162 classes. CWD-independent.
- §10 pre-step 0c: COMPLETE. `git push origin --delete claude/quizzical-hopper` succeeded. `git ls-remote origin claude/quizzical-hopper` returns empty.
- §10 pre-step 0d (NEW): NEXT — commit `docs/_inventory/` to chore branch as audit-trail addition.
- §11 cascade gate: SATISFIED (snapshot 11756f6 is empty, branch ref preserved, dangling worktree is inert).
- Local main has accidental cherry-pick from validator's `/tmp/main-tailwind-check` worktree (SHA 9184f25 — unpushed). Working around: chore branch was created from `origin/main` directly, so unaffected. Local main can be reset to origin/main at user's convenience; not blocking.

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
