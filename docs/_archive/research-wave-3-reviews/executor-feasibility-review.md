# Executor-Feasibility Review (Wave 3, Reviewer 3)

**Question:** Can a future Claude session, starting cold (no conversation history), pick up ANY phase from this roadmap and actually execute it?

**Method:** Simulated three cold-start scenarios end-to-end, opening only the files a fresh Claude would naturally open from the entry-point docs. Verified source-code references against the actual codebase. Audited 5 randomly sampled tasks for atomicity and self-containment.

---

## 1. Verdict (100 words)

**APPROVE-WITH-FIXES.** The roadmap genuinely works as a cold-start executor. SESSION-START-CHECKLIST plus CURRENT-PHASE plus the per-phase README/tasks/testing trio routes a fresh Claude into actionable work in under 10 minutes. Tasks are atomic, prompts are self-contained with concrete code blocks, and rollback procedures are verifiable. However: CURRENT-PHASE.md still points at Phase 0 even though Phase 0.25 is the security-critical phase that should be in flight; several file path references are stale (`user-profile.ts` vs `user-profile.schema.ts`); and Scenario C (security incident) has no explicit incident-response routing doc — fixable in Wave 4.

---

## 2. Scenario A: Phase 0.25 cold start

**User prompt:** "Pick up Phase 0.25 critical-fixes."

### Step 1 — Read STATUS/CURRENT-PHASE.md (1 min)

I open the file and immediately hit a contradiction. The file says "**Phase in flight: Phase 0 — Foundation cleanup (NOT YET STARTED)**" and lists Phase 0 actions. There is no mention of Phase 0.25 anywhere in this file. The "Phase queue" section diagrams `Phase 0 → Phase 0.5 → Phase 1 → Phase 2` — Phase 0.25 is invisible.

If a user asked me "pick up Phase 0.25" I would now be uncertain: is this a real active phase, or did the user mistype? **Friction point.** A fresh Claude would have to ask the user, or guess, or open `04-roadmap/PHASE-0.25-critical-fixes/README.md` to confirm it exists.

### Step 2 — Read CLAUDE-WORKFLOW.md (30 sec)

Clean routing. Task type A ("Pick up an active phase and execute") maps to: `STATUS/CURRENT-PHASE.md → 04-roadmap/PHASE-N/README.md → 04-roadmap/PHASE-N/tasks-and-prompts.md`. Under 5KB total. The anti-patterns list is excellent — explicitly tells me not to read the whole `docs/` tree.

### Step 3 — Read SESSION-START-CHECKLIST.md (1 min)

Five concrete steps in 8 minutes. Step 5 (confirm understanding in one sentence) is exactly the right defense against the misalignment I'm currently feeling about Phase 0 vs 0.25. Good.

### Step 4 — Read PHASE-0.25 README

Excellent. In ~90 lines I have:
- The six fixes spelled out
- Why-now (three are actively exploitable)
- Prereqs (Phase 0 done — but Phase 0 is also "not yet started" per CURRENT-PHASE)
- Exit criteria (ten verifiable rows in a table)
- Time budget (~16 hours, broken down per task)
- Risks accepted (in-memory nonce store, RLS facade deletion not real RLS)
- Cross-references back to the wave1 audit findings

This is high quality. **No friction.**

### Step 5 — Read tasks-and-prompts.md

Six atomic tasks. Each prompt is genuinely self-contained — they include the actual TypeScript snippets to paste, the file paths to touch, the test cases to add, and the verification command. I could execute Task 0.25.4 (delete `db-audit.ts`) right now: `git rm`, fix exports in `db.ts`, grep for stragglers, add CI gate script, document, run typecheck. Six numbered steps, no ambiguity.

Task 0.25.1 (OAuth state) is the most complex — it includes the literal `oauth-state.ts` source code, the test cases, and the routing changes. I would not need to ask any clarifying question to start.

### Step 6 — Verify file references exist

Sampled 18 references from the tasks:

