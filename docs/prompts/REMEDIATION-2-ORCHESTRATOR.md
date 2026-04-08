# REMEDIATION 2 — POST-SECOND-AUDIT ORCHESTRATOR

> **Usage**: Paste into Claude Code (Opus). Fresh session recommended.
> **Purpose**: Fix all Critical + Warning findings from the second build audit (B- grade).
> **Duration**: ~4-5 hours. Modifies code across both services + shared.
> **Scope**: Authorization fixes, test regression, client routing, validation, CORS, contracts, SSE types, prompt externalization.

---

Read .claude/CLAUDE.md first. You are the REMEDIATION-2 AGENT.

**Protocol per task:**
1. BRIEF: State what you're fixing, which files, expected change.
2. BUILD: Minimal diff. Don't refactor beyond the fix.
3. VALIDATE: `npm run typecheck` in affected packages. Run tests if relevant.

**Stop conditions:**
- TypeScript won't compile after a fix → revert, move to next task
- 2 failed attempts on same fix → skip, document in REMEDIATION-2-REPORT.md
- Never delete working code to simplify (CLAUDE.md Rule 1)

**Commit after EACH task.** Message format:
`fix(scope): description — REM2-{N}`

---

## TASK 1: CRITICAL — Fix Test Regression from Env Var Guards

**Problem:** Remediation 1 changed JWT_SECRET and OMNIMIND_API_KEY to throw
at module load time. This crashes 3 test suites that import these modules
before setting env vars. Tests went from 85 pass / 0 fail to 85 pass / 3 broken suites.

**Fix pattern:** Change top-level throw to lazy initialization.

### 1a. `packages/boardroom-ai/server/src/middleware/auth.ts` lines 8-9
```typescript
// CURRENT (crashes tests on import):
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');

// FIX — lazy getter:
let _jwtSecret: string | undefined;
function getJwtSecret(): string {
  if (!_jwtSecret) {
    _jwtSecret = process.env.JWT_SECRET;
    if (!_jwtSecret) throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  }
  return _jwtSecret;
}
```
Then replace all usages of `JWT_SECRET` in this file with `getJwtSecret()`:
- `createToken` (line 30): `jwt.sign(payload, getJwtSecret(), ...)`
- `verifyToken` (line 34): `jwt.verify(token, getJwtSecret())`

### 1b. `packages/boardroom-ai/server/src/services/omnimind-client.ts` lines 2-3
```typescript
// CURRENT:
const OMNIMIND_KEY = process.env.OMNIMIND_API_KEY;
if (!OMNIMIND_KEY) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set.');

// FIX — lazy getter:
let _omnimindKey: string | undefined;
function getOmnimindKey(): string {
  if (!_omnimindKey) {
    _omnimindKey = process.env.OMNIMIND_API_KEY;
    if (!_omnimindKey) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set.');
  }
  return _omnimindKey;
}
```
Update the `request()` method to call `getOmnimindKey()` instead of using the constant.

### 1c. `packages/omnimind-api/src/middleware/auth.ts` lines 4-5
Same pattern. Lazy getter for API_KEY.

**Validate:** `npx vitest run` in ALL 3 packages. All previously passing tests
must pass again. The 3 broken suites should now work.

---

## TASK 2: CRITICAL — Fix Authorization Bypass on Outcome Reviews

**Problem:** `POST /outcome-reviews/:id/complete` and `POST /outcome-reviews/:id/skip`
don't check user ownership. Any authenticated API key holder can modify any user's reviews.

### 2a. Update service functions in `packages/omnimind-api/src/services/outcome-review.service.ts`

