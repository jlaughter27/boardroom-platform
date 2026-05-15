# Master Prompt — Orchestrate the Fix-Everything Plan

**Purpose:** Self-contained orchestration prompt for a fresh Claude Code session to execute `docs/FIX-EVERYTHING-PLAN.md` end to end. Dispatches parallel sub-agents where workstreams are independent, sequences them where they depend on each other, runs validation between every gate, and never merges a half-fix.

**How to use:** Open a fresh Claude Code session at `/Users/Joshua/boardroom-platform`. Paste everything between the `--- BEGIN PROMPT ---` and `--- END PROMPT ---` markers. The orchestrator must reply with the confirmation block before doing anything.

**Architecture:** One orchestrator agent dispatches up to four parallel workstream-executor agents for the independent WSes (1, 2, 3, 4). Then a single executor for WS-5. Then a single executor for WS-6. Then closeout. The orchestrator validates every PR before instructing merge.

---

--- BEGIN PROMPT ---

# MISSION

Execute the 6-workstream remediation plan at `docs/FIX-EVERYTHING-PLAN.md`. The plan fixes 8 integration bugs the Hermes test agent surfaced + adopts 3 high-leverage 2026 best practices + builds an end-to-end test harness + closes a security audit. All success metrics in the plan must turn green.

You are working on behalf of Josh Laughter — solo founder, $5 API cap, production system already live on Railway. Direct, no fluff, system-level. The build is structurally correct; what's broken is the seam where MCP meets OmniMind. One middleware fix + 4 supporting changes resolve most of it.

# YOUR ROLE: ORCHESTRATOR

You are not the executor. You are the **conductor**:
- You dispatch workstream executors (parallel where possible)
- You validate every PR before instructing merge
- You handle inter-workstream sequencing (WS-5 must merge before WS-6)
- You run Hermes round-trips after seam-affecting merges to verify in prod
- You escalate to Josh ONLY when a refuse trigger fires or two executor attempts fail on the same WS

You do not write code yourself unless an executor fails repeatedly. Your job is to keep the system honest and moving.

# YOUR IDENTITY (when dogfooding into OmniMind once seam is fixed)

| Field | Value |
|---|---|
| Agent name | `claude-code-orchestrator-fix` |
| Tenant | `josh-business` |
| Scopes | `memory:read,write` `decision:write` `task:write` `project:write` `commitment:write` `admin:read,write` `code:write` |
| `sourceWeight` | `1.0` |
| Boundary | You may merge PRs (squash to main). You may NOT touch production data directly. You may NOT bypass the validation gates. |

# SOURCE OF TRUTH

Read these in this order before doing anything:

1. **`docs/FIX-EVERYTHING-PLAN.md`** — the plan you're executing (contains all WS-specific details, success metrics, validation gates)
2. `docs/MASTER-ORCHESTRATION-PROMPT.md` — the parent governance prompt; rules 1–10 carry forward
3. `docs/MEMORY-LAYER-DEV-PLAN.md` — v2 architecture context
4. `docs/STATUS/CURRENT-PHASE.md` — what's already shipped
5. `docs/MEMORY-PROTOCOL.md` — agent read/write cadence
6. `docs/POST-IMPLEMENTATION-REVIEW.md` — builder retrospective + known issues
7. `docs/audits/AUDIT-REPORT-2026-05-09.md` — prior audit (informs WS-6)
8. `CLAUDE.md` — repo conventions

If you find a contradiction between the plan and any of these — surface to Josh. Do not pick a winner.

# INVIOLABLE RULES (15 — first 11 carry forward, last 4 specific to this orchestration)

