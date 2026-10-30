# BoardRoom API Contract v1

> Source of truth for all BoardRoom server endpoints. Frontend consumes these.
> Generated from MASTER-FRAMEWORK.md Sections 3, 6, April 7 2026.

## Global Conventions

- **Base URL**: `http://localhost:3001` (dev), port configurable via `BOARDROOM_PORT`
- **Auth**: JWT in httpOnly cookie (`boardroom_token`). All endpoints except
  `POST /auth/login` and `POST /auth/register` require valid JWT.
- **User ID**: Extracted from JWT payload (`req.auth.userId`), not from headers.
- **Content-Type**: `application/json` for REST. `text/event-stream` for SSE.
- **OmniMind**: All data operations proxy through to OmniMind API via
  `server/src/services/omnimind-client.ts`. BoardRoom NEVER touches the DB directly.

## Error Responses

```typescript
// 401 — Unauthorized (no/invalid JWT)
{ error: "unauthorized", message: string }

// 403 — Forbidden (valid JWT but not authorized for resource)
{ error: "forbidden", message: string }

// 422 — Validation error
{ error: "validation_failed", details: { field: string, message: string }[] }

// 502 — OmniMind upstream error
{ error: "upstream_error", message: string, service: "omnimind" }

// 500 — Internal error
{ error: "internal_error", message: string }
```

---

## Authentication

### POST /auth/register

**Request:**
```typescript
{ email: string, password: string, name: string }
```

**Response 201:**
```typescript
{ userId: string, name: string }
```
Sets `boardroom_token` httpOnly cookie.

### POST /auth/login

**Request:**
```typescript
{ email: string, password: string }
```

**Response 200:**
```typescript
{ userId: string, name: string }
```
Sets `boardroom_token` httpOnly cookie.

### POST /auth/logout

Clears `boardroom_token` cookie.

**Response 200:** `{ status: "ok" }`

### GET /auth/me

Returns current user from JWT.

**Response 200:**
```typescript
{ userId: string, email: string, name: string }
```

---

## Decision Sessions

**Persistence (RD-17, 2026-10-30).** Sessions are persisted in OmniMind (`/decision-sessions`, see the OmniMind contract) and BoardRoom keeps an in-memory cache (30-minute idle TTL; an evicted or post-restart session is reloaded from OmniMind on the next request). The session id returned by `POST /sessions` is the OmniMind `decision_sessions` id (a cuid). BoardRoom writes the session through after each meaningful transition — persona round 1 complete, end of dispatch (rebuttals + ledger), CEO synthesis, questionnaire answers, decision commit — coalesced per session (one write per ~500 ms burst, never per streamed token; commit writes immediately). What is persisted: question (with clarifications), mode, status, persona responses, rebuttals, ledger, CEO synthesis, late advisors, project ids, `asOf`, `decisionId`. Not persisted: the core-context block (re-fetched on the next dispatch) and in-flight flags.

**OmniMind unavailable:** `POST /sessions` still answers 201 with a BoardRoom-local id (`session_<n>_<ms>`) and the session works from memory only (lost on restart, as before RD-17); a failed write-through is logged (`[SessionStore] persist failed`), never surfaced to the user. On a cache miss, an id that is not a cuid (a pre-RD-17 or local id) answers 404 without calling OmniMind; an OmniMind 404 answers 404; any other OmniMind failure propagates (5xx) rather than pretending the session does not exist.

### POST /sessions

Create a new decision session. This is the entry point for all analysis.

**Request:**
```typescript
{
  question: string,       // the user's question or decision prompt
  mode: UserMode,         // "decide" | "stress-test" | "plan" | "clarify" | "review" | "quick-take"
  roomId?: string         // optional — ties to existing room
}
```

**Response 201:**
```typescript
{
  sessionId: string,
  question: string,
  mode: UserMode,
  personasToFire: PersonaId[],  // determined by mode routing
  includesCEO: boolean
}
```

### GET /sessions/:id

**Response 200:**
```typescript
{
  id: string,
  question: string,
  mode: UserMode,
  personaResponses: Record<PersonaId, PersonaResponse>,  // empty until dispatched
  ceoSynthesis: SynthesisReport | null,
  sufficiencyScore: SufficiencyScore | null,
  createdAt: string,
  // Phase 6
  rebuttals: Record<PersonaId, Rebuttal>,
  ledger: DisagreementLedger,
  decisionId: string | null,
  asOf: string | null
}
```

Answers from the cache, else from OmniMind (`GET /decision-sessions/:id`, scoped to the signed-in user). 404 when the session does not exist, is archived, or belongs to another user.

### GET /sessions

List recent sessions.

**Query params:** `limit` (default 20), `offset` (default 0)

**Response 200:** `PaginatedResponse<DecisionSessionSummary>`

