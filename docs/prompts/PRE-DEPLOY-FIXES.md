# PRE-DEPLOY FIXES — Docker + Code Hardening

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Fix 6 confirmed issues from the final audit before Railway deployment.
> **Duration**: ~45 minutes.
> **Scope**: 2 Docker blockers, 4 code fixes.

---

Read .claude/CLAUDE.md first. You are the PRE-DEPLOY FIX AGENT.

These are confirmed audit findings that need to be resolved before deployment.
Fix each one precisely. Do not refactor surrounding code. Surgical fixes only.

**Commit after EACH task.** Message format:
`fix: description — PREDEPLOY-{N}`

---

## TASK 1: Fix Dockerfiles — npm → pnpm (BLOCKER)

Both Dockerfiles use `npm install` but the project uses `pnpm@10.32.1`
(specified in root `package.json` `packageManager` field). The `pnpm-lock.yaml`
exists at the repo root but is not copied into the Docker build context.

### Fix `packages/omnimind-api/Dockerfile`

Replace the current Dockerfile with this corrected version.
Read the existing file FIRST to understand the current structure, then update:

**Changes needed:**
1. In the builder stage, after the base image line, add: `RUN corepack enable && corepack prepare pnpm@10.32.1 --activate`
2. After copying `package.json`, `turbo.json`, `tsconfig.base.json`, ADD: `COPY pnpm-lock.yaml pnpm-workspace.yaml ./`
3. Replace `RUN npm install` with `RUN pnpm install --frozen-lockfile`
4. Replace any `npx turbo` with `pnpm turbo`
5. In the runner stage, also enable corepack: `RUN corepack enable && corepack prepare pnpm@10.32.1 --activate`

**Also check:** Does a `pnpm-workspace.yaml` file exist at the repo root? If not, create one:
```yaml
packages:
  - "packages/*"
```

### Fix `packages/boardroom-ai/Dockerfile`

Same changes as above:
1. Enable corepack + pnpm in builder
2. Copy `pnpm-lock.yaml` and `pnpm-workspace.yaml`
3. Replace `npm install` with `pnpm install --frozen-lockfile`
4. Replace `npx turbo` with `pnpm turbo`
5. Enable corepack in runner stage

### Fix `docker-compose.yml`

Read `docker-compose.yml`. If it references npm anywhere, update to pnpm.
The build context should be `.` (repo root) since lock file is at root.
Verify this is already the case.

**Validate:** Read both Dockerfiles and confirm they reference pnpm throughout.
Run `npm run typecheck` to make sure nothing else broke.

---

## TASK 2: Fix Entity List Type Mismatch (BLOCKER)

**Problem:** The client API functions declare return types as plain arrays
(`Goal[]`, `Project[]`, etc.) but the OmniMind service returns paginated
objects `{ items: T[], total, offset, limit }`.

**File:** `packages/boardroom-ai/client/src/lib/api.ts`

### 2a. Find the entity getter functions

Search for `getGoals`, `getProjects`, `getTasks`, `getPeople`, `getDecisions`,
`getCommitments` in the API client. They will look like:
```typescript
export function getGoals() {
  return request<Goal[]>('/goals');
}
```

### 2b. Check the store consumption

Read `packages/boardroom-ai/client/src/stores/entities.store.ts` to see how
these functions are called. The store likely does:
```typescript
const data = await api.getGoals();
set({ goals: data });
```

### 2c. Determine the correct fix path

**Option A (preferred — minimal change):** If the backend entity routes DON'T
actually paginate (i.e., they return all items without limit/offset params),
then the simplest fix is to have the client extract `.items` from the response:

```typescript
export async function getGoals(): Promise<Goal[]> {
  const res = await request<{ items: Goal[]; total: number; offset: number; limit: number }>('/goals');
  return res.items;
}
```

This preserves the store interface (still receives `Goal[]`) with zero store changes.

**Option B (if pagination is actually used):** Update both the API client AND
the store to handle paginated responses properly. This is more work.

**Check which option is correct** by reading the actual backend route handler
for goals. Look at: does it accept `limit`/`offset` query params? Does the
client pass them?

If the client never passes pagination params → use Option A.

Apply the same fix to ALL entity getters: getGoals, getProjects, getTasks,
getPeople, getDecisions, getCommitments.

**Validate:** `npm run typecheck`. Check that the entities store still works by
reading it and confirming the types align.

---

## TASK 3: Fix Analyze Button Race Condition

**Problem:** The "Analyze" button in the Decision Session page has no disabled
state during the async `createSession()` + `dispatch()` calls. A user can
double-click and create duplicate sessions.

**File:** `packages/boardroom-ai/client/src/pages/DecisionSessionPage.tsx`

### Fix

1. Find the `handleAnalyze` function and the corresponding button in the JSX.

2. Add a local state flag:
```typescript
const [isAnalyzing, setIsAnalyzing] = useState(false);
```

