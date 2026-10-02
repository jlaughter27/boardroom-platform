# Phase 6 build contracts (2026-10-02)

**Status: implemented 2026-10-02** (see CHANGELOG). Kept as the record of the shapes the six lanes agreed on; `docs/contracts/omnimind-api.contract.md` is the live API reference.

Shared agreements for the parallel Phase 6 build. Every agent reads this first and codes **exactly** against it. If a contract is wrong, report it — do not improvise a different shape.

Source research: `docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md`.

## Already done (do not redo)

- `@anthropic-ai/sdk` ^0.131 in all three services; `@opentelemetry/sdk-node`, `auto-instrumentations-node`, `exporter-trace-otlp-http` installed in boardroom-ai + omnimind-api. **No agent runs `pnpm add/install`.** Report missing deps instead.
- `packages/shared/src/constants/model-config.ts`: `MODEL_IDS = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5' }`, `MODEL_PRICING_USD_PER_MTOK`, `estimateCostUsd()`, `CACHE_MIN_PREFIX_TOKENS`. **Every model string in code must come from here.**
- Prisma (migration `20261002100000_phase6_foundation`, already generated — **schema.prisma is frozen; do not edit it; report needs**):
  - `Decision`: `expectedOutcome String?`, `probabilitySuccess Float?`, `personaForecasts Json [] ({personaId, recommendation, confidence})`, `decidedAt DateTime?`, `mode String?`
  - `WeeklyMemo.itemStates Json {}` — `{ [itemKey]: { state: 'accepted'|'dismissed'|'snoozed', until?: ISO, memoryId?: string } }`
  - `ContextCapsule`: `sourceMemoryIds String[]`, `importanceSeen Float`, `version Int`
  - `MemoryEntry.consolidatedFrom String[]`
  - new `LlmUsage` (userId?, tenantId?, service, purpose, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, durationMs?, sessionId?, createdAt)
  - new `IdempotencyKey` (scope, key, route, resultId?, resultJson?, expiresAt; unique scope+key)
- Shared `Decision` type + `DecisionSchema` / `Create*` / `Update*` carry the new fields; `PersonaForecast`, `CalibrationBin`, `CalibrationReport` types exist in `types/decision.types.ts`.

## Sonnet 5.5 request rules (all Anthropic callers)

- Model ids only via `MODEL_IDS`. Haiku 4.5 keeps `thinking` off (omit). Sonnet 5.5: **omit `thinking`** (adaptive is default) or `{type:'between_tools'}`; never `{type:'disabled'}`, never `budget_tokens`, never `temperature`, never forced `tool_choice` (`any`/`tool` → 400; use `auto` + instruction, or `output_config.format` for JSON), never assistant prefill.
- Effort: `output_config: { effort: 'low' }` for personas/extractors, `'medium'` for CEO synthesis and reflection. (Default is `high`; lower it explicitly to control cost.)
- Prompt caching: system = `[{type:'text', text: CORE_CONTEXT, cache_control:{type:'ephemeral'}}, {type:'text', text: personaPrompt, cache_control:{type:'ephemeral'}}]`; retrieval results and the question go in `messages`. Cache minimums: 512 tokens Sonnet 5.5, **4,096 Haiku 4.5** — pad nothing; if the core block is under the minimum the Haiku personas simply won't cache (log `usage.cache_read_input_tokens`). Max 4 breakpoints.
- Every call records usage: see **LlmUsage** below.

## OmniMind API — new/changed endpoints

All under existing auth (`x-api-key`, `x-user-id`; agent headers as today). Errors use the existing `{error, message|details}` shape.

### Core context (owner: A1)
- `GET /context/core` → `{ block: string, tokensEstimate: number, hash: string, generatedAt }`. Deterministic markdown (sorted keys, **no timestamps inside `block`**): UserProfile summary, top-N active goals (level ≤1, N=8) each with linked project titles, open commitments due ≤14 days (with person names), standing constraints. Cached in-process 60 s per user; invalidated on goal/project/commitment/profile writes.