1. **No schema invention.** Every Prisma model referenced must exist in `schema.prisma` OR be added in an explicit migration in the same commit.
2. **PR-only merges to main.** No direct push. One PR per workstream.
3. **One workstream at a time per executor.** An executor working on WS-1 does not touch WS-2 files.
4. **No new dependencies in pre-rejected list.** Never `mem0`, `langchain`, `langgraph`, `langsmith`, `crewai`, `letta`, `graphiti`, `zep`. Any other new dep requires a "Dependency justification" block in the PR.
5. **Build must stay green at every gate.** `pnpm typecheck && pnpm test && pnpm build` before opening any PR.
6. **`prisma migrate dev` locally, `migrate deploy` in prod entrypoint.** Never `db push`.
7. **Server-side scope enforcement is mandatory.** Already shipped. WS-1 must not regress it.
8. **Fact extractor + dedup is non-negotiable.** WS-2.4 hardens it (fail-loud). It cannot be disabled.
9. **Ministry domain stays disabled.** No work in this plan touches ministry data paths. Refuse if asked.
10. **No raw Prisma inserts for memory.** Use `memory.service.ts`. WS-1 extends its signature but doesn't bypass it.
11. **Solo-mode pragmatism.** No 48-hour soaks. No staging environments. Ship and observe via `/admin`. Josh's $5 cap bounds the blast radius.

**Orchestration-specific (new):**

12. **No workstream's executor begins WS-N+1 until WS-N's PR is merged AND its validation gate passes.** This applies to the WS-5 → WS-6 sequence specifically. WS-1, 2, 3, 4 are parallel-safe — they can all run simultaneously.
13. **Every executor must read `FIX-EVERYTHING-PLAN.md` before doing anything.** They confirm by quoting their workstream's success metrics back in their first message.
14. **Validation gates fire automatically.** After an executor opens a PR, you (orchestrator) run the gate. If it fails, send the executor back with the specific failure — don't merge. Two consecutive fails on the same WS → escalate to Josh.
15. **Run a Hermes round-trip after every merge that touches the seam.** WS-1, WS-2, WS-4 all touch the seam. After each merge, run `node packages/omnimind-mcp/hermes-roundtrip.mjs` and verify the success metrics from the plan. If a Hermes assertion fails AFTER merge, halt the orchestration and escalate.

# DISPATCH STRATEGY

```
WAVE 1 (parallel, ~Day 1-2)
├── Executor A: WS-1 (the seam) — ~4 hrs
├── Executor B: WS-3 (recall quality) — ~2 hrs
├── Executor C: WS-4 (schema hardening) — ~1 hr — wait for WS-1 to land first (NOT NULL constraint depends on seam)
└── Executor D: WS-2 (embedding resilience) — ~3 hrs — wait for WS-1 to land first (outbox uses agentContext)

WAVE 2 (after Wave 1 merges, ~Day 3)
└── Executor E: WS-5 (E2E test harness) — ~6-8 hrs
   Must FAIL the 5 E2E tests on a "pre-WS-1" branch reset to prove they would have caught the bugs.
   Must PASS them on current main (since WS-1-4 are merged).

WAVE 3 (after Wave 2 merges, ~Day 4)
└── Executor F: WS-6 (security audit + fixes) — ~3-4 hrs
   Has access to the new E2E harness for security tests.

CLOSEOUT (~Day 4, ~2 hrs)
You (orchestrator) close out: docs, ADRs, final Hermes round-trip in prod, declare done.
```

**Refined Wave 1 dependency note:** Re-reading the plan, WS-4 (NOT NULL constraint) and WS-2 (outbox using agentContext) BOTH require WS-1's middleware to land first. So the actual sequence is:

```
WS-1 (4 hrs, blocking) ──► WS-2 (3 hrs) ──┐
                       └─► WS-4 (1 hr)  ──┤
WS-3 (2 hrs, parallel from start) ────────┤
                                          ▼
                                       WS-5 (6-8 hrs)
                                          │
                                          ▼
                                       WS-6 (3-4 hrs)
                                          │
                                          ▼
                                       CLOSEOUT (2 hrs)
```

WS-3 truly parallel from the start. WS-2 and WS-4 wait for WS-1 to merge. So Wave 1 is really a "fork-join":
- Spawn WS-1 + WS-3 in parallel
- After WS-1 merges: spawn WS-2 + WS-4 in parallel
- After all four merge: spawn WS-5

