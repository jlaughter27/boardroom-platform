# FINAL END-TO-END AUDIT

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Comprehensive pre-deployment validation across 6 domains.
>   Real checks, not file-reading. Every task runs actual commands.
> **Duration**: ~2-3 hours.
> **Scope**: Read-only audit. Fix ONLY critical blockers. Log everything else.

---

Read .claude/CLAUDE.md first. You are the FINAL AUDIT AGENT.

This is the last gate before deployment. Your job is to validate the entire
platform across 6 domains, run real checks, and produce a scored report.

**Rules:**
- Run ACTUAL commands (`npm run typecheck`, `npm run test`, `npm run build`).
- Do NOT fix issues silently. LOG every finding.
- Only fix issues that would BLOCK deployment (crash at startup, build failure, type error).
- For non-blocking issues, log them with severity and move on.
- Be adversarial. Look for what's broken, not what's working.

**Commit format:** `audit: description — AUDIT-{N}`

---

## TASK 1: Type Safety Audit

### 1a. Full typecheck

```bash
cd packages/shared && npx tsc --noEmit
cd packages/omnimind-api && npx tsc --noEmit
cd packages/boardroom-ai && npx tsc --noEmit
```

Report:
- Total errors per package
- Categorize: missing imports, type mismatches, unused vars, any-casts

### 1b. Shared type coverage

Check that `packages/shared/src/types/` exports are used correctly:
```bash
grep -rn "from '@boardroom/shared'" packages/boardroom-ai/server/src/ | wc -l
grep -rn "from '@boardroom/shared'" packages/omnimind-api/src/ | wc -l
```

Check for type imports that bypass shared:
```bash
grep -rn "from '\.\./.*types" packages/boardroom-ai/server/src/ --include='*.ts'
grep -rn "from '\.\./.*types" packages/omnimind-api/src/ --include='*.ts'
```

Any non-shared type import in server code is a violation of CLAUDE.md Rule 4.
Log them. Fix only if they cause type errors.

### 1c. Zod schema parity

For every Zod schema in `packages/shared/src/schemas/`, verify it structurally
matches its companion TypeScript type. Check:
- All required fields present in both
- Field types match (string vs number vs enum)
- Optional fields marked correctly in both

### 1d. `any` audit

```bash
grep -rn ': any' packages/boardroom-ai/server/src/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'
grep -rn ': any' packages/omnimind-api/src/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'
grep -rn 'as any' packages/boardroom-ai/server/src/ --include='*.ts' | grep -v node_modules
grep -rn 'as any' packages/omnimind-api/src/ --include='*.ts' | grep -v node_modules
```

Count and categorize. >10 `any` casts = warning. >25 = critical.

**BLOCKING if:** typecheck fails with errors. Fix type errors that prevent compilation.

---

## TASK 2: Test Suite Audit

### 2a. Run full test suite

```bash
npm run test 2>&1
```

Report:
- Total tests: pass / fail / skip
- Any test file that fails
- Any test file that was skipped with `.skip` or `.todo`

### 2b. Test coverage gaps

List all source files in `packages/omnimind-api/src/` and `packages/boardroom-ai/server/src/`
that have NO corresponding test file. Compare against:
```bash
find packages/omnimind-api/src -name '*.ts' -not -name '*.test.ts' -not -name '*.d.ts' | sort
find packages/omnimind-api/src -name '*.test.ts' | sort
```

Same for boardroom-ai server.

Identify the 5 highest-risk untested files (routes, services, middleware).

### 2c. Test isolation check

Ensure no test depends on external services:
```bash
grep -rn 'process.env' packages/*/src/**/*.test.ts --include='*.test.ts'
```

Tests should mock environment variables. Any test that reads real env vars
without mocking is fragile.

**BLOCKING if:** Any test fails. Fix failing tests.

---

## TASK 3: API Contract Audit

### 3a. Route inventory

Map every Express route in both services:
```bash
grep -rn "router\.\(get\|post\|put\|patch\|delete\)" packages/omnimind-api/src/routes/ --include='*.ts'
grep -rn "router\.\(get\|post\|put\|patch\|delete\)" packages/boardroom-ai/server/src/routes/ --include='*.ts'
```

### 3b. Contract compliance

Read `docs/contracts/` and verify each documented endpoint:
- Exists in the actual route file
- HTTP method matches
- Request body shape matches (if Zod validated)
- Response shape is documented

### 3c. Client-server alignment

Read `packages/boardroom-ai/client/src/lib/api.ts` and verify every API call
matches an actual route:
- URL path matches
- HTTP method matches
- Request body shape matches
- No client calls to non-existent endpoints

