# OmniMind Memory Protocol

Rules for agents using the MCP memory layer. Read this before using any tool.

---

## The Cardinal Rule

**Search before you write.** `memory_search` is free. Duplicate writes pollute the store and create contradiction alerts. If you find an existing memory that matches what you're about to write, supersede it — don't create a new one.

---

## When to Use Each Tool

### `memory_write`

Use when you learn something durable — a preference, a decision rationale, a person's context, a project constraint, a blocker. Not for ephemeral info or things that belong in a task.

**Write if:**
- Josh stated a preference ("I want to use Postgres for this")
- Something was decided and the rationale matters ("Chose Railway over Render because of TCP socket support")
- A fact about a person was revealed ("Sarah is the CTO at Acme, reports to Josh")
- A blocker surfaced that isn't attached to a specific task

**Don't write if:**
- It's a transient status update that will be overwritten in hours
- It belongs in a task (`task_upsert`) or decision (`decision_log`)
- You just want to remember what was discussed — use `memory_search` to check if it's already there

**Fact extraction happens automatically.** You pass prose; the extractor pulls atomic facts. Don't pre-chunk. One good paragraph beats seven micro-fragments.

### `memory_search`

Use at the start of any work session to establish what's already known. Use before writing to avoid duplicates. Use when you need context that wasn't in your prompt.

**Phase 6:** `memory_search` is hybrid retrieval (`POST /memories/search`): semantic + full-text + trigram, re-ranked with the forgetting curve — the same stack the BoardRoom personas use, not a substring scan. Results carry a `score`. Optional `asOf` (ISO) returns only facts valid at that moment; `includeArchived: true` adds ARCHIVED rows. Pages are ≤20; follow `nextCursor` with `cursor` for more.

Good queries:
- `"josh preferences typescript"` — retrieve preference facts
- `"tgfc ministry website"` — retrieve ministry project context
- `"sarah acme relationship"` — retrieve person context
- `"railway deployment blockers"` — retrieve blocker history

Bad queries:
- `"everything"` — too broad, useless ranking
- `"what does josh like"` — too vague, won't hit indexed facts

### `memory_supersede`

Use when you have a memory ID that is no longer true and a replacement fact. The old memory is marked superseded, not deleted — it remains in audit history.

Only supersede if you have the ID. If you're not sure which memory to supersede, use `memory_write` with `type: 'context'` — the fact extractor will detect the duplicate and merge.

### `memory_reflect` (Phase 6)

`{ entityType: 'goal'|'project'|'person', entityId, userId }` → regenerates that entity's **context capsule** now (`POST /context/reflect`: summary, open risks, unresolved questions, recent changes, active stakeholders; Haiku, Zod-validated) and returns it. Use it before a review of a goal/project/person when the nightly reflection job hasn't caught up, or after a burst of writes. Requires `memory:write` (it stores the capsule) and is idempotent — reflecting twice yields the same capsule with `version++`.

### `memory_consolidate` (Phase 6)

`{ userId, dryRun?: true, limit?: 20 (≤50), domain? }` — the "dream" pass. Scans the most recent memories, finds near-duplicates (`POST /memories/search-similar`, cosine ≥ 0.92) and proposes `{ keepId, archiveId, similarity }` pairs (keep = higher importance, tie → newer). **Default `dryRun: true` only proposes.** With `dryRun: false` each pair is applied as `PATCH /memories/:keepId { supersedes: archiveId }` — the archived row gets `invalidAt` / `supersededBy`, nothing is deleted. Always run the dry run first and read the pairs. Ministry rows are never scanned. Requires `memory:write`; the tool is annotated `destructiveHint: true` because of the non-dry-run path.

### `graph_neighborhood` (Phase 6)

`{ nodeId: '<type>:<refId>', hops?: 1|2, userId }` → BFS over `GET /graph/backlinks` returning `{ nodes, edges, truncated }` in the shared `KnowledgeGraphNode` / `KnowledgeGraphEdge` shapes, capped at 60 nodes. Node types: `goal | project | task | person | decision | commitment | memory`. Use it to see what a project touches (people, decisions, tasks, memories) before changing it. Read-only (`memory:read`). The same walk is exposed as the `omnimind://{tenant}/graph/{nodeId}` resource at hops=2.

### `decision_log`

Use when a **decision is made**, not when one is being considered. Decisions have a question, a chosen path, and optionally a rationale and alternatives.

**Good:** "Josh decided to use Railway Private Networking instead of public domain calls for the OmniMind → BoardRoom link."

**Bad:** "Josh is thinking about whether to use Railway Private Networking." (Not a decision yet.)

### `task_upsert`

Use when work needs to be tracked with status, effort, and a project link. Tasks are the execution layer — decisions produce tasks, roadmaps produce tasks.