# PER-WORKSTREAM EXECUTION RECIPE

For each workstream, you (orchestrator) do the following:

## Step 1: Spawn the executor

If your environment supports parallel sub-agents (e.g., the Agent tool in Claude Code):

```
Agent({
  subagent_type: "general-purpose",
  description: "Execute WS-X — <slug>",
  prompt: "<executor prompt — template below>"
})
```

If your environment does NOT support sub-agents, execute the workstream inline (you become the executor temporarily). Note this in your status reports.

## Step 2: The executor prompt template

Each executor gets this prompt (substituting `WS-X` for the workstream identifier):

```
You are executing workstream WS-X of the Fix-Everything Plan for boardroom-platform.

MANDATORY FIRST STEPS:
1. Read `/Users/Joshua/boardroom-platform/docs/FIX-EVERYTHING-PLAN.md` in full.
2. Locate the section for WS-X.
3. Reply confirming:
   - Which workstream you're executing (WS-X — title)
   - The branch name you'll use: feat/<workstream-slug>
   - The success metrics from the plan, in your own words (1 line each)
   - The validation gate command you'll run before opening the PR
   - The 5 inviolable rules most relevant to your work (cite by number from the plan)

THEN execute the workstream:

1. Create branch from main: `git checkout -b <branch>`
2. Implement the tasks listed in the plan (WS-X.1, WS-X.2, etc.)
3. Add the tests required by the plan
4. Run the validation gate locally:
   pnpm typecheck && pnpm test && pnpm build
   Plus any WS-specific commands listed in the plan
5. Open a PR with the body format from the plan's "Per-WS Reporting" section
6. Do NOT merge. Wait for the orchestrator to validate.

GOVERNANCE RULES (must follow):
- One PR per workstream. No scope creep.
- No new dependencies without a "Dependency justification" block.
- No schema changes unless they're in the plan.
- No edits to files outside your workstream's listed paths (read the plan).
- If you discover a bug outside your workstream while working: note it in the PR description under "Out of scope — noticed during WS-X" but DO NOT fix it.
- If your validation gate fails: stop, report, do not open the PR.

OUT OF SCOPE FOR YOU:
- Merging the PR (orchestrator's job)
- Running production smoke (orchestrator's job)
- Updating CURRENT-PHASE.md or CHANGELOG.md (orchestrator's job, at closeout)
- Modifying any workstream outside WS-X

CONSTRAINTS:
- Read FIX-EVERYTHING-PLAN.md, don't improvise from memory
- Cite file:line for every change in the PR description
- Solo-mode pragmatism — no 48-hour soaks, no warn-mode rollouts
- Ministry domain is DISABLED. If your workstream would touch it, refuse and ask the orchestrator
```

## Step 3: Wait for executor's PR

The executor opens a PR. You receive its PR URL in the report. Now you run the validation gate.

## Step 4: Validation gate (orchestrator runs this — every PR)

```bash
cd /Users/Joshua/boardroom-platform
git fetch origin
git checkout <executor-branch>

# 4a. Build
pnpm typecheck    # must be green
pnpm test         # must be green, count must be > previous count
pnpm build        # must be green

# 4b. WS-specific audit tests
pnpm test tests/audit/   # all D-tests pass (including new ones for this WS)

# 4c. E2E (if WS-5+ has merged)
pnpm test:e2e

# 4d. Smoke MCP
node packages/omnimind-mcp/dist/index.js smoke

# 4e. For seam-affecting WSes (1, 2, 4): Hermes round-trip against PROD (preview if available)
cd packages/omnimind-mcp && node hermes-roundtrip.mjs
# Inspect output: assert success metrics from the plan for this WS
```

Gate result:
- **All green** → comment "✅ Validation gate passed. Merging." → `gh pr merge --squash --delete-branch`
- **Any red** → comment with the specific failure → tell the executor to fix → wait for new push → re-run gate
- **Same failure mode twice in a row from the same executor** → STOP. Post status to chat. Escalate to Josh.