### Decisions / calibration (owner: A1)
- `POST /decisions` accepts the new fields (schema already does). `decidedAt` defaults to now when `chosenPath` is set.
- `GET /decisions/calibration?successThreshold=4` → `CalibrationReport` (shared type). Bins: `[0,.2),[.2,.4),[.4,.6),[.6,.8),[.8,1]`; Brier = mean((p − o)²) where o = outcomeRating ≥ threshold ? 1 : 0, over decisions with `outcomeRating != null && probabilitySuccess != null`; per-persona Brier over `personaForecasts[].confidence` **only where the persona's recommendation matched `chosenPath`** (exact or case-insensitive prefix) — otherwise skip that persona for that decision. `minimumForSignal = 20`.
- `GET /decisions/changes?entityId=<goal:|project:|person:…>&since=<ISO>` → `{ since, memories: MemoryApiRecord[] (created or invalidated since), decisions: Decision[], commitments: Commitment[], capsule: ContextCapsule|null }` scoped to the entity via link tables + MemoryEntityLink. Used by "what changed since last time".

### Temporal validity (owner: A1)
- `POST /context/for-persona` body gains optional `asOf: ISO`. When present every retrieval layer filters `valid_at <= asOf AND (invalid_at IS NULL OR invalid_at > asOf)`; when absent, default filter `(invalid_at IS NULL OR invalid_at > now())` in all four layers.
- `PATCH /memories/:id` with `supersedes: <id>` sets the old row `invalidAt = now(), supersededBy = newId` (no mutation of old content) and appends old id to new row's `consolidatedFrom`.

### Reflection / capsules (owner: A1)
- Job `jobs/reflection-scheduler.ts` nightly 02:30 (`REFLECTION_SCHEDULE`), Haiku, job-guard protected: for each Goal/Project/Person with memories linked in the last 7 days where `sum(importance of new memories since capsule.generatedAt) ≥ REFLECTION_THRESHOLD (0.8)`, regenerate the capsule (summary/openRisks/unresolvedQuestions/recentChanges/activeStakeholders), set `sourceMemoryIds`, `staleAfter = +14d`, `importanceSeen = 0`, `version++`. Zod-validate the LLM output.
- `POST /context/reflect` body `{ entityType: 'goal'|'project'|'person', entityId }` → runs the same reflection for one entity now → returns the capsule. (MCP `memory_reflect` and the UI use this.)
- `GET /context/capsules?entityIds=goal:x,project:y` → `{ items: ContextCapsule[] }`.
- `assembleContextForPersona` injects capsules for entities linked to the question's related entities (existing `findRelatedEntities` or title match), after the core block, capped at 3 capsules.

### Commitment nudges (owner: A1)
- Job `jobs/commitment-nudge-scheduler.ts` daily 07:00 (`COMMITMENT_NUDGE_SCHEDULE`), **SQL only, no LLM**: commitments `status=OPEN` with `deadline <= now()+3d` or overdue → upsert rows in a lightweight list returned by `GET /commitments/nudges` → `{ dueSoon: Commitment[], overdue: Commitment[] }` (also included in the weekly digest email).
- `assembleContextForPersona` for `doer` prepends "Open commitments" lines from the same query.

### Interactive memo (owner: A1)
- `PATCH /cortex/memo/:id/items/:itemKey` body `{ state: 'accepted'|'dismissed'|'snoozed', until?: ISO }`. `accepted` writes a memory via the validation pipeline (`sourceType: 'CORTEX'` if it exists in the enum, else `'SYSTEM'`; tags `['memo', itemKey]`) and stores its id in `itemStates`. Response: updated memo.
- Memo generation adds `decisionsAwaitingReview: string[]` (decision ids with `reviewAt <= now()+7d` and `outcomeRating IS NULL`) inside `fullMemoText` and as `upcomingPressurePoints` entries prefixed `review:`.

### LlmUsage (owner: A1 writes the endpoint; B + A1 jobs + D write rows)
- `POST /usage/llm` body `{ service, purpose, model, inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, durationMs?, sessionId?, userId? }` → 201 `{ id, costUsd }` (server computes cost with `estimateCostUsd`). Fire-and-forget from callers; failures logged, never thrown.
- `GET /usage/llm/summary?days=7` → `{ days, totalUsd, byDay: [{date, usd, calls}], byPurpose: [{purpose, usd, calls, cacheHitRate}], byModel: [...] }`.