3. Update `handleAnalyze`:
```typescript
async function handleAnalyze() {
  if (!question.trim() || isAnalyzing) return;
  setIsAnalyzing(true);
  try {
    await createSession(question.trim(), mode);
    await dispatch();
  } catch {
    // error handled by store
  } finally {
    setIsAnalyzing(false);
  }
}
```

4. Update the button:
```tsx
<Button
  variant="primary"
  size="lg"
  onClick={handleAnalyze}
  disabled={!question.trim() || isAnalyzing}
>
  {isAnalyzing ? 'Analyzing...' : 'Analyze'}
</Button>
```

Also check: is there a "Check Clarity" button nearby? If so, apply the same
pattern (disable during `checkAmbiguity()` call).

**Validate:** `npm run typecheck`.

---

## TASK 4: Fix API Key Timing Attack

**Problem:** `packages/omnimind-api/src/middleware/auth.ts` uses `!==` for API
key comparison, which is vulnerable to timing attacks.

**File:** `packages/omnimind-api/src/middleware/auth.ts`

### Fix

1. Add import at the top of the file:
```typescript
import { timingSafeEqual } from 'crypto';
```

2. Find the line that compares the API key (looks like `apiKey !== getApiKey()`).

3. Replace the comparison with a timing-safe version:
```typescript
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

4. Update the guard:
```typescript
if (!apiKey || !safeCompare(apiKey, getApiKey())) {
  return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
}
```

**Note:** The `a.length !== b.length` check is intentional — `timingSafeEqual`
throws if buffers are different lengths. The length check itself is not
timing-safe, but it only reveals whether the lengths match (not the content),
which is acceptable since all valid API keys are the same length (64 hex chars).

**Validate:** `npm run typecheck`. `npm run test` (auth tests should still pass).

---

## TASK 5: Fix UserProfile PATCH Validation

**Problem:** `packages/boardroom-ai/server/src/routes/entities.routes.ts` has a
`PATCH /profile` route that accepts unvalidated `req.body`.

**File:** `packages/boardroom-ai/server/src/routes/entities.routes.ts`

### Fix

1. Find the `router.patch('/profile', ...)` handler.

2. Create a Zod schema for the allowed fields. Check the `UserProfile` type in
   `packages/shared/src/types/` to know what fields are valid. The schema
   should allow partial updates (all fields optional):

```typescript
import { z } from 'zod';

const UpdateProfileSchema = z.object({
  role: z.string().optional(),
  industry: z.string().optional(),
  decisionFrequency: z.string().optional(),
  riskProfile: z.object({
    financial: z.number().min(0).max(1).optional(),
    technical: z.number().min(0).max(1).optional(),
    people: z.number().min(0).max(1).optional(),
    strategic: z.number().min(0).max(1).optional(),
  }).optional(),
  valueHierarchy: z.array(z.string()).optional(),
  dashboardLayout: z.any().optional(),
}).strict();
```

**IMPORTANT:** Use `.strict()` so unknown fields are rejected. Check the actual
`UserProfile` type first — if it has additional fields, include them. If it has
fewer, remove extras.

3. Add `validateBody(UpdateProfileSchema)` middleware to the route:
```typescript
router.patch('/profile', validateBody(UpdateProfileSchema), async (req: AuthRequest, res, next) => {
  // ...existing handler...
});
```

4. Make sure `validateBody` is imported from wherever it's defined. Check other
   routes in the same file for the import pattern.

**Validate:** `npm run typecheck`. `npm run test`.

---

## TASK 6: Final Verification

Run the full suite:

```bash
# Typecheck all packages
cd packages/shared && npx tsc --noEmit && cd ../..
cd packages/omnimind-api && npx tsc --noEmit && cd ../..
cd packages/boardroom-ai && npx tsc --noEmit && cd ../..

# Tests
npm run test

# Build
npm run build
```

All three must pass. If any fail, fix the issue and re-run.

Then produce this report:

```markdown
# Pre-Deploy Fixes Report
Date: [date]

## Fixed
1. [PASS/FAIL] Dockerfiles: npm → pnpm with frozen lockfile
2. [PASS/FAIL] Entity list type mismatch: client extracts .items from paginated response
3. [PASS/FAIL] Analyze button: disabled state during async operation
4. [PASS/FAIL] API key: timing-safe comparison with crypto.timingSafeEqual
5. [PASS/FAIL] UserProfile PATCH: Zod schema validation added
6. [PASS/FAIL] Final verification: typecheck + tests + build

## Test Results
- Pass: [N]
- Fail: [N]
- Skip: [N]

## DEPLOYMENT STATUS: [READY / NOT READY]
```

---

## EXECUTION ORDER

1. Task 1 — Dockerfiles (15 min) ← BLOCKER
2. Task 2 — Entity list types (10 min) ← BLOCKER
3. Task 3 — Analyze button (5 min)
4. Task 4 — Timing-safe comparison (5 min)
5. Task 5 — Profile validation (10 min)
6. Task 6 — Final verification (5 min)

Begin Task 1 now. Commit after each task. Go.