| Reference | Status |
|---|---|
| `packages/boardroom-ai/server/src/services/google-calendar.service.ts` | EXISTS |
| `packages/boardroom-ai/server/src/services/gmail.service.ts` | EXISTS |
| `packages/boardroom-ai/server/src/routes/calendar.routes.ts` | EXISTS |
| `packages/boardroom-ai/server/src/routes/integrations.routes.ts` | EXISTS |
| `packages/boardroom-ai/server/src/index.ts` | EXISTS |
| `packages/boardroom-ai/server/src/routes/subscription.routes.ts` | EXISTS |
| `packages/omnimind-api/src/routes/user-profile.routes.ts` | EXISTS |
| `packages/shared/src/validation/user-profile.ts` | **MISSING** (actual file is `user-profile.schema.ts`) |
| `packages/omnimind-api/src/lib/db-audit.ts` | EXISTS |
| `packages/omnimind-api/src/lib/db.ts` | EXISTS |
| `packages/omnimind-api/src/lib/env.ts` | EXISTS |
| `packages/omnimind-api/src/lib/crypto.ts` | EXISTS |
| `packages/omnimind-api/src/services/memory.service.ts` | EXISTS |
| `packages/omnimind-api/src/routes/memories.routes.ts` | EXISTS |
| `packages/shared/src/types/memory.ts` | **MISSING** (actual file is `memory.types.ts`) |
| `packages/omnimind-api/src/services/decision.service.ts` | EXISTS |
| `packages/omnimind-api/src/services/commitment.service.ts` | EXISTS |
| `packages/boardroom-ai/server/src/services/omnimind-client.ts` | EXISTS |

**16/18 = 89% accurate.** The two failures are convention drift — the project uses `*.schema.ts` and `*.types.ts` suffixes for shared, but the roadmap drops the suffix. A fresh Claude executing Task 0.25.3 would `Write` to `validation/user-profile.ts`, which is wrong — it should edit `validation/user-profile.schema.ts`. Recoverable but costs a search.

### Where I would get stuck

1. **CURRENT-PHASE.md disagreement.** The biggest blocker. If the user wants Phase 0.25 in flight, the STATUS file should reflect that. As written, I'd have to ask the user "this file says Phase 0 — is the user wrong, or is the doc stale?"
2. **The `user-profile.ts` / `memory.ts` path drift.** Minor but real.
3. **Phase 0.25 README says prereq is "Phase 0 complete"** — but Phase 0 is "not yet started." Need a decision tree: should I do Phase 0 first, or are A1/A2/A5 urgent enough to break the dependency?

Otherwise: I could ship Task 0.25.4 (the easiest one, `db-audit.ts` deletion) in ~45 minutes from cold start. That's the right shape.

---

## 3. Scenario B: Phase 5a mid-resume

**User prompt:** "Resume Phase 5a after a 2-week pause."

### Step 1 — Read STATUS/CURRENT-PHASE.md

Same problem: file says Phase 0. So if Claude was working on Phase 5a two weeks ago, **CURRENT-PHASE wasn't updated when that session ended.** This is exactly the failure mode the SESSION-END-CHECKLIST is supposed to prevent.

If the file were properly maintained, it would say something like: "Phase in flight: Phase 5a, on Task 5a.3 (relationship inference). Last session shipped Tasks 5a.1 and 5a.2. Resume with Task 5a.3." Currently it tells me nothing about Phase 5a.

### Step 2 — Phase 5a README

Strong. Eight task table with file paths, success criteria, and time estimates. Confidence MED, blast radius medium-low (cron job, can be disabled). Prereqs section is honest: Phase 0.5 eval, Phase 1 schema (which adds `ExtractedEntity`, `EntityRelationship`, `EntityExtractionEvent`), Phase 2 (pattern extractor), Phase 0 (log drain).

I verified: **the prereq tables `ExtractedEntity`, `EntityRelationship`, `EntityExtractionEvent` do not exist in the current `schema.prisma`.** That's correct — Phase 1 creates them. So "resuming" Phase 5a only makes sense if Phase 1 has shipped. CURRENT-PHASE.md doesn't tell me whether it has. **Cold-start blocker.**

### Step 3 — tasks-and-prompts.md

Each task includes the literal Prisma schema additions (`LLMCostUsage`), the literal TypeScript service code (`cost-tracker.ts`, `llm-entity-extractor.service.ts`), the literal markdown prompt files, the cron schedule, the cost-cap envs. I could ship Task 5a.1 (cost tracker) immediately. The Anthropic SDK call in 5a.2 is shown end to end with Zod schema, tool definition, and tool-result handling — no guesswork.

### Step 4 — testing-and-rollback.md

Per-task verification table is clear and actionable. The "safe rollback" path (`LLM_AUGMENTATION_ENABLED=false` in Railway env, restart) is a single env-flag flip — that's exactly the right shape for a 2-week-pause resume: "if anything looks wrong, flip the flag and figure it out cold." Special-concerns section covers cost spike, precision drop, predicate violations, prompt injection — each with a concrete diagnostic query.