- `status: 'todo'` — not started
- `status: 'in_progress'` — actively being worked
- `status: 'blocked'` — waiting on something (add a reason)
- `status: 'done'` — complete

Always include `projectId` if you know it. Orphan tasks are hard to surface.

### `task_complete` / `task_block`

Prefer these over `task_upsert` for status transitions — they're explicit and produce cleaner audit trails.

### `commitment_log`

Use when Josh makes a commitment to someone or something external. Not for internal todos — those are tasks. Commitments are promises with a who and a when.

**Good:** "Josh committed to delivering the memory protocol doc to the team by Friday."

**Bad:** "Josh will write tests." (That's a task, not a commitment to someone.)

### `status_get`

Run this at the start of a session to get a snapshot of active decisions, in-progress tasks, blockers, and open commitments. It runs four searches in parallel and returns a composite view. **Phase 6:** it also returns `commitmentsDueSoon: { dueSoon, overdue }` from `GET /commitments/nudges` (commitments due within 3 days or past deadline). If that endpoint is unavailable the rest of the snapshot still returns and `commitmentsDueSoon.error` says why.

This is your "what's the state of the world" tool. Use it before diving into any sustained work.

### `project_status` / `project_summary`

Use when you need to understand the health of a specific project — its tasks, their statuses, linked people, and blockers. `project_summary` includes recent decision history.

### `person_get`

Use when you need to recall who someone is — their role, relationship to Josh, contact history, or project involvement. Always check before writing new person context — the fact extractor will deduplicate, but `person_get` is cheaper.

---

## Domain Routing (Critical)

| Domain | Where Content Goes | Embedding |
|--------|-------------------|-----------|
| `personal` | Josh personal vault | OpenAI |
| `business` | Josh business vault | OpenAI |
| `code` | Technical decisions, architecture | OpenAI |
| `ministry` | TGFC pastoral data | **Ollama (local only)** |

**Ministry domain is air-gapped from OpenAI.** If Ollama is unavailable, writes to `domain: 'ministry'` are refused. Do not retry with a different domain — wait for Ollama to come back up.

---

## Fact Quality Rules

The extractor runs automatically, but help it produce good output:

1. **Use full names and subjects.** "He decided" → fact extractor can't resolve the pronoun. "Josh decided" is parseable.
2. **One topic per write call.** Don't bundle "ministry website redesign + sarah CTO role + railway migration" in one write — they'll be extracted as separate facts anyway, but long inputs hit token limits.
3. **State the conclusion, not the journey.** "After discussion, Josh decided to use PostgreSQL" → good. "We talked about options and eventually..." → wastes tokens, produces fuzzy facts.
4. **Type selection matters:**
   - `decision` — something resolved with a chosen path
   - `blocker` — something preventing progress
   - `status` — current state of a project/effort
   - `context` — background knowledge, relationships, constraints
   - `preference` — how Josh likes things done

---

## Session Protocol

**Start of every session:**
```
1. Run status_get — what's the current state?
2. Run memory_search for the specific domain you're working in
3. Check for open blockers that affect your work
```

**End of every session:**
```
1. Write a context memory: what you worked on and what's next
2. Log any decisions made (decision_log)
3. Update task statuses (task_complete / task_block / task_upsert)
4. Log any commitments made (commitment_log)
```

**The memory layer is only valuable if it's used consistently.** An agent that reads but never writes is a consumer. An agent that writes without reading creates pollution. Both patterns break the system.

---

## Tool Reference (18 tools)

Every tool is registered with MCP spec 2025-11-25 **annotations** (hints — the server still enforces scopes), a Zod **`outputSchema`** (from `@boardroom/shared` `validation/mcp.schema.ts`), and returns the same object as **`structuredContent`** alongside the JSON text block. `openWorldHint` is `false` on every tool: nothing here reaches the open internet.

| Tool | Scope | readOnly | destructive | idempotent | Pagination / idempotency |
|------|-------|:-:|:-:|:-:|---|
| `memory_write` | `memory:write` | – | – | – | `idempotencyKey` |
| `memory_search` | `memory:read` | ✓ | – | ✓ | `cursor` → `nextCursor`, page ≤ 20 |
| `memory_supersede` | `memory:write` | – | **✓** | – | |
| `memory_reflect` | `memory:write` | – | – | ✓ | |
| `memory_consolidate` | `memory:write` | – | **✓** (only when `dryRun=false`) | – | |
| `decision_log` | `decision:write` | – | – | – | `idempotencyKey` |
| `task_upsert` | `task:write` | – | – | ✓ | `idempotencyKey` |
| `task_status` | `memory:read` | ✓ | – | ✓ | |
| `task_list` | `memory:read` | ✓ | – | ✓ | `cursor` → `nextCursor`, page ≤ 20 |
| `task_complete` | `task:write` | – | – | ✓ | |
| `task_block` | `task:write` | – | – | ✓ | |
| `project_status` | `memory:read` | ✓ | – | ✓ | |
| `project_summary` | `memory:read` | ✓ | – | ✓ | |
| `person_get` | `memory:read` | ✓ | – | ✓ | |
| `commitment_log` | `commitment:write` | – | – | – | `idempotencyKey` |
| `commitment_list` | `memory:read` | ✓ | – | ✓ | `cursor` → `nextCursor`, page ≤ 20 |
| `status_get` | `memory:read` | ✓ | – | ✓ | includes `commitmentsDueSoon` |
| `graph_neighborhood` | `memory:read` | ✓ | – | ✓ | capped at 60 nodes |

### Idempotency keys

`memory_write`, `task_upsert`, `decision_log` and `commitment_log` accept an optional `idempotencyKey` (string, ≤128 chars). It is sent to OmniMind as the `Idempotency-Key` header; the same (agent, key) within 24 h replays the original result (`Idempotent-Replayed: true`) instead of writing again. **Use it whenever you might retry** — the 0.80/0.92 cosine dedup is a safety net, not a guarantee. For `memory_write` the key covers the whole call; each extracted fact is written under `<key>:<n>` so a replay returns the same rows.

### Pagination

`memory_search`, `task_list` and `commitment_list` page at ≤20 items and return `nextCursor` (an opaque string, `null` on the last page). Pass it back as `cursor` to continue; never construct or parse cursors yourself. A cursor from another tool or server is rejected with `VALIDATION_ERROR`.

## Scope Reference

| Scope | Grants |
|-------|--------|
| `memory:read` | `memory_search`, `person_get`, `status_get`, `project_status`, `project_summary`, `task_status`, `task_list`, `commitment_list`, `graph_neighborhood` |
| `memory:write` | `memory_write`, `memory_supersede`, `memory_reflect`, `memory_consolidate` |
| `decision:write` | `decision_log` |
| `task:write` | `task_upsert`, `task_complete`, `task_block` |
| `commitment:write` | `commitment_log` |
| `*` | All of the above |

Scope violations return `SCOPE_DENIED` — not an error to retry, an error to report to the agent operator.

---

## Resources (Phase 6)

Four narrow `omnimind://` resources for clients that prefer resources over tools (`application/json`). `{tenant}` **must equal the server's bound tenant** — any other value is refused (`TENANT_MISMATCH`). Resources have no argument channel, so they read as the user in `OMNIMIND_MCP_USER_ID`; when that env is unset they return `{ error: 'NO_USER_BOUND' }` rather than guessing.

| URI | Returns |
|-----|---------|
| `omnimind://{tenant}/status` | The `status_get` payload (also listed under `resources/list` for the bound tenant) |
| `omnimind://{tenant}/goal/{id}` | `{ goal, capsule }` — `GET /goals/:id` + `GET /context/capsules?entityIds=goal:{id}` |
| `omnimind://{tenant}/person/{id}` | `{ person, capsule }` |
| `omnimind://{tenant}/graph/{nodeId}` | 2-hop `graph_neighborhood` around `<type>:<refId>` (≤60 nodes) |

Not exposed on purpose: the whole graph as one resource, a `memory_delete` tool (use supersede/invalidate), or a 1:1 mirror of the tools.

## Prompts (Phase 6)

Three prompts encode the session protocol below so every client gets the same ritual:

| Prompt | Args | What it instructs |
|--------|------|-------------------|
| `session_start` | `domain?` | `status_get` first, then a focused `memory_search` for the domain; read blockers / overdue commitments; search before you write |
| `decision_review` | `decisionTitle` | `memory_search` (incl. archived) for the decision, test each assumption against memory, check `status_get`, state keep / revise / reverse, record via `decision_log` / `memory_supersede` |
| `session_end` | – | one `memory_write` context summary (what was done + what's next), then `decision_log`, task transitions, `commitment_log` |

---

## Tenant Boundaries

| Tenant ID | Contents | Who writes |
|-----------|----------|------------|
| `josh-personal` | Personal goals, relationships, non-work decisions | claude-desktop-josh, chatgpt-desktop-josh |
| `josh-business` | Business strategy, projects, technical decisions | claude-code-josh, boardroom-ai, cortex-summarizer |
| `tgfc-ministry` | Ministry projects, pastoral data, church context | claude-desktop-josh (ministry scope) |

Cross-tenant reads are not supported. Each agent operates in its own tenant — you cannot read another tenant's memories.
