# OmniMind API Contract v1

> Source of truth for all OmniMind endpoints. BoardRoom consumes these.
> Generated from MASTER-FRAMEWORK.md Section 4, April 7 2026.

## Global Conventions

- **Base URL**: `http://localhost:3333` (dev), configurable via `OMNIMIND_API_URL`
- **Auth**: Every request (except `GET /health` and `GET /ready`) requires `x-api-key` header matching `OMNIMIND_API_KEY` env var
- **User scoping**: Every data-mutating or data-reading endpoint requires `x-user-id` header. ALL queries are scoped to this user. No cross-user data access.
- **Agent identity (MCP callers, 2026-10-02)**: `x-agent-key: omk_…` is verified against `agents.api_key_hash`; when present, `agentId`/`tenantId`/`scopes`/`sourceWeight` come from the agent row and any disagreeing `x-agent-id` / `x-tenant-id` / `x-source-weight` header → `403 agent_header_mismatch`. Without `x-agent-key` the legacy header triple is accepted unverified (solo mode) unless `OMNIMIND_REQUIRE_AGENT_KEY=true`; a **partial** triple (`x-agent-id` without `x-tenant-id` and/or `x-source-weight`) is refused with `400 partial_agent_identity { fields }` and never falls through to the unscoped BoardRoom path (2026-10-20, E2E-5). Verified agents have `Agent.scopes` enforced per route.
- **Scope rules (verified agents, 2026-10-03)**: `GET`/`HEAD` on `/memories`, `/context`, `/decisions`, `/tasks`, `/commitments`, `/projects`, `/people`, `/goals`, `/graph`, `/cortex`, `/usage` → `memory:read`. The POST reads `POST /memories/search`, `POST /memories/search-similar`, `POST /memories/validate`, `POST /context/for-persona` → `memory:read` (and are billed against the agent's `read` rate bucket). Writes: `/decisions` → `decision:write`, `/tasks` → `task:write`, `/commitments` → `commitment:write`, `/projects` → `project:write`; `/memories` (+ links), `/people`, `/goals`, `POST /context/reflect`, `/graph` link writers, `/cortex` scans/patches/generate/simulate, `POST /usage/llm` → `memory:write`. Missing scope → `403 insufficient_scope { required, agentId }`. Wildcards: `*`, `<prefix>:*`.
- **Tenant scoping**: when agent context is present, reads are scoped to its tenant. `?tenantId=` that disagrees → `403`. Cross-tenant views require `x-admin-key` + `?includeAllTenants=true`.
- **Admin**: `/admin/*` and `POST /mcp/agents` require `x-admin-key` matching `OMNIMIND_ADMIN_KEY` (timing-safe). Unset in production → `503 admin_disabled`. `GET /usage/llm/summary?all=1` is gated by the same header (→ `403 admin_required`, see below).
- **Delegated identity (per-user MCP, 2026-10-18)**: a verified agent whose row holds the gateway-only scope `mcp:delegate` may add `x-mcp-principal: token:<mcpTokenId>` or `oauth:<mcpOauthIdentityId>`. The request then runs AS that principal: `agentId = row.agentName`, `tenantId`, `sourceWeight` and `scopes = principal.scopes ∩ (gateway.scopes − mcp:delegate)` come from the McpToken / McpOauthIdentity row, and the context carries `delegated: true, userId: row.userId`. Unknown / revoked / expired / malformed principal → `401 principal_invalid { reason }`. `x-mcp-principal` from any caller that is not a verified `mcp:delegate` agent → `403 delegation_not_allowed`. A delegated request may only act for its own user: a `?userId=`, `body.userId` or `x-user-id` that differs → `403 user_mismatch { field }`; when none is supplied on `/memories`, `/context`, `/decisions`, `/tasks`, `/goals`, `/projects`, `/people`, `/commitments`, `/graph`, `/mcp/audit` the principal's userId is injected (query, body for POST/PATCH/PUT, and the `x-user-id` header). `mcp:delegate` is never grantable to a token and `*` does not imply it. A delegated request is additionally ALLOW-listed to the entity families + `POST|GET /mcp/audit` + `POST /usage/llm` (`403 delegated_route_forbidden` elsewhere, e.g. `/auth`, `/oauth`, `/mcp/tokens*`, `/mcp/agents`, `/admin`). See **MCP** below.
- **Idempotency scope**: `Idempotency-Key` replay is scoped to `agent:<agentId>:user:<x-user-id>` for a verified agent and `user:<x-user-id>` otherwise (BoardRoom and unverified legacy agents). For a delegated request `<agentId>` is the principal's `agentName`, so two users behind one gateway never share a replay namespace; the agent rate-limit buckets are keyed the same way (per principal, not per gateway).
- **Rate limits**: per-user, per-agent and audit buckets; callers without an identity header are keyed by IP (never skipped). Per-user buckets: reads get `USER_READ_RATE_LIMIT_PER_MINUTE` (default 120, floor 20) because one BoardRoom dashboard or graph load fans out to 20–40 reads; writes keep `MAX_QUERIES_PER_MINUTE` (20) per method. Reads are GET/HEAD **and the POST reads** `POST /memories/search`, `/memories/search-similar`, `/memories/validate`, `/context/for-persona` (2026-10-23: counting those as writes let one decision dispatch — one `/context/for-persona` per persona — or an MCP client searching hard exhaust the write budget and lock the user out of every POST).
- **Content-Type**: `application/json` for all request/response bodies
- **Timestamps**: ISO 8601 strings in JSON. Parsed to `Date` internally.
- **IDs**: CUID strings generated by Prisma

## Error Responses

All errors follow this shape:

```typescript
// 422 — Validation failure
{
  error: "validation_failed",
  details: [{ field: string, message: string }]
}

// 404 — Not found
{
  error: "not_found",
  message: string
}

// 401 — Unauthorized (missing/invalid API key)
{
  error: "unauthorized",
  message: "Invalid or missing API key"
}

// 429 — Rate limited
{
  error: "rate_limited",
  message: string,
  retryAfter: number // seconds
}

// 409 — Conflict (e.g. PATCH on a superseded memory)
{
  code: "memory_superseded",
  message: string // names the superseding memory id
}

// 500 — Internal error
{
  error: "internal_error",
  message: string // never leaks stack traces in production
}
```

---

## Health

### GET /health

No auth required. Liveness: always HTTP 200 (`railway.toml` uses `healthcheckPath = "/health"`), even when the database is down.

**Response 200:**
```typescript
{
  status: "ok" | "degraded",
  service: "omnimind-api",
  version: string,   // RAILWAY_GIT_COMMIT_SHA, or "dev" locally (M0-A2)
  timestamp: string, // ISO 8601
  dbConnected: boolean
}
```

### GET /ready

No auth required (M0-A2). Readiness: `SELECT 1` with a 3 s timeout.

**Response 200 / 503:**
```typescript
{
  status: "ready" | "not_ready",   // 503 when not_ready
  service: "omnimind-api",
  version: string,
  timestamp: string,
  checks: { db: "ok" | "fail" }
}
```

---

## Idempotency (Phase 6)

`POST /memories`, `POST /people`, `POST /goals`, `POST /projects`, `POST /tasks` (and, from lane A1, `POST /decisions` / `POST /commitments`) honour an `Idempotency-Key` header (≤128 chars, else 400).

- **Scope:** `agentContext.agentId` when the request carries a verified/legacy agent identity, else `x-user-id`.
- **Hit** (same scope + key, within 24 h): the stored body is replayed with the original status and the header `Idempotent-Replayed: true`; the handler does not run.
- **Miss:** the handler runs; a 2xx JSON response is stored (`IdempotencyKey.resultJson = { status, body }`, `resultId = body.id`). Non-2xx responses are not stored, so a retry re-runs the handler.
- Reusing a key on a different route → 422 `idempotency_key_reused`.
- Concurrent duplicates: the unique `(scope, key)` constraint makes the loser re-read and replay the winner's stored result.
- Expired rows are deleted lazily (at most once per 10 minutes).

## Memories

### POST /memories

Create a memory. Runs sync validation pipeline (schema → temporal → budget).

**Request:**
```typescript
{
  title: string,           // required
  content: string,         // required
  domain: string,          // required
  sector?: string,         // default ""
  tags?: string[],         // default []
  memoryClass?: MemoryClass, // default SEMANTIC
  importance?: number,     // 0-1, default 0.5
  confidence?: Confidence, // default MEDIUM
  sourceType: SourceType,  // required
  sourceRef?: string,
  metadata?: Record<string, unknown>,
  dedup?: boolean          // default true; false skips the near-duplicate auto-supersede (2026-10-23)
}
```

**Near-duplicate auto-supersede:** on an agent write (agent headers present), a live memory in the caller's tenant with cosine similarity > 0.92 is **updated in place** (title and content replaced, tags merged) and the response is `{ id: <existing id>, status: "updated" }`. `dedup: false` skips that search and always creates — for bulk importers that key their own rows (`scripts/vault-import.mjs` syncs by vault path) and must not let one note overwrite another. BoardRoom writes (no agent headers) never dedup.

**Response 201:**
```typescript
{
  id: string,
  status: "created",
  validation: {
    syncPassed: boolean,
    errors: []             // empty on success
  }
}
```

**Response 422:** Validation failure (schema, temporal, or budget). `title` / `content` containing NUL (U+0000) → 422 `must not contain NUL (U+0000) characters` (2026-10-23; it used to reach Postgres and answer 500). Same rule on `PATCH /memories/:id`.

### POST /memories/search (Phase 6)

Hybrid search for MCP and BoardRoom — the **same retrieval stack as `POST /context/for-persona`** (structured + FTS + trigram + semantic → `rankAndDeduplicate`, forgetting curve inside the layers, decrypt). No persona tag boosts, no token budget, no recall reinforcement.

**Full-text layer (2026-10-23):** a strict pass first (every query word must match); when it returns fewer than the layer limit, a ranked any-word pass fills the remaining slots below the strict hits, scored at half weight (`whyIncluded: "Partial full-text match …"`). Before this, natural-language questions rarely matched every word, so the full-text layer returned nothing and recall depended on embeddings being available. Labeled IR eval in CI (mock embeddings): `/context/for-persona` recall@10 0.520 → 0.718, MRR 0.440 → 0.532; `/memories/search` recall@10 0.535 → 0.826, MRR 0.549 → 0.688.

**Request:**
```typescript
{
  query: string,              // required, ≤2000 chars
  limit?: number,             // 1–50, default 20
  domain?: string,            // normalized (trim + lowercase)
  tags?: string[],            // ALL tags must be present (hasEvery)
  status?: MemoryStatus,      // exact match; default excludes ARCHIVED (layers never return ARCHIVED)
  includeArchived?: boolean,  // lifts the forgetting-curve filter (not the ARCHIVED status filter)
  asOf?: string,              // ISO 8601 — rows valid at that instant (valid_at ≤ asOf < invalid_at)
  cursor?: string | null      // opaque, from a previous nextCursor
}
```

**Response 200:**
```typescript
{
  items: Array<Memory & { score: number }>,   // ranked, score ∈ [0,1]
  nextCursor: string | null                   // opaque base64 of { offset }
}
```

**Tenant:** from `req.agentContext` (MCP). A BoardRoom call (no agent context) searches all of the user's tenants, like `/context/for-persona`.
**Errors:** 400 `invalid_cursor` · 422 validation.

### GET /memories/:id

**Response 200:** Full `Memory` object (see shared types)

**Response 404:** Memory not found or not owned by user

### GET /memories

Search/filter memories.

**Query params:**
- `q` — text search (FTS + trigram, when retrieval engine is active)
- `domain` — exact match
- `tags` — comma-separated, AND logic
- `memoryClass` — exact match
- `status` — exact match (default: excludes ARCHIVED)
- `since` — ISO date, filter createdAt >= since
- `sortBy` — `createdAt` | `importance` | `updatedAt` (default: `createdAt`)
- `sortOrder` — `asc` | `desc` (default: `desc`)
- `limit` — integer, default 20, max 100
- `offset` — integer, default 0

**Response 200:**
```typescript
{
  items: Memory[],
  total: number,
  offset: number,
  limit: number
}
```

**Invalidated rows (2026-10-03):** rows with `invalidAt` set (superseded / consolidated away) are hidden by default. `?includeInvalidated=true` opts back in (provenance / audit views). `POST /memories/search-similar` and the create-time dedup never return or merge into invalidated rows.

### PATCH /memories/:id

Partial update. Runs sync validation pipeline.

**Request:** Partial `CreateMemoryRequest` (any subset of fields)

**Response 200:** Updated `Memory` object

**Response 404/422:** As above

**Phase 6 — `supersedes`:** the body may carry `supersedes: <oldMemoryId>`. `:id` is the **new** row; the old row (same user, same tenant when an agent context is present) gets `invalidAt = now(), supersededBy = :id` — its content is never mutated — and `oldId` is appended to `:id`'s `consolidatedFrom`. 404 when the old row is not in scope, 422 on self-supersede. Retrieval layers hide invalidated rows by default (see `asOf`).

**Response 409 `memory_superseded` (2026-10-03):** `:id` is itself invalidated (`invalidAt` / `supersededBy` set). Invalidated rows are frozen — a plain update would resurrect a replaced belief, and letting one act as the keeper of a `supersedes` request could flip a pair and leave both rows invalid. The message names `supersededBy`; PATCH that row instead.

### DELETE /memories/:id

Soft delete (sets status to ARCHIVED, sets deletedAt).

**Response 200:**
```typescript
{ id: string, status: "archived" }
```

### POST /memories/validate

Dry-run validation. No database write.

**Request:** Same as POST /memories

**Response 200:**
```typescript
{
  valid: boolean,
  errors: [{ field: string, message: string }],
  durationMs: number
}
```

---

## People

### POST /people

**Request:**
```typescript
{
  name: string,            // required
  role?: string,
  domains?: string[],
  importance?: number,     // 0-1, default 0.5
  relationshipToUser?: string,
  notes?: string
}
```

**Response 201:** Created `Person` object

### GET /people/duplicates (Phase 6)

Probable duplicate people via `pg_trgm similarity(a.name, b.name) >= threshold` (each unordered pair once, `a.id < b.id`). Name-only (Person has no email column). No auto-merge. **Mounted before `/people/:id`.**

**Query params:** `threshold` (0.3–1, default 0.6) · `limit` (1–200, default 100)

**Response 200:** `{ pairs: Array<{ a: Person, b: Person, similarity: number }> }` — sorted by similarity desc.

### GET /people/:id

**Response 200:** `Person` object

### GET /people

**Query params:** `q` (name search), `domain`, `limit`, `offset`

**Response 200:** `PaginatedResponse<Person>`

### PATCH /people/:id

**Request:** Partial fields

**Response 200:** Updated `Person` object

### DELETE /people/:id

Soft delete.

**Response 200:** `{ id, status: "deleted" }`

---

## Goals

### POST /goals

**Request:**
```typescript
{
  title: string,           // required
  level?: 0 | 1 | 2 | 3,  // default 0
  parentGoalId?: string,
  successMetrics?: string[],
  deadline?: string,       // ISO date
  status?: string,         // default "active"
  domain?: string
}
```

**Response 201:** Created `Goal` object

### GET /goals/:id

**Response 200:** `Goal` object plus `projectIds: string[]` (linked via `GoalProjectLink`). Optionally include `?include=children` to get child goals.

### GET /goals

**Query params:** `level`, `status`, `domain`, `limit`, `offset`

**Response 200:** `PaginatedResponse<Goal>`

### PATCH /goals/:id

### DELETE /goals/:id

Soft delete.

### POST /goals/:goalId/projects/:projectId

Link a project to a goal (`GoalProjectLink`, idempotent on the unique pair). Both entities must belong to `x-user-id` and not be soft-deleted.

**Response 201** `{ id, goalId, projectId }` (200 if the link already existed) · **404** if either entity is missing.

### DELETE /goals/:goalId/projects/:projectId

Remove the link. **204**.

---

## Projects

### POST /projects

**Request:**
```typescript
{
  title: string,           // required
  status?: string,         // default "active"
  deadline?: string,
  successMetrics?: string[],
  domain?: string
}
```

**Response 201:** Created `Project` object

### GET /projects/:id

**Response 200:** `Project` object plus `goalIds: string[]` and `taskIds: string[]`.

### POST /projects/:projectId/tasks/:taskId

Link a task to a project (`ProjectTaskLink`, idempotent). **201** `{ id, projectId, taskId }` / **200** existed / **404**.

### DELETE /projects/:projectId/tasks/:taskId

Remove the link. **204**.

### POST /projects/:projectId/people/:personId (Phase 6)

Assign a person to a project (`ProjectPersonLink`, idempotent on the unique pair). Body `{ role?: string }` (≤120 chars; unknown fields → 422). Both entities must belong to `x-user-id` and not be soft-deleted. When the link exists and a different `role` is sent, the role is updated.

**Response 201** `{ id, projectId, personId, role }` · **200** if it already existed · **404** if either entity is missing.

### DELETE /projects/:projectId/people/:personId (Phase 6)

Remove the link. **204** · **404** when there is no such link.

### POST /projects/:projectId/decisions/:decisionId (Phase 6)

Link a decision to a project (`DecisionProjectLink`, idempotent). **201** `{ id, decisionId, projectId }` · **200** existed · **404**.

### DELETE /projects/:projectId/decisions/:decisionId (Phase 6)

Remove the link. **204** · **404**.

Optionally `?include=tasks` to include linked tasks.

### GET /projects

**Query params:** `status`, `domain`, `limit`, `offset`

### PATCH /projects/:id

### DELETE /projects/:id

Soft delete.

---

## Tasks

### POST /tasks

**Request:**
```typescript
{
  title: string,           // required
  owner?: string,
  status?: string,         // default "pending"
  deadline?: string,
  priority?: number,       // default 0
  estimatedEffort?: number
}
```

**Response 201:** Created `Task` object

### GET /tasks/:id

### GET /tasks

**Query params:** `status`, `priority`, `owner`, `limit`, `offset`

### PATCH /tasks/:id

### DELETE /tasks/:id

Soft delete.

---

### POST /tasks/:taskId/depends-on/:otherTaskId (Phase 6)

`:taskId` depends on `:otherTaskId` (`TaskDependency`, idempotent on the unique pair). Both tasks must belong to `x-user-id` and not be soft-deleted.

**Response 201** `{ id, taskId, dependsOnTaskId }` · **200** existed · **404** missing/foreign · **422** `validation_failed` self-dependency · **409** `dependency_cycle` when the reverse edge already exists (deeper cycles are not walked).

### DELETE /tasks/:taskId/depends-on/:otherTaskId (Phase 6)

Remove the dependency. **204** · **404**.


## Decisions

### POST /decisions

**Request:**
```typescript
{
  title: string,           // required
  question: string,        // required
  options?: object[],      // DecisionOption[]
  constraints?: string[],
  sessionId?: string
}
```

**Response 201:** Created `Decision` object

### GET /decisions/:id

### GET /decisions

**Query params:** `status`, `limit`, `offset`

### PATCH /decisions/:id

Used for: updating status, recording outcome, linking chosen path.

**Special fields:**
- `chosenPath` + `rationale` — records the decision
- `outcome` + `outcomeRating` — records what happened
- `status` — lifecycle transitions: OPEN → DECIDED → REVIEWED → REVISED

**Phase 6 fields (create + update):** `expectedOutcome?: string`, `probabilitySuccess?: number (0..1)`,
`personaForecasts?: {personaId, recommendation, confidence}[]`, `decidedAt?: ISO`, `mode?: string`.
`decidedAt` defaults to now the first time `chosenPath` is set.

### GET /decisions/calibration?successThreshold=4  (Phase 6)

Brier + reliability bins for the user's own `probabilitySuccess` and for each persona's
`personaForecasts[].confidence` (persona counted only where its recommendation matched `chosenPath`,
exact or case-insensitive prefix). Over decisions with `outcomeRating != null && probabilitySuccess != null`.
Bins `[0,.2) [.2,.4) [.4,.6) [.6,.8) [.8,1]`.

**Response 200:** `CalibrationReport` — `{ reviewedDecisions, minimumForSignal: 20, successThreshold,
user: { brier: number|null, bins: CalibrationBin[] }, personas: { [personaId]: { brier, count, bins } } }`

### GET /decisions/changes?entityId=<goal|project|person>:<id>&since=<ISO>  (Phase 6)

"What changed since last time" for an entity. Scoped via `MemoryEntityLink` (memories created or
invalidated since), `DecisionProjectLink` / `GoalProjectLink` / `ProjectPersonLink` (decisions,
commitments), plus the entity's capsule.

**Response 200:** `{ since, memories: MemoryApiRecord[], decisions: Decision[], commitments: Commitment[], capsule: ContextCapsule|null }`

---

## Commitments

### POST /commitments

**Request:**
```typescript
{
  description: string,     // required
  stakeholderId?: string,
  deadline?: string,
  sourceSessionId?: string,
  linkedProjectId?: string
}
```

**Response 201:** Created `Commitment` object

### GET /commitments/:id

### GET /commitments

**Query params:** `status`, `limit`, `offset`

**Special:** `GET /commitments?status=OPEN&overdue=true` — returns commitments past deadline

### GET /commitments/nudges  (Phase 6)

SQL only. OPEN commitments due within 3 days or overdue. Precomputed daily by
`jobs/commitment-nudge-scheduler.ts` (07:00, `COMMITMENT_NUDGE_SCHEDULE`), recomputed live on request.

**Response 200:** `{ dueSoon: Commitment[], overdue: Commitment[] }`

### PATCH /commitments/:id

---

## User Profile

### GET /user-profile

Returns profile for x-user-id. Creates default if none exists (upsert).

**Response 200:** `UserProfile` object

### PATCH /user-profile

Partial update.

**Response 200:** Updated `UserProfile` object

---

## Context (BoardRoom Consumer)

### POST /context/for-persona

The primary retrieval endpoint. BoardRoom calls this before each persona invocation.

**Request:**
```typescript
{
  query: string,           // the user's question
  persona: PersonaId,      // which persona needs context
  userId: string,          // redundant with header but explicit
  maxItems?: number,       // default: RETRIEVAL_CONFIG.maxItemsPerPersona (10)
  includeEntities?: ("memories" | "people" | "goals" | "projects" | "decisions")[],
  asOf?: string            // Phase 6: ISO — every retrieval layer filters
                           //   valid_at <= asOf AND (invalid_at IS NULL OR invalid_at > asOf).
                           //   Absent → (invalid_at IS NULL OR invalid_at > now()).
}
```

**Phase 6 injection:** up to 3 reflection capsules for the goal/project/person entities the question
touches are prepended to `items` (source `structured`, `whyIncluded` starts with `Reflection capsule`).
For `persona: "doer"` an `Open commitments:` item (due ≤3 days / overdue) is prepended first.

**Response 200:**
```typescript
{
  items: ContextItem[],    // ranked, deduplicated, persona-filtered
  tokenEstimate: number,   // estimated tokens for all items combined
  retrievalMetadata: {
    totalCandidates: number,
    layersUsed: string[]   // e.g. ["structured", "fts", "trigram"]
  }
}
```

Where `ContextItem`:
```typescript
{
  type: "memory" | "person" | "goal" | "project" | "decision",
  id: string,
  content: string,         // the rendered text to inject into persona prompt
  relevanceScore: number,  // 0-1
  source: "structured" | "fts" | "trigram" | "semantic",
  whyIncluded: string      // human-readable explanation
}
```

### POST /context/session-summary

Removed (was a Phase 1 stub). See `jobs/session-summarizer.ts` for the MCP session summarizer.

### GET /context/core  (Phase 6)

Deterministic core-memory block for prompt caching: UserProfile summary, top-8 active goals
(level ≤ 1) with linked project titles, open commitments due ≤ 14 days (with person names), standing
constraints (memories tagged `constraint`). Sorted keys, **no timestamps inside `block`**. Cached
in-process 60 s per user (`CORE_CONTEXT_TTL_MS`); invalidated on goal / project / commitment / profile
writes via `invalidateCoreContext(userId)` (`services/core-context.service.ts`).

**Response 200:** `{ block: string, tokensEstimate: number, hash: string (sha256), generatedAt: ISO }`

### POST /context/reflect  (Phase 6)

Run reflection for one entity now (Haiku, `effort: medium`, Zod-validated; prompt
`docs/prompts/cortex-reflection.system.md`). Ministry-domain memories are excluded from the LLM input.

**Request:** `{ entityType: "goal"|"project"|"person", entityId }`
**Response 200:** `ContextCapsule` (+ `sourceMemoryIds`, `importanceSeen`, `version`) · 404 when the entity is not visible.

### GET /context/capsules?entityIds=goal:x,project:y  (Phase 6)

**Response 200:** `{ items: ContextCapsule[] }` (1–20 refs)

---

## Retrieval Layer Details (for implementors)

The `/context/for-persona` endpoint internally uses a 4-layer retrieval pipeline:

1. **Structured filter** (weight 0.3): Exact matches on domain, tags, linked entities, date ranges
2. **Full-text search** (weight 0.25): PostgreSQL tsvector/tsquery on content + title
3. **Trigram search** (weight 0.2): pg_trgm similarity() for fuzzy/typo matching
4. **Semantic search** (weight 0.25): STUB in Phase 0 — returns empty. Will use pgvector cosine similarity.

**Ranker** deduplicates by memory ID, applies weighted merge, adds boosts:
- Recency boost: +0.1 if lastAccessedAt within 7 days
- Importance boost: +0.1 if importance >= 0.8

**Context packager** applies persona-specific filtering:
- Optimist: boost memories tagged success/opportunity/resource
- Critic: boost memories tagged risk/failure/constraint
- Alternate: boost memories tagged alternative/competitor/unexplored
- Technician: boost memories tagged technical/implementation/timeline
- CEO: no filter (full ranked list, higher token budget)

**Limits** (from shared constants):
- maxItemsPerPersona: 10
- maxItemsCEO: 15
- tokenBudgetPerPersona: 2000
- tokenBudgetCEO: 3000

---

## Cortex — Thinking Patterns

### GET /cortex/patterns
List detected thinking patterns for the user.
Query params: limit (default 20), offset (default 0)
Response 200: PaginatedResponse<ThinkingPattern>

### POST /cortex/patterns/scan
Trigger pattern detection scan. Requires 10+ decisions.
Response 200: { patterns: ThinkingPattern[], newCount: number }

---

## Cortex — Contradictions

### GET /cortex/contradictions
Query params: status (ACTIVE|RESOLVED|DISMISSED), limit, offset
Response 200: PaginatedResponse<ContradictionAlert>

### POST /cortex/contradictions/scan
Trigger cross-project contradiction scan.
Response 200: { contradictions: ContradictionAlert[], newCount: number }

### PATCH /cortex/contradictions/:id
Update contradiction status.
Request: { status: ContradictionStatus, resolution?: string }
Response 200: ContradictionAlert

---

## Cortex — Weekly Memo

### GET /cortex/memo/latest
Response 200: WeeklyMemo | null

### GET /cortex/memo/history
Query params: limit, offset
Response 200: PaginatedResponse<WeeklyMemo>

### PATCH /cortex/memo/:id/items/:itemKey  (Phase 6)

Interactive memo. `itemKey` = `<patternsNoticed|activeContradictions|upcomingPressurePoints|recommendedFocus>:<index>`.

**Request:** `{ state: "accepted"|"dismissed"|"snoozed", until?: ISO (required for snoozed) }`
`accepted` writes the item as a memory through the validation pipeline (`sourceType: AGENT_EXTRACTED` —
the enum has no CORTEX/SYSTEM member; tags `["memo", itemKey]`) and stores its id in `itemStates`.
**Response 200:** updated `WeeklyMemo` · 404 `item_not_found` · 422 `memory_validation_failed`.

Memo generation now also returns `decisionsAwaitingReview: string[]` (decision ids with
`reviewAt <= now+7d` and no `outcomeRating`), adds a `## Decisions awaiting review` section to
`fullMemoText`, and appends `review:<id>` entries to `upcomingPressurePoints`.

### POST /cortex/memo/generate
Trigger on-demand memo generation. Requires 5+ decisions.
Response 200: WeeklyMemo

---

## Cortex — Simulation

### POST /cortex/simulate
Run decision simulation for a chosen path.
Request: { chosenPath: string, sessionQuestion: string }
Response 200: SimulationResult

---

## Outcome Reviews

### GET /outcome-reviews
Query params: status, limit, offset
Response 200: PaginatedResponse<OutcomeReviewNudge>

### GET /outcome-reviews/pending
Returns nudges where scheduledFor <= now AND status = pending.
Response 200: OutcomeReviewNudge[]

### POST /outcome-reviews/:id/complete
Request: { outcome: string, outcomeRating: number, wouldDecideSame: boolean }
Response 200: OutcomeReviewNudge

### POST /outcome-reviews/:id/skip
Response 200: OutcomeReviewNudge

---

## Custom Personas

### GET /custom-personas
List user's custom personas.
Response 200: CustomPersona[]

### POST /custom-personas
Create custom persona. Max 3 per user.
Request: CreateCustomPersonaRequest
Response 201: CustomPersona
Response 422: If limit exceeded

### PATCH /custom-personas/:id
Update custom persona.
Response 200: CustomPersona

### DELETE /custom-personas/:id
Hard delete.
Response 200: { status: "deleted" }

---

## Knowledge Graph

### GET /graph

Bulk, read-only projection of the entity graph for the Obsidian-style graph view. One request returns every Goal, Project, Task, Person, Decision and Commitment the user owns (not soft-deleted), the top-N memories by importance, and every link between them. Node ids are namespaced `<type>:<refId>`; edges whose endpoints were filtered out are dropped server-side. No memory `content` is returned, only titles.

**Query params:** `types` (comma-separated subset of `goal,project,task,person,decision,commitment,memory`; default all) · `domain` (keeps nodes in that domain plus their domain-less neighbours) · `memoryLimit` (0–500, default 150) · `includeArchived` (`true` to include ARCHIVED memories)

**Tenant scoping:** when an agent context is present, memories are limited to that tenant; entities are user-scoped.

**Response 200:** `KnowledgeGraph` (`packages/shared/src/types/graph.types.ts`)

```json
{
  "nodes": [{ "id": "goal:ckx…", "type": "goal", "refId": "ckx…", "label": "Launch v1", "domain": "business", "status": "active", "importance": null, "createdAt": "2026-…", "meta": { "level": 1, "parentGoalId": null } }],
  "edges": [{ "id": "goal_project:goal:ckx…->project:cky…", "source": "goal:ckx…", "target": "project:cky…", "type": "goal_project", "label": null }],
  "stats": { "nodeCounts": { "goal": 4, "project": 9, "task": 31, "person": 12, "decision": 6, "commitment": 3, "memory": 150 }, "edgeCount": 212, "isolatedNodes": 17, "memoryLimitHit": true },
  "generatedAt": "2026-10-02T12:00:00.000Z"
}
```

Edge types: `goal_hierarchy`, `goal_project`, `project_task`, `project_person` (label = role), `decision_project`, `task_dependency` (source depends on target), `commitment_person`, `commitment_project`, `commitment_entity`, `memory_entity` (label = linkType).

BoardRoom proxies this as `GET /api/graph` with the same query params.

### GET /graph/backlinks/:nodeId (Phase 6)

`nodeId` = `<type>:<refId>` (types as above). Returns the node and **every edge incident to it, in both directions** — `edge.source` / `edge.target` carry the direction. Entity edges come from the full entity projection (no cap); memory edges are read directly from `MemoryEntityLink` for that node, so they are complete too. Memory nodes/backlinks are tenant-scoped under an agent context and exclude ARCHIVED memories unless `?includeArchived=true`.

**Response 200:** `{ node: KnowledgeGraphNode, backlinks: Array<{ node: KnowledgeGraphNode, edge: KnowledgeGraphEdge }> }`
**Errors:** 422 malformed `nodeId` · 404 node not found / not the user's / memory outside the agent tenant.

### GET /graph/unlinked-mentions (Phase 6)

Memories whose `title` or `content` mentions a Person (name ≥3 chars), Project or Goal (title ≥3 chars) by word-boundary, case-insensitive match (`~*` with `\m…\M`, metacharacters escaped) and that have **no** `MemoryEntityLink` to that entity. Scans the newest 500 live, non-ARCHIVED memories of the user (tenant-scoped under an agent context). **Ministry memories match on `title` only** — their content is encrypted — and get a title-only snippet.

**Query params:** `limit` (1–200, default 50)

**Response 200:** `{ items: Array<{ memoryId, memoryTitle, entityType: 'person'|'project'|'goal', entityId, entityLabel, snippet }> }` — `snippet` ≤160 chars around the match, newest memories first.

### POST /graph/unlinked-mentions/link (Phase 6)

**Request:** `{ memoryId: string, entityType: 'person'|'project'|'goal'|'task'|'decision'|'commitment', entityId: string }`

Creates the `relates_to` `MemoryEntityLink` after verifying the memory (user + agent tenant) and the entity (user, not soft-deleted). Idempotent on the link's unique tuple.

**Response 201:** `MemoryEntityLink` · **200** when it already existed · **404** memory or entity not found · **422** validation.

---

## Relationships

### GET /relationships/graph
Returns pre-computed relationship graph.
Response 200: { nodes: GraphNode[], edges: GraphEdge[] }

---

## Memory Entity Links

### POST /memories/links/batch (2026-10-23)

Up to 500 MemoryEntityLinks in one request — for bulk imports (`scripts/vault-import.mjs` turns `[[wikilinks]]` into memory→memory links), so links are not paced one write each under the 20/min limit. Same rules as `POST /memories/:id/links`, checked in bulk: the source memory must be the caller's (and in the agent's tenant when agent headers are present); the target must be the caller's and live — a `memory` target also in that tenant, so a link never crosses tenants. Idempotent on the link's unique tuple.

