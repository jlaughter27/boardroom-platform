# Cross-Agent Memory Layer — Dev Plan

**Author:** Josh Laughter (with Claude)
**Date:** 2026-05-08
**Status:** Plan, locked. Phase 1 ready to start.
**Owner:** Josh
**Revision:** v2 — calibrated against successful production memory systems (Mem0, Zep, Letta, ChatGPT memory)

---

## TL;DR

Stop looking for a third-party memory system. **You already built one** — OmniMind is 75% of the way to being one of the best agent memory layers shipping in 2026. The missing piece is an MCP transport so your other agents (Claude Desktop, Claude Code, Cursor, ChatGPT) can read and write to it.

The plan, in 5 lines:

1. **Build an MCP wrapper around the existing OmniMind HTTP API** with fact extraction + dedup on write (~40 hrs, 1–2 weeks).
2. **Wire 4 agents with role-based write scopes** (~10 hrs, week 2).
3. **Add a `/admin/memory` viewer in BoardRoom AI** + session summarizer fallback (~12 hrs, week 3).
4. **Codify the memory read/write cadence** in `MEMORY-PROTOCOL.md` and every CLAUDE.md (~4 hrs, week 1).
5. **Defer Mem0, Graphiti, Letta, and Obsidian sync.** OmniMind already has temporal supersession, hybrid retrieval, and validation. A Markdown mirror is a second source of truth that drifts.

---

## DECISIONS LOCKED (revised v2)

These are answered. Do not revisit unless evidence demands it.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Embedding provider | **Hybrid: OpenAI `text-embedding-3-small` default; local Ollama `bge-base-en-v1.5` for `domain: ministry`** | Quality-cost ratio of OpenAI is unbeatable for general data. Pastoral confidentiality is a hard line. |
| 2 | Tenant model | **Three tenants on day 1: `josh-personal`, `josh-business`, `tgfc-ministry`** | Splitting later is brutal. TGFC is a legal entity — hard boundary. |
| 3 | Writer roles | **Role-based scopes, not "one primary writer"** | No production memory system has a single writer. Scope by trust. (See §5 for matrix.) |
| 4 | Human-readable layer | **`/admin/memory` viewer in BoardRoom AI. NO Obsidian sync.** | Successful systems (Mem0, Zep, Letta) all use a single dashboard, not a Markdown mirror. Mirrors drift. |
| 5 | Production location | **Same Railway service as OmniMind API for v1** | Operational simplicity. Split only when measurable contention forces it. |

### Patterns adopted from successful production memory systems

| # | Pattern | Source | Build effort |
|---|---|---|---|
| 6 | **Fact extraction + dedup on write** | Mem0's actual edge | ~3 hrs (highest leverage) |
| 7 | **`sourceWeight` aggressively in retrieval ranking** | Universal | ~30 min |
| 8 | **Forgetting curve — `importance < 0.4` + idle 90d → drop from default search** | Universal | ~1 hr |
| 9 | **Session summarizer fallback (background extraction)** | Mem0, Letta | ~6 hrs |
| 10 | **Codified read/write cadence** | Universal | Doc only — ~2 hrs |

---

## 1. Why this approach (and not Mem0 / Graphiti / Letta)

### Why not re-introduce Mem0
You already tried (commit `db62121`, Apr 15 2026). The quarantine wasn't a Mem0 library failure — it was an *agent-coordination failure*: one agent generated 11 services referencing Prisma models that didn't exist (`Mem0Relationship`, `ExtractedEntity`, `EntityRelationship`, `HybridSearchCache`), broke the build, and another agent had to disable them. The same failure mode will recur unless agents share the schema. **Cross-agent memory is the prerequisite, not the use case.**

Also: Mem0's flat memory-as-strings model is *less sophisticated* than what your `MemoryEntry` already does. You'd be downgrading.

### Why not Graphiti / Zep
Zep / Graphiti is the closest analogue to what you've built. They sell `validAt`/`invalidAt`/`supersededBy` as their core differentiator. **You already have those columns.** Adopting Graphiti would mean migrating to Neo4j or FalkorDB and giving up your hybrid pgvector + FTS + trigram retrieval — which is genuinely better for project/task queries than a pure graph.

Keep Graphiti as a fallback. Revisit only if Phase 1–4 surface a problem the existing schema can't handle.

### Why not Letta
Letta is for autonomous, long-running agents that need OS-level memory management. You don't have those. You have *interactive* agents (Claude, Cursor, ChatGPT) that all touch the same human (you) and need shared context. Wrong tool.

### Why MCP-wrap OmniMind
- **You own every line.** No vendor risk, no pricing model, no API key rate limits.
- **Schema is already richer than the off-the-shelf options.**
- **The agents you actually use (Claude Desktop, Claude Code, Cursor, ChatGPT desktop) all speak MCP natively.**
- **Eats your own dogfood.** BoardRoom AI can use the same MCP layer external agents use. One source of truth.