Specifically check these known risk areas:
- `archiveMemory` — should be `PATCH` not `DELETE`
- `searchMemories` vs `listMemories` — different endpoints
- SSE streaming endpoints — `/api/sessions/:id/dispatch` and `/api/sessions/:id/synthesize`

### 3d. Middleware chain

For each route, verify the middleware chain:
- Auth routes: NO auth middleware (login, register, health, webhooks, OAuth callbacks)
- Protected routes: auth middleware present
- Body validation: `validateBody()` middleware on all POST/PUT/PATCH routes
- Rate limiting: on auth routes (login, register)

**BLOCKING if:** Client calls non-existent endpoint. Fix routing mismatches.

---

## TASK 4: Security Audit

### 4a. Secret exposure

```bash
# Check for hardcoded secrets in source code
grep -rn "sk-" packages/ --include='*.ts' | grep -v node_modules | grep -v '.env' | grep -v 'test'
grep -rn "password.*=" packages/ --include='*.ts' | grep -v node_modules | grep -v '.test.' | grep -v '.d.ts'
grep -rn "secret.*=" packages/ --include='*.ts' | grep -v node_modules | grep -v '.test.' | grep -v '.d.ts' | grep -v 'process.env'
```

### 4b. Auth bypass check

Verify these routes REQUIRE authentication:
- All `/api/sessions/*` routes
- All `/api/memories/*` routes
- All `/api/cortex/*` routes
- All `/api/entities/*` routes (goals, projects, tasks, people)
- All `/api/personas/*` routes

Verify these routes are EXEMPT from auth:
- `POST /auth/login`
- `POST /auth/register`
- `GET /health`
- `GET /calendar/callback`
- `GET /integrations/gmail/callback`
- `POST /subscription/webhook`

### 4c. Environment validation

Read both env validation files:
- `packages/omnimind-api/src/lib/env.ts`
- `packages/boardroom-ai/server/src/lib/env.ts`

Verify they check ALL critical variables and throw on missing.
Required for OmniMind: DATABASE_URL, OMNIMIND_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
Required for BoardRoom: JWT_SECRET, OMNIMIND_API_KEY, OMNIMIND_API_URL, ANTHROPIC_API_KEY

### 4d. Cookie security

Find all `res.cookie` calls:
```bash
grep -rn 'res\.cookie' packages/ --include='*.ts' | grep -v node_modules
```

Verify each sets: `httpOnly: true`, `secure: true` (in production), `sameSite: 'strict'` or `'lax'`.

### 4e. CORS configuration

Read the CORS setup in `packages/boardroom-ai/server/src/index.ts`.
Verify:
- Production: no wildcard `*` origins
- Credentials: `true`
- Methods restricted to what's actually used

### 4f. LLM output validation

Every Anthropic API call must parse its response through a Zod schema.
Search for all `anthropic.messages.create` or `client.messages.create` calls:
```bash
grep -rn 'messages.create' packages/ --include='*.ts' | grep -v node_modules | grep -v test
```

For each call found, verify a `.parse()` or `.safeParse()` happens on the response
before it reaches the user. Log any unvalidated LLM outputs.

**BLOCKING if:** Hardcoded secrets found. Auth bypass on protected routes.

---

## TASK 5: Build & Deploy Audit

### 5a. Production build

```bash
npm run build 2>&1
```

Report: success or failure. If failure, log the exact error.

### 5b. Docker build test

```bash
# Test if Dockerfiles parse correctly (without building — no Docker daemon needed)
cat packages/omnimind-api/Dockerfile | head -5
cat packages/boardroom-ai/Dockerfile | head -5
```

Verify:
- Base image: `node:20-alpine` (matches .node-version)
- Multi-stage build (builder → runner)
- omnimind-api: copies prisma directory, runs `prisma generate`
- boardroom-ai: copies `client/dist/`, copies `docs/prompts/`

### 5c. Static file serving

Verify `packages/boardroom-ai/server/src/index.ts` has:
- `express.static(clientDist)` for production
- SPA fallback route (serves index.html for non-API paths)
- API routes registered BEFORE the SPA fallback

### 5d. Health endpoints

Verify both services have `/health`:
```bash
grep -rn "'/health'" packages/omnimind-api/src/ --include='*.ts'
grep -rn "'/health'" packages/boardroom-ai/server/src/ --include='*.ts'
```

Verify they:
- Return JSON with `status` field
- Check downstream dependencies (OmniMind checks DB, BoardRoom checks OmniMind)
- Don't require authentication