### Links / graph extras (owner: A2)
- `POST/DELETE /projects/:projectId/people/:personId` body `{ role?: string }` (ProjectPersonLink), `POST/DELETE /projects/:projectId/decisions/:decisionId` (DecisionProjectLink), `POST/DELETE /tasks/:taskId/depends-on/:otherTaskId` (TaskDependency). All verify ownership + not soft-deleted, idempotent, 201/200/204/404.
- `GET /graph/backlinks/:nodeId` (`nodeId` = `type:refId`) → `{ node: KnowledgeGraphNode, backlinks: Array<{ node: KnowledgeGraphNode, edge: KnowledgeGraphEdge }> }`.
- `GET /graph/unlinked-mentions?limit=50` → `{ items: Array<{ memoryId, memoryTitle, entityType, entityId, entityLabel, snippet }> }` — memories whose title/content contains a Person name (≥3 chars, word boundary, case-insensitive) or Project/Goal title and have **no** `MemoryEntityLink` to it. Ministry memories: match on title only (content is encrypted/placeholder).
- `POST /graph/unlinked-mentions/link` body `{ memoryId, entityType, entityId }` → creates the MemoryEntityLink (201).
- `GET /people/duplicates` → `{ pairs: Array<{ a: Person, b: Person, similarity: number }> }` via `pg_trgm similarity(name) >= 0.6` (no auto-merge).

### Hybrid search for MCP (owner: A2)
- `POST /memories/search` body `{ query, limit?: ≤50, domain?, tags?, status?, includeArchived?, asOf?, cursor? }` → `{ items: MemoryApiRecord[] (plus `score`), nextCursor: string|null }` using the **same hybrid stack as `/context/for-persona`** (semantic+FTS+trigram → rank, forgetting curve, decrypt). Tenant from agent context. Cursor = opaque base64 of `{offset}`.

### Idempotency (owner: A2 middleware; applied by A2 on memories/people/goals/projects/tasks, by A1 on decisions/commitments)
- Header `Idempotency-Key` (≤128 chars). Scope = `agentContext.agentId` if present else `x-user-id`. On hit (same scope+key, not expired, 24 h TTL): replay stored `resultJson` with the original status and header `Idempotent-Replayed: true`. On miss: run handler, store result. Middleware: `middleware/idempotency.ts` exporting `idempotent(routeName)`.

## BoardRoom server — new/changed (owner: B)

