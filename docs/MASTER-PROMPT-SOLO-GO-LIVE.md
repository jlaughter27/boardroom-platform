# Master Prompt — Solo Go-Live + Phase 5 Backlog

**Purpose:** Self-contained prompt to fix every remaining issue and ship the OmniMind-MCP memory layer to working production for **solo single-user testing**. Calibrated for Josh's actual constraints: he's the only user for now, API spend is capped at $5, ministry data is deferred, no team to coordinate with.

**Key calibration vs. earlier prompts:** No 48-hour soak windows. No staging gates. No multi-tenant complexity. Ministry domain is explicitly *disabled* (not built). Ship fast, iterate live, observe via the admin UI you already have.

**How to use:** Open a fresh Claude Code session at `/Users/Joshua/boardroom-platform`. Paste everything between the `--- BEGIN PROMPT ---` and `--- END PROMPT ---` markers. The agent must reply with the confirmation block before doing anything.

---

--- BEGIN PROMPT ---

# MISSION

The OmniMind-MCP memory layer (Phases 1–3 + Phase 4 hardening + 7-finding audit remediation) is shipped to `origin/main` as commit `f0d4cf1`. Your job:

1. **Triage** the repo's accumulated chaos (14 worktree branches, 2 stalled PRs, leaked `.env.deploy`, uncommitted prompt-loader changes, local 33+ commits behind origin)
2. **Deploy** what's built to Railway production
3. **Wire** Claude Desktop / Claude Code / Cursor / ChatGPT to live MCP
4. **Disable** the ministry-domain pipeline (deferred — Josh is solo, no pastoral data flow yet)
5. **Ship Phase 5 backlog** — importance decay, duplicate detection, admin duplicates tab
6. **Close out** with a working production system Josh can actually use today

**Operator profile:** Josh Laughter — solo founder. Single user. $5 API spend cap during testing. Direct, no fluff, system-level thinking. Treat 48-hour soak windows and warn-mode rollouts as ceremony, not safety. Ship and observe via `/admin`.

# YOUR IDENTITY

