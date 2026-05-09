# OmniMind-MCP Memory Layer — Dev Plan

**Status:** Phase 0 complete → Phase 1 in progress  
**Last updated:** 2026-05-09  
**Branch convention:** `feat/mcp-phase-{N}-{slug}`  
**Owner:** `claude-code-orchestrator` (`josh-business` tenant, `sourceWeight=1.0`)

---

## What This Builds

A cross-agent memory layer (OmniMind-MCP) on top of the existing OmniMind API. End state: external agents (Claude Desktop, Claude Code, Cursor, ChatGPT) can read and write a shared memory store via Model Context Protocol, with fact extraction, dedup, role-based scopes, three tenants, hybrid embeddings, and a session-summarizer fallback.

---

## Tenants

| ID | Name |
|---|---|
| `josh-personal` | Josh Personal |
| `josh-business` | Josh Business (umbrella) |
| `tgfc-ministry` | TGFC Ministry |

---

## Agent Identity & Scopes

| Agent | Tenant | Scopes | sourceWeight |
|---|---|---|---|
| `claude-desktop-josh` | josh-personal | memory:read,write context:write preference:write person:write | 0.85 |
| `claude-code-josh` | josh-business | memory:read,write decision:write task:write project:write commitment:write code:write | 1.0 |
| `cursor-josh` | josh-business | memory:read | 0.7 |
| `chatgpt-desktop-josh` | josh-personal | memory:read | 0.6 |
| `boardroom-ai` | josh-business | * | 1.0 |
| `cortex-summarizer` | josh-business | memory:write | 0.8 |

---

## Inviolable Rules

1. **No schema invention.** Every Prisma model must exist in `schema.prisma` or be added in an explicit `prisma migrate dev` in the same commit.
2. **No commits to `main`.** All changes via PR. Branch naming: `feat/mcp-phase-{N}-{slug}`.
3. **One phase at a time.** Phase N+1 only starts after Phase N's PR is merged.
4. **No new dependencies without approval.** Each new package requires a `## Dependency justification` block in the PR. Pre-rejected: `mem0`, `mem0ai`, `langchain`, `langgraph`, `crewai`, `letta`, `graphiti`, `zep` — any agent-orchestration or memory framework.
5. **Build must stay green.** `pnpm typecheck && pnpm test && pnpm build` before any PR.
6. **No `prisma db push`.** Use `prisma migrate dev` for every schema change.
7. **Server-side scope enforcement is mandatory.** Role-based write scopes enforced at the MCP transport layer, not in agent system prompts.
8. **Fact extractor + dedup is non-negotiable.** Ships with Phase 1. Never deferred.
9. **Ministry-domain data uses local Ollama embeddings only.** Never send `domain: 'ministry'` content to OpenAI's embedding API. If Ollama is unavailable, refuse the write with a clear error.
10. **No raw Prisma inserts for memory.** Every memory write goes through `src/memory/validation/pipeline.ts` AND the new fact extractor.

---

## Phase Overview

| Phase | Scope | Est. hours | Status |
|---|---|---|---|
| 0 | Triage — branch hygiene, PR cleanup, foundation | 2h | ✅ Complete |
| 1 | MCP wrapper + fact extractor + core tools | ~40h | 🟡 Next |
| 2 | Wire 4 agents, role-based scopes, memory protocol | ~10h | 📋 Queued |
| 3 | Admin viewer + session summarizer cortex job | ~12h | 📋 Queued |
| 4 | Hardening — encryption, rate limiting, observability, backup | ~12h | 📋 Queued |

---

## Phase 1 — MCP Wrapper + Fact Extractor

**Branch:** `feat/mcp-phase-1-core`  
**Gate:** PR merged + all acceptance criteria checked before Phase 2 starts.

### 1.1 Schema Migration

Add to `packages/omnimind-api/prisma/schema.prisma`:

