# Phase B Target Tree — Revised (V2)

> **Status:** Synthesized from 3 parallel validator reports against V1.
> **Generated:** 2026-04-30
> **Supersedes:** `docs/_inventory/PHASE-B-PROPOSAL.md` (V1)
> **Validators:** architecture, risk, ai-information-architecture (all PASS_WITH_NOTES)

---

## What changed from V1

V1 was a tidy cleanup. The validators challenged that as half-measure. V2 is a more substantial reorganization driven by the **AI-IA validator's** finding that V1's `01-product/` bucket conflated 6 different concerns and that the most-loaded docs (STATUS, CLAUDE-WORKFLOW, CONTEXT-LOAD-ORDER) are buried 4 levels deep.

| V1 said | V2 says | Why changed |
|---|---|---|
| One `01-product/` bucket for 13 loose docs | Split into 4 purpose-aligned buckets: `01-orientation/`, `02-reference/`, `03-operations/`, `_reports/` | AI-IA: `01-product/` mixes reference, ops, ADRs, status, dated reports |
| Keep STATUS at `docs/roadmap/STATUS/` | Promote to `docs/STATUS/` (top-level) | AI-IA: it's session-state, loaded every session, daily tax to nest 4-deep |
| Keep `docs/roadmap/07-claude-instructions/` AS-IS | Promote to `docs/_meta/` | AI-IA: these ARE the load-order map; should not be 4-deep |
| Auto-generate one INDEX.json | Two artifacts: auto `INDEX.json` (manifest) + curated `LOAD-MAP.json` (task→files) | AI-IA: auto-gen of all files isn't the index Claude needs |
| Stale .claude/CLAUDE.md MEM0 refs deferred to "open question 5" | Fixed in same PR | Risk + Architecture: don't defer broken links |
| 13 loose-doc moves only | Add: 15 code-comment fixes in `packages/shared/src/`, 2 nested CLAUDE.md updates, Dockerfile glob tightening, env-var override | Risk + Architecture: comments and code-loaded paths bypass stubs |
| No CI assertion | Add `docs/prompts/*.system.md` count ≥17 + link-validity check on entry-point docs + Phase E tripwire | Risk: stubs persist forever without enforcement |
| 30-day stub window | Stubs are 1-line + `<!-- AGENT_REDIRECT_ONLY -->` HTML marker | AI-IA: agents short-circuit; humans can read |
| GLOSSARY: 14 prefixes + 7 personas + 30+ entities + statuses + modes | GLOSSARY: prefixes + statuses + modes only. Link out for personas (→ prompts) and entities (→ Prisma) | AI-IA: avoid 3-way drift |
| MASTER-DEV-PLAN sibling-repo ambiguity unresolved | **Open question for user**: port into this repo, declare sibling canonical, or sync? | AI-IA: don't leave ambiguous |

---

## Revised target tree