**completeReview** (line 38) — add userId parameter and ownership check:
```typescript
export async function completeReview(
  nudgeId: string,
  userId: string,          // ← ADD THIS
  outcome: string,
  rating: number,
  wouldRepeat: boolean,
  prisma: PrismaClient,
) {
  // Verify ownership
  const nudge = await prisma.outcomeReviewNudge.findFirst({
    where: { id: nudgeId, decision: { userId } },
  });
  if (!nudge) throw Object.assign(new Error('Not found'), { status: 404 });

  // Then update
  const updated = await prisma.outcomeReviewNudge.update({
    where: { id: nudgeId },
    data: { status: 'completed', completedAt: new Date() },
  });
  // ... rest of function (update decision with outcome)
```

**skipReview** (line 63) — add userId parameter and ownership check:
```typescript
export async function skipReview(nudgeId: string, userId: string, prisma: PrismaClient) {
  const nudge = await prisma.outcomeReviewNudge.findFirst({
    where: { id: nudgeId, decision: { userId } },
  });
  if (!nudge) throw Object.assign(new Error('Not found'), { status: 404 });

  return prisma.outcomeReviewNudge.update({
    where: { id: nudgeId },
    data: { status: 'skipped' },
  });
}
```

### 2b. Update routes in `packages/omnimind-api/src/routes/outcome-review.routes.ts`

**Complete endpoint** (line 47) — extract userId, pass to service:
```typescript
router.post('/:id/complete', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const { outcome, outcomeRating, wouldDecideSame } = req.body;
    // ... existing validation ...
    const nudge = await reviewService.completeReview(
      req.params.id,
      userId,              // ← ADD THIS
      outcome,
      outcomeRating,
      wouldDecideSame ?? true,
      prisma,
    );
    res.json(nudge);
  } catch (err) { /* handle 404 from ownership check */ next(err); }
});
```

**Skip endpoint** (line 71) — same pattern:
```typescript
router.post('/:id/skip', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const nudge = await reviewService.skipReview(req.params.id, userId, prisma);
    res.json(nudge);
  } catch (err) { next(err); }
});
```

**Validate:** `npm run typecheck` in omnimind-api.

---

## TASK 3: CRITICAL — Fix Authorization Bypass on Contradiction Updates

**Problem:** `PATCH /contradictions/:id` extracts userId but never passes it
to the service. `updateContradiction()` updates by ID only, no ownership check.

### 3a. Update `packages/omnimind-api/src/services/cortex-contradictions.service.ts`

**updateContradiction** (line 112) — add userId param and ownership filter:
```typescript
export async function updateContradiction(
  id: string,
  userId: string,              // ← ADD THIS
  status: string,
  resolution: string | undefined,
  prisma: PrismaClient
) {
  // Verify ownership
  const existing = await prisma.contradictionAlert.findFirst({ where: { id, userId } });
  if (!existing) throw Object.assign(new Error('Not found'), { status: 404 });

  return prisma.contradictionAlert.update({
    where: { id },
    data: {
      status: status as Prisma.ContradictionAlertUpdateInput['status'],
      resolution: resolution ?? null,
      resolvedAt: ['RESOLVED', 'DISMISSED'].includes(status) ? new Date() : null,
    },
  });
}
```

### 3b. Update `packages/omnimind-api/src/routes/cortex.routes.ts` line 93

Pass userId to the service:
```typescript
const updated = await contradictionService.updateContradiction(req.params.id, userId, status, resolution, prisma);
```

**Validate:** `npm run typecheck` in omnimind-api.

---

## TASK 4: WARNING — Fix Client Routing Mismatches

**Problem:** Two methods in omnimind-client.ts call endpoints that don't match
the actual API routes. These are runtime 404s.

### 4a. `packages/boardroom-ai/server/src/services/omnimind-client.ts`

**archiveMemory** (line 189) — calls `POST /memories/:id/archive` but API uses `DELETE /memories/:id`:
```typescript
// CURRENT:
async archiveMemory(userId: string, id: string) {
  return this.request('POST', `/memories/${id}/archive`, userId);
}

// FIX:
async archiveMemory(userId: string, id: string) {
  return this.request('DELETE', `/memories/${id}`, userId);
}
```