- **Caching + model**: `agent.ts` builds `system` as the two cached blocks above; core block fetched via `omnimindClient.getCoreContext(userId)` once per dispatch and shared by all personas; personas Haiku `effort:'low'`, CEO Sonnet `effort:'medium'`. Log `usage` of every call to `POST /usage/llm` (purpose `persona:<id>`, `ceo`, `extraction`, `sufficiency`, `questionnaire`, `doer`, `premortem`).
- **Debate protocol** in `orchestrator.dispatch`: after round 1, compute majority recommendation cluster (cosine over recommendation embeddings is unavailable here — use the CEO-free heuristic: group by `dissentFlag` + a Jaccard ≥0.4 token overlap of `recommendation`); personas with `dissentFlag` or outside the majority cluster get **one** round-2 call with the other outputs **anonymized as Advisor A/B/C** and must `defend` or `concede` (Zod: `{ stance:'defend'|'concede', reason, revisedRecommendation?, revisedConfidence }`). SSE events: `rebuttal_start {personaId}`, `rebuttal_complete {personaId, stance, reason}`. Build `DisagreementLedger = Array<{ claim, heldBy: personaId[], opposedBy: personaId[], citedMemoryIds: string[] }>` and pass it to the CEO as a user-message block; CEO output schema gains `ledgerResolutions: Array<{ claim, resolution }>` and `droppedConsiderations: string[]` (facts in round-1 `sourceMemoryIds` absent from the CEO's). Emit `synthesis_complete` with the extended report. Feature flag `DEBATE_ROUND2=true` default on; `MAX_REBUTTALS=3`.
- **Pre-mortem mode**: new `UserMode` `'premortem'` (add to shared `modes.types.ts` MODE_CONFIGS: personas critic, technician, questionnaire; includesCEO true). Prompts: add `docs/prompts/premortem.system.md` (loaded via prompt-loader and prepended as a third cached system block) instructing past-tense failure narrative. Output validated into `DecisionAssumption`-shaped `{ text, confidence, reviewAt }[]` and returned in `synthesis_complete.report.assumptionsToMonitor`.
- **Decision commit**: `POST /sessions/:id/decide` body `{ chosenPath, rationale?, expectedOutcome, probabilitySuccess (0..1), reviewAt? }` → creates Decision via OmniMind with `personaForecasts` from the session's persona responses, `assumptions` from the report, `mode` from the session, `decidedAt` now; links to project ids mentioned in the session context if any (`POST /projects/:id/decisions/:decisionId`). Returns the Decision. **`probabilitySuccess` and `expectedOutcome` are required.**
- **Persona-specific retrieval**: `context-strategy.ts` adds `rewriteQuery(persona, question)` (Critic: "risks, failures, past mistakes, what went wrong about: …"; Doer: "tasks, deadlines, commitments, owners about: …"; Technician: "implementation, constraints, dependencies about: …"; Optimist: "opportunities, wins, momentum about: …"; default: question). Critic requests `includeArchived: true` and memoryClass DECISION.
- **Proxies** (all thin): `GET /context/core`, `GET /decisions/calibration`, `GET /decisions/changes`, `POST /context/reflect`, `GET /context/capsules`, `GET /commitments/nudges`, `PATCH /cortex/memo/:id/items/:key`, `GET /usage/llm/summary`, link routes, `GET /graph/backlinks/:id`, `GET /graph/unlinked-mentions`, `POST /graph/unlinked-mentions/link`, `GET /people/duplicates`, `POST /memories/search`.
- **Observability**: `server/src/lib/otel.ts` started first thing in `index.ts` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (NodeSDK + auto-instrumentations http/express + OTLP http trace exporter; service name `boardroom-ai`); propagate `traceparent` to OmniMind via `omnimind-client` (auto-instrumentation does this for `fetch`/`http`; verify). Same for OmniMind (A1 owns `omnimind-api/src/lib/otel.ts`, service name `omnimind-api`).
- **Private networking**: `.env.example` + runbook note: `OMNIMIND_API_URL=http://omnimind-api.railway.internal:3333`; OmniMind binds `::` (A1 in `index.ts`: `app.listen(port, '::')`).

## BoardRoom client (owner: C)

- Decision commit UI after synthesis: `DecisionCommitCard` with chosen path (pick from report/persona recommendations or custom), expected outcome (textarea, required), probability slider 5–95 % (required), review date (default +30 d) → `POST /sessions/:id/decide`.
- `OutcomeReviewModal`: show the original `expectedOutcome` + `probabilitySuccess` **before** the rating control.
- Calibration section (Decisions page or Settings → Insights): reliability diagram (forecast vs observed, 5 bins, diagonal reference), Brier per persona + user; hidden behind "Needs N more reviewed decisions" until `reviewedDecisions >= minimumForSignal`. Charts follow `dataviz` rules: one axis, text in text tokens, legend when ≥2 series, hover tooltips, table view toggle.
- Disagreement ledger + dropped considerations rendered in the synthesis view; rebuttal events shown inline on persona cards (`rebuttal_start/complete`).
- Pre-mortem mode selectable in the mode picker.
- "What changed since last time" card at session start when the question maps to a known entity (search entities by title match client-side; call `/decisions/changes`).
- Commitment nudges widget (due soon / overdue) on the dashboard; weekly memo items get accept/dismiss/snooze controls.
- People page: duplicates banner with "Not duplicates" / "Open both".
- Graph inspector: backlinks from `/graph/backlinks/:id`; "Unlinked mentions" panel on the graph page with one-click link; link editors: assign person to project (role), link decision to project, add task dependency.
- Cost widget (dashboard, admin-only): last 7 days USD, by purpose, cache hit rate.

## MCP (owner: D)

- All 15 tools gain `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint:false`), `outputSchema` from Zod, and return `structuredContent` alongside text.
- Write tools accept optional `idempotencyKey` → sent as `Idempotency-Key` header.
- `memory_search` → `POST /memories/search` (hybrid); `task_list`, `commitment_list`, `memory_search` return `nextCursor`, page ≤20.
- New tools: `memory_reflect {entityType, entityId}` → `POST /context/reflect`; `memory_consolidate {dryRun?: true}` → `GET /memories?…recent` + `POST /memories/search-similar` pairs ≥0.92 → returns proposed `{keepId, archiveId, similarity}` list; when `dryRun=false` performs `PATCH supersedes`. Both `memory:write`, audited. `graph_neighborhood {nodeId, hops≤2}` → `GET /graph/backlinks` BFS (memory:read). `status_get` includes `commitmentsDueSoon` from `/commitments/nudges`.
- Resources (`server.resource`): `omnimind://{tenant}/status`, `omnimind://{tenant}/goal/{id}`, `omnimind://{tenant}/person/{id}`, `omnimind://{tenant}/graph/{nodeId}` (hops=2). Prompts: `session_start`, `decision_review`, `session_end` encoding the CLAUDE.md dogfooding rules.
- Every tool call posts `LlmUsage` only where the MCP itself calls Anthropic (fact-extractor, purpose `mcp:fact-extractor`).

