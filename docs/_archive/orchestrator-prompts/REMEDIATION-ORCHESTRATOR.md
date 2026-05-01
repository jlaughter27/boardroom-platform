# POST-AUDIT REMEDIATION ORCHESTRATOR

> **Usage**: Paste into Claude Code (Opus) after reviewing the B+ audit report.
> **Purpose**: Fix all Critical + Warning findings from the build audit, plus
> 3 additional findings discovered during independent validation.
> **Duration**: ~3-4 hours. Modifies code.
> **Scope**: Security hardening, validation compliance, contract alignment, cleanup.

---

Read .claude/CLAUDE.md first. You are the REMEDIATION AGENT. You have the
full audit report context. You will fix every Critical and Warning finding
in priority order, using the BRIEF → BUILD → VALIDATE protocol.

**Protocol per task:**
1. BRIEF: State what you're fixing, which files, and the expected change.
2. BUILD: Make the changes. Minimal diff — don't refactor beyond the fix.
3. VALIDATE: Run `npm run typecheck` in affected packages. Run relevant tests.
   If a Zod schema was added, write a unit test for it.

**Stop conditions:**
- TypeScript won't compile after a fix → revert and move to next task
- 2 failed attempts on the same fix → skip, document in REMEDIATION-REPORT.md
- Never delete working code to simplify. Add alongside. (CLAUDE.md Rule 1)

**Commit after EACH task completes validation.** Message format:
`fix(scope): description — REMEDIATION-{N}`

---

## TASK 1: CRITICAL — Remove Hardcoded Secret Fallbacks

**Problem:** JWT_SECRET and OMNIMIND_API_KEY have hardcoded fallback strings
that will silently activate if env vars are missing, compromising all auth.

**Files to modify:**

### 1a. `packages/boardroom-ai/server/src/middleware/auth.ts` line 8
```typescript
// CURRENT (VULNERABLE):
const JWT_SECRET = process.env.JWT_SECRET ?? 'boardroom-dev-secret';

// FIX:
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
```

### 1b. `packages/boardroom-ai/server/src/services/omnimind-client.ts` line 2
```typescript
// CURRENT (VULNERABLE):
const OMNIMIND_KEY = process.env.OMNIMIND_API_KEY ?? 'dev-api-key-change-in-production';

// FIX:
const OMNIMIND_KEY = process.env.OMNIMIND_API_KEY;
if (!OMNIMIND_KEY) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set.');
```

### 1c. `packages/omnimind-api/src/middleware/auth.ts` line 4
```typescript
// CURRENT (VULNERABLE):
const API_KEY = process.env.OMNIMIND_API_KEY ?? 'dev-api-key-change-in-production';

// FIX:
const API_KEY = process.env.OMNIMIND_API_KEY;
if (!API_KEY) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set.');
```

**Validate:** `npm run typecheck` in both packages. Verify tests still pass
(tests should set env vars in their setup — if any break, add the env var
to the test setup, NOT by re-adding the fallback).

---

## TASK 2: CRITICAL — Encrypt OAuth Tokens at Rest

**Problem:** `packages/omnimind-api/src/routes/oauth.routes.ts` stores
accessToken and refreshToken as plaintext strings in PostgreSQL.

**Implementation:**

### 2a. Create `packages/omnimind-api/src/lib/crypto.ts`
```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('FATAL: ENCRYPTION_KEY environment variable not set');
  // Key must be 32 bytes for aes-256. Accept hex-encoded 64-char string.
  return Buffer.from(key, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  const [ivHex, tagHex, ciphertextHex] = encoded.split(':');
  if (!ivHex || !tagHex || !ciphertextHex) throw new Error('Invalid encrypted token format');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(ciphertextHex, 'hex', 'utf-8') + decipher.final('utf-8');
}
```

### 2b. Update `packages/omnimind-api/src/routes/oauth.routes.ts`
- Import `{ encrypt, decrypt }` from `'../lib/crypto'`
- In POST /oauth/token: encrypt `accessToken` and `refreshToken` before `prisma.oAuthToken.upsert()`
- In GET /oauth/token/:provider: decrypt `accessToken` and `refreshToken` before returning

### 2c. Add `ENCRYPTION_KEY` to `.env.example` with generation instructions:
```
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=
```

### 2d. Write test: `packages/omnimind-api/tests/unit/crypto.test.ts`
- Test encrypt/decrypt roundtrip
- Test tampered ciphertext throws
- Test missing ENCRYPTION_KEY throws

**Validate:** `npx vitest run` for the new test. `npm run typecheck`.