**searchMemories** (line 193) — calls `GET /memories/search` but API uses `GET /memories?q=`:
```typescript
// CURRENT:
async searchMemories(userId: string, query: string, limit: number = 20) {
  return this.request('GET', `/memories/search?q=${encodeURIComponent(query)}&limit=${limit}`, userId);
}

// FIX:
async searchMemories(userId: string, query: string, limit: number = 20) {
  return this.request('GET', `/memories?q=${encodeURIComponent(query)}&limit=${limit}`, userId);
}
```

**Validate:** `npm run typecheck` in boardroom-ai.

---

## TASK 5: WARNING — Add Zod Validation to Remaining 5 LLM Call Sites

**Problem:** Remediation 1 fixed cortex services. 5 BoardRoom-side LLM calls
still use raw `JSON.parse()` without Zod.

### 5a. Create schemas in `packages/shared/src/schemas/boardroom-llm.schemas.ts`

```typescript
import { z } from 'zod';

// Doer task breakdown
export const DoerTaskBreakdownSchema = z.object({
  tasks: z.array(z.object({
    title: z.string(),
    owner: z.string().optional(),
    deadline: z.string().optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
  })),
}).passthrough();

// Onboarding goal extraction
export const ExtractedGoalsSchema = z.array(z.object({
  title: z.string(),
  level: z.number().min(0).max(3),
  domain: z.string(),
}));

// Onboarding project extraction
export const ExtractedProjectsSchema = z.array(z.object({
  title: z.string(),
  domain: z.string(),
  status: z.enum(['active', 'planning', 'paused']),
}));

// Gmail email memory proposals
export const EmailMemoryProposalsSchema = z.array(z.object({
  content: z.string(),
  domain: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough());

// Commitment extraction
export const ExtractedCommitmentsSchema = z.array(z.object({
  description: z.string(),
  stakeholder: z.string().nullable(),
  deadline: z.string().nullable(),
}));
```

Export from `packages/shared/src/schemas/index.ts`.

### 5b. Apply to each call site

**orchestrator.ts** line 327 (runDoer):
```typescript
import { DoerTaskBreakdownSchema } from '@boardroom/shared';
// ...
return DoerTaskBreakdownSchema.parse(JSON.parse(jsonStr));
```

**onboarding.routes.ts** line 33 (extract-goals):
```typescript
import { ExtractedGoalsSchema } from '@boardroom/shared';
// ...
res.json(ExtractedGoalsSchema.parse(JSON.parse(jsonStr)));
```

**onboarding.routes.ts** line 63 (extract-projects):
```typescript
import { ExtractedProjectsSchema } from '@boardroom/shared';
// ...
res.json(ExtractedProjectsSchema.parse(JSON.parse(jsonStr)));
```

**gmail.service.ts** line 160:
```typescript
import { EmailMemoryProposalsSchema } from '@boardroom/shared';
// ...
proposals = EmailMemoryProposalsSchema.parse(JSON.parse(jsonStr));
```

**commitment-tracker.ts** line 42:
```typescript
import { ExtractedCommitmentsSchema } from '@boardroom/shared';
// ...
return ExtractedCommitmentsSchema.parse(JSON.parse(jsonStr));
```

### 5c. Write tests for new schemas
`packages/shared/tests/boardroom-llm-schemas.test.ts` — validate accepts/rejects for each schema.

**Validate:** `npm run typecheck` in shared + boardroom-ai. `npx vitest run` in shared.

---

## TASK 6: WARNING — Fix CORS Configuration

**Problem:** `cors({ origin: true, credentials: true })` accepts ALL origins
with credentials. This is the most dangerous CORS config possible — browsers
will send cookies to any requesting origin.

### 6a. `packages/boardroom-ai/server/src/index.ts` line 25

```typescript
// CURRENT:
app.use(cors({ origin: true, credentials: true }));

// FIX:
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
```