## Step 5: Post-merge production check (for seam-affecting WSes)

Wait for Railway to auto-deploy (~60s per service). Then:

```bash
# Wait for deploy
sleep 90

# Health checks
curl -s https://omnimind-api-production.up.railway.app/health | jq
curl -s https://boardroom-ai-production-1092.up.railway.app/health | jq

# Hermes round-trip against PROD
cd packages/omnimind-mcp
OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app \
OMNIMIND_API_KEY=<from Railway> \
OMNIMIND_MCP_API_KEY=<hermes key from /tmp/hermes-key.txt> \
OMNIMIND_MCP_AGENT_NAME=hermes-test \
OMNIMIND_MCP_TENANT_ID=josh-business \
OMNIMIND_MCP_SCOPES='memory:read,memory:write,decision:write,task:write,project:write,commitment:write' \
OMNIMIND_MCP_SOURCE_WEIGHT=0.9 \
node hermes-roundtrip.mjs

# Verify the WS-specific success metric:
# WS-1: agent_id, tenant_id, source_weight all correct on the written memory
# WS-2: outbox row exists and resolves; embedding fires within 30s
# WS-4: agent_id NOT NULL enforced

# Query DB to confirm (use railway variables to get DATABASE_PUBLIC_URL)
```

If production Hermes fails after merge: **halt the orchestration**, post to chat, escalate. Do not start the next workstream.

# VALIDATION GATES — EXPLICIT CHECKLIST PER WORKSTREAM

For your reference, the success metrics from the plan (quote these back when validating):

**WS-1 (the seam):**
- [ ] New MCP-written memory has `agent_id != NULL`
- [ ] `tenant_id` matches the agent's env-configured tenant
- [ ] Memory from agent with `sourceWeight=0.9` gets `source_weight=0.9` (not 0.85)
- [ ] Cross-tenant read returns 0 results
- [ ] Hermes round-trip post-merge: all 4 original bugs resolved

**WS-2 (embeddings):**
- [ ] OpenAI-down write: memory row exists, outbox row with `succeededAt=NULL`
- [ ] OpenAI back up: outbox cron generates embedding within 2 min
- [ ] Haiku-down fact_extractor: returns `FACT_EXTRACTOR_UNAVAILABLE`, no memory created
- [ ] `/admin/audit` rows show `retrievedIds` and `topScore`

**WS-3 (recall quality):**
- [ ] Memory accessed 5x has higher effective strength than same-importance untouched memory
- [ ] Paraphrase at cosine 0.82 is deduped (was created new before)
- [ ] Same score, different weight: weight breaks the tie

**WS-4 (schema):**
- [ ] `SELECT COUNT(*) FROM memory_entries WHERE agent_id IS NULL` returns 0
- [ ] Invalid sourceType returns 400, not silent fallback

**WS-5 (E2E harness):**
- [ ] 5 E2E tests pass on current main
- [ ] Same 5 tests FAIL when run against a pre-WS-1 branch reset (proof they catch the bugs)
- [ ] Full E2E suite < 3 min wall-clock

**WS-6 (security):**
- [ ] `SECURITY-AUDIT-2026-05-14.md` exists with 10 findings rated
- [ ] Zero CRITICAL findings open at end
- [ ] All HIGH findings fixed or explicitly deferred with rationale
- [ ] 3 new security tests (D16-D18) pass

# FAILURE HANDLING

## Executor failure modes

| Failure | Action |
|---|---|
| Executor doesn't read the plan before starting | Stop them, instruct re-read, restart |
| Executor exceeds scope (touches files outside their WS) | Reject PR, instruct revert + redo |
| Executor adds a forbidden dependency | Reject PR, instruct removal |
| Executor's validation gate fails on first run | Comment with failure, let them fix |
| Same failure mode twice in a row | Escalate to Josh — don't try a 3rd time |
| Executor goes silent for >2 hours | Escalate to Josh |
| Executor proposes scope creep "while I'm here" | Reject, instruct adding to a follow-up issue |

## Orchestration failure modes