---

## TASK 3: CRITICAL — Add Zod Validation to All Cortex + Simulation Services

**Problem:** 4 services parse LLM JSON with raw `JSON.parse()` and write
directly to DB, violating CLAUDE.md Rule 3. This is a SYSTEMATIC fix.

**Files to modify:**

### 3a. Create Zod schemas in `packages/shared/src/schemas/cortex.schemas.ts`
```typescript
import { z } from 'zod';

export const WeeklyMemoResponseSchema = z.object({
  decisionsMade: z.number(),
  decisionsByCategory: z.record(z.string(), z.number()),
  patternsNoticed: z.array(z.string()),
  activeContradictions: z.array(z.string()),
  upcomingPressurePoints: z.array(z.string()),
  thinkingQualityScore: z.number().min(0).max(10),
  recommendedFocus: z.array(z.string()),
  fullMemoText: z.string(),
});

export const DetectedPatternSchema = z.object({
  pattern: z.string(),
  patternType: z.enum(['BIAS', 'STRENGTH', 'BEHAVIORAL_CYCLE', 'DECISION_STYLE']),
  confidence: z.number().min(0).max(1),
  evidence: z.string().optional(),
});
export const DetectedPatternsSchema = z.array(DetectedPatternSchema);

export const ContradictionDetectionSchema = z.object({
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  entityATitle: z.string(),
  entityBTitle: z.string(),
});
export const ContradictionDetectionsSchema = z.array(ContradictionDetectionSchema);

export const SimulationResultSchema = z.object({
  resourceImpact: z.unknown(),
  timelineImpact: z.unknown(),
  stakeholderImpact: z.unknown(),
  overallRisk: z.unknown(),
}).passthrough(); // Allow extra fields from LLM
```

Export all from `packages/shared/src/schemas/index.ts`.

### 3b. Update `packages/omnimind-api/src/services/cortex-memo.service.ts` line 75
```typescript
// CURRENT:
const memoData = JSON.parse(jsonStr);

// FIX:
import { WeeklyMemoResponseSchema } from '@boardroom/shared';
const memoData = WeeklyMemoResponseSchema.parse(JSON.parse(jsonStr));
```

### 3c. Update `packages/omnimind-api/src/services/cortex-patterns.service.ts` line 48
```typescript
// CURRENT:
const detected = JSON.parse(jsonStr) as { pattern: string; patternType: string; confidence: number }[];

// FIX:
import { DetectedPatternsSchema } from '@boardroom/shared';
const detected = DetectedPatternsSchema.parse(JSON.parse(jsonStr));
```

### 3d. Update `packages/omnimind-api/src/services/cortex-contradictions.service.ts` line 67
```typescript
// CURRENT:
const detected = JSON.parse(jsonStr) as { description: string; severity: string; entityATitle: string; entityBTitle: string }[];

// FIX:
import { ContradictionDetectionsSchema } from '@boardroom/shared';
const detected = ContradictionDetectionsSchema.parse(JSON.parse(jsonStr));
```

### 3e. Update `packages/omnimind-api/src/services/simulation.service.ts` line 68
```typescript
// CURRENT:
return JSON.parse(jsonStr);

// FIX:
import { SimulationResultSchema } from '@boardroom/shared';
return SimulationResultSchema.parse(JSON.parse(jsonStr));
```

### 3f. Write tests: `packages/shared/tests/cortex-schemas.test.ts`
- Test each schema accepts valid data
- Test each schema rejects malformed data (wrong types, missing fields)
- Test edge cases (empty arrays, boundary numbers)

**Validate:** `npx vitest run` in shared/. `npm run typecheck` in omnimind-api/.

---

## TASK 4: WARNING — Add Rate Limiting to Auth Endpoints

**Problem:** `packages/boardroom-ai/server/src/routes/auth.routes.ts` has
no rate limiting on POST /auth/register and POST /auth/login. Brute force
and credential stuffing attacks are unmitigated.

**Implementation:**

### 4a. Check if `session-rate-limiter.ts` exists and can be reused
Read `packages/boardroom-ai/server/src/middleware/session-rate-limiter.ts`.
If it uses a generic rate limiter pattern, create an auth-specific config.
If not, create a new `auth-rate-limiter.ts` middleware.

Use a stricter config for auth:
- Login: 5 attempts per IP per 15 minutes (prevents brute force)
- Register: 3 attempts per IP per hour (prevents spam accounts)