## Eval / CI / ops (owner: E)

- `eval/retrieval/gold/*.json`: ≥35 labeled queries per tenant archetype (business, personal, ministry-shaped but non-sensitive synthetic data), each `{ id, query, persona, relevantMemoryKeys: string[], slice: 'temporal'|'update'|'abstention'|'entity'|'general' }`; `eval/retrieval/seed.ts` seeds the memories (deterministic keys → ids) through the API; `eval/runners/eval-retrieval-ir.ts` computes recall@5, recall@10, MRR, nDCG@10 overall and per slice; writes `eval/results/retrieval-ir-<date>.json`; exits non-zero below `eval/retrieval/thresholds.json`.
- CI: new job `retrieval-eval` with `pgvector/pgvector:pg16` service, boots omnimind-api against it (`migrate deploy`), runs the IR eval with embeddings **mocked deterministically** (hash-based 1536-dim vectors via `EMBEDDING_PROVIDER=mock` — A1 adds this provider switch in `embedding.service.ts`; E consumes it) so no API key is needed.
- `eval-personas.ts`: pairwise cosine between persona outputs per scenario (median > 0.85 → warn), sycophancy probe (opt-in, needs key).
- `services/backup/`: Dockerfile + `backup.sh` (pg_dump -Fc nightly → Cloudflare R2 via `rclone`), `restore-drill.sh` (restore into scratch DB, row-count + `/context` smoke), `railway.json`; docs in `docs/03-operations/BACKUPS.md`.
- `.env.example` + runbook: `OMNIMIND_API_URL` private host, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `REFLECTION_SCHEDULE`, `REFLECTION_THRESHOLD`, `COMMITMENT_NUDGE_SCHEDULE`, `DEBATE_ROUND2`, `MAX_REBUTTALS`, `EMBEDDING_PROVIDER`, backup vars.

## Lane rules

- A1 (omnimind: context, decisions, cortex, jobs, retrieval layers, context-assembler, embedding provider switch, otel, usage) · A2 (omnimind: memories.routes/service search + idempotency, entity link routes, knowledge-graph routes/service, people duplicates) · B (boardroom server) · C (boardroom client) · D (omnimind-mcp) · E (eval, tests, CI, scripts, services/backup, docs/03-operations).
- Nobody edits `schema.prisma`, any `package.json`, or the lockfile. Nobody commits. Each lane runs its own package typecheck + tests before reporting, and the whole-repo `pnpm typecheck` at the end (report, don't fix, failures in files you did not touch).
- Shared package: A1 may add `types/context.types.ts` + `validation/context.schema.ts` (core context, capsule, changes, usage, nudges); B may add rebuttal/ledger types to `types/persona.types.ts` + `validation/persona.schema.ts` and the `premortem` mode; D may add MCP output schemas under `validation/mcp.schema.ts`. No other shared edits; extend, never rename.