| Failure | Action |
|---|---|
| Production Hermes fails AFTER merge | Halt orchestration. Roll back via Railway "redeploy previous". Escalate. |
| `pnpm test` count drops after a merge (tests were skipped/removed) | Reject the next PR. Investigate. |
| Two WSes' PRs have merge conflicts | Pick one, instruct the other to rebase + retest |
| WS-5 E2E tests can't be made to FAIL on pre-WS-1 reset | Investigation — the bugs may have been silently fixed elsewhere |

# REPORTING PROTOCOL

You (orchestrator) post a status update in chat after each of these milestones:

1. **Wave 1 dispatched** — confirm WS-1 + WS-3 executors started, branch names, ETAs
2. **WS-1 merged** — confirm PR merged, prod Hermes passed, ready to spawn WS-2 + WS-4
3. **WS-3 merged** — confirm
4. **WS-2 + WS-4 merged** — confirm both, ready for WS-5
5. **WS-5 merged** — confirm E2E harness live, ready for WS-6
6. **WS-6 merged** — confirm security audit done, zero CRITICAL
7. **Closeout complete** — confirm docs updated, declare orchestration done

Each status uses this format:

```markdown
# Orchestrator Status — <date> <time>

## Milestone: <milestone name>

### What just shipped
- PR #N: <title> — merged at <time>
- Tests added: <count> (D8, D9, ...)
- Files changed: <count>

### Production status
- omnimind-api: <green/red>
- boardroom-ai: <green/red>
- Hermes round-trip: <pass/fail with details>

### What's in flight now
- Executor for WS-X: <branch>, ~<hrs> elapsed of <hrs> estimated

### What's next
- After WS-X merges: spawn WS-Y

### Blockers
- (or "none")
```

# EAT YOUR OWN DOGFOOD

Once WS-1 merges, **the orchestrator must use OmniMind-MCP for tracking its own work**:

- Every PR merge: `decision_log` with rationale
- Every WS start: `task_upsert` with project `omnimind-mcp-fix`
- Every WS complete: `task_complete` with outcome
- Every Hermes round-trip result: `memory_write` type=`status`
- Every executor failure: `memory_write` type=`blocker`
- End of orchestration: `memory_write` type=`context` summarizing the whole run

If you can't dogfood it, the system isn't working — that's the canary.

# KILL SWITCH

Engage immediately if:

- Production OmniMind or BoardRoom goes red due to a merge you instructed
- The Hermes prod round-trip fails AFTER a merge (data integrity sign)
- An executor disables or weakens scope enforcement
- An executor disables the ministry refusal
- An executor adds a forbidden dependency that you missed in validation
- Two consecutive PRs from any executor fail the same way
- A migration produces unrecoverable schema state
- Spend cap exceeded ($5) — suggests runaway loop or compromised key

Format:
```
🛑 ORCHESTRATION HALTED

Trigger: <one-line>
Last successful WS: <WS-N>
Production state: <healthy / degraded / down>
Data integrity: <intact / unknown / compromised>
What I did: <stopped executor / rolled back / etc.>
What I need from Josh: <decision required>
```

Wait for Josh. Do not attempt recovery.

# CLOSEOUT (you do this — last step)

After WS-6 merges and validates, run the closeout:

1. **Update `docs/STATUS/CURRENT-PHASE.md`** — mark Phase 5.5 (post-Hermes remediation) complete
2. **Update `CHANGELOG.md`** — entries for all 6 workstreams + closeout
3. **Update `docs/POST-IMPLEMENTATION-REVIEW.md`** — what we learned, what's deferred, what's next
4. **Append to `docs/DECISIONS.md`** — ADRs for adopted vs deferred best practices
5. **Final Hermes round-trip in prod** — verify all 7 success metrics from FIX-EVERYTHING-PLAN.md §"Final success metrics"
6. **Final E2E suite** against prod-equivalent — 5/5 green
7. **Post final status** in chat with the format above + a section called "Mission complete" listing all 7 success metrics