**Request:** `{ links: [{ memoryId, entityType, entityId, linkType? }] }` — 1–500 items; `entityType` ∈ `person|project|goal|task|decision|commitment|memory` (case-insensitive); `linkType` ≤ 64 chars, default `relates_to`. Schema: `BatchMemoryLinksBodySchema` (shared).

**Response 200:** `{ created: number, existing: number, rejected: [{ index, reason: 'unknown_entity_type' | 'memory_not_found' | 'entity_not_found' | 'self_link' }] }` — `existing` counts valid links that were already there. **422** on a malformed body (`validation_failed`).

Memory→memory links are drawn by `GET /graph` as `memory_entity` edges.

### POST /memories/:id/links
Create link between memory and entity.
Request: { entityType: 'goal'|'project'|'task'|'person'|'decision'|'commitment'|'memory', entityId: string, linkType?: string (default `relates_to`) }
`entityType` is lower-cased before validation (2026-10-03); the entity must exist for this user.
Response 201: MemoryEntityLink · 422 unknown `entityType` · 404 memory or entity not found

### GET /memories/:id/links
List links for a memory.
Response 200: MemoryEntityLink[] · 404 memory not found
Scoping (2026-10-23, RD-5): the memory must be the caller's (`x-user-id`) and, when agent headers are present, in the agent's tenant — the same rule as `POST /memories/links/batch`. Without agent headers (BoardRoom) it is user-scoped only, as before.