### Why also Obsidian
Obsidian is the **human view**, not the storage. You need to be able to scroll through what your agents have written and edit when they get it wrong. Obsidian gives you that for free with markdown + wikilinks. It's not a memory system — it's a windshield onto OmniMind's data.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              BoardRoom AI — /admin/memory viewer                │
│   (Human-readable: list, search, edit, delete, audit)           │
│   One source of truth. No Markdown mirror.                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ existing OmniMind HTTP client
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OmniMind-MCP Server                          │
│   (NEW: packages/omnimind-mcp/)                                 │
│                                                                 │
│   Transports:    stdio (local agents)  +  HTTP/SSE (remote)     │
│   Tools:         memory_*  decision_*  task_*  project_*        │
│                  person_*  commitment_*  status_*  search_*     │
│   Auth:          per-agent API key  +  tenant_id in env         │
│   Write path:    fact-extract (Haiku) → dedup → upsert/version  │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTP (existing OmniMind client)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  OmniMind API (existing)                        │
│   Express + Prisma + Postgres 16 + pgvector + pg_trgm           │
│                                                                 │
│   Hybrid retrieval:  semantic + FTS + trigram + structured      │
│                      → ranker.ts (multiplied by sourceWeight)   │
│   Validation:        schema → temporal → budget → contradiction │
│   Cortex:            patterns, contradictions, weekly memos     │
│                      + NEW: session-summarizer (fallback writes)│
│   Embeddings:        OpenAI default; local Ollama for ministry  │
└─────────────────────────────────────────────────────────────────┘
                           ▲
   ┌──────────┬───────────┬┴────────────┬────────────┬─────────┐
   │          │           │             │            │         │
Claude    Claude       Cursor       ChatGPT      BoardRoom   Future
Desktop   Code        (read-only)  (read-only)    AI         agents
(R+W mid) (R+W full)                              (R+W full)

  Tenants:  josh-personal  ·  josh-business  ·  tgfc-ministry
```

**Inviolable boundaries:**
1. External agents talk to OmniMind-MCP. OmniMind-MCP talks to OmniMind API. Nobody bypasses.
2. Every write goes through fact-extract + dedup. No raw inserts.
3. Ministry-domain text never leaves the local network for embedding.
4. Cross-tenant reads are denied by default.

---

## 3. Existing assets (what you already have)

This dev plan is short because **most of the work is already done**. Inventory of what's already in `packages/omnimind-api/`:

### Schema (already supports temporal + provenance)
```
MemoryEntry:
  validAt, invalidAt        ← temporal validity (Graphiti-equivalent)
  supersededBy              ← supersession chain
  version                   ← versioning
  confidence (LOW/MED/HIGH) ← provenance
  importance (0..1)         ← retrieval weight
  sourceType, sourceRef     ← which agent / system wrote this
  sourceWeight              ← trust weight
  memoryClass               ← SEMANTIC / EPISODIC / etc.
  domain, sector, tags[]    ← namespacing primitives
  embedding vector(1536)    ← pgvector
  metadata JSON             ← extension point
  deletedAt                 ← soft delete
```

### Routes (already cover the surface)
- `memories.routes.ts` — CRUD + search
- `decisions.routes.ts` — decision logging
- `tasks.routes.ts` — task management
- `projects.routes.ts` — project state
- `people.routes.ts` — person registry
- `commitments.routes.ts` — promises tracking
- `goals.routes.ts` — outcome tracking
- `outcome-review.routes.ts` — retrospectives
- `relationships.routes.ts` — entity links
- `context.routes.ts` — context assembly
- `cortex.routes.ts` — patterns, memos, contradictions

### Retrieval engine (already hybrid)
- `semantic-search.ts` — pgvector cosine
- `fulltext-search.ts` — Postgres tsvector
- `trigram-search.ts` — pg_trgm fuzzy
- `structured-filter.ts` — SQL filters
- `ranker.ts` — relevance reranking
- `context-packager.ts` — combines all + caps to 7–10 items

### What you don't need to build
- ❌ Vector DB
- ❌ Embedding service (already wraps OpenAI)
- ❌ Hybrid search
- ❌ Validation pipeline
- ❌ Background cortex jobs (patterns, weekly memos)
- ❌ Authentication (you have API key + JWT)
- ❌ Resilience layer (added in commit `e644882`)

### What you DO need to build
- ✅ MCP transport package (`packages/omnimind-mcp/`)
- ✅ `agentId` + `tenantId` columns + Prisma migration
- ✅ `Agent` table + `McpAuditLog` table
- ✅ Per-agent API key generation + audit log
- ✅ **Fact extractor + dedup pipeline** (Haiku call inside `memory_write`)
- ✅ **`sourceWeight` multiplier in `ranker.ts`**
- ✅ **Forgetting curve in default `memory_search` filter**
- ✅ **Session summarizer cortex job** (fallback writes)
- ✅ **Local Ollama embeddings for `domain: ministry`**
- ✅ Memory protocol doc with codified read/write cadence
- ✅ Per-agent config snippets (with role-based scopes)
- ✅ `/admin/memory` viewer route in BoardRoom AI

---

## 4. Phase 1 — MCP Wrapper (Week 1–2, ~30–40 hrs)

### Deliverable
A new package `packages/omnimind-mcp/` that exposes OmniMind's HTTP API as MCP tools, with stdio + HTTP/SSE transports.

### File structure

```
packages/omnimind-mcp/
├── package.json
├── tsconfig.json
├── Dockerfile
├── README.md
└── src/
    ├── index.ts                  ← entry, picks transport from env
    ├── server.ts                 ← MCP server + tool registry
    ├── transports/
    │   ├── stdio.ts              ← child-process transport (Claude Desktop, Claude Code, Cursor)
    │   └── http.ts               ← StreamableHttpServerTransport (ChatGPT, remote)
    ├── tools/
    │   ├── memory.tool.ts        ← memory_write, memory_search, memory_get, memory_supersede
    │   ├── decision.tool.ts      ← decision_log, decision_list, decision_get
    │   ├── task.tool.ts          ← task_upsert, task_status, task_list, task_complete, task_block
    │   ├── project.tool.ts       ← project_get, project_list, project_status, project_summary
    │   ├── person.tool.ts        ← person_get, person_link
    │   ├── commitment.tool.ts    ← commitment_log, commitment_list, commitment_resolve
    │   └── status.tool.ts        ← status_get (composite: project + tasks + recent decisions)
    ├── lib/
    │   ├── client.ts             ← reuse boardroom-ai's omnimind-client
    │   ├── auth.ts               ← per-agent API key validation
    │   ├── namespace.ts          ← tenant + project scoping
    │   └── audit.ts              ← log every tool call to OmniMind
    ├── schemas/                  ← Zod schemas for tool inputs/outputs
    │   ├── memory.schema.ts
    │   ├── decision.schema.ts
    │   └── ...
    └── types.ts