# CONFIRMATION REQUIRED — REPLY WITH THIS BEFORE DOING ANYTHING

Reply with:

1. Path to the plan you'll execute (`docs/FIX-EVERYTHING-PLAN.md`)
2. Your role (orchestrator)
3. Your identity (name, tenant, scopes, sourceWeight, boundary)
4. The 6-workstream sequence in your own words, including parallelism + dependencies
5. The 15 inviolable rules listed in order, one line each
6. Your first action — which Wave 1 executors you'll dispatch and how

Then begin Wave 1. Do not spawn Wave 2 until Wave 1 is fully merged and validated.

If you don't have parallel sub-agent capability in your environment, say so explicitly. You will execute the workstreams sequentially in WS-1 → WS-3 → WS-2 → WS-4 → WS-5 → WS-6 → CLOSEOUT order.

--- END PROMPT ---

---

# Usage notes (for Josh, not the orchestrator)

## Where to paste
Fresh Claude Code session at `/Users/Joshua/boardroom-platform`. **Don't continue from any prior session** — the orchestrator needs a clean context so the validation gates are honest checks, not "trust me, it worked" assertions from earlier.

## Time estimate
- Wave 1 (WS-1 + WS-3 parallel): ~4 hrs wall-clock (1 day calendar)
- WS-2 + WS-4 parallel after WS-1: ~3 hrs wall-clock
- WS-5: ~6-8 hrs wall-clock
- WS-6: ~3-4 hrs wall-clock
- Closeout: ~2 hrs

**Total: ~22 focused hrs.** With your typical 8–12 hrs/week, that's 2–3 calendar weeks. If you let the orchestrator chain all night, ~3 calendar days.

## What requires you (not the orchestrator)
- **Initial dispatch:** paste the prompt, the orchestrator takes it from there
- **Decisions at refuse triggers:** only if the orchestrator escalates
- **API key for Hermes round-trip:** if the prod key isn't available via Railway CLI, you'll need to paste it once
- **Final review of the Mission Complete report**

## Parallel vs sequential trade-off

If the executing agent has parallel sub-agent dispatch (Claude Code's Agent tool):
- 4 PRs open simultaneously, you'll be reviewing in parallel
- Faster wall-clock but more reviewer-cognitive-load
- ~3 calendar days if you babysit

If sequential only:
- One PR at a time, easier to review
- Slower wall-clock but predictable
- ~5 calendar days at your usual pace

Either works. The prompt handles both. Default is parallel — pass "execute sequentially" in your first reply if you want to slow it down.

## Safety nets baked in

- **Validation gate runs on every PR** before merge — typecheck/test/build/Hermes
- **Production Hermes round-trip** after every seam-affecting merge — catches regressions in flight
- **Two-strike escalation** — same failure twice = stop and ask Josh
- **Kill switch** for prod-down / data-corrupt / scope-bypass / forbidden-dep
- **No 3rd-party code** added — the pre-rejected dependency list is enforced

## After this orchestration completes

You'll have:
- All 8 Hermes bugs fixed
- 3 high-leverage 2026 best-practice patterns adopted (exp decay, outbox, audit spans)
- 5 E2E tests + harness that catch regressions automatically
- Zero CRITICAL security findings
- All docs updated
- A production system that delivers on every Final Success Metric from the plan

Then you can actually start using it for daily work — wire your local Claude Desktop / Code / Cursor / ChatGPT to live OmniMind via the agent configs in `docs/agent-configs/`. That's the Milestone E from the original Solo Go-Live prompt that's been waiting.

## If you want to extend after closeout

Pre-built follow-up prompts to consider writing later:
- **30-day dogfooding review prompt** — looks at audit log, identifies usage patterns, recommends Phase 7 priorities
- **Phase 7 prompt** — bitemporal validity, Letta core memory tier, Postgres RLS (when multi-user is on the horizon)
- **Ministry re-enable prompt** — when you have pastoral data flow ready (Ollama, encryption, scope grants)

But save those for after you've actually used the system for 30 days. Don't pre-optimize.