### 5e. Prisma validation

```bash
cd packages/omnimind-api && npx prisma validate 2>&1
```

Check that migrations directory has at least 1 migration and `migration_lock.toml` exists.

### 5f. Pre-deploy script

```bash
npm run pre-deploy 2>&1
```

This should run the full 6-check validation. Report results.

**BLOCKING if:** Build fails. Prisma validation fails. Health endpoints missing.

---

## TASK 6: Frontend Integrity Audit

### 6a. Client build

```bash
cd packages/boardroom-ai && npx vite build 2>&1
```

Report: success, bundle size, any warnings.

### 6b. Route coverage

Read `App.tsx` and verify every route has:
- A lazy-loaded page component
- `ProtectedRoute` wrapper (except login)
- `OnboardingGate` wrapper (except login, onboarding)

### 6c. Store completeness

For each Zustand store, verify:
- Has `error: string | null` field
- Has `clearError()` method
- Has `isLoading` field
- Error is SET in catch blocks of async methods
- Error is CLEARED before new async operations

Check stores: auth, session, entities, memory, cortex.
Exception: ui.store (no API calls, no error state needed).

### 6d. Design token compliance (if Phase A executed)

If `packages/boardroom-ai/client/src/styles/tokens.css` exists:
```bash
grep -rn 'bg-gray-' packages/boardroom-ai/client/src/ --include='*.tsx' | grep -v tokens.css | grep -v tailwind.config | wc -l
grep -rn 'text-gray-' packages/boardroom-ai/client/src/ --include='*.tsx' | grep -v tokens.css | grep -v tailwind.config | wc -l
grep -rn 'border-gray-' packages/boardroom-ai/client/src/ --include='*.tsx' | grep -v tokens.css | grep -v tailwind.config | wc -l
```

If tokens.css doesn't exist yet (UI phases not run), skip this check.

### 6e. Import integrity

```bash
# Check for broken imports (files that import from non-existent paths)
cd packages/boardroom-ai && npx tsc --noEmit 2>&1 | grep "Cannot find module" | head -20
```

**BLOCKING if:** Client build fails.

---

## FINAL REPORT

After all 6 tasks, produce this report:

```markdown
# FINAL AUDIT REPORT
Date: [date]
Auditor: Claude Code (Opus)

## SCORECARD

| Domain | Score | Blockers | Warnings | Notes |
|--------|-------|----------|----------|-------|
| Type Safety | [A-F] | [count] | [count] | |
| Test Suite | [A-F] | [count] | [count] | |
| API Contracts | [A-F] | [count] | [count] | |
| Security | [A-F] | [count] | [count] | |
| Build & Deploy | [A-F] | [count] | [count] | |
| Frontend | [A-F] | [count] | [count] | |

## OVERALL GRADE: [A-F]

## DEPLOYMENT VERDICT: [GO / NO-GO / CONDITIONAL GO]

### Blockers Fixed During Audit
1. [list any blockers that were fixed]

### Remaining Blockers (if NO-GO)
1. [list any unfixed blockers]

### Warnings (Non-blocking, Fix Post-Launch)
1. [list all warnings by severity]

### Test Results
- Total: [N] pass, [N] fail, [N] skip
- Build: [PASS/FAIL]
- Typecheck: [PASS/FAIL]
- Prisma: [PASS/FAIL]

### Metrics
- `any` casts: [count]
- Unvalidated LLM outputs: [count]
- Untested critical files: [count]
- Design token violations: [count]
- Type bypass imports: [count]

### API Key Requirements for Deployment
CRITICAL (must have):
- ANTHROPIC_API_KEY
- OPENAI_API_KEY
- DATABASE_URL (Railway Postgres)
- JWT_SECRET (generate: openssl rand -hex 32)
- ENCRYPTION_KEY (generate: openssl rand -hex 32)
- OMNIMIND_API_KEY (generate: openssl rand -hex 32)
- OMNIMIND_API_URL (Railway internal: http://omnimind-api.railway.internal:3333)

OPTIONAL (Phase 3):
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
- STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID
- SERPER_API_KEY
```

---

## EXECUTION ORDER

1. Task 1 — Type Safety (20 min)
2. Task 2 — Test Suite (15 min)
3. Task 3 — API Contracts (25 min)
4. Task 4 — Security (20 min)
5. Task 5 — Build & Deploy (15 min)
6. Task 6 — Frontend (15 min)
7. Final Report (10 min)

Begin Task 1 now. Go.
