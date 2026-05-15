# Master Orchestration Prompt — OmniMind-MCP Memory Layer

**Purpose:** A single comprehensive prompt Josh hands to Claude Code (or any equivalent execution agent) to build the cross-agent memory layer described in `docs/MEMORY-LAYER-DEV-PLAN.md`. Built with explicit guardrails to prevent the failure modes already observed in this repo (Mem0 quarantine, 14 unmerged worktree branches, stalled PRs, schema invention).

**How to use:** Paste the entire prompt below (everything inside the `--- BEGIN PROMPT ---` to `--- END PROMPT ---` markers) into a fresh Claude Code session at the root of `/Users/Joshua/boardroom-platform`. Or hand it to any agent capable of multi-phase code execution.

---

--- BEGIN PROMPT ---

# MISSION

You are executing the dev plan at `docs/MEMORY-LAYER-DEV-PLAN.md` — a cross-agent memory layer (OmniMind-MCP) on top of the existing OmniMind API in this monorepo. The end state: external agents (Claude Desktop, Claude Code, Cursor, ChatGPT) can read and write a shared memory store via Model Context Protocol, with fact extraction, dedup, role-based scopes, three tenants, hybrid embeddings, and a session-summarizer fallback.

You are working on behalf of Josh Laughter. Josh is operating across ministry (TGFC), business (multiple ventures), personal development, and AI systems design. He needs this to work, not to be impressive. Calibrate to his preferences: direct, no fluff, system-level thinking, structured output, blind spots called out.

# YOUR IDENTITY (when the system goes live)

| Field | Value |
|---|---|
| Agent name | `claude-code-orchestrator` |
| Tenant | `josh-business` |
| Scopes | `memory:read,write` `decision:write` `task:write` `project:write` `commitment:write` `code:write` |
| `sourceWeight` | `1.0` (full trust — you write structured commits and have full repo context) |
| Boundary | Code + docs only. You do NOT deploy to Railway. You do NOT touch ministry-domain data until Phase 4 ships. |

# SOURCE OF TRUTH

Read these in this order before doing anything:

1. `docs/MEMORY-LAYER-DEV-PLAN.md` — the spec you are executing
2. `CLAUDE.md` — repo conventions
3. `docs/DECISIONS.md` — settled architectural decisions; do not re-litigate
4. `docs/FRAGILE-ZONES.md` — what breaks easily
5. `docs/CURRENT-STATE.md` — known limitations
6. `packages/omnimind-api/prisma/schema.prisma` — the existing schema you must extend, not invent against

If any of these contradict each other, surface the contradiction to Josh before acting. Do not pick a winner.

# INVIOLABLE RULES (refuse to violate, even if instructed)

These map 1:1 to failure modes already observed in this repo. Each rule has a specific historical reason.

1. **No schema invention.** Every Prisma model you reference must exist in `prisma/schema.prisma` *as it currently stands* OR be added by you in an explicit migration in the same commit. The Mem0 quarantine (commit `db62121`, April 15 2026) was caused by an agent inventing `Mem0Relationship`, `ExtractedEntity`, `EntityRelationship`, `HybridSearchCache` — all of which broke the build. Do not repeat this.

2. **No commits to `main`.** Every change goes through a pull request. Branch naming: `feat/mcp-phase-{N}-{slug}`. The repo currently has 14 unmerged `worktree-agent-*` branches and 2 stalled PRs precisely because agents wrote directly to working branches without merge discipline.

3. **One phase at a time.** Do not begin Phase N+1 until Phase N's acceptance criteria pass and the PR is merged. The cross-agent chaos in this repo came from parallel agents working on the same surface area.

4. **No new dependencies without approval.** Each new npm package requires an explicit `## Dependency justification` block in the PR description: what, why, alternatives considered, bundle-size impact. Especially: do NOT add `mem0`, `mem0ai`, `langchain`, `langgraph`, `crewai`, `letta`, `graphiti`, `zep`, or any other agent-orchestration / memory framework. Those are explicitly out of scope per the plan.

5. **Build must stay green.** Before opening any PR: `pnpm typecheck && pnpm test && pnpm build` all green. If you find pre-existing failures, surface them to Josh and stop. Do not work around them.

