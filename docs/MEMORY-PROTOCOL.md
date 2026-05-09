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

Run this at the start of a session to get a snapshot of active decisions, in-progress tasks, blockers, and open commitments. It runs four searches in parallel and returns a composite view.

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

## Scope Reference

| Scope | Grants |
|-------|--------|
| `memory:read` | `memory_search`, `person_get`, `status_get`, `project_status`, `project_summary`, `task_status`, `task_list`, `commitment_list` |
| `memory:write` | `memory_write`, `memory_supersede` |
| `decision:write` | `decision_log` |
| `task:write` | `task_upsert`, `task_complete`, `task_block` |
| `commitment:write` | `commitment_log` |
| `*` | All of the above |

Scope violations return `SCOPE_DENIED` — not an error to retry, an error to report to the agent operator.

---

## Tenant Boundaries

| Tenant ID | Contents | Who writes |
|-----------|----------|------------|
| `josh-personal` | Personal goals, relationships, non-work decisions | claude-desktop-josh, chatgpt-desktop-josh |
| `josh-business` | Business strategy, projects, technical decisions | claude-code-josh, boardroom-ai, cortex-summarizer |
| `tgfc-ministry` | Ministry projects, pastoral data, church context | claude-desktop-josh (ministry scope) |

Cross-tenant reads are not supported. Each agent operates in its own tenant — you cannot read another tenant's memories.