```
docs/
├── INDEX.md                          NEW    human-readable map (links to LOAD-MAP, GLOSSARY, the 4 main bucket dirs)
├── INDEX.json                        NEW    auto-gen manifest, all 296 files, with status + deprecation flags
├── LOAD-MAP.json                     NEW    CURATED. ~20 task types → 2-3 files each. Source of truth for Claude.
├── GLOSSARY.md                       NEW    code prefixes + statuses + modes. ≤150 lines. Links out, doesn't duplicate.
├── CONVENTIONS.md                    NEW    naming, lifecycle, stub format, code-prefix taxonomy.
│
├── _meta/                            NEW DIR — agent-facing meta-docs (promoted from roadmap/07-claude-instructions/)
│   ├── CLAUDE-WORKFLOW.md            ← docs/roadmap/07-claude-instructions/CLAUDE-WORKFLOW.md
│   ├── CONTEXT-LOAD-ORDER.md         ← docs/roadmap/07-claude-instructions/CONTEXT-LOAD-ORDER.md
│   ├── PROMPT-TEMPLATES.md           ← docs/roadmap/07-claude-instructions/PROMPT-TEMPLATES.md
│   ├── HANDOFF-TEMPLATE.md           ← docs/roadmap/07-claude-instructions/HANDOFF-TEMPLATE.md
│   └── SESSION-END-CHECKLIST.md      ← docs/roadmap/07-claude-instructions/SESSION-END-CHECKLIST.md
│
├── STATUS/                           PROMOTED from docs/roadmap/STATUS/ — session-state
│   ├── CURRENT-PHASE.md
│   ├── CHANGELOG.md
│   ├── DECISIONS-LOG.md
│   ├── BLOCKERS.md
│   └── PHASE-PROGRESS-TRACKER.md
│
├── 01-orientation/                   NEW — "what is this thing"
│   ├── PROJECT-BRIEF.md              ← docs/PROJECT-BRIEF.md
│   ├── CURRENT-STATE.md              ← docs/CURRENT-STATE.md
│   └── ARCHITECTURE-QUICK-REF.md     ← docs/ARCHITECTURE-QUICK-REF.md
│
├── 02-reference/                     NEW — "deep context when needed"
│   ├── MASTER-FRAMEWORK.md           ← docs/MASTER-FRAMEWORK.md   (79kb, 42 inbound — hub)
│   ├── DECISIONS.md                  ← docs/DECISIONS.md           (22 inbound — ADR list)
│   └── FRAGILE-ZONES.md              ← docs/FRAGILE-ZONES.md
│
├── 03-operations/                    NEW — "how to deploy/run"
│   ├── DEPLOYMENT-RUNBOOK.md         ← docs/DEPLOYMENT-RUNBOOK.md  (25 inbound — hub)
│   ├── DEPLOY-RAILWAY.md             ← docs/DEPLOY-RAILWAY.md
│   └── REALITY-BASELINE.md           ← docs/REALITY-BASELINE.md
│
├── _reports/                         NEW — point-in-time, kept for audit trail
│   ├── FRONTEND-POLISH-REPORT.md
│   ├── PHASE-5-REPORT.md
│   ├── REMEDIATION-REPORT.md
│   └── REMEDIATION-2-REPORT.md
│
├── architecture/                     AS-IS minus 4 empty stubs
├── contracts/                        AS-IS
├── schemas/                          AS-IS minus 3 empty stubs
├── roadmap/                          AS-IS minus the STATUS/ + 07-claude-instructions/ promotions
├── tasks/                            AS-IS (separately: rebuild _TASK-INDEX.md to cite all subdirs)
├── research/                         AS-IS minus wave3-review/ (moves to _archive)
├── prompts/                          AS-IS for *.system.md (runtime loaded). 16 orchestrators move to _archive (no stubs — they're orphans).
│
├── _deprecated/                      NEW TIER — stale-but-still-cited (30-day cycle, then to _archive)
│
└── _archive/
    ├── 2026-04-pre-roadmap/          AS-IS
    ├── orchestrator-prompts/         NEW — 16 files, ~360kb. README explains origin.
    └── research-wave-3-reviews/      NEW — 4 files incl. wave4-validator-summary.md (~75kb total)
```

---

## Phase D scope (now ~2× original)

Item | Source of finding | Effort
---|---|---
`git mv` 13 loose docs into 4 new buckets + 4 reports | V1 | 30 min
Move `_meta/` files from `docs/roadmap/07-claude-instructions/` | AI-IA HIGH | 15 min
Move `STATUS/` from `docs/roadmap/STATUS/` | AI-IA HIGH | 15 min
`git mv` 16 orchestrators (no stubs — orphans) | V1 + Arch | 10 min
Move `wave3-review/` (incl. wave4-validator-summary.md) | Arch MED | 10 min
Delete 7 empty architecture/schema stubs | V1 | 5 min
Sed-replace 15 doc-path comments in `packages/shared/src/` | Risk HIGH | 30 min
Update root `CLAUDE.md`, `.claude/CLAUDE.md`, `packages/boardroom-ai/CLAUDE.md`, `packages/omnimind-api/CLAUDE.md`, `README.md` | Arch HIGH + Risk | 45 min
Fix stale `.claude/CLAUDE.md:32` MEM0_* refs | Arch MED + Risk MED | 5 min
Fix `pre-deploy-check.sh:24` if needed | Risk MED | 5 min
Tighten Dockerfile `COPY docs/prompts/` to `*.system.md` glob | Arch HIGH | 10 min
Set `PROMPTS_DIR` env in Dockerfile runner | Arch MED | 5 min
Add CI assertion: `docs/prompts/*.system.md` count ≥17 | Risk HIGH | 15 min
Add CI link-validity check for entry-point docs | Risk MED | 30 min
Add Phase E tripwire (dated test or scheduled agent) | Risk MED | 20 min
Write `INDEX.md`, `INDEX.json` (regen), `LOAD-MAP.json`, `GLOSSARY.md`, `CONVENTIONS.md` | V1 + AI-IA | 90 min
`scripts/fix-unresolved-refs.py` cleanup pass | AI-IA INFO | 60 min
Branch freeze: rebase/close `cascade/...`, `claude/distracted-satoshi`, `claude/quizzical-hopper` | Risk MED | external coordination