### How would I know which task to resume?

The phase doc has no "current task pointer." If the previous session shipped Tasks 5a.1 and 5a.2, I would have to:
- Look at `STATUS/CHANGELOG.md` for recent entries (the SESSION-START-CHECKLIST hints at this in the "special cases" section: "Read CHANGELOG.md's most recent entry — it should have a 'Next session:' line.")
- Or grep the codebase for `cost-tracker.ts` and `llm-entity-extractor.service.ts` existence
- Or ask the user

The CHANGELOG-as-pointer pattern is documented but feels under-specified. A `STATUS/PHASE-PROGRESS-TRACKER.md` exists (180 lines) but I didn't see it referenced from CURRENT-PHASE or SESSION-START-CHECKLIST as the "which task am I on" answer.

### File reference accuracy (Phase 5a sample)

| Reference | Status |
|---|---|
| `packages/omnimind-api/src/lib/cost-tracker.ts` | NEW (correct — phase creates it) |
| `packages/omnimind-api/src/lib/sanitize-user-content.ts` | NEW (correct) |
| `packages/omnimind-api/src/lib/prompt-loader.ts` | EXISTS |
| `packages/omnimind-api/src/jobs/cortex-scheduler.ts` | EXISTS |
| `packages/omnimind-api/src/jobs/llm-augmentation.job.ts` | NEW (correct) |
| `packages/omnimind-api/prisma/schema.prisma` | EXISTS |
| `docs/prompts/entity-extractor.system.md` | NEW (correct) |
| `docs/prompts/relationship-extractor.system.md` | NEW (correct) |
| `tests/integration/llm-augmentation.test.ts` | NEW (correct) |

All 9/9 valid (counting "NEW" as a phase deliverable). Phase 5a is more accurate than Phase 0.25 because most paths are net-new files where convention drift can't bite.

### Testing-and-rollback verifiability without re-reading implementation

Yes — verification rows reference observable database queries (`SELECT user_id, sum(estimated_cost_usd) FROM llm_cost_usage`), HTTP behavior (`/health` returns 200), Stripe-CLI roundtrips, and feature-flag flips. None require reading the implementation. **Strong.**

### Where I would get stuck

1. **No "current task pointer."** I would have to grep the filesystem to figure out which of the 8 tasks were already shipped. Adding a `STATUS/IN-PROGRESS-TASKS.md` (or making `PHASE-PROGRESS-TRACKER.md` the canonical resume signal) would close this.
2. **Prereq verification is manual.** "Phase 1 schema" is a prereq, but no verifier command tells me whether Phase 1 schema is actually in prod. I would have to open `schema.prisma` and check.
3. **CURRENT-PHASE.md staleness** (same as Scenario A).

---

## 4. Scenario C: Security incident triage

**User prompt:** "We just had a security incident; what do we do?"

### Step 1 — Hit the entry-point docs

CLAUDE-WORKFLOW.md has Task type F: "Debug a production issue → `02-current-state/LANDMINES.md` → `06-risks-and-mitigations/OPERATIONAL-RISKS.md` → relevant phase rollback." That's a *production-issue* path. There is **no explicit "security incident" task type.** A fresh Claude would either pick F (closest fit) or start asking the user "is this a bug, a security exploit, a data leak, or a billing issue?"

A dedicated row would help: "X. Security incident triage → `06-risks-and-mitigations/SECURITY-RISKS.md` → `02-current-state/LANDMINES.md` (L5/L6/L7 OAuth/billing) → relevant rollback."

### Step 2 — COMMON-PITFALLS.md

This is excellent reference material for *prevention*, not incident response. Twelve common Claude mistakes with detection commands and fixes. Useful for understanding what could have gone wrong, but not "an incident is happening RIGHT NOW, what do I do?" routing.

### Step 3 — LANDMINES.md

Actionable. Ten landmines (L1-L10) with: scenario, symptom, blast radius, fix, roadmap home. The "Sequencing summary" at the end gives a defuse-order. For an active OAuth hijack incident, L5 (OAuth state hijack) gives me:
- Files involved (`calendar.routes.ts:21-29`, `integrations.routes.ts:31-40`)
- Attack vector (state forgery)
- Fix (signed JWT state, callback above auth wall)
- Roadmap home (Phase 2.5 / Phase 0.25)

Good triage signal. I could move from "user says incident" to "investigate `OAuthToken` table for cross-account writes in last X hours" within minutes.

### Step 4 — SECURITY-RISKS.md