### 6b. Add `CORS_ORIGINS` to `.env.example`:
```
# Comma-separated allowed origins for CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

**Validate:** `npm run typecheck` in boardroom-ai.

---

## TASK 7: WARNING — Fix Cookie and Auth Response Issues

**Problem 7a:** `clearCookie` on logout doesn't match cookie options.
**Problem 7b:** Auth middleware 401 shape doesn't match contract.

### 7a. `packages/boardroom-ai/server/src/routes/auth.routes.ts` line 66-67

```typescript
// CURRENT:
router.post('/logout', (_req, res) => {
  res.clearCookie('boardroom_token');
  res.json({ status: 'ok' });
});

// FIX:
router.post('/logout', (_req, res) => {
  res.clearCookie('boardroom_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ status: 'ok' });
});
```

### 7b. `packages/boardroom-ai/server/src/middleware/auth.ts` lines 45-52

Contract requires `{ error: "unauthorized", message: string }`:
```typescript
// CURRENT:
res.status(401).json({ error: 'Authentication required' });
// ...
res.status(401).json({ error: 'Invalid or expired token' });

// FIX:
res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
// ...
res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
```

**Validate:** `npm run typecheck`.

---

## TASK 8: WARNING — Fix DELETE Response Shapes

**Problem:** 2 DELETE endpoints return 204 No Content, contract says `{ status: "deleted" }`.
1 DELETE returns full object, contract says `{ status: "canceled" }`.

### 8a. `packages/omnimind-api/src/routes/memories.routes.ts` line ~195
```typescript
// CURRENT:
res.status(204).end();

// FIX:
res.json({ status: 'deleted' });
```

### 8b. `packages/omnimind-api/src/routes/custom-personas.routes.ts` line ~122
```typescript
// CURRENT:
res.status(204).end();

// FIX:
res.json({ status: 'deleted' });
```

### 8c. `packages/omnimind-api/src/routes/subscription.routes.ts` line ~85
```typescript
// CURRENT:
res.json(subscription);

// FIX:
res.json({ status: 'canceled', subscription });
```

**Validate:** `npm run typecheck`.

---

## TASK 9: WARNING — Fix createMemory Client Type Mismatch

**Problem:** Client declares `request<Memory>` but API returns `{ id, status, validation }`.

### 9a. Create response type in `packages/shared/src/types/api-responses.types.ts`
```typescript
export interface CreateMemoryResponse {
  id: string;
  status: 'created';
  validation: {
    syncPassed: boolean;
    errors: string[];
  };
}
```

Export from shared index.

### 9b. `packages/boardroom-ai/client/src/lib/api.ts` line 419
```typescript
// CURRENT:
export function createMemory(input: Record<string, unknown>) {
  return request<Memory>('/memories', { ... });
}

// FIX:
import type { CreateMemoryResponse } from '@boardroom/shared';
export function createMemory(input: Record<string, unknown>) {
  return request<CreateMemoryResponse>('/memories', { ... });
}
```

**Validate:** `npm run typecheck` in boardroom-ai (client).

---

## TASK 10: WARNING — Add Zod Body Validation to POST/PATCH Routes

**Problem:** 9+ endpoints destructure req.body with zero runtime validation.

### 10a. Create request body schemas in `packages/shared/src/schemas/request-body.schemas.ts`

```typescript
import { z } from 'zod';

export const RegisterBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

export const LoginBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export const CreateSessionBodySchema = z.object({
  question: z.string().min(1).max(5000),
  mode: z.enum(['advisory', 'doer']).optional(),
  roomId: z.string().optional(),
});

export const UpdateUserProfileBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  decisionFrequency: z.string().optional(),
  onboardingComplete: z.boolean().optional(),
  dashboardLayout: z.unknown().optional(),
}).passthrough();

export const SaveOAuthTokenBodySchema = z.object({
  provider: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  calendarId: z.string().nullable().optional(),
});