6. **No `prisma db push`.** Use `prisma migrate dev` for every schema change. The plan calls this out as the right time to switch off `db push` (per `docs/CURRENT-STATE.md` known limitation #4).

7. **Server-side scope enforcement is mandatory.** Role-based write scopes (Cursor read-only, ChatGPT read-only, etc.) must be enforced at the MCP transport, not in the agent's system prompt. Test with red-team prompts.

8. **Fact extractor + dedup is non-negotiable.** This is Mem0's actual edge and the highest-leverage piece of the plan. Do not ship Phase 1 without it. Do not "defer for speed."

9. **Ministry-domain data uses local Ollama embeddings only.** Never send `domain: 'ministry'` content to OpenAI's embedding API. If Ollama is unavailable, refuse the write with a clear error.

10. **No raw Prisma inserts for memory.** Every memory write goes through the validation pipeline (`packages/omnimind-api/src/memory/validation/pipeline.ts`) AND the new fact extractor.

# EXECUTION PLAN

You will execute four phases sequentially. **Each phase ends with a status report (format in §REPORTING).** Wait for Josh's "go" before starting the next phase unless he has pre-approved chained execution.

## PHASE 0 — Triage (DO THIS FIRST, ~1–2 hrs)

**Goal:** clean foundation before adding any code.

Execute in this order. Stop and report after each step if you hit anything ambiguous.

```bash
cd /Users/Joshua/boardroom-platform

# 0.1 Sync local with remote
git fetch origin
git status
# If working tree is dirty, stop and report. Do not auto-stash.

# 0.2 Pull the 33 commits ahead on origin/main
git checkout main
git pull origin main
git push origin main  # push your one local-only commit (`2bae6d3` per audit)

# 0.3 Inventory the 14 worktree-agent-* branches
git branch -v | grep worktree-agent | tee /tmp/worktree-inventory.txt

# For each: git log --oneline main..<branch> to see unique commits.
# Recommend keep/kill to Josh in your status report. DO NOT delete without approval.

# 0.4 Identify the 2 stalled PRs
# PR #1 — "29 validated fixes from adversarial code audit" (Apr 8, 5 tasks)
# PR #4 — "Phase D — consolidation and bucket migration" (May 1, draft)
# In your status report: recommend merge / close / convert-to-issues for each.

# 0.5 Audit the windsurf folder
ls -la "/Users/Joshua/windsurf boradroom test/" 2>&1
# In your report: which commits there are NOT on origin/main? Recommend cherry-pick / archive.
```

**Phase 0 acceptance criteria:**
- [ ] Local main and origin/main are in sync.
- [ ] Status report includes: keep/kill recommendation for each `worktree-agent-*` branch.
- [ ] Status report includes: merge/close recommendation for PR #1 and PR #4.
- [ ] Status report includes: cherry-pick list from windsurf folder OR explicit "nothing worth porting" claim with evidence.

**Stop. Report. Wait for Josh's decisions before Phase 1.**

---

## PHASE 1 — MCP Wrapper + Fact Extractor (~40 hrs)

**Goal:** ship the core memory layer. Highest-leverage phase.

Branch: `feat/mcp-phase-1-core`

### 1.1 — Schema migration (~3 hrs)

Add to `packages/omnimind-api/prisma/schema.prisma`:

```prisma
// Extend existing MemoryEntry
model MemoryEntry {
  // ... existing fields ...
  agentId        String?       @map("agent_id")
  tenantId       String        @default("josh-personal") @map("tenant_id")
  embeddingModel String        @default("openai-text-embedding-3-small") @map("embedding_model")

  @@index([tenantId, deletedAt])
  @@index([agentId, createdAt])
}

model Tenant {
  id        String   @id
  name      String
  createdAt DateTime @default(now())
}

model Agent {
  id           String    @id @default(cuid())
  name         String    @unique
  apiKeyHash   String    @map("api_key_hash")
  tenantId     String    @map("tenant_id")
  scopes       String[]
  sourceWeight Float     @default(1.0) @map("source_weight")
  createdAt    DateTime  @default(now())
  lastSeenAt   DateTime? @map("last_seen_at")

  @@index([tenantId])
}

model McpAuditLog {
  id           String   @id @default(cuid())
  agentId      String   @map("agent_id")
  tenantId     String   @map("tenant_id")
  toolName     String   @map("tool_name")
  inputJson    Json     @map("input_json")
  outputJson   Json?    @map("output_json")
  errorMessage String?  @map("error_message")
  durationMs   Int      @map("duration_ms")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([agentId, createdAt])
  @@index([tenantId, createdAt])
}
```

Run: `cd packages/omnimind-api && pnpm exec prisma migrate dev --name mcp_phase_1`

Seed three tenants in a separate `prisma/seed.ts` migration:
```typescript
await prisma.tenant.createMany({
  data: [
    { id: 'josh-personal',   name: 'Josh Personal' },
    { id: 'josh-business',   name: 'Josh Business (umbrella)' },
    { id: 'tgfc-ministry',   name: 'TGFC Ministry' },
  ],
  skipDuplicates: true,
});
```

### 1.2 — Hybrid embedding service (~4 hrs)

Modify `packages/omnimind-api/src/services/embedding.service.ts`:

```typescript
async function embed(text: string, domain: string): Promise<{ vector: number[], model: string }> {
  if (domain === 'ministry') {
    const vector = await ollamaEmbed(text, 'bge-base-en-v1.5');  // 768-dim
    return { vector: padTo1536(vector), model: 'ollama-bge-base-en-v1.5' };
  }
  const vector = await openaiEmbed(text, 'text-embedding-3-small');  // 1536-dim
  return { vector, model: 'openai-text-embedding-3-small' };
}
```

Pad ministry vectors to 1536 with zeros for now (cheaper than separate column). Document this decision in `docs/DECISIONS.md`.

Test: write a `domain: ministry` memory with Ollama down → returns clean error, does not fall back to OpenAI.

### 1.3 — Scaffold `packages/omnimind-mcp/` (~6 hrs)

File structure exactly as specified in `MEMORY-LAYER-DEV-PLAN.md` §4. Stub all files with TODO comments before implementing.

```
packages/omnimind-mcp/
├── package.json           ← deps: @modelcontextprotocol/sdk, zod, undici (HTTP client)
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── transports/{stdio,http}.ts
│   ├── tools/{memory,decision,task,project,person,commitment,status}.tool.ts
│   ├── lib/{client,auth,namespace,audit,fact-extractor}.ts
│   ├── schemas/*.schema.ts
│   └── types.ts
└── tests/
```

Add to `pnpm-workspace.yaml`. Add to `turbo.json`.

### 1.4 — Fact extractor + dedup pipeline (~3 hrs) — **HIGHEST LEVERAGE**

In `packages/omnimind-mcp/src/lib/fact-extractor.ts`:

```typescript
const FACT_EXTRACTION_PROMPT = `
You are a fact extractor for an agent memory system. Given input text,
return a JSON array of atomic facts. Each fact is one self-contained
claim. Examples:

Input: "Josh decided to use Postgres for the memory layer because it
already has pgvector and the team knows it."
Output: [
  {"text": "Memory layer storage is Postgres", "type": "decision"},
  {"text": "Decision rationale: existing pgvector + team familiarity", "type": "context"}
]

Rules:
- Atomic. One claim per fact.
- Self-contained. No pronoun ambiguity.
- Type: decision | blocker | status | context | preference
- Empty array if input has no extractable facts.
`;

export async function extractAndDedup(
  content: string,
  ctx: Context
): Promise<FactWithAction[]> {
  const facts = await haiku.extract(content, FACT_EXTRACTION_PROMPT);
  const results: FactWithAction[] = [];
  for (const fact of facts) {
    const hits = await ctx.client.searchMemories({
      query: fact.text,
      tenantId: ctx.agent.tenantId,
      limit: 1,
      similarityThreshold: 0.85,
    });
    if (hits.length > 0) {
      results.push({ ...fact, supersedes: hits[0].id, action: 'update' });
    } else {
      results.push({ ...fact, action: 'create' });
    }
  }
  return results;
}
```

This is non-negotiable. If you find yourself wanting to skip it for speed, **stop and ask Josh.**

### 1.5 — Implement core MCP tools (~12 hrs)

In order of priority (build + test each before moving to next):
1. `memory_write` (uses fact extractor)
2. `memory_search`
3. `memory_supersede`
4. `decision_log`
5. `task_upsert` / `task_status` / `task_list` / `task_complete` / `task_block`
6. `project_status` / `project_summary`
7. `person_get`
8. `commitment_log` / `commitment_list`
9. `status_get` (composite)

Each tool:
- Zod schema for input
- Server-side scope check (fail fast with `SCOPE_DENIED`)
- Tenant injection from agent context
- Audit log entry on every call (success or failure)
- 3+ vitest tests (happy path, scope denial, validation error)

### 1.6 — Modifications to existing OmniMind (~2 hrs)

`packages/omnimind-api/src/retrieval/ranker.ts` — multiply final score by `sourceWeight`:
```typescript
score = (semantic * 0.6 + fts * 0.3 + trigram * 0.1) * memory.sourceWeight;
```

`packages/omnimind-api/src/retrieval/structured-filter.ts` — forgetting curve in default search:
```typescript
const archiveCutoff = new Date(Date.now() - 90 * 86400 * 1000);
where.AND.push({
  OR: [
    { importance: { gte: 0.4 } },
    { lastAccessedAt: { gte: archiveCutoff } },
  ],
});
// Override via `?includeArchived=true` query param
```

Tests: existing retrieval tests must still pass. Add new tests for sourceWeight ranking and forgetting curve.

### 1.7 — Transports (~6 hrs)

`src/transports/stdio.ts` — for Claude Desktop, Claude Code, Cursor (child process).
`src/transports/http.ts` — `StreamableHttpServerTransport` on port 3334 for ChatGPT desktop and remote agents.

Both must:
- Authenticate via `OMNIMIND_MCP_API_KEY` env var (timing-safe compare against hashed key).
- Read `OMNIMIND_MCP_AGENT_NAME` and `OMNIMIND_MCP_TENANT_ID` from env.
- Refuse to start if any required env var is missing (`process.exit(1)`).

### 1.8 — `keygen` CLI (~2 hrs)

```bash
pnpm omnimind-mcp keygen --agent claude-desktop-josh \
  --tenant josh-personal \
  --scopes 'memory:read,memory:write,context:write,preference:write,person:write' \
  --source-weight 0.85
```

Outputs: an API key (printed once, hashed in DB). Stores agent record in `Agent` table.

### 1.9 — Tests + smoke harness (~3 hrs)

Minimum 40 vitest tests. Plus a smoke script:
```bash
pnpm omnimind-mcp smoke
```
That spins up the stdio server, lists tools, calls `memory_write` and `memory_search`, asserts round-trip.

### 1.10 — PR + acceptance criteria

Open PR with title: `feat(mcp): Phase 1 — OmniMind-MCP core (memory, decisions, tasks) + fact extractor + dedup`

PR description must include:
- [ ] `pnpm typecheck` green
- [ ] `pnpm test` green (40+ new tests)
- [ ] `pnpm build` green
- [ ] Round-trip smoke test passes
- [ ] Fact extractor verified — duplicate writes produce 0 new memories
- [ ] `sourceWeight` verified in ranker
- [ ] Forgetting curve verified in default search
- [ ] Ministry embedding goes to Ollama (not OpenAI)
- [ ] All writes appear in `McpAuditLog`
- [ ] BoardRoom AI continues to work (no regression)
- [ ] `## Dependency justification` block for any new packages

**Stop. Report. Wait for Josh's review and merge before Phase 2.**

---

## PHASE 2 — Wire Agents (~10 hrs)

**Goal:** all four agents authenticate, list tools, and round-trip a memory.

Branch: `feat/mcp-phase-2-agents`

### 2.1 — Generate API keys (~30 min)

```bash
pnpm omnimind-mcp keygen --agent claude-desktop-josh   --tenant josh-personal --scopes 'memory:read,write context:write preference:write person:write' --source-weight 0.85
pnpm omnimind-mcp keygen --agent claude-code-josh      --tenant josh-business --scopes 'memory:read,write decision:write task:write project:write commitment:write' --source-weight 1.0
pnpm omnimind-mcp keygen --agent cursor-josh           --tenant josh-business --scopes 'memory:read' --source-weight 0.7
pnpm omnimind-mcp keygen --agent chatgpt-desktop-josh  --tenant josh-personal --scopes 'memory:read' --source-weight 0.6
pnpm omnimind-mcp keygen --agent boardroom-ai          --tenant josh-business --scopes '*' --source-weight 1.0
pnpm omnimind-mcp keygen --agent cortex-summarizer     --tenant josh-business --scopes 'memory:write' --source-weight 0.8
```

Print each key once. Store in 1Password / macOS keychain. Do NOT commit to repo.

### 2.2 — Write `MEMORY-PROTOCOL.md` (~2 hrs)

Use the exact text from `MEMORY-LAYER-DEV-PLAN.md` §5. Save to `docs/MEMORY-PROTOCOL.md`.

### 2.3 — Per-agent config snippets (~2 hrs)

Generate (do NOT auto-install):

`docs/agent-configs/claude-desktop.json`:
```json
{
  "mcpServers": {
    "omnimind": {
      "command": "node",
      "args": ["/Users/Joshua/boardroom-platform/packages/omnimind-mcp/dist/index.js"],
      "env": {
        "OMNIMIND_API_URL": "http://localhost:3333",
        "OMNIMIND_MCP_API_KEY": "<paste from 1Password>",
        "OMNIMIND_MCP_TENANT_ID": "josh-personal",
        "OMNIMIND_MCP_AGENT_NAME": "claude-desktop-josh"
      }
    }
  }
}
```

Same pattern for Claude Code, Cursor, ChatGPT (HTTP transport). Each saved to `docs/agent-configs/`.

### 2.4 — Update `CLAUDE.md` (~30 min)

Add the "Memory Layer" section per the plan. Reference `MEMORY-PROTOCOL.md`.

### 2.5 — Smoke tests (~5 hrs)

For each agent, document a manual smoke test in `docs/agent-configs/SMOKE-TESTS.md`:
- Start the agent
- Verify it lists OmniMind tools
- Write a test memory
- Read it from a different agent
- Confirm correct `agentId` in `McpAuditLog`
- Confirm scope enforcement (Cursor write attempt → `SCOPE_DENIED`)

### 2.6 — PR + acceptance criteria

PR title: `feat(mcp): Phase 2 — wire 4 agents with role-based scopes + memory protocol`

- [ ] All 6 agents have keys (4 user agents + boardroom-ai + cortex-summarizer)
- [ ] `MEMORY-PROTOCOL.md` committed
- [ ] Per-agent config files in `docs/agent-configs/`
- [ ] `CLAUDE.md` updated
- [ ] Manual smoke tests documented
- [ ] Cross-agent read verified (write from Claude Desktop, read from Cursor)
- [ ] Scope enforcement verified (Cursor write → 403)

**Stop. Report. Wait for Josh to actually use it for 1 week before Phase 3.** Real usage will surface tool description issues.

---

## PHASE 3 — Admin Viewer + Session Summarizer (~12 hrs)

Branch: `feat/mcp-phase-3-admin-summarizer`

### 3.1 — `/admin/memory` viewer in BoardRoom AI (~5 hrs)

Routes in `packages/boardroom-ai/server/src/routes/admin.routes.ts`:
- `GET /admin/memory`
- `GET /admin/memory/:id`
- `PATCH /admin/memory/:id`
- `DELETE /admin/memory/:id`
- `GET /admin/audit`
- `GET /admin/agents`
- `GET /admin/contradictions`

Frontend in `packages/boardroom-ai/client/src/pages/admin/`:
- `memory.tsx` — table + filter + detail drawer
- `audit.tsx` — paginated audit log
- `agents.tsx` — agent list with last-seen + write counts
- `contradictions.tsx` — pending alerts

JWT auth, single-user (Josh) gate.

### 3.2 — Session summarizer cortex job (~6 hrs)

`packages/omnimind-api/src/services/cortex-summarizer.service.ts`:
- Trigger: every 10 min via existing node-cron
- Find: sessions with no activity ≥5 min that haven't been summarized
- Summarize: Haiku call over transcript + explicit writes
- Extract: net-new facts (run through fact extractor for dedup)
- Write: as `cortex-summarizer` agent, `sourceWeight=0.8`, `sourceType=SESSION_SUMMARY`

Tests: feed a synthetic transcript, verify N facts extracted, verify dedup, verify audit log.

### 3.3 — Optional: Markdown export CLI (~1 hr)

```bash
pnpm omnimind export --tenant josh-business --format markdown --since 2026-01-01 --output ./snapshots/
```

### 3.4 — PR + acceptance criteria

- [ ] `/admin/memory` lists, filters, edits, deletes work
- [ ] Audit log viewer shows correct attribution
- [ ] Editing creates new version with `supersedes`
- [ ] Summarizer cron runs every 10 min without error
- [ ] Verified: 5-min conversation in Claude Desktop without explicit `memory_write` calls → 10 min later, facts appear with `sourceType=SESSION_SUMMARY`
- [ ] Cortex contradictions visible in `/admin/contradictions`

**Stop. Report. Inspect summarizer outputs for 1 week. If garbage, tighten prompt before Phase 4.**

---

## PHASE 4 — Hardening (~12 hrs)

Branch: `feat/mcp-phase-4-hardening`

### 4.1 — Encryption at rest for ministry (~5 hrs)
- Add `encryptedContent: Bytes?` to `MemoryEntry`
- AES-256-GCM, key from env or macOS keychain
- For `domain: ministry` writes: encrypt `content`, store ciphertext, leave `content` null
- Decrypt only when agent has `ministry:read` scope

### 4.2 — Per-agent rate limiting (~2 hrs)
- Move rate limiter to per-`agentId` keys
- Defaults: 1000 reads/hr, 200 writes/hr, 100 decision-writes/hr
- Background jobs bypass

### 4.3 — Observability (~3 hrs)
- Charts in `/admin/audit`: writes per agent, top projects, top queries, contradiction counts
- Friday 6pm digest email: "Here's what your agents wrote this week"

### 4.4 — Backup (~2 hrs)
- Nightly `pg_dump` to S3 / Backblaze (or Railway native backup)
- Monthly restore-to-scratch test
- Audit log retention: 1 year

### 4.5 — PR + acceptance criteria

- [ ] Pastoral memories stored as ciphertext (verified by SQL query)
- [ ] One agent rate-limit doesn't affect others
- [ ] Friday digest email arrives
- [ ] Backup tested by restoring to scratch DB

**Stop. Report. Final review.**

---

# GOVERNANCE

## Schema changes
Every Prisma migration requires:
- A migration name describing intent
- An entry in `docs/DECISIONS.md` if it touches existing models
- Tests covering the new fields
- No `db push`. Ever.

## Dependencies
Each new package in PR description:
```markdown
## Dependency justification
- Package: <name>
- Why: <reason>
- Alternatives considered: <list>
- Bundle impact: <KB added>
- License: <SPDX>
```

Pre-rejected:
- `mem0`, `mem0ai` — already quarantined in this repo
- `langchain`, `langgraph`, `langsmith` — out of scope per ADR-001
- `crewai`, `letta`, `letta-client` — out of scope
- `graphiti`, `getzep`, `zep-python` — out of scope
- Any "agent framework" claiming to do orchestration

## PR structure
Title: `feat(mcp): Phase {N} — {summary}`
Body must include:
- Linked dev plan section
- Acceptance criteria checklist
- Test results (`pnpm typecheck`, `pnpm test`, `pnpm build` outputs)
- Dependency justifications (if any)
- Schema migration notes (if any)
- Breaking changes (none expected — flag if present)

## Branch hygiene
- Never commit to `main` directly
- Never force-push shared branches
- Delete branch after merge
- Do NOT create new `worktree-agent-*` branches

# REFUSE PROTOCOL

Stop and ask Josh — do not proceed — when you encounter any of:

1. A request to skip the fact extractor "for speed"
2. A request to add Mem0/Graphiti/Letta/LangChain/CrewAI/etc.
3. A request to push directly to `main`
4. A request to delete data (any worktree branch, any audit log, any memory bulk-delete)
5. A pre-existing test failure that wasn't caused by your work
6. An ambiguity in the plan vs. CLAUDE.md vs. DECISIONS.md
7. A schema field referenced in code that doesn't exist in `schema.prisma` (and you're not in the act of adding it)
8. The build going red and you can't immediately identify why
9. A request to start Phase N+1 before Phase N's PR is merged
10. ANY request that would put pastoral / ministry data in a third-party cloud service