### DELETE /memories/:id/links/:linkId
Remove a link. Used by `scripts/vault-import.mjs --prune` to remove `wikilink` rows a note no longer contains.
Response 200: { status: "deleted" } · 404 memory not found (not the caller's, soft-deleted, or — with agent headers — in another tenant) or link not on that memory
Scoping (2026-10-23, RD-5): identical to `GET /memories/:id/links` above.

---

## MCP (agent identity, per-user tokens, delegation)

All routes below sit under `/mcp` and take the usual `x-api-key`. Added 2026-10-18 (Lane A1) so one MCP gateway URL can serve many users; the gateway (omnimind-mcp) is a registered Agent with the `mcp:delegate` scope. Hardened 2026-10-18 after the identity review (A1–A10, D/M5, D/M6): delegated principals are ALLOW-listed, token management is BoardRoom-only, OAuth agent names are unique per identity, OAuth identities are administrable.

**Shapes** (`@boardroom/shared`: `mcp-token.types.ts` / `mcp-token.schema.ts`, wire = ISO strings):

```typescript
MCP_SCOPES = ['memory:read','memory:write','decision:write','task:write','commitment:write','project:write','code:write']
// gateway-only, never grantable to a token/identity: MCP_DELEGATE_SCOPE = 'mcp:delegate'
// the ONE list a gateway Agent row may hold (keygen / docs / API cite this, D-M5):
MCP_GATEWAY_CEILING_SCOPES = [...MCP_SCOPES, 'mcp:delegate']

McpTokenRecord = { id, userId, tenantId, name, agentName, prefix, scopes: McpScope[], sourceWeight,
                   createdAt, lastUsedAt: string|null, expiresAt: string|null, revokedAt: string|null }
// never the hash. agentName = `mcp-token:<slug(name)>-<last 8 chars of id>` (unique); prefix = first 12 chars of the raw token.

McpPrincipal = { kind: 'token'|'oauth', id /* row id */, userId, tenantId, agentName, scopes: McpScope[],
                 sourceWeight, name?: string /* tokens */, expiresAt?: string /* tokens with expiry */ }
// oauth agentName = `oauth:<clientId or issuer host>-<last 8 chars of id>` — unique PER IDENTITY (A5), so two users
// behind one OAuth client never share a rate bucket or an audit agentId.

McpOauthIdentityRecord = { id, issuer, subject, userId, tenantId, agentName, scopes: McpScope[], sourceWeight,
                           createdAt, lastUsedAt: string|null, revokedAt: string|null }
```

Row ids for both tables are generated server-side as `c` + 18 CSPRNG bytes base64url (24 chars; A10) — they match the `x-mcp-principal` grammar `[A-Za-z0-9_-]{1,64}` and are never validated as user CUIDs. Raw token format: `omt_` + 32 random bytes base64url (47 chars). Stored as `sha256(raw)` (`mcp_tokens.token_hash`, unique) — the raw value is returned exactly once by `POST /mcp/tokens`. Revocation sets `revokedAt` (never deletes). `lastUsedAt` is touched at most once per 5 minutes per row. Both tables carry an FK to `users(id)` `ON DELETE CASCADE` (migration `20261018000001_mcp_identity_hardening`).

**Validation failures** on every `/mcp` route are `400` (this router's convention) with the SAME body as the API-wide 422s: `{ error: 'validation_failed', details: [{ field, message }] }` (A7). No `flatten()` shapes remain.

### Headers & scopes (additions to the auth table)

| Header / scope | Who sends it | Meaning |
|---|---|---|
| `x-agent-key: omk_…` | gateway | existing verified agent identity |
| `x-mcp-principal: token:<id>` \| `oauth:<id>` | gateway only (`mcp:delegate`) | act as that McpToken / McpOauthIdentity; else `403 delegation_not_allowed` |
| scope `mcp:delegate` | Agent row (keygen) | may present `x-mcp-principal`, call `POST /mcp/tokens/introspect` and `POST /mcp/identities/resolve`. Gateway-only: rejected by the token scope schema; `*` does not imply it; removed from the delegated context's scope list |

With `x-mcp-principal` the legacy triple (`x-agent-id` / `x-tenant-id` / `x-source-weight`) may name either the gateway or the principal; anything else is `403 agent_header_mismatch`. The gateway's own `lastSeenAt` is still touched. Principal rows are cached in memory for 60 s (keyed by the header value; expiry is always evaluated at request time). `DELETE /mcp/tokens/:id`, `PATCH /mcp/identities/:id`, `DELETE /mcp/identities/:id` and a reactivating `POST /mcp/identities` evict the cache synchronously, so a revoke / re-scope / re-link applies on the next request; a row edited by SQL is stale for ≤60 s (per process — revisit before horizontal scaling).

### Delegated allow-list (A1 / A3 / A4)

A delegated context is less trusted than the service key, so it is ALLOW-listed in `middleware/delegated-user-isolation.ts` (mounted right after agent-context, before scope enforcement). Anything not listed → `403 delegated_route_forbidden { method, path }`, regardless of the principal's scopes; `user_mismatch` is still reported first. The list is exactly what omnimind-mcp's tools and resources call:

| Allowed for a delegated principal | Notes |
|---|---|
| `/memories`, `/context`, `/decisions`, `/tasks`, `/goals`, `/projects`, `/people`, `/commitments`, `/graph` — every method, segment-aware prefix | read vs write inside a family is still decided by `Agent.scopes` (`insufficient_scope`); userId is injected as before |
| `POST /mcp/audit`, `GET /mcp/audit` | `GET` is pinned to the principal (below) |
| `POST /usage/llm` | fact-extractor usage sink |

Carve-out: `POST /memories/backfill-embeddings` (operator maintenance) is refused inside the `/memories` family. Everything else is refused for a delegated principal: `/auth/*`, `/oauth/*`, `/admin/*`, `/mcp/tokens*` (incl. introspect), `/mcp/identities*` (incl. resolve), `/mcp/agents`, `/mcp/audit/stats`, `GET /usage/llm/summary`, `/subscription`, `/user-profile`, `/custom-personas`, `/outcome-reviews`, `/relationships`, `/cortex`. `tests/unit/middleware/delegated-route-allowlist.test.ts` walks every prefix mounted in `src/index.ts` and fails when a new mount is not classified. Non-delegated callers (BoardRoom, solo-mode agents, plain gateways) are unaffected.

### POST /mcp/tokens  (BoardRoom-only)

Body `{ userId, tenantId, name: 1–60, scopes: McpScope[] (non-empty, no repeats), sourceWeight?: 0–2 (default 1), expiresInDays?: 1–365 | null }`.

- **any agent context is refused** (A2): verified `x-agent-key`, the legacy triple → `403 agent_context_not_allowed`; a delegated principal → `403 delegated_route_forbidden`. BoardRoom authenticates the user with its JWT and sends the service key alone. Same rule for `GET /mcp/tokens`, `GET /mcp/tokens/options`, `DELETE /mcp/tokens/:id`.
- `tenantId` must be owned by the user (`tenants.owner_user_id = userId`) → else `403 tenant_not_owned`
- max 25 active (not revoked, not expired) tokens per user → `409 token_limit`
- `expiresInDays` omitted → **365 days** (`MCP_TOKEN_DEFAULT_EXPIRES_IN_DAYS`); `null` → never expires (an explicit choice the UI must send); a number → that many days (A9)
- a unique violation on insert (agentName suffix / hash) is retried once with fresh random material before surfacing (A10)
- `201 { token: 'omt_…', record: McpTokenRecord }`

### GET /mcp/tokens?userId=  (BoardRoom-only)

`200 { tokens: McpTokenRecord[] }` newest first; tokens revoked more than 30 days ago are omitted. Missing `userId` → `400`.

### GET /mcp/tokens/options?userId=  (BoardRoom-only)

`200 { tenants: [{ id, name }] /* owned by the user */, scopes: [{ id: McpScope, description, write: boolean }] }`.

### DELETE /mcp/tokens/:id?userId=  (BoardRoom-only)

`204` (sets `revokedAt`, idempotent, evicts the delegation cache). `404 not_found` when no token with that id belongs to the user. Missing `userId` → `400`.

### POST /mcp/tokens/introspect  (gateway only)

Caller must be a verified `x-agent-key` agent with `mcp:delegate` and must not itself be delegated → else `403 gateway_scope_required { required: 'mcp:delegate' }` (a delegated caller is already stopped by the allow-list with `403 delegated_route_forbidden`).

Body `{ token }` → `200 { active: true, principal: McpPrincipal }` or `200 { active: false, reason: 'invalid' | 'expired' | 'revoked' }`. Lookup is by `sha256(token)` on the unique index.

### POST /mcp/identities/resolve  (gateway only, same auth)

Body `{ issuer, subject, email?, emailVerified?: boolean, clientId? }`.

- **issuer allow-list** (A6): when the API env `MCP_OAUTH_ALLOWED_ISSUERS` (comma-separated, trailing slash ignored) is set and does not contain `issuer` → `200 { active: false, reason: 'issuer_not_allowed' }` before any lookup. Unset → any issuer the gateway verified is accepted.
- the issuer is **normalised** (trimmed, trailing slash removed) before the lookup and on insert — the same form `POST /mcp/identities` stores — so an operator-linked `https://idp` matches a JWT whose `iss` is `https://idp/` (2026-10-19)
- an `McpOauthIdentity` row exists for `(issuer, subject)` and is not revoked → `200 { active: true, principal }`
- else if `emailVerified === true` and a `User` matches `lower(trim(email))` **case-insensitively** (A6) and owns ≥1 tenant → auto-create the identity with `scopes: ['memory:read']` (read-only), `tenantId` = the user's **oldest-created owned tenant** (`created_at asc, id asc` — deterministic; D-M6, re-point with `PATCH /mcp/identities/:id`), `agentName: oauth:<clientId or issuer host>-<last 8 of id>`, `sourceWeight: 1` → `200 { active: true, principal }`
- two concurrent first-resolves racing on `(issuer, subject)` never 500: the loser re-reads the winner's row; an agentName collision is retried once (A6 / A10)
- else (no verified email, unknown user, user owns no tenant, or a revoked link — never re-created automatically) → `200 { active: false, reason: 'unlinked' }`
- **every `unlinked` outcome is logged at `warn`** (`mcp-token: OAuth identity unlinked — link it with POST /mcp/identities`) with `issuer`, `subjectHash` (the first 12 hex chars of `sha256(subject)`), `reason: 'no_verified_email' | 'user_not_found' | 'no_owned_tenant' | 'revoked'`, `emailPresent`, `emailVerified` and `clientId` (plus `userId` / `identityId` when known). **The subject itself and the e-mail are never logged** — the operator uses the issuer, the time and the client to find the subject in the provider's dashboard, then links it with `POST /mcp/identities` (2026-10-19).

### POST /mcp/identities  ·  GET /mcp/identities  ·  PATCH /mcp/identities/:id  ·  DELETE /mcp/identities/:id  (admin: `x-admin-key`)

Operator administration of OAuth identities (D/M6; `POST` + list-all added 2026-10-19). All four require `x-admin-key` like `/admin/*` (`401 admin_unauthorized`, `503 admin_disabled` in production without the key); a delegated principal is refused by the allow-list (`403 delegated_route_forbidden`).

- `POST /mcp/identities` body `{ issuer, subject, userId, tenantId, scopes?: McpScope[] (default ['memory:read']), sourceWeight?: 0–2 (default 1), clientId? }` (`McpIdentityCreateRequest` / `McpIdentityCreateRequestSchema`) — links an `(issuer, subject)` pair by hand, for identity providers whose access tokens carry no `email` / `email_verified` (auto-link on resolve can never fire for them). Checks run in this order, each final:
  1. `issuer` is normalised (trimmed, trailing slash removed) and, when `MCP_OAUTH_ALLOWED_ISSUERS` is set and excludes it → `403 issuer_not_allowed`
  2. an **active** row already exists for the pair → `409 identity_exists { existingId }` (re-point / re-scope it with `PATCH` instead)
  3. unknown `userId` → `404 user_not_found`
  4. `tenantId` not owned by that user (`tenants.owner_user_id = userId`) → `403 tenant_not_owned`
  5. a **revoked** row exists for the pair → **reactivated in place** → `200 { identity: McpOauthIdentityRecord }`. `(issuer, subject)` is `UNIQUE` regardless of `revokedAt`, so a second row is impossible: `revokedAt` is cleared, `userId` / `tenantId` / `scopes` / `sourceWeight` are replaced with the request's values (defaults apply when omitted), the row id — and therefore the agentName suffix — and `createdAt` are kept, the agentName is rebuilt only when a `clientId` is supplied, and the delegation cache is evicted so the next delegated request sees the new link.
  6. otherwise a new row → `201 { identity }`, `agentName: oauth:<clientId or issuer host>-<last 8 of id>`, `lastUsedAt: null`. A `(issuer, subject)` race lost to a concurrent resolve/auto-link is reported as the `409` above; an agentName collision is retried once (A10).
  - `400 validation_failed { details: [{ field, message }] }` for a bad body (same shape as every `/mcp` route): `scopes` is a non-empty, repeat-free subset of `MCP_SCOPES`, `issuer` / `subject` ≤ 512 chars, `clientId` 1–256 chars.
- `GET /mcp/identities[?userId=][&limit=]` → `200 { identities: McpOauthIdentityRecord[] }` newest first, revoked rows included. **`userId` is optional**: without it the operator sees every identity across all users (how an operator finds the row behind a warn line, or confirms a subject is still unlinked). `limit` 1–200, default 50 (`MCP_IDENTITY_LIST_DEFAULT_LIMIT` / `MCP_IDENTITY_LIST_MAX_LIMIT`); out of range or non-integer → `400 validation_failed`.
- `PATCH /mcp/identities/:id` body `{ tenantId?, scopes? }` (at least one) → `200 McpOauthIdentityRecord`. `tenantId` must be owned by the identity's user → else `403 tenant_not_owned`; `scopes` is validated as a non-empty, repeat-free subset of `MCP_SCOPES` (`400 validation_failed`). `404 not_found` for an unknown id. Evicts the delegation cache. A revoked identity can be edited but stays revoked — to re-link it, `POST /mcp/identities` with the same pair.
- `DELETE /mcp/identities/:id` → `204` (sets `revokedAt`, idempotent, evicts the cache so the next delegated request is `401 principal_invalid { reason: 'revoked' }`). `404 not_found` for an unknown id.

### GET /mcp/audit/stats?tool=&sinceHours=24

`200 { tool: string|null, sinceHours, count, p50Ms, p95Ms, errorRate /* 0..1 */ }` computed in memory (nearest-rank percentiles) over the newest ≤10 000 `McpAuditLog` rows in the window (`durationMs`, `errorMessage`). `tool` omitted → all tools (`tool: null`). `sinceHours` 1–2160, default 24. Zeros when the window is empty.

Tenant: with agent context the caller's tenant (a different `?tenantId=` → `403 tenant_mismatch` unless admin); without agent context an optional `?tenantId=` filter, otherwise the aggregate spans all tenants (numbers only, nothing row-level). Not on the delegated allow-list — the gateway calls it with its static identity (`bench`).

### Delegated request flow (summary)

```
gateway ──POST /mcp/tokens/introspect {token}──▶ { active, principal }
gateway ──GET /memories  x-agent-key: omk_gw  x-mcp-principal: token:<principal.id>──▶
          agent-context: ctx = { agentId: principal.agentName, tenantId, sourceWeight,
                                 scopes: ∩, verified: true, delegated: true, userId }
          delegated-user-isolation: x-user-id/query/body userId pinned to ctx.userId (403 user_mismatch),
                                    route must be on the ALLOW-list (403 delegated_route_forbidden)
          scope-enforcer / agent-rate-limiter / idempotency: keyed by principal.agentName
          POST /mcp/audit must carry agentId = principal.agentName, tenantId = principal.tenantId
```

### Existing `/mcp` routes

`POST /mcp/audit`, `GET /mcp/audit`, `POST /mcp/agents` (admin), `GET /mcp/agents` — see Global Conventions for tenant scoping. Under delegation (A4): `POST /mcp/audit` is held to the principal's own `agentName`/`tenantId` (`403 audit_identity_mismatch`); `GET /mcp/audit` is **forced to `agentId = principal.agentName`** (a different `?agentId=` → `403 audit_identity_mismatch`), so a principal only ever sees its own rows; `GET /mcp/agents` → `403 delegated_route_forbidden`. Plain verified agents keep the tenant-wide views.

### Admin: tenant ownership

`GET /admin/tenants` → `{ tenants: [{ id, name, ownerUserId }] }` and `PATCH /admin/tenants/:id` body `{ ownerUserId }` → `200 { id, name, ownerUserId }` (`404 not_found` / `404 user_not_found`, `400 validation_failed`). Both behind `x-admin-key` like the rest of `/admin/*`. Ownership is what gates `POST /mcp/tokens` and OAuth auto-link (oldest owned tenant).

---

## LLM Usage (Phase 6)

### POST /usage/llm

Fire-and-forget usage sink for BoardRoom, MCP and OmniMind's own Anthropic calls. Server computes
`costUsd` via shared `estimateCostUsd`. `userId` defaults to `x-user-id`, `tenantId` to the agent context.

**Request:** `{ service, purpose, model, inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, durationMs?, sessionId?, userId?, tenantId? }`
**Response 201:** `{ id, costUsd }` · 502 `usage_write_failed` when the row could not be written.

### GET /usage/llm/summary?days=7[&all=1]

Default scope: the calling user. `all=1` aggregates every row (admin cost widget; job rows without a user
only appear here). `byDay` is zero-filled per UTC day, ascending.

**`all=1` is admin-gated (2026-10-03):** the request must carry `x-admin-key` matching `OMNIMIND_ADMIN_KEY`
(same semantics as `/admin/*`; BoardRoom's admin proxy forwards the header). Otherwise `403 admin_required`.
Without `all=1` the header is ignored and the summary is scoped to `x-user-id`.

**Response 200:** `{ days, totalUsd, byDay: [{date, usd, calls}], byPurpose: [{purpose, usd, calls, cacheHitRate}], byModel: [{model, usd, calls, inputTokens, outputTokens}] }`

---

## OAuth Token Management (Internal)

### GET /oauth/token/:provider
Get OAuth token for user + provider.
Response 200: OAuthToken (decrypted) | null

### POST /oauth/token
Save/update OAuth token.
Request: { provider, accessToken, refreshToken, expiresAt, scope, calendarId }
Response 200: OAuthToken

### DELETE /oauth/token/:provider
Remove OAuth token.
Response 200: { status: "deleted" }

---

## Subscription

### GET /subscription
Get subscription by userId.
Response 200: Subscription | null

### POST /subscription
Create subscription.
Response 201: Subscription

### PATCH /subscription
Update subscription.
Response 200: Subscription

### DELETE /subscription
Cancel subscription (soft).
Response 200: { status: "canceled" }