Comprehensive. Each entry has severity, files, scenario, mitigation phase, residual risk after fix. Section G ("Defenses present and working") is gold: it tells me what NOT to break in the panic of incident response.

But: **no "if this is happening right now, do these three things" runbook.** All the content is structured around long-term mitigation, not acute response. For Scenario C I would benefit from a `SECURITY-INCIDENT-RUNBOOK.md` with sections like:
- "OAuth tokens cross-leaked → step 1 invalidate all OAuthToken rows; step 2 revoke Google access; step 3 force re-auth"
- "Stripe webhook silently failing → step 1 query Stripe for last 24h events, step 2 reconcile against `Subscription` rows, step 3 alert affected paying users"
- "Memory contradiction in cortex output → step 1 disable cortex feature flag, step 2 audit prompt-injection envelope, step 3 force re-extraction"

### Where I would get stuck

1. **No incident-routing path** in CLAUDE-WORKFLOW.md. Closest match (Task F) doesn't list SECURITY-RISKS.md.
2. **No incident runbook** with first-action playbooks. The detailed risk catalog is great for planning, less great for the 3am "what command do I run" moment.
3. **LANDMINES sequencing is for defusing in calm time**, not for "this just exploded." Different mindset.

I could still triage usefully — LANDMINES + SECURITY-RISKS together cover most scenarios — but the friction is real and a fresh Claude under time pressure would feel it.

---

## 5. Source-code reference accuracy

Sampled 27 references across Phase 0.25 and Phase 5a:

- **Phase 0.25:** 16/18 valid existing files (89%); 2 path-suffix drift errors (`user-profile.ts`, `memory.ts` should be `*.schema.ts`/`*.types.ts`).
- **Phase 5a:** 9/9 valid (5 net-new files correctly flagged as new, 4 existing files all present).

**Aggregate: 25/27 = 93% accurate.**

The two failures share a pattern: shared-package files dropped their suffix. This suggests a roadmap-wide convention drift. Spot-check recommendation for Wave 4: grep all phase task tables for `packages/shared/src/(types|validation)/[^.]+\.ts$` (without `.schema` or `.types`) and fix.

---

## 6. Self-containment audit (5 sampled tasks)

| Task | Atomic? | Self-contained prompt? | Could a fresh Claude execute? |
|---|---|---|---|
| 0.25.4 (Delete RLS facade) | YES | YES | YES — 6 numbered steps, all concrete |
| 0.25.5 (ENCRYPTION_KEY fail-closed) | YES | YES | YES — 6 numbered steps, env-doc and test-doc included |
| 0.25.6 (MemoryEntry.version race) | YES | YES | YES — full TypeScript code block, 6 numbered steps |
| 5a.1 (Cost tracker) | YES | YES | YES — full Prisma model + full TypeScript code |
| 5a.4 (Prompts + sanitization) | YES | YES | YES — full markdown prompts + sanitizer code |

**5/5 atomic and self-contained.** Each prompt names file paths, code blocks, success criteria, and verification commands. No "go figure out X" handoffs to the executor.

The one structural gap I noticed: tasks freely reference files from earlier tasks (e.g., 5a.5 imports `extractEntitiesWithLLM` from 5a.2; 5a.6 imports `checkBudget` from 5a.1) but don't say "if this dependency isn't shipped yet, you cannot execute this task." A new Claude resuming Phase 5a at Task 5a.5 needs to verify 5a.1 and 5a.2 have shipped first. A "depends on tasks" column in each tasks-and-prompts table would close this.

---

## 7. The "what's missing for cold start" list

In rough order of importance:

1. **CURRENT-PHASE.md is stale.** It says Phase 0 in flight while Phase 0.25 is the actually-urgent phase. Either Phase 0.25 isn't real-active-work, or the file isn't being updated. Either way, a cold-start Claude can't trust it.

2. **No per-phase task pointer.** Within a phase like 5a (8 tasks), the only way to know which tasks have shipped is grep the filesystem or read CHANGELOG. Add `STATUS/IN-PROGRESS-TASKS.md` or extend CURRENT-PHASE with `Active task: 5a.3 (out of 8)`.

3. **Path-suffix drift in shared package references.** Two files in Phase 0.25 reference `user-profile.ts` / `memory.ts` instead of `*.schema.ts` / `*.types.ts`. Sample a wider audit across all phases.

4. **Phase 0.25 isn't in CLAUDE-WORKFLOW or CURRENT-PHASE's phase queue.** It's a distinct phase but is invisible from the entry points. Either fold it into Phase 0 or surface it explicitly.