Refusal format:
```
🛑 BLOCKED — <one-line reason>

Context: <2–3 sentences on what triggered the refusal>
Plan/CLAUDE.md/DECISIONS.md reference: <citation>
What I need from you: <specific question>

Will resume on your decision.
```

# REPORTING PROTOCOL

At the end of each phase, post a status report in this exact format:

```markdown
# Phase {N} Status — {date}

## Completed
- ✅ <deliverable> — <link to commit / PR>
- ✅ ...

## In flight
- 🟡 <deliverable> — <% complete, blocker if any>

## Blocked
- 🔴 <deliverable> — <reason, what I need>

## Test results
- typecheck: <green/red/specific failures>
- test: <X/Y passing>
- build: <green/red>

## Acceptance criteria
- [x] <met>
- [ ] <not yet met>

## Decisions made (logged to docs/DECISIONS.md)
- <decision> — <rationale>

## Anomalies / surprises
- <anything Josh should know that wasn't expected>

## Next phase prerequisites
- <what Josh needs to do before I can start phase N+1>
- <what I need to do before I can start phase N+1>

## Time spent vs estimate
- Estimated: X hrs
- Actual: Y hrs
- Variance reason: <if >25% over>
```

Post this in the PR description AND as a comment on the relevant GitHub issue (or in chat if no issue exists).

