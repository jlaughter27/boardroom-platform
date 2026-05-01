# Memory Editor UI

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). In particular, ADR-006 (soft-delete only) governs the deletion flow.

---

## Problem

Today, the user has no way to see or fix what OmniMind "knows" about them. Memories are extracted by an LLM, stored in Postgres, and surfaced indirectly through persona answers. When the model gets a fact wrong — wrong project name, wrong commitment, hallucinated number — the user has three options:

1. Argue with the model in chat (doesn't fix the underlying memory)
2. Email support
3. Quietly stop trusting the system

Every consumer memory product (ChatGPT Memory, Notion AI, Granola, Reflect) eventually ships a "see and edit your memory" surface for the same reason: **trust requires legibility**. Users tolerate AI getting things wrong if they can correct it. They don't tolerate AI being wrong about them with no recourse.

A memory editor closes the loop. It also doubles as the surface where re-import conflicts (from [markdown-export-import.md](markdown-export-import.md)) get resolved, and where users can verify that their GDPR-export request actually returned everything (see [data-export-gdpr.md](data-export-gdpr.md)).

## Approach

A new section in the BoardRoom UI: **Memory** (top-level nav, alongside Sessions, Decisions, Roadmap). Three views:

### 1. List + search

Paginated table of all memories. Default sort: `createdAt` desc. Columns:

- Snippet (first 120 chars)
- Domain (badge)
- Confidence (visual indicator)
- Created
- Source (session / extraction / manual / MCP / vault import)
- Linked entities (chips)

Filters at the top: domain, date range, confidence threshold, source, entity. Search box queries the same hybrid retrieval stack as the persona context — semantic + FTS + trigram.

### 2. Detail + edit

Click a row, open a side panel with full content + metadata. Editable fields:

- `content` (textarea)
- `domain` (dropdown)
- `confidence` (slider, 0.0-1.0)
- `tags` (multi-select with autocomplete)
- `entities` (chips, add/remove with entity-search)
- `validAt` (date picker — when the fact became true)

Read-only fields: `createdAt`, `embeddingHash`, `source`, `linkedDecisions`, `linkedTasks`.

Edits go through the existing validation pipeline (`memory/validation/pipeline.ts`) — schema check, temporal check, budget check. On success, the entry is updated in place AND a new `embedding` is queued (since content changed).

### 3. Soft-delete + restore

Per ADR-006, no hard deletes from the editor. The "Delete" button sets `deletedAt = now()` and removes the entry from all retrieval signals. A "Recently deleted" tab shows soft-deleted entries with a "Restore" action. After 30 days (configurable), a scheduled job hard-deletes — the same pipeline as GDPR account deletion (see [data-export-gdpr.md](data-export-gdpr.md)).

### 4. Related entities + extraction events

In the detail panel, two sub-sections:

- **Related entities** — clickable chips for every linked Person, Goal, Project, Task. Click jumps to the entity page with all its memories.
- **Extraction events** — timeline of every event tied to this memory: extracted from session X, validated at T, embedded at T+1, contradicted by memory Y on T+30, restored on T+45, etc. Pulls from a new `MemoryAuditLog` table (foundation for GDPR audit trail too).

## What's NOT in scope

- **Markdown editing.** The vault feature (Phase 11) is the answer for users who want to edit memories as files. The editor UI is the structured, in-app surface; the vault is the file-based surface. Two paths, one source of truth.
- **Bulk edit.** Power-user flow; defer until usage data shows demand. v1 supports bulk soft-delete only.
- **Manual memory creation from scratch.** v1 is edit-existing. Manual creation comes later (or via the SDK).
- **Per-field redaction.** Power-user / compliance feature; defer.

## Schema impact

```prisma
model MemoryAuditLog {
  id          String   @id @default(cuid())
  memoryId    String
  event       String   // "created" | "updated" | "validated" | "embedded"
                       // | "soft_deleted" | "restored" | "hard_deleted"
                       // | "contradicted_by" | "edited_by_user"
  actor       String   // userId | "system" | "cortex" | "extraction"
  metadata    Json?    // event-specific payload
  createdAt   DateTime @default(now())

  memory      MemoryEntry @relation(fields: [memoryId], references: [id])

  @@index([memoryId, createdAt])
}
```

`MemoryEntry` already has `validAt`, `deletedAt`, `confidence`, `domain` columns; no schema change needed for those. The audit log is the only new table.

## API surface

- `GET /v1/memories?domain=&q=&from=&to=&limit=&cursor=` — list with filters
- `GET /v1/memories/:id` — detail including related entities
- `PATCH /v1/memories/:id` — edit (goes through validation pipeline)
- `DELETE /v1/memories/:id` — soft-delete
- `POST /v1/memories/:id/restore` — un-soft-delete (within 30-day window)
- `GET /v1/memories/:id/audit` — audit log timeline

## Phases

- [`../04-roadmap/PHASE-11-markdown-export/`](../04-roadmap/PHASE-11-markdown-export/) — ships in the same phase as markdown export; shared concerns (audit log, validation pipeline edits)

Estimated effort: ~2-3 weeks (UI components + backend routes + audit-log wiring).

## Risks

- **Edits cascade unexpectedly.** If a user edits a memory's content, the embedding regenerates, the linked-entity extraction may need to re-run, downstream cortex outputs that referenced the old content go stale. Mitigation: changing content triggers re-embedding async; entity-link extraction re-runs on user opt-in only; cortex outputs reference memories by ID so they auto-pick up edits next run.
- **User edits introduce bad data.** Mitigation: validation pipeline still runs; confidence slider can't exceed model-derived ceiling; audit log preserves before/after for forensic recovery.
- **Race between cortex jobs and user edits.** Mitigation: optimistic locking via `updatedAt`; UI shows "this memory was updated by cortex; refresh?" if version is stale.
- **Performance on large memory sets.** Mitigation: cursor-based pagination; indexed search; client-side virtualization for > 1k rows.
- **Information disclosure.** Showing memory metadata to the user is fine; showing it across team boundaries (in Phase 18+) is not. Mitigation: scope every query by `userId`; revisit when multi-tenant teams ship.

## Success metrics

- ≥ 40% of paying users open the memory editor within 30 days of feature launch
- Median time-to-edit < 30s (proxy for UI clarity)
- < 2% of edits flagged by validation pipeline as malformed
- ≥ 20% of editor sessions result in at least one edit or soft-delete (proxy for utility)
- "I trust the system" survey score increases by ≥ 1 point post-launch

## Dependencies on other features

- **GDPR data export + deletion** (Phase 13) — shares the soft-then-hard delete pipeline and the audit log
- **Markdown export + import** (Phase 11) — shares the validation pipeline; conflict resolution surfaces here
- **Retrieval explainability** (Phase 14) — the "why was this memory surfaced?" panel could live in the editor too
- **Webhooks event bus** (Phase 13) — `memory.updated` event fires from edits