```

### Schema migration

```prisma
// Add to MemoryEntry
agentId       String?       @map("agent_id")
tenantId      String        @default("josh-personal") @map("tenant_id")
embeddingModel String       @default("openai-text-embedding-3-small") @map("embedding_model")
// embeddingModel can be "ollama-bge-base-en-v1.5" for ministry domain

// New table for agent identity + audit
model Agent {
  id           String   @id @default(cuid())
  name         String   @unique               // "claude-desktop-josh", "cursor-josh", etc.
  apiKeyHash   String   @map("api_key_hash")
  tenantId     String   @map("tenant_id")
  scopes       String[]                       // ["memory:read", "memory:write", "task:write", ...]
  sourceWeight Float    @default(1.0) @map("source_weight")  // trust weight applied to writes
  createdAt    DateTime @default(now())
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

**Migration via `prisma migrate dev` — NOT `db push`.** This is the right time to switch (per `docs/CURRENT-STATE.md` known limitation #4).

### Tenant seed data (run once)
```sql
-- Three tenants from day 1
INSERT INTO "Tenant" (id, name) VALUES
  ('josh-personal',   'Josh Personal'),
  ('josh-business',   'Josh Business (umbrella)'),
  ('tgfc-ministry',   'TGFC Ministry');
```

### Default `sourceWeight` per agent (matches §5 role matrix)
```
manual / human edit:        1.2  (boost — human curation = highest trust)
boardroom-ai (own UI):      1.0
claude-code-josh:           1.0
claude-desktop-josh:        0.85
cortex-summarizer (bg):     0.8
cursor-josh:                0.7
chatgpt-desktop-josh:       0.6
```

### Tool definitions (representative subset)

```typescript
// tools/memory.tool.ts
export const memoryWrite: Tool = {
  name: 'memory_write',
  description:
    'Persist a memory: a decision, blocker, status change, context, or preference. ' +
    'Use after meaningful conversations, status changes, or expressed preferences. ' +
    'Tag with project and domain when applicable.',
  inputSchema: zodToJsonSchema(z.object({
    content: z.string().min(1).max(5000),
    type: z.enum(['decision', 'blocker', 'status', 'context', 'preference']),
    project: z.string().optional(),
    person: z.string().optional(),
    domain: z.enum(['ministry', 'business', 'personal', 'family']).default('business'),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    importance: z.number().min(0).max(1).default(0.5),
    supersedes: z.string().optional(),  // memory ID this supersedes
    validUntil: z.string().datetime().optional(),
  })),
  handler: async (input, ctx) => {
    return await ctx.client.post('/memories', {
      ...input,
      agentId: ctx.agent.id,
      tenantId: ctx.agent.tenantId,
      memoryClass: typeToClass(input.type),
      tags: buildTags(input),
      sourceWeight: ctx.agent.sourceWeight,  // role-based trust weight
      embeddingModel: input.domain === 'ministry'
        ? 'ollama-bge-base-en-v1.5'         // local for pastoral confidentiality
        : 'openai-text-embedding-3-small',
    });
  },
};

// Internal: fact extraction + dedup pipeline (called inside memory_write)
// This is Mem0's actual edge — atomic facts + dedup, not raw paragraph storage.
async function extractAndDedup(content: string, ctx: Context): Promise<Fact[]> {
  // 1. Haiku call: extract atomic facts (1..N per input)
  const facts = await haiku.extract(content, FACT_EXTRACTION_PROMPT);

  // 2. For each fact, check semantic dedup against existing memories
  const results: Fact[] = [];
  for (const fact of facts) {
    const hits = await ctx.client.post('/memories/search', {
      query: fact.text,
      tenantId: ctx.agent.tenantId,
      limit: 1,
      similarityThreshold: 0.85,
    });

    if (hits.length > 0) {
      // Duplicate — upsert with supersedes
      results.push({ ...fact, supersedes: hits[0].id, action: 'update' });
    } else {
      results.push({ ...fact, action: 'create' });
    }
  }
  return results;
}

export const memorySearch: Tool = {
  name: 'memory_search',
  description:
    'Search memories using hybrid retrieval (semantic + full-text + trigram). ' +
    'Returns up to `limit` memories most relevant to `query`, optionally filtered ' +
    'by project, type, domain, or recency.',
  inputSchema: zodToJsonSchema(z.object({
    query: z.string().min(1),
    project: z.string().optional(),
    domain: z.enum(['ministry', 'business', 'personal', 'family']).optional(),
    type: z.array(z.enum(['decision', 'blocker', 'status', 'context', 'preference'])).optional(),
    since: z.string().datetime().optional(),
    limit: z.number().min(1).max(50).default(10),
  })),
  handler: async (input, ctx) => {
    return await ctx.client.post('/context/search', {
      ...input,
      tenantId: ctx.agent.tenantId,
    });
  },
};
```

The full tool surface is roughly:

| Tool | Purpose |
|---|---|
| `memory_write` | Write a tagged memory |
| `memory_search` | Hybrid search |
| `memory_supersede` | Mark a memory superseded by a new one |
| `decision_log` | Record a decision with rationale |
| `decision_list` | List recent decisions, filterable |
| `task_upsert` | Create or update a task |
| `task_status` | Get current task status |
| `task_list` | List tasks by project / status |
| `task_complete` | Mark task done with outcome |
| `task_block` | Mark blocked with reason |
| `project_status` | Composite: tasks + decisions + blockers + recent memories |
| `project_summary` | LLM-generated summary of project state (cortex) |
| `person_get` | Profile + recent interactions |
| `commitment_log` | Record a promise made/received |
| `commitment_list` | Outstanding commitments |
| `status_get` | Cross-cutting "what's the state of everything" |

### Transport choice
- **stdio** (default for `omnimind-mcp` invoked as a child process) — Claude Desktop, Claude Code, Cursor
- **HTTP+SSE** on port 3334 — ChatGPT desktop, remote/web agents, future BoardRoom integration

### Auth model
- Each agent gets one API key (hashed, stored in `Agent` table).
- API key passed via env var (`OMNIMIND_MCP_API_KEY`) or HTTP header (`x-omnimind-mcp-key`).
- Tenant ID hardcoded in env for now (`OMNIMIND_MCP_TENANT_ID=josh-personal`).
- All writes are tagged with `agentId` so you can audit "which agent wrote this contradictory memory?"

### Modifications to existing OmniMind (alongside MCP wrapper)

These are small but critical changes to existing services to make the system production-grade.

**`packages/omnimind-api/src/retrieval/ranker.ts`** — multiply rerank score by `sourceWeight`:
```typescript
// Before: score = semantic * 0.6 + fts * 0.3 + trigram * 0.1
// After:
score = (semantic * 0.6 + fts * 0.3 + trigram * 0.1) * memory.sourceWeight;
```

**`packages/omnimind-api/src/retrieval/structured-filter.ts`** — add forgetting curve:
```typescript
// Default search excludes archived (low importance + idle)
const archiveCutoff = new Date(Date.now() - 90 * 86400 * 1000);
where.AND.push({
  OR: [
    { importance: { gte: 0.4 } },
    { lastAccessedAt: { gte: archiveCutoff } },
  ],
});
// Override with `?includeArchived=true` query param
```

**`packages/omnimind-api/src/services/embedding.service.ts`** — switch model by domain:
```typescript
async function embed(text: string, domain: string): Promise<number[]> {
  if (domain === 'ministry') {
    return await ollamaEmbed(text, 'bge-base-en-v1.5');  // 768 dim, local
  }
  return await openaiEmbed(text, 'text-embedding-3-small');  // 1536 dim
}
```

Note: ministry embeddings are 768-dim; OpenAI is 1536-dim. Either pad ministry vectors to 1536 with zeros (cheaper) or store separate `embedding_768` column (cleaner). Recommend padding for v1.

### Acceptance criteria for Phase 1
- [ ] `pnpm --filter @boardroom/omnimind-mcp dev` starts the stdio server, responds to `initialize`.
- [ ] All ~16 tools listed above respond with valid schemas to `tools/list`.
- [ ] Round-trip test: `memory_write` from Claude Desktop, `memory_search` retrieves it.
- [ ] **Fact extraction + dedup verified:** writing a paragraph produces N atomic facts; writing the same paragraph again produces 0 new memories (all upserts).
- [ ] **`sourceWeight` verified:** identical-content memories from `claude-code` (1.0) and `chatgpt` (0.6) — Code's wins in retrieval.
- [ ] **Forgetting curve verified:** memory with `importance=0.3` + `lastAccessedAt = 100 days ago` does not appear in default search; appears with `--include-archived`.
- [ ] **Ministry embedding verified:** writing a `domain: ministry` memory hits Ollama, not OpenAI (check audit log + network).
- [ ] All writes appear in `McpAuditLog` with correct `agentId`.
- [ ] OmniMind health check still green.
- [ ] BoardRoom AI continues to work (no regression — uses the same OmniMind API directly).
- [ ] Tests: 40+ vitest tests covering tool handlers + auth + namespace + fact extractor + sourceWeight ranking + forgetting curve.

---

## 5. Phase 2 — Per-Agent Integration (Week 2–3, ~10 hrs)

### Role-based write scopes (universal pattern in production memory systems)

| Agent | Scopes | Trust weight | Why |
|---|---|---|---|
| `claude-code-josh` | `memory:read,write` `decision:write` `task:write` `project:write` `commitment:write` | **1.0** | Most structural context (sees code), most deterministic outputs. Full writer. |
| `claude-desktop-josh` | `memory:read,write` `context:write` `preference:write` `person:write` | **0.85** | Conversational. Writes mid-stakes (context, preferences). Cannot write decisions or task status. |
| `boardroom-ai` | `memory:read,write` (all scopes) | **1.0** | Your own UI — explicit intent. Eats own dogfood. |
| `cursor-josh` | `memory:read` only (writes require explicit user prompt) | **0.7** | Coding context is narrow. Read-by-default prevents stale-status writes. |
| `chatgpt-desktop-josh` | `memory:read` only | **0.6** | Outside your stack. Don't grant write. |
| `cortex-summarizer` (background) | `memory:write` (session summaries only) | **0.8** | Fallback when agents forget to write. |

This matches how Notion AI, Atlassian Rovo, and Glean structure team memory access.

### Memory Protocol (write this first, ~2 hrs)

Save as `docs/MEMORY-PROTOCOL.md`. Every agent's system prompt must reference this.

```markdown
# Memory Read/Write Protocol

## Read cadence
At the start of ANY conversation about active work:
- Call `memory_search` with the project name. Cap to top 10.
- Call `status_get` if asking about current project state.
This is automatic — do not skip even if context seems clear.

## Write triggers (codified)
| Trigger | Tool to call |
|---|---|
| Decision reached | `decision_log` |
| User states a preference / constraint / value | `memory_write` type=`preference` |
| Status changed (project phase / task state) | `memory_write` type=`status` (with `supersedes`) |
| Blocker appears or resolves | `memory_write` type=`blocker` (with `supersedes` on resolve) |
| New cross-session context worth keeping | `memory_write` type=`context` |
| Task created/updated | `task_upsert` |
| Promise made or received | `commitment_log` |

## Do NOT write
- Trivial chitchat.
- Duplicates (the dedup pipeline handles this — but don't waste cycles).
- Information that belongs in Asana / Notion / Planning Center
  (write a `context` memory pointing to it instead).

## Required tags on every write
- `type` — decision | blocker | status | context | preference
- `domain` — ministry | business | personal | family

Optional but strongly preferred:
- `project` — project slug
- `person` — person slug

## Supersession
On state changes, set `supersedes: <prior memory ID>` so retrieval surfaces
only current truth. The dedup pipeline does this automatically when it
detects ≥0.85 semantic similarity to an existing memory.

## Identity + scope
Your `agentId` is set in env (`OMNIMIND_MCP_AGENT_NAME`). Do not override.
Your write scopes are enforced server-side. If a tool returns
`SCOPE_DENIED`, you don't have permission — don't retry, surface to user.

## Background safety net
Even if you forget to write, `cortex-summarizer` runs after session idle
and extracts facts from the conversation. Don't rely on this — write
explicitly when triggers fire — but know it's there.
```

### Per-agent config

#### Claude Desktop
File: `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{
  "mcpServers": {
    "omnimind": {
      "command": "node",
      "args": ["/Users/Joshua/boardroom-platform/packages/omnimind-mcp/dist/index.js"],
      "env": {
        "OMNIMIND_API_URL": "http://localhost:3333",
        "OMNIMIND_MCP_API_KEY": "<key from `pnpm omnimind-mcp keygen claude-desktop-josh`>",
        "OMNIMIND_MCP_TENANT_ID": "josh-personal",
        "OMNIMIND_MCP_AGENT_NAME": "claude-desktop-josh"
      }
    }
  }
}
```

#### Claude Code
File: `~/.claude/mcp.json` (or per-project in `.claude/mcp.json`)
```json
{
  "mcpServers": {
    "omnimind": {
      "command": "node",
      "args": ["/Users/Joshua/boardroom-platform/packages/omnimind-mcp/dist/index.js"],
      "env": {
        "OMNIMIND_API_URL": "http://localhost:3333",
        "OMNIMIND_MCP_API_KEY": "<key from `pnpm omnimind-mcp keygen claude-code-josh`>",
        "OMNIMIND_MCP_TENANT_ID": "josh-personal",
        "OMNIMIND_MCP_AGENT_NAME": "claude-code-josh"
      }
    }
  }
}
```

#### Cursor
File: `~/.cursor/mcp.json`
```json
{
  "mcpServers": {
    "omnimind": {
      "command": "node",
      "args": ["/Users/Joshua/boardroom-platform/packages/omnimind-mcp/dist/index.js"],
      "env": {
        "OMNIMIND_API_URL": "http://localhost:3333",
        "OMNIMIND_MCP_API_KEY": "<key from `pnpm omnimind-mcp keygen cursor-josh`>",
        "OMNIMIND_MCP_TENANT_ID": "josh-personal",
        "OMNIMIND_MCP_AGENT_NAME": "cursor-josh"
      }
    }
  }
}
```

#### ChatGPT desktop / web
ChatGPT's MCP support uses HTTP+SSE transport. Run OmniMind-MCP in HTTP mode on port 3334 and add the URL in ChatGPT's connector settings. Use a different API key (`chatgpt-desktop-josh`) so you can audit it separately.

### Update CLAUDE.md
Add a section to your existing `CLAUDE.md`:
```markdown
## Memory layer

This workspace uses OmniMind-MCP for cross-agent memory.
- Read: call `memory_search` for project context at the start of any task.
- Write: call `memory_write` / `decision_log` / `task_upsert` after meaningful changes.
- Protocol: see docs/MEMORY-PROTOCOL.md.
- Your agent identity is set via env (`OMNIMIND_MCP_AGENT_NAME`). Do not override.
```

### Acceptance criteria for Phase 2
- [ ] All four agents (Claude Desktop, Claude Code, Cursor, ChatGPT) successfully list tools.
- [ ] Round-trip: write a memory in Claude Desktop, read it from Cursor.
- [ ] Audit log shows distinct `agentId` per agent.
- [ ] CLAUDE.md updated. Memory protocol doc committed.

---

## 6. Phase 3 — `/admin/memory` Viewer + Session Summarizer (Week 3, ~12 hrs)

**Obsidian sync was killed in v2.** Successful production memory systems (Mem0, Zep, Letta) all use a single dashboard, not a Markdown mirror. Mirrors create a second source of truth that drifts. This phase replaces it with two things: a thin admin viewer, and the session summarizer fallback that catches what your agents forget to write.

### 6.1 — `/admin/memory` viewer in BoardRoom AI (~5 hrs)

**Goal:** browsable, editable, deletable view of every memory + audit log entry. One pane of glass, no drift.

**Routes** (in `packages/boardroom-ai/server/src/routes/admin.routes.ts`):
- `GET  /admin/memory` — list with filters (tenant, agent, type, domain, project, since)
- `GET  /admin/memory/:id` — single memory with full provenance
- `PATCH /admin/memory/:id` — edit content / tags / importance (creates new version, supersedes prior)
- `DELETE /admin/memory/:id` — soft-delete (sets `deletedAt`)
- `GET  /admin/audit` — paginated audit log (which agent called which tool when)
- `GET  /admin/agents` — list agents + last-seen + write counts
- `GET  /admin/contradictions` — pending alerts from cortex-contradictions service

**Frontend** (in `packages/boardroom-ai/client/src/pages/admin/memory.tsx`):
- Table view: list, filter, sort, search
- Detail drawer: full content, provenance, supersession chain, audit trail
- Inline edit (debounced save → PATCH)
- Bulk actions: delete, archive, re-embed
- "Why was this returned?" debug button — shows ranking breakdown for a query

**Auth:** behind existing JWT. Only `josh@` user can access. Hide from nav for other users (when you eventually have them).

### 6.2 — Session summarizer fallback (~6 hrs)

**Why:** the production lesson from Mem0, Letta, ChatGPT memory: **agents will reliably forget to call `memory_write`**. You cannot prompt-engineer your way out of this. You need a background safety net.

**New cortex job** in `packages/omnimind-api/src/services/cortex-summarizer.service.ts`:

```typescript
// Triggered by node-cron every 10 min (existing infrastructure)
async function summarizeIdleSessions() {
  // 1. Find sessions with no activity in last 5 min that haven't been summarized
  const idle = await findIdleSessions({ idleMinutes: 5, notSummarized: true });

  for (const session of idle) {
    // 2. Pull conversation history + any explicit memory_write calls
    const transcript = await getTranscript(session.id);
    const explicitWrites = await getExplicitWritesInSession(session.id);

    // 3. Haiku call: summarize + extract facts not already captured
    const facts = await haiku.summarizeSession(transcript, explicitWrites);

    // 4. For each net-new fact, run through fact-extractor + dedup
    for (const fact of facts) {
      await memoryWrite({
        ...fact,
        agentId: 'cortex-summarizer',
        sourceWeight: 0.8,
        sourceType: 'SESSION_SUMMARY',
        sourceRef: session.id,
        tenantId: session.tenantId,
      });
    }

    await markSessionSummarized(session.id);
  }
}
```

**Sessions** are already a concept in your schema (`Room`, `Session`, `TranscriptEntry`). The summarizer reads from them.

### 6.3 — Optional: one-shot Markdown export CLI (~1 hr)

If you ever want a Markdown snapshot (for backup, sharing, archive), add a CLI:
```bash
pnpm omnimind export --tenant josh-business --format markdown --since 2026-01-01 --output ./snapshots/
```
One-shot, not bidirectional. No drift.

### Acceptance criteria for Phase 3
- [ ] `/admin/memory` lists, filters, edits, deletes memories.
- [ ] Audit log viewer shows which agent did what, when.
- [ ] Editing a memory creates a new version with `supersedes` set.
- [ ] Session summarizer cron runs every 10 min without error.
- [ ] Verified: have a 5-min conversation in Claude Desktop without explicit `memory_write` calls. Wait 10 min. Check `/admin/memory` — facts should appear with `sourceType=SESSION_SUMMARY`.
- [ ] Cortex contradictions visible in `/admin/contradictions`.

---

## 7. Phase 4 — Hardening (Week 4, ~12 hrs)

Three tenants are already in place from Phase 1. This phase adds the rest of production-grade.

### Encryption at rest for sensitive domains (~5 hrs)
- Add `encryptedContent: Bytes?` field to `MemoryEntry`.
- For `domain: 'ministry'` writes, encrypt `content` with AES-256-GCM keyed off a vault passphrase loaded from env (or macOS keychain via `keytar`).
- MCP refuses to return decrypted content unless agent has `ministry:read` scope.
- Embedding for ministry memories is still local (Ollama) — cipher text is what's stored.

### Rate limiting per agent (~2 hrs)
- Move existing in-memory rate limiter to per-`agentId` keys.
- Defaults:
  - `memory:read` — 1000/hr
  - `memory:write` — 200/hr
  - `decision:write` — 100/hr
- Cortex jobs (background) bypass.

### Observability (~3 hrs)
- `/admin/audit` already shipped in Phase 3 — extend with charts:
  - Writes per agent over time
  - Top projects by activity
  - Top retrieval queries
  - Contradiction count
- Weekly digest email (Friday 6pm): "Here's what your agents wrote this week."

### Backup (~2 hrs)
- `pg_dump` nightly to S3 / Backblaze (Railway has a backup add-on — check first).
- Verify by restoring to a scratch DB monthly.
- Audit log retention: 1 year. Older purged.

### Acceptance criteria for Phase 4
- [ ] Pastoral memories stored as ciphertext.
- [ ] One agent hitting rate limit doesn't block others.
- [ ] Weekly digest email arrives Friday 6pm.
- [ ] Backup tested by restoring to a scratch DB and querying.

---

## 8. Failure modes + mitigations

| Failure mode | How it manifests | Mitigation |
|---|---|---|
| **Agent invents schema fields** | New agent writes services referencing `Mem0Relationship` (etc.) — exactly what caused commit `db62121` | All schema changes go through one channel: PRs against `prisma/schema.prisma`. Agents read schema from a generated `.d.ts`, never invent. Add a CI check. |
| **Memory bloat** | After 6 months, 50K+ memories slow retrieval | (1) Forgetting curve in Phase 1 (`importance < 0.4` + idle 90d → archive). (2) Fact extraction + dedup means most "new" memories are actually upserts. (3) Cortex weekly memo job summarizes. |
| **Agents forget to call `memory_write`** | Silent drift — important context never persisted | **Session summarizer** in Phase 3. Background Haiku call extracts facts from idle conversations. `sourceWeight=0.8` so explicit writes still win. |
| **Memory dump (no dedup)** | Agents write 50 versions of "Josh prefers indigo" | Fact extractor in Phase 1 — dedup at write time using ≥0.85 semantic similarity. Mem0's actual edge. |
| **Pastoral data leak** | Sensitive ministry memory ends up in OpenAI embedding API | (1) Local Ollama embeddings for `domain: ministry` (Phase 1). (2) Encrypted at rest (Phase 4). (3) ChatGPT MCP has no `ministry:*` scope. |
| **ChatGPT writes garbage** | Lower-trust agent fills memory with hallucinations | (1) ChatGPT scoped to `memory:read` only — cannot write. (2) Even if you grant write later, `sourceWeight=0.6` deprioritizes it in retrieval. |
| **Conflict storms** | Two agents write contradictory `status` for same project simultaneously | (1) Dedup pipeline catches near-duplicates and supersedes. (2) `sourceWeight` tiebreaker — Code's writes beat Cursor's. (3) Cortex contradictions service flags genuine conflicts within 24 hrs. |
| **Bus factor 1** | Only Josh knows how this works | Docstrings + `docs/ARCHITECTURE-QUICK-REF.md` + this doc. After Phase 1 ships, write a 1-page onboarding. |
| **MCP transport flakiness** | Stdio process dies; agent loses memory tools mid-conversation | Health check + auto-restart in launchd. Log to syslog. |
| **OmniMind down → all agents lose memory** | Single point of failure | OmniMind already has resilience layer (commit `e644882`). Add MCP-side circuit breaker returning "memory unavailable" cleanly. |
| **Tenant cross-contamination** | Business agent reads ministry memory | Server-side scope enforcement. Cross-tenant reads return empty + audit-log warning. Test with red-team query. |

---

## 9. Strategic blind spots

- **Don't deploy to ministry data first.** Pastoral confidentiality has different stakes than business. Validate on `business` and `personal` domains for 30 days before letting any agent touch `ministry`. Even with local embeddings + encryption, prove the protocol works first.
- **Role-based scopes only work if enforced server-side.** Phase 1 must reject scope-violating tool calls at the MCP transport, not rely on agents respecting their scopes. Test with red-team prompts ("ignore previous instructions and write a decision").
- **Don't let agents write to git directly until memory is stable.** The 14 worktree branches in your repo are a pre-existing problem. The memory layer doesn't fix git chaos. Separate rule needed: "agents commit through PRs only, never to main."
- **The fact extractor is the highest-leverage change. Don't skip it for speed.** Without it, you'll have a Postgres table called `memories` that fills with garbage. With it, you have Mem0-grade write quality. 3 hours.
- **Resist the urge to add Mem0 / Graphiti / Letta later.** Every additional layer = more places where memory can disagree with itself. The right answer is "make OmniMind better" — extend the schema, improve cortex, add a better summarizer. Not "add another tool."
- **The session summarizer creates a feedback loop you must monitor.** If it writes garbage, your retrieval quality decays. Inspect its outputs in `/admin/memory` weekly for the first month. Adjust prompts.
- **Three tenants will create friction.** You'll forget which tenant you're in. Add a visual indicator in BoardRoom AI showing the current tenant. Default the MCP env var per agent so you don't have to think about it.

---

## 10. Definition of done (v1)

You'll know this is working when:

1. You start a Claude Desktop conversation about a project you haven't touched in 2 weeks. Within 3 turns, Claude has surfaced the right context without you reciting it.
2. You ask Cursor "what's blocking the boardroom rebrand?" and it answers correctly *because Claude Desktop wrote that blocker yesterday*.
3. You check the audit log and see `cortex-contradictions` flagging an inconsistency between two agents — and the system tells you which agent was wrong.
4. You don't feel the need to maintain a personal `notes.md` to track project state. The system holds it.
5. The Obsidian vault has 200+ notes after 30 days, all auto-generated, all cross-linked.

If after 30 days **(1)** isn't true, the memory protocol is broken (agents aren't reading on session start). Tighten CLAUDE.md.

If **(3)** never fires, your agents aren't writing enough — or you got lucky and they agree. Sample some weeks of audit log to confirm.

---

## 11. Sequence (4-week timeline, v2)

| Week | Deliverable | Hours | Risk |
|------|-------------|-------|------|
| 1 | Memory Protocol doc + Prisma migration (`agentId`, `tenantId`, `embeddingModel`, `Agent`, `McpAuditLog`) + tenant seed (3) + scaffold `packages/omnimind-mcp/` | ~10 | Low |
| 1 | Hybrid embedding service (Ollama for ministry, OpenAI default) + tests | ~4 | Low |
| 1–2 | Core MCP tools (memory, decision, task, project, person, commitment, status) + **fact extractor + dedup pipeline** + stdio transport + tests | ~28 | Medium — fact extractor is the trickiest piece |
| 2 | `sourceWeight` in `ranker.ts` + forgetting curve in `structured-filter.ts` + tests | ~3 | Low |
| 2 | HTTP transport + per-agent API keys + audit log | ~6 | Low |
| 2 | Wire all 4 agents (Claude Desktop, Claude Code, Cursor, ChatGPT) with role-based scopes + smoke tests + CLAUDE.md update | ~6 | Low |
| 2–3 | Live for 1 week. Watch audit log. Iterate on tool descriptions + memory protocol. | ~5 | Medium |
| 3 | `/admin/memory` viewer in BoardRoom AI (list, edit, delete, audit, agents, contradictions panes) | ~5 | Low |
| 3 | Session summarizer cortex job + transcript integration + tests | ~6 | Medium — biggest "is this writing garbage?" risk |
| 4 | Hardening: encryption at rest (ministry), per-agent rate limits, observability charts, backup automation | ~12 | Medium — encryption has rollback risk |
| 4 | Final review. Define success metrics from §10. Decide if v2 features (Graphiti, multi-user) are needed (probably not). | ~3 | — |

**Total: ~88 hrs of focused work over 4 weeks** (was 100 over 5 in v1). At 8–12 focused hrs/week, that's 7–11 calendar weeks solo, or 4–6 weeks if you can delegate Phase 3 components to an agent under tight specs.

---

## 12. Tactical first move (today)

Don't start coding. Start with **triage** so you don't repeat the cross-fork chaos:

1. **Sync local with origin.** `cd /Users/Joshua/boardroom-platform && git pull origin main` — get the 33 commits you're behind.
2. **Push your one local-only commit.** `git push origin main` — get on parity.
3. **Diff windsurf folder vs. GitHub main.** Decide which commits in `~/windsurf boradroom test` are worth porting back. Cherry-pick those, archive the folder.
4. **Triage the 14 `worktree-agent-*` branches.** Run `git log --oneline -1 <branch>` for each. Keep what's unique, delete the rest.
5. **Close PR #1 (April 8, 5 tasks stalled) and PR #4 (May 1, draft).** Either merge, close, or convert to issues. Don't let them rot.
6. **Then start Phase 1.**

Steps 1–5 are 1–2 hours. Skipping them means building the memory layer on top of a chaotic foundation, which will compound the problem you're trying to solve.

---

## 13. What this plan does NOT include (intentionally)

- Mem0 or OpenMemory — already tried, already broken, no upside vs. OmniMind.
- Graphiti / Zep — your schema already does what they sell (`validAt`, `invalidAt`, `supersededBy`, `version`).
- Letta — wrong tool for interactive agents.
- **Obsidian sync — killed in v2.** Replaced by `/admin/memory` viewer + one-shot Markdown export CLI.
- A new database — pgvector + pg_trgm + tsvector is enough.
- A separate frontend — BoardRoom AI's `/admin/memory` is the frontend.
- Multi-user — defer until you have a second user. Tenant model is in place to make that easy when needed.
- A SaaS offering — that's a v2 conversation. Make it work for you first.
- A separate vector DB / knowledge graph engine — Postgres + pgvector handles your scale.

---

## 14. Decisions locked (v2 — see §"DECISIONS LOCKED" at the top)

All five open questions from v1 are answered. Summary:

| # | Decision |
|---|---|
| 1 | Hybrid embeddings: OpenAI default, Ollama `bge-base-en-v1.5` for `domain: ministry` |
| 2 | Three tenants on day 1: `josh-personal`, `josh-business`, `tgfc-ministry` |
| 3 | Role-based write scopes (no single primary writer); Code = full, Desktop = mid, Cursor + ChatGPT = read-only |
| 4 | `/admin/memory` viewer in BoardRoom AI; no Obsidian sync |
| 5 | Same Railway service as OmniMind API for v1 |

Plus 5 patterns adopted from successful production memory systems:
- Fact extraction + dedup at write time (Mem0's edge)
- `sourceWeight` aggressively applied in retrieval ranking
- Forgetting curve in default search
- Session summarizer fallback (background Haiku extraction)
- Codified read/write cadence in `MEMORY-PROTOCOL.md`

---

## 15. Tactical first move (today)

Don't start coding. Triage first:

1. `git pull origin main` — sync the 33 commits you're behind.
2. `git push origin main` — get parity.
3. Diff the windsurf folder vs GitHub. Cherry-pick keepers, archive the rest.
4. Triage the 14 `worktree-agent-*` branches. Most are dead.
5. Close PR #1 (April 8, 5 tasks stalled) and PR #4 (May 1, draft).
6. **Then** start Phase 1 from §4.

Steps 1–5 are 1–2 hours. Skipping them = building the memory layer on top of the same problem.

---

*This plan (v2) supersedes v1 and any previous memory-layer recommendations. Phase 1 is ready to start. The single highest-leverage piece is the **fact extractor + dedup pipeline** — do not skip it for speed.*