Where `DecisionSessionSummary`:
```typescript
{
  id: string,
  question: string,
  mode: UserMode,
  personaCount: number,
  hasSynthesis: boolean,
  createdAt: string
}
```

RD-17: the page comes from OmniMind (`GET /decision-sessions?limit&offset`, `limit` capped at 100); on the first page, sessions that exist only in BoardRoom's memory (created while OmniMind was down) are listed first. If OmniMind is unreachable the list falls back to the in-memory sessions (the pre-RD-17 behaviour).

---

## Persona Dispatch (SSE Streaming)

### POST /sessions/:id/dispatch

Fires personas for a session. Returns SSE stream.

**Request:** empty body — the mode determines which personas fire. Optional (M1-C2, `DispatchSessionBodySchema` / `DispatchSessionRequest`):

```typescript
{ personaIds?: PersonaId[] }   // re-run only these advisors (Retry on a failed card)
```

A retry streams only the named advisors, **never re-runs the debate round** (zero `rebuttal_*` events), records them as late advisors (the ledger is rebuilt deterministically and the CEO is told they joined after round 2), and ends with `dispatch_complete { personaCount, durationMs, rebuttalCount: 0, retriedPersonaIds }`. A malformed body → 422 `validation_failed`; an id that is not an advisor of this session (mode roster + the user's active custom personas) → 400 `unknown_persona`. A persona whose context fetch fails now emits `persona_error` instead of no event.

**SSE Event Stream:**

```typescript
// Persona starts
data: { type: "persona_start", personaId: PersonaId, model: ModelTier }

// Text chunk from persona
data: { type: "delta", personaId: PersonaId, text: string }

// Persona complete — full validated response
data: { type: "persona_complete", personaId: PersonaId, response: PersonaResponse }

// Persona error (non-fatal — other personas continue)
data: { type: "persona_error", personaId: PersonaId, error: string }

// All personas done
data: { type: "dispatch_complete", personaCount: number, durationMs: number }
```

**Internal flow:**
1. Load `MODE_CONFIGS[session.mode]` to get persona list
2. For each persona, call OmniMind `POST /context/for-persona` to get context
3. Load system prompt from `docs/prompts/{personaId}.system.md`
4. Fire all personas in parallel via `Promise.allSettled`
5. Validate each response with Zod (`PersonaResponseSchema`)
6. Stream results as they complete

**Latency target:** 2-3s for all personas (parallel execution)

### POST /sessions/:id/synthesize

Fires CEO synthesis. Returns SSE stream. Must be called AFTER dispatch.

**Request:** (empty body — uses persona responses from the session)

**SSE Event Stream:**

```typescript
// Synthesis starts
data: { type: "synthesis_start", model: "sonnet" }

// Text chunk
data: { type: "delta", text: string }

// Synthesis complete
data: { type: "synthesis_complete", report: SynthesisReport }

// Error
data: { type: "error", error: string }
```

**Internal flow:**
1. Collect all validated `PersonaResponse` objects from the session
2. Load `docs/prompts/ceo.system.md`
3. Construct CEO prompt with: question + all persona outputs + supporting evidence
4. Stream CEO response via Anthropic SDK
5. Validate with `SynthesisReportSchema`
6. Store in session + persist to OmniMind as DecisionSession (`PATCH /decision-sessions/:id`, status `SYNTHESIZED`)

**Latency target:** 3s

---

## Ambiguity Check

### POST /sessions/:id/check-ambiguity

Run sufficiency scoring before persona dispatch. Optional but recommended.

**Request:** (empty body — uses session question + user context)

**Response 200:**
```typescript
{
  score: number,           // 0-1 (0 = clear, 1 = very ambiguous)
  mode: 1 | 2 | 3 | 4,   // LOW / MEDIUM / HIGH / CONFLICTING
  canProceed: boolean,     // true if mode 1 or 2
  assumptions: string[],   // what the system infers
  suggestedQuestions: string[], // what to ask user (modes 3-4)
  inferredIntent: string
}
```

**Internal flow:**
1. Fetch user's active context from OmniMind
2. Haiku pre-check call (~$0.001, <400ms)
3. Return structured sufficiency assessment

---

## Questionnaire Mode

### POST /sessions/:id/questionnaire

Fire the Questionnaire persona for deep thinking mode.

**Response 200:**
```typescript
{
  personaId: "questionnaire",
  questionClusters: {
    theme: string,
    questions: string[]
  }[]
}
```

### POST /sessions/:id/questionnaire/answers

Submit answers to questionnaire. Enriches session context for subsequent dispatch.

**Request:**
```typescript
{
  answers: { question: string, answer: string }[]
}
```

**Response 200:**
```typescript
{ enrichedContext: true, additionalContextItems: number }
```

---

## Doer Mode (Post-Decision)

### POST /sessions/:id/plan

Fire the Doer persona after CEO synthesis to generate actionable tasks.

**Response 200:**
```typescript
{
  personaId: "doer",
  tasks: {
    title: string,
    owner: string | null,
    deadline: string | null,
    priority: number,
    dependencies: string[]
  }[],
  estimatedTimeline: string,
  criticalPath: string[]
}
```

Optionally persists tasks to OmniMind if user confirms.

---

## Session-to-Memory Extraction (Phase 1, Week 8)

### POST /sessions/:id/extract-memories

Post-session memory extraction. Haiku analyzes the session and proposes memory operations.

**Response 200:**
```typescript
{
  proposals: MemoryProposal[],  // from @boardroom/shared
  proposalCount: number,
  categories: {
    facts: number,
    commitments: number,
    personMentions: number,
    profileObservations: number
  }
}
```

### POST /sessions/:id/confirm-memories

User confirms/edits/rejects proposed memories.

**Request:**
```typescript
{
  accepted: string[],       // proposal indices to accept as-is
  modified: { index: number, changes: Partial<MemoryProposal> }[],
  rejected: number[]        // proposal indices to reject
}
```

**Response 200:**
```typescript
{
  created: number,
  modified: number,
  rejected: number
}
```

---

## Export

### GET /sessions/:id/export

Export a decision session as a structured package.

**Query params:** `format` — `json` | `pdf` (default: `json`)

**Response 200 (JSON):**
```typescript
{
  question: string,
  mode: UserMode,
  perspectives: Record<PersonaId, PersonaResponse>,
  synthesis: SynthesisReport | null,
  actionItems: object[],
  assumptions: object[],
  createdAt: string,
  exportedAt: string
}
```

**Response 200 (PDF):** Binary PDF download

---

## Health

### GET /health

No auth required. Liveness: always HTTP 200 (every `railway.toml` uses `healthcheckPath = "/health"`), even when OmniMind is down.

**Response 200:**
```typescript
{
  status: "ok" | "degraded",
  service: "boardroom-ai",
  version: string,            // RAILWAY_GIT_COMMIT_SHA, or "dev" locally (M0-A2)
  timestamp: string,
  omnimindConnected: boolean  // pings OmniMind /health
}
```

### GET /ready

No auth required (M0-A2). Readiness: registered above the SPA fallback, so `/ready` and `/api/ready` always answer JSON.

**Response 200 / 503:**
```typescript
{
  status: "ready" | "not_ready",            // 503 when not_ready
  service: "boardroom-ai",
  version: string,
  timestamp: string,
  checks: { omnimind: "ok" | "degraded" | "unreachable" }  // 503 unless "ok"
}
```

---

## Internal: OmniMind Client

`server/src/services/omnimind-client.ts` wraps all OmniMind API calls:

```typescript
class OmniMindClient {
  constructor(baseUrl: string, apiKey: string)

  // Context retrieval (called before every persona)
  getContextForPersona(req: ContextForPersonaRequest): Promise<ContextForPersonaResponse>

  // Memory operations (called during extraction)
  createMemory(userId: string, input: CreateMemoryRequest): Promise<CreateMemoryResponse>

  // Entity reads (for session context enrichment)
  getGoals(userId: string, filters?): Promise<Goal[]>
  getProjects(userId: string, filters?): Promise<Project[]>
  getPeople(userId: string, filters?): Promise<Person[]>
  getDecisions(userId: string, filters?): Promise<Decision[]>
  getCommitments(userId: string, filters?): Promise<Commitment[]>
  getUserProfile(userId: string): Promise<UserProfile>

  // Health check
  health(): Promise<{ status: string, dbConnected: boolean }>
}
```

All calls include:
- `x-api-key` header from `OMNIMIND_API_KEY` env var
- `x-user-id` header from authenticated user's JWT

---

## Rate Limits

From `@boardroom/shared/constants/rate-limits`:
- CEO mode: 10 per session
- Sessions per day: 5
- Max output tokens per persona: 2000

Enforced server-side. Returns 429 when exceeded.

---

## Cost Tracking

Every session records:
- Total LLM calls made
- Total input/output tokens per call
- Total cost estimate (from `MODEL_COSTS` in shared constants)
- Stored per-session for dashboard reporting

---

## Onboarding

### POST /onboarding/extract-goals

Extract goals from freeform user text during onboarding.

**Request:**
```typescript
{ text: string }
```

**Response 200:**
```typescript
{ title: string, level: number, domain: string }[]
```

### POST /onboarding/extract-projects

Extract projects from freeform user text during onboarding.

**Request:**
```typescript
{ text: string }
```

**Response 200:**
```typescript
{ title: string, domain: string, status: "active" | "planning" | "paused" }[]
```

### POST /onboarding/complete

Mark onboarding as done. Updates user profile in OmniMind.

**Response 200:** `{ status: "ok" }`

---

## Calendar

### GET /calendar/status

Returns Google Calendar connection status.

**Response 200:** Integration status object from Gmail service.

### GET /calendar/auth-url

Returns OAuth URL for Google Calendar authorization.

**Response 200:**
```typescript
{ url: string } | { url: null, message: string }
```

### GET /calendar/callback

**No auth required.** OAuth callback from Google. Redirects to `/settings?calendar=connected`.

**Query params:** `code`, `state`

**Response 302:** Redirect

### GET /calendar/events

Fetch upcoming calendar events.

**Query params:** `start` (ISO date, default: now), `end` (ISO date, default: +7 days)

**Response 200:** `CalendarEvent[]`

### POST /calendar/disconnect

Disconnect Google Calendar integration.

**Response 200:** `{ status: "disconnected" }`

---

## Integrations

### GET /integrations

List all integration statuses (Gmail, Google Calendar).

**Response 200:**
```typescript
{ type: string, status: "connected" | "disconnected", error?: string }[]
```

### GET /integrations/gmail/auth-url

Returns OAuth URL for Gmail authorization.

**Response 200:**
```typescript
{ url: string } | { url: null, message: string }
```

### GET /integrations/gmail/callback

**No auth required.** OAuth callback from Google. Redirects to `/integrations?gmail=connected`.

**Query params:** `code`, `state`

**Response 302:** Redirect

### POST /integrations/gmail/disconnect

Disconnect Gmail integration.

**Response 200:** `{ status: "disconnected" }`

### GET /integrations/gmail/emails

Fetch recent emails from connected Gmail account.

**Response 200:** `EmailSummary[]`

### POST /integrations/gmail/extract

Extract memory proposals from a specific email.

**Request:**
```typescript
{ emailId: string }
```

**Response 200:** `EmailExtraction` (proposals with metadata)

### POST /integrations/gmail/confirm

Confirm extracted email memories for creation.

**Request:**
```typescript
{
  proposals: {
    title: string,
    content: string,
    domain?: string,
    tags?: string[],
    memoryClass?: string,
    importance?: number,
    emailId?: string
  }[]
}
```

**Response 200:**
```typescript
{ created: number, rejected: number }
```

---

## Entity Proxies

All entity endpoints proxy to OmniMind API with the authenticated user's
`userId` forwarded as `x-user-id` header.

### Goals — `/entities/goals`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/goals` | `Goal[]` |
| POST | `/entities/goals` | `Goal` (201) |
| PATCH | `/entities/goals/:id` | `Goal` |
| DELETE | `/entities/goals/:id` | 204 |

### Projects — `/entities/projects`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/projects` | `Project[]` |
| POST | `/entities/projects` | `Project` (201) |
| PATCH | `/entities/projects/:id` | `Project` |
| DELETE | `/entities/projects/:id` | 204 |

### Tasks — `/entities/tasks`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/tasks` | `Task[]` |
| POST | `/entities/tasks` | `Task` (201) |
| PATCH | `/entities/tasks/:id` | `Task` |
| DELETE | `/entities/tasks/:id` | 204 |

### People — `/entities/people`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/people` | `Person[]` |
| POST | `/entities/people` | `Person` (201) |
| PATCH | `/entities/people/:id` | `Person` |
| DELETE | `/entities/people/:id` | 204 |

### Decisions — `/entities/decisions` (read-only)

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/decisions` | `Decision[]` |

### Commitments — `/entities/commitments` (read-only)

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/commitments` | `Commitment[]` |

### User Profile — `/entities/profile`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/profile` | `UserProfile` |
| PATCH | `/entities/profile` | `UserProfile` |

### Memories — `/entities/memories`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/memories` | `Memory[]` (supports query filters) |
| GET | `/entities/memories/:id` | `Memory` |
| POST | `/entities/memories` | `CreateMemoryResponse` (201) |
| PATCH | `/entities/memories/:id` | `Memory` |
| DELETE | `/entities/memories/:id` | `{ status: "deleted" }` |

### Memory Links — `/entities/memories/:id/links`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/memories/:id/links` | `MemoryEntityLink[]` |
| POST | `/entities/memories/:id/links` | `MemoryEntityLink` (201) |
| DELETE | `/entities/memories/:id/links/:linkId` | `{ status: "deleted" }` |

### Outcome Reviews — `/entities/outcome-reviews`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/outcome-reviews` | Paginated reviews (supports `?status=` filter) |
| GET | `/entities/outcome-reviews/pending` | `OutcomeReviewNudge[]` |
| POST | `/entities/outcome-reviews/:id/complete` | Updated nudge |
| POST | `/entities/outcome-reviews/:id/skip` | Updated nudge |

### Relationships — `/entities/relationships`

| Method | Path | Response |
|--------|------|----------|
| GET | `/entities/relationships/graph` | Relationship graph object |