### 4b. Apply to auth routes
```typescript
// In auth.routes.ts:
import { loginLimiter, registerLimiter } from '../middleware/auth-rate-limiter';

router.post('/register', registerLimiter, async (req, res, next) => { ... });
router.post('/login', loginLimiter, async (req, res, next) => { ... });
```

### 4c. Constants in shared
Add rate limit values to `packages/shared/src/constants/rate-limits.ts`
(or existing constants file). Don't hardcode magic numbers in middleware.

**Validate:** `npm run typecheck`. Write a basic test that verifies the
middleware exports exist and are functions.

---

## TASK 5: WARNING — Add Cookie `secure` Flag

**Problem:** Auth cookies at `auth.routes.ts` lines 22 and 59 are missing
the `secure` flag. Cookies will transmit over HTTP in non-localhost.

**Files to modify:** `packages/boardroom-ai/server/src/routes/auth.routes.ts`

### Both cookie-setting lines (22 and 59):
```typescript
// CURRENT:
res.cookie('boardroom_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

// FIX:
res.cookie('boardroom_token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

**Validate:** `npm run typecheck`.

---

## TASK 6: WARNING — Implement Missing DELETE Routes

**Problem:** Contracts specify DELETE /decisions/:id and DELETE /commitments/:id
but these routes don't exist.

### 6a. `packages/omnimind-api/src/routes/decisions.routes.ts`
Add soft-delete route (match pattern of other entity routes):
```typescript
// DELETE /decisions/:id — soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const decision = await prisma.decision.findFirst({ where: { id: req.params.id, userId } });
    if (!decision) { res.status(404).json({ error: 'not_found' }); return; }
    await prisma.decision.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.json({ status: 'deleted' });
  } catch (err) { next(err); }
});
```

### 6b. `packages/omnimind-api/src/routes/commitments.routes.ts`
Same pattern — soft delete with userId ownership check.

**Validate:** `npm run typecheck`. Optionally test with curl against running server.

---

## TASK 7: WARNING — Remove Duplicate embedMemory Call

**Problem:** `packages/omnimind-api/src/services/memory.service.ts` lines 53-65
contain two identical `setImmediate(() => embedMemory(...))` blocks in
`createMemory()`. Every memory write triggers 2x embedding API calls,
wasting OpenAI tokens.

**Fix:** Delete the second block (lines 60-65). Keep the first (lines 53-58).

```typescript
// KEEP (lines 53-58):
  // Fire-and-forget embedding generation
  setImmediate(() => {
    embedMemory(memory.id).catch(err =>
      logger.error('Async embedding failed', { memoryId: memory.id, error: (err as Error).message })
    );
  });

// DELETE (lines 60-65):
  // Fire-and-forget embedding generation    ← REMOVE THIS ENTIRE BLOCK
  setImmediate(() => {                       ← REMOVE
    embedMemory(memory.id).catch(err =>      ← REMOVE
      logger.error('Async embedding failed', ← REMOVE
        { memoryId: memory.id, error: (err as Error).message })  ← REMOVE
    );                                       ← REMOVE
  });                                        ← REMOVE