| Field | Value |
|---|---|
| Agent name | `claude-code-solo-golive` |
| Tenant | `josh-business` |
| Scopes | `memory:read,write` `decision:write` `task:write` `project:write` `commitment:write` `code:write` `admin:read,write` |
| `sourceWeight` | `1.0` |
| Boundary | You may push to `origin/main` (since Josh works solo and there's no other reviewer). You may rotate Railway env vars. You may NOT touch `domain: ministry` data — that path is being explicitly disabled, not migrated. |

# SOURCE OF TRUTH

Read these in this order. If any contradict each other, surface to Josh:

1. `docs/MEMORY-LAYER-DEV-PLAN.md` — original spec (v2)
2. `docs/STATUS/CURRENT-PHASE.md` — what shipped, what's next
3. `docs/audits/AUDIT-REPORT-2026-05-09.md` — the validation audit + 7 findings (already remediated in `f0d4cf1`)
4. `docs/POST-IMPLEMENTATION-REVIEW.md` — builder retrospective
5. `docs/MEMORY-PROTOCOL.md` — agent read/write cadence
6. `docs/agent-configs/` — per-agent MCP configs
7. `docs/runbooks/omnimind-mcp.md` and `docs/runbooks/backup-restore.md`
8. `packages/omnimind-api/prisma/schema.prisma` — current schema (post mcp_phase_1 + mcp_phase_4)
9. `packages/omnimind-mcp/` — existing MCP server code
10. `CLAUDE.md` — repo conventions

# INVIOLABLE RULES (calibrated for solo)

11 rules. The first 10 carry forward from prior prompts; rule 11 is solo-specific.

1. **No schema invention.** Every Prisma model you reference must exist in the current schema or be added by you in an explicit migration in the same commit.
2. **Branch first, then merge to main.** Use `feat/solo-golive-{slug}` branches. Squash-merge to main after self-review. Direct push to main is allowed *only* for trivial fixes <10 lines.
3. **One milestone at a time.** Don't start Milestone N+1 until Milestone N's gate criteria pass.
4. **No new dependencies without justification.** Same pre-rejected list: no mem0, langchain, crewai, letta, graphiti, zep, langgraph.
5. **Build must stay green.** `pnpm typecheck && pnpm test && pnpm build` before push.
6. **Use `prisma migrate deploy` in production**, `prisma migrate dev` locally. The production entrypoint already uses `migrate deploy` per F-005 fix.
7. **Server-side scope enforcement is mandatory.** Already shipped. Don't regress.
8. **Fact extractor + dedup is non-negotiable.** Already shipped. Don't disable.
9. **Ministry domain is DISABLED, not partially supported.** Per Milestone D below — the API explicitly refuses ministry writes with a clear "deferred" error. No half-built ministry path.
10. **No raw Prisma inserts for memory.** Use `memory.service.ts`.
11. **Solo-mode pragmatism.** No 48-hour soak windows. No warn-mode rollouts. No staging environments. Ship to prod, observe via `/admin`, fix forward. Josh has the only credentials and a $5 spend cap — the blast radius is bounded.

# EXECUTION PLAN

Six milestones. Run sequentially. **Single status report at the end** unless you hit a refuse trigger (then stop immediately). You may chain milestones automatically.

---

## MILESTONE A — Verify state + sync local (~30 min)

**Goal:** confirm origin/main is what we think it is and reconcile local.

```bash
cd /Users/Joshua/boardroom-platform

# A.1 — Origin state
git fetch origin main
git log origin/main --oneline -15
# Expected last 2: f0d4cf1 (Phase 4 hardening) + 2aec4a2 (PR #6 merge)
git rev-list --count origin/main
# Expected: 175

# A.2 — Local state
git status -sb
# Expected: behind 33+, ahead 1, with 3 modified files (.claude/CLAUDE.md, prompt-loader.ts, server/index.ts)

# A.3 — Verify omnimind-mcp shipped
ls packages/omnimind-mcp/src/tools/  # 7 .tool.ts files
ls packages/omnimind-mcp/src/transports/  # stdio.ts + http.ts
test -f docs/MEMORY-PROTOCOL.md && echo OK || echo MISSING
test -f docs/agent-configs/claude-code.json && echo OK || echo MISSING
test -f docs/runbooks/omnimind-mcp.md && echo OK || echo MISSING
ls packages/omnimind-api/prisma/migrations/  # mcp_phase_1 + mcp_phase_4 must be there
```

If any expectation fails — STOP and report. Do not assume.

**A.4 — Reconcile local with origin.** This is the trickiest step because of uncommitted changes.

```bash
# Stash uncommitted prompt-loader work (it's real, useful, but not part of MCP)
git stash push -u -m "solo-golive: prompt-loader includes + claude.md updates"

# Pull origin (fast-forward expected; if not, abort and report)
git pull --ff-only origin main

# Push your one ahead commit (the docs commit `2bae6d3`)
git push origin main

# Pop the stash
git stash pop

# Now diff — your prompt-loader work should be the only modification
git status
git diff --stat
```

If the `git stash pop` produces conflicts: stop. The MCP work and your prompt-loader work touch overlapping files. Report which files conflict. Don't auto-resolve.

If no conflicts: commit the prompt-loader work to a new branch:
```bash
git checkout -b feat/solo-golive-prompt-includes
git add .claude/CLAUDE.md packages/boardroom-ai/server/src/index.ts packages/boardroom-ai/server/src/lib/prompt-loader.ts
git commit -m "feat(prompt-loader): {{include:...}} token resolution + CLAUDE.md updates"
git push origin feat/solo-golive-prompt-includes
# Self-merge after milestone B's typecheck passes
```

**Gate criteria:**
- [ ] Local `main` is in sync with `origin/main`
- [ ] No uncommitted changes in `main` working tree
- [ ] Prompt-loader work captured on its own branch (not lost)

---

## MILESTONE B — Triage repo chaos (~1 hr)

**Goal:** delete dead branches, close stalled PRs, remove `.env.deploy` from tree.

### B.1 — Worktree-agent branches

There are 14 `worktree-agent-*` branches. Most have no unique commits worth keeping. Check each:

```bash
for branch in $(git branch -r | grep 'worktree-agent-' | tr -d ' '); do
  echo "=== $branch ==="
  git log origin/main..$branch --oneline 2>&1 | head -3
done
```

Then:
- For each branch with **0 unique commits** (or only commits already on main): mark for deletion.
- For each with unique commits: read them. Decide keep / cherry-pick / delete. Default to **delete** unless the commit is unambiguously valuable.

Delete in batch:
```bash
# Local
git branch -D <branch1> <branch2> ...

# Remote (only if you have any branches that exist as remote refs)
git push origin --delete <branch1> <branch2> ...
```

### B.2 — Stalled PRs

Two open PRs:
- **PR #1** — "29 validated fixes from adversarial code audit" (Apr 8, 5 task list, stalled 1 month)
- **PR #4** — "Phase D — consolidation and bucket migration" (May 1, draft)

Open each in the browser via `gh pr view 1 --web` and `gh pr view 4 --web`. Review the diff briefly. Then:

- If the changes are clearly superseded by what's now on main → **close** with a comment explaining why
- If they have real unique work → **convert to issue** with the PR description preserved, then close the PR
- If still merge-worthy → **rebase + merge** (low likelihood after a month)

Default action for both: **close + convert to issue if you found unique work**.

### B.3 — `.env.deploy` cleanup (low priority, not emergency)

Josh isn't worried about the leaked keys (capped at $5 spend, easy to rotate later). But the file shouldn't be in the repo going forward.

```bash
# Remove from tree
git rm -f .env.deploy

# Add to .gitignore so it can never be re-added
echo "" >> .gitignore
echo "# Never commit deploy secrets" >> .gitignore
echo ".env.deploy" >> .gitignore
echo ".env.production" >> .gitignore
echo ".env.local" >> .gitignore

git add .gitignore
git commit -m "security: remove .env.deploy from tree, gitignore deploy secrets"
git push origin main
```

**Defer history scrub** (`git filter-repo`) — not urgent given the spend cap. Add a TODO in `docs/STATUS/CURRENT-PHASE.md` to revisit when off the cap.

**Gate criteria:**
- [ ] All worktree-agent-* branches deleted (or explicitly preserved with rationale)
- [ ] PR #1 + PR #4 closed (or explicit decision documented)
- [ ] `.env.deploy` removed from working tree, gitignored
- [ ] Repo `git status` shows only intentional state

---

## MILESTONE C — Production deploy of what's built (~2 hrs)

**Goal:** ship the merged Phase 1–4 code to Railway prod and prove it works.

### C.1 — Rotate keys (good hygiene even with spend caps)

Even with $5 caps, generate fresh secrets so `.env.deploy`'s exposure ages out:

```bash
echo "OMNIMIND_API_KEY: $(openssl rand -hex 32)"
echo "ENCRYPTION_KEY:    $(openssl rand -hex 32)"
echo "JWT_SECRET:        $(openssl rand -hex 32)"
```

For `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` — Josh decides whether to rotate. If he's already at $5 caps and saw no spike, rotation is optional for now. **Ask Josh once before deciding** — this is the only place this prompt requires explicit approval.

### C.2 — Set Railway env vars

For both `boardroom-ai` and `omnimind-api` services on Railway, set / verify:

| Variable | Value |
|---|---|
| `OMNIMIND_API_KEY` | new value (set on both services, must match) |
| `JWT_SECRET` | new value (boardroom-ai only) |
| `ENCRYPTION_KEY` | new value (omnimind-api only) — used by AES-256-GCM, must be 32-byte hex |
| `ANTHROPIC_API_KEY` | existing or rotated |
| `OPENAI_API_KEY` | existing or rotated |
| `DIGEST_SCHEDULE` | `0 18 * * 5` (default — Friday 6pm, can leave unset) |
| `AGENT_RATE_READ` / `AGENT_RATE_WRITE` / `AGENT_RATE_DECISION` | leave unset (defaults: 1000 / 200 / 100) |
| `OMNIMIND_API_URL` | `https://omnimind-api-production.up.railway.app` (boardroom-ai only) |
| `DATABASE_URL` | auto-set by Railway Postgres plugin |

**Document via the Railway CLI** if available, or have Josh do this in the Railway UI and report back.

### C.3 — Deploy

Railway auto-deploys on push to main. Since Milestones A + B already pushed to main, the deploy should already be running. Watch it:

```bash
# Get logs from Railway CLI if available, or have Josh share dashboard
railway logs --service omnimind-api 2>&1 | tail -100  # if installed
railway logs --service boardroom-ai 2>&1 | tail -100
```

Watch specifically for:
- Successful Docker build (~60 sec each)
- Migration runs in `omnimind-api` startup (`prisma migrate deploy` should apply `mcp_phase_1` and `mcp_phase_4`)
- Cron jobs registered: session summarizer (10 min), weekly digest (Friday 6pm)
- Both services hit `/health` green

**If migration fails:** rollback via Railway "redeploy previous" button. Do not forward-fix in prod. Report and stop.

### C.4 — Smoke test prod

```bash
# Health checks
curl -s https://boardroom-ai-production-1092.up.railway.app/health | jq
curl -s https://omnimind-api-production.up.railway.app/health | jq

# MCP smoke against prod (requires keys from C.1 in env)
export OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app
export OMNIMIND_API_KEY=<the new value>
node packages/omnimind-mcp/dist/index.js smoke 2>&1 | tail -30
# Expected: "15 tools registered ✅"
```

**Gate criteria:**
- [ ] Both services healthy on Railway
- [ ] `mcp_phase_1` and `mcp_phase_4` migrations applied (verify via `psql $DATABASE_URL -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5"`)
- [ ] MCP smoke test passes against prod
- [ ] Session summarizer + weekly digest cron jobs visible in startup logs

---

## MILESTONE D — Disable ministry domain (~30 min)

**Goal:** explicitly turn off the ministry path. Josh isn't using it. A half-built path is worse than none.

### D.1 — API-level refusal

In `packages/omnimind-api/src/services/memory.service.ts`, at the top of `createMemory`:

```typescript
if (input.domain === 'ministry') {
  throw new HttpError(503, {
    code: 'MINISTRY_DEFERRED',
    message:
      'Ministry-domain memories are deferred. Single-user testing mode. ' +
      'Re-enable via Phase 6 (Ollama + encryption rollout) when ready.',
  });
}
```

Same refusal in `updateMemory` and any path that could write `domain='ministry'`.

### D.2 — MCP tool guard

In `packages/omnimind-mcp/src/tools/memory.tool.ts`, on `memory_write`:
- If `input.domain === 'ministry'` → return `{ error: 'MINISTRY_DEFERRED', message: 'Use a non-ministry domain. Ministry path will return when needed.' }` before calling the API.

### D.3 — Schema enum guard (optional)

Don't remove `'ministry'` from any TypeScript enum or Zod schema — leave the type so it can come back later. Just refuse it at the boundary.

### D.4 — Update agent configs

In `docs/agent-configs/claude-desktop.json` and any other config that might emit ministry writes:
- Remove `tgfc-ministry` tenant if present
- Default tenant to `josh-personal`

### D.5 — Document the deferral

Add to `docs/STATUS/CURRENT-PHASE.md`:
```markdown
## Deferred (re-enable in Phase 6+)

- **Ministry domain** — API and MCP tool refuse with `MINISTRY_DEFERRED`.
  Re-enable when: (a) Ollama running on Railway or local-only writes confirmed,
  (b) ministry encryption tested end-to-end, (c) at least one non-Josh user
  has pastoral interactions worth memorializing.
```

Add a tiny test in `tests/audit/D7-ministry-disabled.test.ts`:
```typescript
it('refuses ministry-domain writes with 503 MINISTRY_DEFERRED', async () => {
  const res = await client.post('/memories', {
    title: 'test', content: 'test', domain: 'ministry', userId: TEST_USER_ID,
  });
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('MINISTRY_DEFERRED');
});
```

**Gate criteria:**
- [ ] Ministry write returns `503 MINISTRY_DEFERRED` from both API and MCP
- [ ] Test passes
- [ ] Deferral documented in CURRENT-PHASE.md
- [ ] Agent configs no longer reference `tgfc-ministry` tenant

---

## MILESTONE E — Wire agents to prod + dogfood (~1 hr)

**Goal:** all four of Josh's agents talk to live OmniMind-MCP.

### E.1 — Generate prod agent keys

```bash
# Against prod URL
export OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app
export OMNIMIND_API_KEY=<from C.2>

bash docs/agent-configs/keygen-commands.sh
```

Expected output: 6 agent keys (claude-desktop, claude-code, cursor, chatgpt, boardroom-ai, cortex-summarizer). Print each ONCE. Have Josh paste into 1Password (or the system keychain).

If `keygen-commands.sh` doesn't exist, generate manually for each agent:
```bash
node packages/omnimind-mcp/dist/keygen.js \
  --agent claude-code-josh --tenant josh-business \
  --scopes 'memory:read,memory:write,decision:write,task:write,project:write,commitment:write' \
  --source-weight 1.0
```

Per the role-based scope matrix from `MEMORY-LAYER-DEV-PLAN.md` §Phase 2:
- `claude-code-josh` — full write, sourceWeight 1.0
- `claude-desktop-josh` — mid-stakes write (memory, context, preference, person), sourceWeight 0.85
- `cursor-josh` — read-only, sourceWeight 0.7
- `chatgpt-desktop-josh` — read-only, sourceWeight 0.6
- `boardroom-ai` — full write, sourceWeight 1.0
- `cortex-summarizer` — `memory:write` (background), sourceWeight 0.8

### E.2 — Update local agent config files

For each of the 4 user agents, rewrite `docs/agent-configs/<agent>.json` to:
- `OMNIMIND_API_URL`: production URL
- `OMNIMIND_MCP_API_KEY`: the key from E.1
- `OMNIMIND_MCP_TENANT_ID`: `josh-business` for Code + Cursor, `josh-personal` for Desktop + ChatGPT
- `OMNIMIND_MCP_AGENT_NAME`: as above

### E.3 — Wire each agent (Josh-driven, you document)

Don't auto-install configs into client apps. **Print precise step-by-step instructions** for each agent for Josh to paste:

- **Claude Desktop:** path to `claude_desktop_config.json`, the JSON snippet to merge
- **Claude Code:** `~/.claude/mcp.json` instructions
- **Cursor:** `~/.cursor/mcp.json` instructions
- **ChatGPT desktop:** HTTP transport setup via Connectors UI

### E.4 — Smoke each agent

Walk Josh through `docs/agent-configs/SMOKE-TESTS.md` for each. Document pass/fail per tier.

### E.5 — Begin dogfooding

Once at least 2 agents are live + smoking green, **start using the system on this very work**:

```typescript
// First memory write (do this from Claude Code, where you are)
memory_write({
  content: 'Solo go-live deploy completed. Production URL: ...',
  type: 'status',
  project: 'omnimind-mcp',
  domain: 'business',  // NOT ministry
  importance: 0.7,
});

// Decision log
decision_log({
  title: 'Defer ministry domain to Phase 6+',
  rationale: 'Solo testing mode; no pastoral data flow yet. Half-built ministry path is worse than none.',
  project: 'omnimind-mcp',
});
```

**Gate criteria:**
- [ ] At least 4 agents have keys against prod
- [ ] Configs for all 4 agents printed for Josh to install
- [ ] At least 1 agent dogfooding live (memory_write + memory_search round-trip in production)
- [ ] `/admin/audit` shows the writes

---

## MILESTONE F — Phase 5 backlog (~3-4 hrs)

**Goal:** ship the 3 next-up items from `docs/STATUS/CURRENT-PHASE.md` "Next actions". Skip the ones that don't matter for solo.

### F.1 — Importance decay job (~1 hr)

Per CURRENT-PHASE: "weekly cron, drop importance 0.05/week for unaccessed memories".

`packages/omnimind-api/src/services/importance-decay.service.ts`:
```typescript
// Decay rule: for memories not accessed in last 7 days, drop importance by 0.05
// Floor at 0.0. Memories at 0.0 already drop out of default search via forgetting curve.
export async function runImportanceDecay() {
  const cutoff = new Date(Date.now() - 7 * 86400 * 1000);
  const result = await prisma.$executeRaw`
    UPDATE "memory_entries"
    SET importance = GREATEST(importance - 0.05, 0.0),
        updated_at = NOW()
    WHERE last_accessed_at IS NULL
       OR last_accessed_at < ${cutoff}
    AND importance > 0.0
    AND deleted_at IS NULL
  `;
  return { decayed: result };
}
```

`packages/omnimind-api/src/jobs/importance-decay-scheduler.ts`:
```typescript
// Cron: weekly at Sunday 2am
export function startImportanceDecayScheduler() {
  return cron.schedule('0 2 * * 0', async () => {
    const result = await runImportanceDecay();
    log.info({ result }, 'Importance decay run complete');
  });
}
```

Wire into `index.ts` startup/shutdown alongside the other crons.

Test: insert a memory with `importance: 0.6, lastAccessedAt: 14 days ago`, run job, assert `importance: 0.55`. Run again, assert `0.50`. Run 12 times, assert `0.0` floor.

### F.2 — Duplicate detection pipeline on write (~1.5 hrs)

Per CURRENT-PHASE: "on write, cosine check; auto-supersede if >0.92".

This already exists in concept (the fact extractor uses 0.85 dedup threshold), but make it explicit at the memory.service.ts layer for ALL writes (not just MCP fact extractor):

`packages/omnimind-api/src/services/memory.service.ts` — modify `createMemory`:
```typescript
export async function createMemory(input: CreateMemoryInput) {
  // ... existing validation ...

  // 1. Generate embedding first (so we can check for duplicates)
  const embedding = await generateEmbeddingWithRetry(
    `${input.title} ${input.content}`,
    input.domain
  );
  if (embedding === null) {
    throw new HttpError(503, { code: 'EMBEDDING_FAILED', message: 'Could not generate embedding' });
  }

  // 2. Cosine check against existing memories for this user (DUPLICATE_THRESHOLD = 0.92)
  const candidates = await searchSimilar({
    embedding,
    userId: input.userId,
    tenantId: input.tenantId,
    threshold: 0.92,
    limit: 1,
  });

  if (candidates.length > 0) {
    // Auto-supersede the existing memory
    const existing = candidates[0];
    return await updateMemory({
      id: existing.id,
      title: input.title,
      content: input.content,
      // bump version, set supersededBy in audit log
      version: existing.version + 1,
      // ... merge tags, importance, etc. — take max ...
    });
  }

  // 3. No near-duplicate — proceed with normal create
  // ... existing create logic ...
}
```

Test: write memory A. Write memory A' (paraphrase, ~0.94 cosine). Assert A' becomes a new version of A, not a separate memory.

### F.3 — `/admin/duplicates` endpoint + UI tab (~1 hr)

`packages/omnimind-api/src/routes/admin.routes.ts` — add:
```typescript
// GET /admin/duplicates — list memory pairs with cosine > threshold (default 0.85)
adminRouter.get('/duplicates', async (req, res) => {
  const threshold = parseFloat(req.query.threshold as string) ?? 0.85;
  const pairs = await prisma.$queryRaw<DuplicatePair[]>`
    SELECT a.id AS a_id, a.title AS a_title, a.created_at AS a_created,
           b.id AS b_id, b.title AS b_title, b.created_at AS b_created,
           1 - (a.embedding <=> b.embedding) AS cosine
    FROM "memory_entries" a
    JOIN "memory_entries" b
      ON a.id < b.id
      AND a.user_id = b.user_id
      AND a.deleted_at IS NULL AND b.deleted_at IS NULL
    WHERE 1 - (a.embedding <=> b.embedding) > ${threshold}
    ORDER BY cosine DESC
    LIMIT 100
  `;
  res.json({ pairs });
});

// POST /admin/duplicates/merge — merge two memories (newer supersedes older, keep both linked)
adminRouter.post('/duplicates/merge', async (req, res) => {
  // ... merge logic ...
});
```

In `packages/boardroom-ai/client/src/pages/AdminPage.tsx`:
- Add 6th tab: "Duplicates"
- Pair list: show A vs B side by side, cosine score, "merge" button
- Merge button: calls `/admin/duplicates/merge` with both IDs

### F.4 — Skipped from CURRENT-PHASE.md "Next actions" (with rationale)

| Skipped item | Reason |
|---|---|
| Digest charts (sparklines) on AdminPage | Nice-to-have. The audit log + memory tab already give visibility. Revisit when there's enough data to make charts meaningful (>30 days). |
| Railway private networking | Latency optimization. Not a blocker. Public domain works. Revisit when latency is measurable. |
| Redis-backed rate limiting | Only matters with >1 Railway instance. Solo = always 1 instance. |

Document these as "deferred" in `docs/STATUS/CURRENT-PHASE.md`, not as TODOs.

**Gate criteria:**
- [ ] Importance decay job ships, tested, scheduled
- [ ] Duplicate detection on write produces zero new memories for paraphrases at >0.92 cosine
- [ ] `/admin/duplicates` UI tab live and functional
- [ ] Skipped items documented with rationale, not as latent debt

---

## MILESTONE G — Closeout (~30 min)

**Goal:** verify, document, hand off.

### G.1 — Full test suite

```bash
pnpm typecheck
pnpm test
pnpm build
node packages/omnimind-mcp/dist/index.js smoke
```

All green or stop and report.

### G.2 — Production smoke

Final round-trip:
1. From Claude Code, write a memory: `memory_write({ content: 'Solo go-live shipped', type: 'status', project: 'omnimind-mcp' })`
2. Wait 2 minutes
3. From Cursor (read-only), search: `memory_search({ query: 'solo go-live' })`
4. Expect: the memory appears, attributed to `claude-code-josh`
5. Check `/admin/audit` — both calls logged with correct agent IDs

### G.3 — Update docs

`docs/STATUS/CURRENT-PHASE.md`:
- Mark Phases 1–5 complete
- Document the deferred ministry path
- Document deferred Phase 5 items (charts, private networking, Redis)
- Define "next phase" — likely a Phase 6 focused on real-usage observations after 30 days of dogfooding

`docs/POST-IMPLEMENTATION-REVIEW.md`:
- Append a "Solo go-live observations" section
- What surprised you during deploy
- What's noticeably missing now that it's live
- What was over-engineered

`CHANGELOG.md` (create if missing):
- Entry: `v3.0.0-solo` — OmniMind-MCP live single-user

### G.4 — Status report (use the format in §REPORTING)

Post the report in chat. Wait for Josh's "done" or follow-ups.

**Gate criteria:**
- [ ] All tests + build green
- [ ] Production round-trip verified
- [ ] CURRENT-PHASE + POST-IMPLEMENTATION-REVIEW + CHANGELOG updated
- [ ] Status report posted

---

# GOVERNANCE

## Schema changes
- Use `prisma migrate dev` locally, `migrate deploy` runs in entrypoint on prod
- Every migration documented in commit message + ADR if it touches existing models
- No `db push` (already fixed by F-005)

## Dependencies
Same pre-rejected list. Solo doesn't change this.

## PR / branch
- Use `feat/solo-golive-{slug}` branches for non-trivial work
- Direct push to main allowed for trivial fixes (<10 lines, no migration, no schema)
- Squash-merge to main, delete branch after

## Commits
- One concept per commit
- Conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`, `security:`)
- Reference milestone in body when relevant

# REFUSE PROTOCOL

Stop and ask Josh — do not proceed — when:

1. The Milestone A reconciliation produces git conflicts you can't safely auto-resolve
2. A worktree branch in Milestone B has unique commits that look genuinely valuable (don't just delete; report and ask)
3. The Railway deploy in Milestone C fails the migration step (rollback, then ask)
4. Josh's `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` rotation question — explicit yes/no needed once
5. Any Milestone F change would alter retrieval semantics (sourceWeight ranking, dedup threshold, etc.) in a way not specified
6. You discover a `.env*` file with secrets you didn't know about (beyond `.env.deploy`)
7. The MCP smoke test fails in production — do not forward-fix; rollback and ask
8. You find a forbidden dependency was added
9. You'd need to add a new env var that touches Anthropic / OpenAI billing in a non-obvious way (Josh has $5 caps — protect them)

Refusal format:
```
🛑 BLOCKED — <one-line reason>

Context: <2-3 sentences>
Plan reference: <citation>
What I need from Josh: <specific question>

Will resume on your decision.
```

# REPORTING PROTOCOL — single end-of-execution report

```markdown
# Solo Go-Live Status — <date>

## Milestones
- ✅ A — Verify + sync
- ✅ B — Triage chaos
- ✅ C — Production deploy
- ✅ D — Ministry disabled
- ✅ E — Agents wired
- ✅ F — Phase 5 backlog (decay, dedup, duplicates UI)
- ✅ G — Closeout

## Production state
- omnimind-api: <green/red, last deploy time, migration applied>
- boardroom-ai: <green/red, last deploy time>
- Cron jobs: <session summarizer, weekly digest, importance decay — running/not>
- Agents live: <count + names>

## What's working end-to-end
<2-3 verified flows with evidence — agent IDs, audit log entries, etc.>

## Test results
- typecheck: <green/red>
- pnpm test: <X/Y passing>
- MCP smoke: <pass/fail>
- Production round-trip: <pass/fail>

## What changed
- Branches deleted: <count>
- PRs closed: <numbers>
- Files removed from tree: <list>
- New routes / services / jobs: <list>

## Deferred (with rationale)
- Ministry domain — disabled at API level. Re-enable in Phase 6.
- Digest charts — not enough data yet
- Railway private networking — latency optimization, not blocker
- Redis rate limiting — solo = 1 instance
- .env.deploy git history scrub — low priority given $5 cap

## Anomalies
<anything Josh should know>

## Next session prerequisites
<what Josh needs to do before next phase>
```

# EAT YOUR OWN DOGFOOD

Once Milestone E completes, every decision in Milestone F goes through `decision_log`. Every status change through `task_upsert`. End-of-session: `memory_write` summary so the next agent can resume.

You're testing the system by using it.

# KILL SWITCH

Engage if:
- Production goes down due to your change
- Migration produces unrecoverable schema state
- Spend cap exceeded ($5) — would mean a runaway loop or compromised key
- You find prior work has a CRITICAL flaw (data loss, auth bypass)
- A cron job or job spawns sub-agents you can't account for

Format:
```
🛑 KILL SWITCH ENGAGED — <trigger>

Production state: <healthy/degraded/down>
Data integrity: <intact/unknown/compromised>
What I did: <stopped processes / rolled back>
What I need from Josh: <decision>
```

Do not attempt recovery without explicit instruction.

---

# CONFIRMATION REQUIRED

Before doing anything, reply with:

1. The path to the dev plan you're executing
2. Your agent identity (name, tenant, scopes, sourceWeight, boundary)
3. The current branch you're on
4. The 11 inviolable rules, in order, in your own words (1 line each)
5. Confirmation that you will NOT touch `domain: ministry` and will refuse it at the API
6. Your first action under Milestone A

Then begin Milestone A. Chain through G unless a refuse trigger fires. Single status report at the end.

--- END PROMPT ---

---

# Usage notes (for Josh)

## Where to paste
Fresh Claude Code session at `/Users/Joshua/boardroom-platform`. Don't continue from any prior session — this prompt expects a clean context that re-verifies state.

## Time estimate
- Milestone A — 30 min
- Milestone B — 1 hr
- Milestone C — 2 hrs
- Milestone D — 30 min
- Milestone E — 1 hr (mostly your wall-clock, the agent waits)
- Milestone F — 3-4 hrs
- Milestone G — 30 min

**Total: ~8-9 hours of focused agent work.** Realistically a Saturday or two evenings.

## What's intentionally NOT in this prompt
- Multi-tenant tooling beyond what's already shipped (you're solo)
- Ministry path (deferred — explicitly disabled)
- Ollama in production (skipped because no ministry)
- Encryption rollout ceremony (already shipped, no migration needed since no existing ministry data)
- 48-hour soak windows (you're solo, your blast radius is yourself)
- Warn-mode rate limiting (you'll see it in admin logs immediately)
- Redis-backed anything (solo = 1 instance)
- A separate "remediation prompt" — Milestones B + D handle the cleanup directly

## Calibration knobs
- **If you DO want to rotate Anthropic + OpenAI keys:** answer yes when asked in C.1, takes 5 extra min
- **If you DO want to scrub `.env.deploy` from git history right now:** add a step to Milestone B saying "run `git filter-repo --path .env.deploy --invert-paths --force` after the working-tree removal." Otherwise it stays as a known-deferred item.
- **If you want the agent to STOP between milestones for review:** find "You may chain milestones automatically" and replace with "Wait for Josh's go between each milestone." Defaults to chained because solo + bounded blast radius.

## After this prompt completes
You should have:
1. Working production OmniMind-MCP with 4 agents wired in
2. Importance decay + duplicate detection live
3. /admin/duplicates UI tab
4. Ministry path explicitly closed
5. Clean repo (no worktree branches, closed PRs, .env.deploy gone from tree)
6. Documented deferrals so future-you doesn't re-ask "what's next"

If anything in Phase 5 surprises you (e.g., dedup is too aggressive, importance decay drops important things), iterate. The system is yours; it's bounded; the cost is your time, not money.

Want a follow-up prompt for "30 days of dogfooding observations → Phase 6 plan"? That's the natural next artifact when you've used it for a month.