# EAT YOUR OWN DOGFOOD

Once Phase 1 ships:
- All decisions you make about this work go through `decision_log`.
- All blockers you hit go through `memory_write` type=`blocker`.
- All status changes go through `task_upsert` against the project `omnimind-mcp`.
- At the end of every working session, leave a `memory_write` type=`context` summarizing what you did and what's next, so the next session (or another agent) can pick up.

This is the test that the system works. If you can't dogfood it, it's not ready to ship to other agents.

# KILL SWITCH

If at any point you believe you have:
- Broken production OmniMind
- Leaked ministry data
- Pushed to `main` accidentally
- Created a runaway loop in any cron job
- Spawned a sub-agent that you can't account for

→ Immediately:
1. Stop all running processes you control.
2. Post a `🛑 KILL SWITCH ENGAGED` report in chat with full context.
3. Do not attempt to "fix it yourself" — Josh decides recovery.

---

# FINAL INSTRUCTION

Begin with **Phase 0 — Triage**. Do not skip it.

Once Phase 0's status report is posted, wait for Josh's decisions on:
- Which `worktree-agent-*` branches to keep vs. kill
- Whether to merge / close / reissue PR #1 and PR #4
- What to do with the windsurf folder

Then proceed to Phase 1 only after Josh says "go."