export const ContextForPersonaBodySchema = z.object({
  query: z.string().min(1).max(5000),
  persona: z.string().min(1),
  maxItems: z.number().min(1).max(20).optional(),
  includeEntities: z.boolean().optional(),
});
```

Export from shared index.

### 10b. Apply to routes (highest priority first)

For each route: replace manual destructuring with schema.parse(req.body).
Wrap in try/catch — on ZodError, return 422 with formatted details.

Create a tiny helper (or add to existing middleware):
```typescript
// packages/omnimind-api/src/middleware/validate.ts (or similar)
import { ZodSchema, ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(422).json({
          error: 'validation_failed',
          details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
      }
      next(err);
    }
  };
}
```

Apply as middleware to: auth/register, auth/login, sessions POST,
user-profile PATCH, oauth POST, context/for-persona POST.

This also adds **input length validation** — the schemas enforce max lengths,
preventing oversized payloads (e.g., a 10MB decision title).

**Validate:** `npm run typecheck` in all packages. Run existing tests.

---

## TASK 11: WARNING — Define SSE Event Types

**Problem:** 10+ SSE event types are hardcoded strings with no shared type.
Frontend parses them as untyped JSON.

### 11a. Create `packages/shared/src/types/sse-events.types.ts`

```typescript
export interface SSEPersonaStart {
  type: 'persona_start';
  personaId: string;
  model: string;
}

export interface SSEPersonaComplete {
  type: 'persona_complete';
  personaId: string;
  response: unknown;
  toolInvocations?: unknown[];
}

export interface SSEPersonaError {
  type: 'persona_error';
  personaId: string;
  error: string;
}

export interface SSEDispatchComplete {
  type: 'dispatch_complete';
  personaCount: number;
  durationMs: number;
}

export interface SSESynthesisStart {
  type: 'synthesis_start';
  model: string;
}

export interface SSEDelta {
  type: 'delta';
  text: string;
}

export interface SSESynthesisComplete {
  type: 'synthesis_complete';
  report: string;
  qualityScore: number;
}

export interface SSEDone {
  type: 'done';
}

export interface SSEError {
  type: 'error';
  error: string;
}

export type BoardRoomSSEEvent =
  | SSEPersonaStart
  | SSEPersonaComplete
  | SSEPersonaError
  | SSEDispatchComplete
  | SSESynthesisStart
  | SSEDelta
  | SSESynthesisComplete
  | SSEDone
  | SSEError;