```prisma
// Extend MemoryEntry with MCP fields
// agentId, tenantId, embeddingModel — added via migration mcp_phase_1

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

Seed three tenants via `prisma/seed.ts`.

### 1.2 Hybrid Embedding Service

Modify `packages/omnimind-api/src/services/embedding.service.ts`:
- `domain: 'ministry'` → Ollama `bge-base-en-v1.5` (768-dim), pad to 1536 with zeros
- All other domains → OpenAI `text-embedding-3-small` (1536-dim)
- If Ollama is down on a ministry write: return a clean error, do NOT fall back to OpenAI

Document the padding decision in `docs/02-reference/DECISIONS.md` (ADR-014).

### 1.3 `packages/omnimind-mcp/` Package

```
packages/omnimind-mcp/
├── package.json           ← @modelcontextprotocol/sdk, zod, undici
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── transports/
│   │   ├── stdio.ts       ← Claude Desktop, Claude Code, Cursor
│   │   └── http.ts        ← StreamableHttpServerTransport port 3334
│   ├── tools/
│   │   ├── memory.tool.ts
│   │   ├── decision.tool.ts
│   │   ├── task.tool.ts
│   │   ├── project.tool.ts
│   │   ├── person.tool.ts
│   │   ├── commitment.tool.ts
│   │   └── status.tool.ts
│   ├── lib/
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── namespace.ts
│   │   ├── audit.ts
│   │   └── fact-extractor.ts
│   ├── schemas/
│   └── types.ts
└── tests/
```

Add to `pnpm-workspace.yaml` and `turbo.json`.

### 1.4 Fact Extractor + Dedup — Highest Leverage

`packages/omnimind-mcp/src/lib/fact-extractor.ts`:

- Extract atomic facts from input text via Claude Haiku
- For each fact: cosine similarity search against existing memories (threshold: 0.85)
- If hit found: mark as `action: 'update'`, set `supersedes: <existing_id>`
- If no hit: mark as `action: 'create'`
- This is non-negotiable. Do not ship Phase 1 without it.

### 1.5 MCP Tools (build + test each before moving to next)

Priority order:
1. `memory_write` (uses fact extractor)
2. `memory_search`
3. `memory_supersede`
4. `decision_log`
5. `task_upsert`, `task_status`, `task_list`, `task_complete`, `task_block`
6. `project_status`, `project_summary`
7. `person_get`
8. `commitment_log`, `commitment_list`
9. `status_get` (composite)

Each tool requires:
- Zod input schema
- Server-side scope check (fail fast: `SCOPE_DENIED`)
- Tenant injection from agent context
- `McpAuditLog` entry on every call (success and failure)
- 3+ vitest tests (happy path, scope denial, validation error)

### 1.6 OmniMind Modifications

`packages/omnimind-api/src/retrieval/ranker.ts` — multiply final score by `sourceWeight`:
```typescript
score = (semantic * 0.6 + fts * 0.3 + trigram * 0.1) * memory.sourceWeight;
```

`packages/omnimind-api/src/retrieval/structured-filter.ts` — forgetting curve:
- Default: exclude memories with `importance < 0.4` AND `lastAccessedAt < 90 days ago`
- Override via `?includeArchived=true`

### 1.7 Transports

Both stdio and HTTP transports must:
- Auth via `OMNIMIND_MCP_API_KEY` (timing-safe compare against hash)
- Read `OMNIMIND_MCP_AGENT_NAME` and `OMNIMIND_MCP_TENANT_ID` from env
- `process.exit(1)` if any required env var is missing

### 1.8 `keygen` CLI

```bash
pnpm omnimind-mcp keygen --agent <name> --tenant <id> --scopes '<list>' --source-weight <float>
```

Prints the API key once, stores agent record with hashed key in `Agent` table.

### 1.9 Tests + Smoke Harness

Minimum 40 vitest tests. Plus:
```bash
pnpm omnimind-mcp smoke
```
Spins up stdio server, lists tools, calls `memory_write` + `memory_search`, asserts round-trip.

### Phase 1 Acceptance Criteria

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

---

## Phase 2 — Wire Agents

**Branch:** `feat/mcp-phase-2-agents`  
**Gate:** All 4 user agents authenticate + cross-agent read verified + scope enforcement verified.

Deliverables:
- `keygen` run for all 6 agents (keys printed once, stored in 1Password)
- `docs/MEMORY-PROTOCOL.md` committed
- `docs/agent-configs/claude-desktop.json` and equivalents
- `docs/agent-configs/SMOKE-TESTS.md`
- `.claude/CLAUDE.md` updated with Memory Layer section

**Wait for 1 week of real usage before Phase 3.** Tool descriptions will need tuning based on actual agent behavior.

---

## Phase 3 — Admin Viewer + Session Summarizer

**Branch:** `feat/mcp-phase-3-admin-summarizer`

Deliverables:
- `/admin/memory`, `/admin/audit`, `/admin/agents`, `/admin/contradictions` routes + UI pages
- `cortex-summarizer.service.ts` — cron every 10 min, Haiku summarization, fact extractor dedup
- Optional: `pnpm omnimind export` CLI for markdown snapshots

**Wait 1 week post-Phase 3 to inspect summarizer quality before Phase 4.**

---

## Phase 4 — Hardening

**Branch:** `feat/mcp-phase-4-hardening`

Deliverables:
- Encryption at rest for ministry memories (AES-256-GCM, `encryptedContent: Bytes?`)
- Per-agent rate limiting (1000 reads/hr, 200 writes/hr, 100 decision-writes/hr)
- Admin charts + Friday 6pm digest email
- Nightly `pg_dump` backup + monthly restore test

---

## Governance

### Schema changes
Every migration requires:
- A descriptive migration name
- An entry in `docs/02-reference/DECISIONS.md` if it touches existing models
- Tests covering the new fields
- `prisma migrate dev`, never `db push`

### New dependencies (PR description template)
```markdown
## Dependency justification
- Package: <name>
- Why: <reason>
- Alternatives considered: <list>
- Bundle impact: <KB added>
- License: <SPDX>
```

### Refuse Protocol — Stop and ask Josh when:
1. Skipping fact extractor "for speed"
2. Adding Mem0/Graphiti/Letta/LangChain/CrewAI or any agent framework
3. Pushing directly to `main`
4. Deleting data (branches, audit logs, bulk memory delete)
5. Pre-existing test failure not caused by current work
6. Ambiguity between this plan, CLAUDE.md, and DECISIONS.md
7. Schema field referenced in code that doesn't exist in `schema.prisma`
8. Build goes red with unknown cause
9. Request to start Phase N+1 before Phase N PR is merged
10. Any request that would put ministry data in a third-party cloud service

---

## Dogfood Protocol

Once Phase 1 ships:
- All decisions made about this work → `decision_log`
- All blockers → `memory_write` type=`blocker`
- All task status changes → `task_upsert`
- End of every session → `memory_write` type=`context` summarizing work done and what's next

If the system can't be dogfooded, it's not ready to ship to other agents.

---

## Phase 0 Completion Record

**Completed 2026-05-09:**
- ✅ Local main + origin/main synced at `403747d`
- ✅ No `worktree-agent-*` branches found (clean slate)
- ✅ PR #4 (`chore/docs-phase-D-migration`) — merged (docs restructure, 20 commits)
- ✅ PR #1 (`claude/distracted-satoshi`) — superseded, closed
- ✅ PR #5 (`fix/security-phase-0.25`) — created and merged (29 security fixes, Phase 0.25)
- ✅ Working branch `claude/build-memory-layer-IftGo` synced to `a210a3a`
- ✅ This dev plan created at `docs/MEMORY-LAYER-DEV-PLAN.md`
- ⚠️ Windsurf folder not accessible from this environment (Linux; folder is on Mac)