```

**Validate:** `npm run typecheck`. Verify `npx vitest run` passes in omnimind-api.

---

## TASK 8: WARNING — Replace console.log with Structured Logger

**Problem:** 9 instances of console.log/error in production code should use
the structured logger from `packages/omnimind-api/src/lib/logger.ts`.

**Files to modify:**

### 8a. `packages/boardroom-ai/server/src/agents/orchestrator.ts` line 279
Replace `console.log('[Synthesis] Quality score', ...)` with a logger call.
BoardRoom doesn't have a logger yet — create a minimal one at
`packages/boardroom-ai/server/src/lib/logger.ts` matching OmniMind's pattern.

### 8b. `packages/boardroom-ai/server/src/transcription/deepgram-proxy.ts`
Lines 63, 88, 93 — replace console.log/error with logger.

### 8c. `packages/boardroom-ai/server/src/index.ts`
Lines 64, 79, 83 — keep `console.log` for server startup messages (standard
practice). But replace `console.error` on line 64 with logger.error.

**Note:** `packages/omnimind-api/src/lib/logger.ts` lines 17/19 deliberately
use console as the transport. That's fine — it's the logger ITSELF, not
application code bypassing the logger.

**Validate:** `npm run typecheck` in boardroom-ai.

---

## TASK 9: WARNING — Update API Contracts for Phase 3-4 Endpoints

**Problem:** 9+ cortex endpoints, simulation endpoint, and widget/relationship
routes exist in code but are NOT documented in the API contracts.

### 9a. Update `docs/contracts/omnimind-api.contract.md`
Add sections for:
- `GET /cortex/patterns` — list detected thinking patterns
- `POST /cortex/patterns/scan` — trigger pattern detection
- `GET /cortex/memo/latest` — get most recent weekly memo
- `GET /cortex/memo/history` — paginated memo history
- `POST /cortex/memo/generate` — trigger memo generation
- `GET /cortex/contradictions` — list contradiction alerts
- `POST /cortex/contradictions/scan` — trigger contradiction scan
- `PATCH /cortex/contradictions/:id` — update contradiction status
- `POST /cortex/simulate` — run decision simulation

Read the actual route files to get exact request/response shapes. Match
the contract format used by existing endpoints (method, path, auth,
request body schema, response schema, error codes).

### 9b. Update `docs/contracts/boardroom-api.contract.md`
Add proxy routes that BoardRoom exposes for the cortex endpoints above.

**Validate:** Read-only check — verify every route in code has a contract entry.

---

## TASK 10: CLEANUP — Fix `any` Types and Move Shared Types

**Problem:** 15+ interface/type definitions outside shared/, plus `any` usage
in useWidgetLayout and cortex services.

### 10a. `packages/boardroom-ai/client/src/hooks/useWidgetLayout.ts` line 13
Replace `(profile: any)` with proper `UserProfile` type import from
`@boardroom/shared`.

### 10b. Move these interfaces to shared/ (create new files or extend existing):
**High priority (used across service boundary):**
- `ValidationResult` from `omnimind-api/src/memory/validation/schema-validator.ts`
- `PipelineResult` from `omnimind-api/src/memory/validation/pipeline.ts`
- `ScoredResult` from `omnimind-api/src/retrieval/structured-filter.ts`
- `ContextPackage` from `omnimind-api/src/retrieval/context-packager.ts`
- `ExtractionResult` from `boardroom-ai/server/src/agents/memory-extractor.ts`

**Medium priority (internal but should be shared for contract compliance):**
- `AuthPayload` from `boardroom-ai/server/src/middleware/auth.ts`
- `SessionState` from `boardroom-ai/server/src/agents/orchestrator.ts`

**Low priority (can stay local for now):**
- `TranscriptEntry`, `ToolHandler`, `AnthropicToolDef` — internal implementation details

For each move: create the type in shared/, export from index, update imports
in the original file. Don't break anything.

### 10c. Remove `as any` casts in cortex services
- `cortex-contradictions.service.ts` lines 106 and 119 use `as any`
- `cortex-patterns.service.ts` line 68 uses `as any`
- Replace with proper Prisma enum types or Zod-validated types from Task 3

**Validate:** `npm run typecheck` in ALL 3 packages. `npx vitest run` in all 3.

---

## FINAL: REMEDIATION REPORT

After all tasks, create `docs/REMEDIATION-REPORT.md`:

```markdown
# Remediation Report — Post-Audit Fixes
Date: [date]
Agent: Claude Code (Opus) — Remediation Agent
Audit Grade (Before): B+
Tasks Attempted: 10
Tasks Completed: X/10

## Changes by Task
1. [PASS/FAIL] Hardcoded secret fallbacks — [files changed]
2. [PASS/FAIL] OAuth token encryption — [files changed]
3. [PASS/FAIL] Cortex Zod validation — [files changed, tests added]
4. [PASS/FAIL] Auth rate limiting — [files changed]
5. [PASS/FAIL] Cookie secure flag — [files changed]
6. [PASS/FAIL] Missing DELETE routes — [files changed]
7. [PASS/FAIL] Duplicate embedMemory — [files changed]
8. [PASS/FAIL] console.log cleanup — [files changed]
9. [PASS/FAIL] Contract updates — [files changed]
10. [PASS/FAIL] Type cleanup — [files moved, any removed]

## Skipped (if any)
- [task] — [reason]

## Post-Remediation Status
- TypeScript: [COMPILES / ERRORS]
- Tests: [X passed, Y failed, Z skipped]
- Security criticals remaining: [N]
- Estimated new grade: [A/B+/B]
```

Run `npm run typecheck` and `npx vitest run` across all 3 packages as final
verification. Report results in the remediation report.

---

## EXECUTION ORDER

Tasks 1-3 are CRITICAL — do them first, in order.
Tasks 4-7 are WARNING — do after criticals pass.
Tasks 8-10 are CLEANUP — do last, skip if running low on context.

Begin Task 1 now. Commit after each task. Go.