```

Export from shared index.

### 11b. Update server to use types
Import `BoardRoomSSEEvent` in orchestrator.ts and streaming.ts.
Type the `sendSSE` helper to accept `BoardRoomSSEEvent` only.

### 11c. Update client to use types
Import in the SSE event handler. Use discriminated union switch on `event.type`.

**Validate:** `npm run typecheck` in all 3 packages.

---

## TASK 12: CLEANUP — Externalize Inline System Prompts

**Problem:** 7 inline system prompts violate CLAUDE.md Rule 5:
"Persona prompts live in docs/prompts/*.system.md. Code loads them at runtime."

### 12a. Create prompt files in `docs/prompts/`:
- `docs/prompts/sufficiency-check.system.md` — from sufficiency.ts lines 12-15
- `docs/prompts/commitment-extraction.system.md` — from commitment-tracker.ts lines 28-30
- `docs/prompts/onboarding-goals.system.md` — from onboarding.routes.ts line 26
- `docs/prompts/onboarding-projects.system.md` — from onboarding.routes.ts line 56
- `docs/prompts/cortex-memo.system.md` — from cortex-memo.service.ts line 57
- `docs/prompts/cortex-patterns.system.md` — from cortex-patterns.service.ts line 34
- `docs/prompts/cortex-contradictions.system.md` — from cortex-contradictions.service.ts line 57

### 12b. Create a shared `loadPrompt()` helper if one doesn't exist, or reuse the existing one from the persona system.

### 12c. Replace inline strings with `loadPrompt('filename')` calls in each service file.

**Validate:** `npm run typecheck`. Verify prompt files exist and load correctly.

---

## TASK 13: CLEANUP — Update Contract Docs for BoardRoom Endpoints

**Problem:** 27 BoardRoom endpoints exist in code but aren't in the contract.

### 13a. Update `docs/contracts/boardroom-api.contract.md`

Add sections for:

**Onboarding (3 endpoints):**
- `POST /onboarding/extract-goals`
- `POST /onboarding/extract-projects`
- `POST /onboarding/complete`

**Calendar (5 endpoints):**
- `GET /calendar/status`
- `GET /calendar/auth-url`
- `GET /calendar/callback`
- `GET /calendar/events`
- `POST /calendar/disconnect`

**Integrations (7 endpoints):**
- `GET /integrations`
- `GET /integrations/gmail/auth-url`
- `GET /integrations/gmail/callback`
- `POST /integrations/gmail/disconnect`
- `GET /integrations/gmail/emails`
- `POST /integrations/gmail/extract`
- `POST /integrations/gmail/confirm`

**Entity Proxies (12+ endpoints):**
- CRUD for goals, projects, tasks, people, decisions, commitments
- Document that these proxy to OmniMind with x-user-id forwarding

Read each route file to get exact request/response shapes. Match existing
contract format.

**Validate:** Read-only — verify every route in code has a contract entry.

---

## FINAL: REMEDIATION-2 REPORT

After all tasks, create `docs/REMEDIATION-2-REPORT.md`:

```markdown
# Remediation 2 Report — Post-Second-Audit Fixes
Date: [date]
Agent: Claude Code (Opus) — Remediation-2 Agent
Audit Grade (Before): B-
Tasks Attempted: 13
Tasks Completed: X/13

## Changes by Task
1. [PASS/FAIL] Test regression — lazy env var init
2. [PASS/FAIL] Outcome review ownership checks
3. [PASS/FAIL] Contradiction update ownership check
4. [PASS/FAIL] Client routing mismatches
5. [PASS/FAIL] Zod validation on 5 LLM call sites
6. [PASS/FAIL] CORS origin allowlist
7. [PASS/FAIL] Cookie + auth response shape fixes
8. [PASS/FAIL] DELETE response shapes
9. [PASS/FAIL] createMemory client type
10. [PASS/FAIL] Zod body validation on POST/PATCH routes
11. [PASS/FAIL] SSE event discriminated union
12. [PASS/FAIL] Externalize inline prompts
13. [PASS/FAIL] BoardRoom contract docs

## Post-Remediation Status
- TypeScript: [COMPILES / ERRORS]
- Tests: [X passed, Y failed, Z skipped]
- Security criticals remaining: [N]
- Contract compliance: [X/Y endpoints documented]
- Estimated new grade: [A-/B+]
```

Run `npm run typecheck` and `npx vitest run` across all 3 packages as final check.

---

## EXECUTION ORDER

**BLOCKERS (do first, in order):**
- Task 1 (test regression) — unblocks all subsequent testing
- Task 2 (outcome review auth) — security critical
- Task 3 (contradiction auth) — security critical

**HIGH PRIORITY (do next):**
- Task 4 (client routing) — runtime 404s
- Task 5 (LLM Zod validation) — CLAUDE.md Rule 3
- Task 6 (CORS) — security
- Task 7 (cookie + auth shape) — contract compliance

**MEDIUM PRIORITY:**
- Task 8 (DELETE shapes) — contract compliance
- Task 9 (createMemory type) — type safety
- Task 10 (body validation) — input validation
- Task 11 (SSE types) — type safety

**LOW PRIORITY (skip if running low on context):**
- Task 12 (externalize prompts) — CLAUDE.md Rule 5
- Task 13 (contract docs) — documentation

Begin Task 1 now. Commit after each task. Go.