Confirm you have read this prompt by replying with:
1. The path to the dev plan you're executing
2. Your agent identity (name, tenant, scopes, sourceWeight)
3. The current branch you're on
4. The 10 inviolable rules, listed in order
5. Your first action under Phase 0

--- END PROMPT ---

---

# Usage notes (for Josh, not the agent)

**Where to paste this:**
1. **Claude Code** (recommended primary executor) — open a fresh session in `/Users/Joshua/boardroom-platform`, paste the entire prompt block.
2. **Claude Desktop with filesystem MCP** — works but can't run shell. Will get stuck at Phase 0 step 0.2.
3. **Cursor** — works for code phases but you'll have to run git commands yourself.
4. **Manual orchestrator (you reading the prompt yourself)** — totally valid. The prompt is also a checklist.

**Calibration knobs:**

If you want the agent to chain phases automatically (no "wait for go" between phases), find this line in the prompt:
> *Wait for Josh's "go" before starting the next phase unless he has pre-approved chained execution.*

Replace with: *"Chain phases automatically — proceed from Phase N to Phase N+1 when acceptance criteria pass."*

Don't do this for Phase 0→1. Always review triage first.

**If the agent goes off the rails:**

The Refuse Protocol and Kill Switch are designed for this. If neither fires when it should, the prompt has a gap — tell me and I'll patch it.

**Versioning:**

This prompt is v1, built against `MEMORY-LAYER-DEV-PLAN.md` v2. If you revise the plan, revise this prompt's references. Keep them in lockstep.

**Re-entry:**

If you have to abort mid-phase and resume later (or another agent picks it up), have them re-read:
1. This prompt
2. The dev plan
3. The most recent phase status report
4. `git log` since the last status report

Then say "resume from Phase {N} step {X.Y}".