**Total: ~6 hours of work** (was ~2-3 hrs in V1).

---

## Branch hygiene precondition (Risk validator)

Before opening Phase D PR:
1. Check status of remote branches `claude/distracted-satoshi`, `claude/quizzical-hopper` — close/merge or notify owner
2. Local branch `cascade/get-a-grasp-on-this-project-ce9f67` has 4 of 13 loose docs touched recently — rebase or stash
3. Post freeze notice on the 13 loose-doc paths

---

## Open questions (require user decision before Phase D)

1. **MASTER-DEV-PLAN sibling-repo ambiguity.** AI-IA validator HIGH finding. The plan lives at `/Users/Joshua/boardroom-platform/docs/MASTER-DEV-PLAN.md` (sibling clone), not in this repo. Three options:
   - **(a)** Port MASTER-DEV-PLAN.md and MASTER-DREAM-ROADMAP.md into THIS repo at `docs/02-reference/`, deprecate sibling.
   - **(b)** Declare sibling canonical for product specs, add a paragraph in CONVENTIONS.md, leave this repo implementation-only.
   - **(c)** Maintain as drift-prone copies in both, add a sync script.

2. **Branch coordination.** Three active branches conflict with the loose-doc moves. Are they yours? Can we close `cascade/get-a-grasp-on-this-project-ce9f67` (current local checkout)? Do you want me to merge to main first, then branch fresh?

3. **Promotion vs preservation of `docs/roadmap/STATUS/` and `docs/roadmap/07-claude-instructions/`.** AI-IA HIGH says promote. But this dramatically increases the inbound-update count (the roadmap pipeline references these paths from many internal docs). Trade-off:
   - Promote → faster Claude loads, but ~30+ internal roadmap-doc edits
   - Keep + add stub redirects → no internal roadmap-doc edits, but Claude still pays the path-prefix tax
   - Compromise: symlink `docs/STATUS/` → `docs/roadmap/STATUS/` (keeps both paths working without duplication, but symlinks have OS quirks)

4. **`_deprecated/` tier.** AI-IA MED finding. Adds a new lifecycle stage between "active" and "_archive." Worth the operational complexity, or YAGNI?

5. **Curated LOAD-MAP.json.** AI-IA HIGH says we need this in addition to the auto-gen INDEX.json. It would be ~20 entries: `{"task_type": "phase-0", "load": ["docs/STATUS/CURRENT-PHASE.md", "docs/_meta/CLAUDE-WORKFLOW.md", "docs/04-tasks/phase-0/..."]}`. Confirm?

---

## What V2 does NOT change from V1

- Roadmap tree internal structure stays at 4 levels (validator suggested `docs/roadmap/_redirect.md` for short-aliases — I haven't included that, considered nice-to-have)
- Tasks tree stays AS-IS (rebuilding `_TASK-INDEX.md` is a side task, not Phase D scope)
- Prompts dir stays AS-IS for runtime `*.system.md` files
- Contracts dir stays AS-IS
- Existing `_archive/2026-04-pre-roadmap/` stays AS-IS
- No git submodules, no workspace edits, no node_modules churn

---

## Validator verdicts (raw)

| Validator | Verdict | Top finding |
|---|---|---|
| Architecture | PASS_WITH_NOTES | Dockerfile copies `docs/prompts/` wholesale — stubs would bloat image |
| Risk | PASS_WITH_NOTES | 15 doc-path code comments in `packages/shared/src/` need sed-replace |
| AI-IA | PASS_WITH_NOTES | `01-product/` bucket conflates 6 concerns; STATUS + meta need promotion |

All three: directionally right, scope-expanding catches.