5. **No security-incident routing.** CLAUDE-WORKFLOW.md task types don't include "incident triage." Add a row that maps to SECURITY-RISKS + LANDMINES + a (to-be-written) `SECURITY-INCIDENT-RUNBOOK.md`.

6. **No prereq verification commands.** Phase 5a says "Phase 1 schema is a prereq" but no `prisma db pull | grep ExtractedEntity || echo BLOCKED` style check. A cold-start Claude would manually verify, costing minutes.

7. **No inter-task dependency declarations within a phase.** Phase 5a Task 5a.5 silently depends on 5a.1 and 5a.2 having shipped. A "depends on tasks: 5a.1, 5a.2" column would prevent a fresh Claude from accidentally starting 5a.5 first.

8. **Conflicting prereq language.** Phase 0.25 README says "Prereq: Phase 0 complete" — but Phase 0 is "not yet started" per CURRENT-PHASE. If Phase 0.25 is truly more urgent (security A1/A2/A5 are exploitable today), the prereq should be downgraded or the phase ordering corrected.

---

## 8. Recommendations for Wave 4 (final validator)

**Must-fix before declaring "ready to execute":**

1. **Update CURRENT-PHASE.md to reflect actual current state.** Either Phase 0.25 is in flight (most likely, given its urgency framing) or Phase 0 is. Pick one. Add an "Active task within phase" line. This is the single highest-leverage fix.

2. **Audit and fix path drift in tasks-and-prompts.md across all phases.** Grep for `packages/shared/src/(types|validation)/[a-z-]+\.ts$` patterns and confirm each resolves to either `*.schema.ts` or `*.types.ts`. I caught 2 in Phase 0.25; full audit may surface more.

3. **Add a security-incident task type to CLAUDE-WORKFLOW.md.** Map it to SECURITY-RISKS + LANDMINES + a new `SECURITY-INCIDENT-RUNBOOK.md`. The runbook should be 5-7 acute scenarios (OAuth leak, Stripe webhook outage, memory PII leak, etc.) with first-action commands, not long-form mitigation plans.

4. **Add intra-phase task pointer.** Either extend CURRENT-PHASE.md with "Active task: X.Y" or make `STATUS/PHASE-PROGRESS-TRACKER.md` the canonical resume signal and reference it from SESSION-START-CHECKLIST Step 1.

5. **Add a "depends on tasks" column** to every phase's tasks-and-prompts table.

6. **Add prereq verification commands** to each phase README — one-line shell or Prisma queries that prove the prereqs are satisfied.

**Nice-to-have:**

7. **Reconcile Phase 0 vs Phase 0.25 ordering.** If 0.25 is hard-prereq for Phase 1 (it says so), and Phase 0 is also a prereq for 0.25, then Phase 0 → 0.25 → 1 is the actual order. State it explicitly.

8. **Spot-check: do the phase READMEs all use the same exit-criteria table format?** Both phases I read used a consistent `Criterion / How to verify` table. Worth confirming this consistency holds across all 25+ phase folders.

9. **Make the "if this is happening right now, do these three things" pattern explicit.** It exists implicitly in some places (Phase 5a's "Cost spike" subsection in testing-and-rollback) but not others. Standardize.

**What's already excellent and shouldn't change:**

- The CONTEXT-LOAD-ORDER + SESSION-START-CHECKLIST + CLAUDE-WORKFLOW trio. The 8-minute cold-start budget is realistic and the anti-patterns list is concrete.
- Per-phase README + tasks-and-prompts + testing-and-rollback structure. Three docs, ~150-300 lines each, gives the right ratio of phase context to executable detail.
- Self-contained prompts with full code blocks. A fresh Claude really can paste-and-run.
- LANDMINES.md sequencing summary. The "compounds with" table is precisely the kind of cross-cutting analysis that prevents whack-a-mole fixes.
- Rollback procedures with explicit time budgets and "warning" call-outs.

---

**Final assessment:** A fresh Claude session, given CURRENT-PHASE.md as the entry point and the Phase 0.25 / 5a docs in front of it, can execute single tasks within 30-60 minutes from cold start with reasonable accuracy. The roadmap genuinely solves the cold-start problem at the per-task level. The remaining gaps are at the **session-routing** layer (which phase, which task) and **incident response** layer (no acute-mode runbook). Both are fixable with bookkeeping discipline (CURRENT-PHASE staleness) and one new doc (security incident runbook). With those fixes, this is a working executor-driven roadmap.

**Word count:** ~2,180.
