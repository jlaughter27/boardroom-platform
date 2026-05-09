# PHASE 5 — PRE-LAUNCH HARDENING + RAILWAY DEPLOYMENT

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: E2E tests, deployment hardening, Railway config, env validation, static serving fix.
> **Duration**: ~4-5 hours.
> **Prereqs**: Phases 0-4 complete. Remediation 1+2 complete. A- grade.

---

Read .claude/CLAUDE.md first. You are the PHASE-5 BUILD AGENT.

**Protocol per task:**
1. BRIEF: State what you're building, which files, and the expected outcome.
2. BUILD: Write the code. Follow existing conventions.
3. VALIDATE: `npm run typecheck` in affected packages. Run tests.

**Commit after EACH task.** Message format:
`feat(scope): description — PHASE5-{N}`

**Stop conditions:**
- TypeScript won't compile → revert and move to next task
- 2 failed attempts → skip, document why
- Never delete working code to simplify (CLAUDE.md Rule 1)

---

## CONTEXT: What Exists Already

**Dockerfiles exist** for both services:
- `packages/omnimind-api/Dockerfile` — multi-stage, node:20-alpine, port 3333
- `packages/boardroom-ai/Dockerfile` — multi-stage, node:20-alpine, port 3001

**docker-compose.yml exists** at root:
- postgres (pgvector/pgvector:pg16), omnimind-api, boardroom-ai
- Named volume `pgdata`, health checks on postgres

**Health endpoints exist** on both services (`GET /health`).

**Monorepo**: npm workspaces + Turbo. Packages: shared, omnimind-api, boardroom-ai.

**Background jobs**: node-cron in omnimind-api — weekly memo (Sun 6pm), pattern scan (Mon 3am), contradiction scan (Mon 4am). Started in app.listen callback.

**Critical gap**: BoardRoom server does NOT serve the React client build. In dev, Vite runs on port 5173 separately. In production, `client/dist/` is built but never served. This must be fixed before deployment.

**Ports**: OmniMind 3333, BoardRoom server 3001, Vite dev 5173.

**Environment variables** (from .env.example):
DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY, OMNIMIND_API_URL, OMNIMIND_API_KEY,
JWT_SECRET, OMNIMIND_PORT, BOARDROOM_PORT, CORS_ORIGINS, ENCRYPTION_KEY,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, APP_URL, SERPER_API_KEY

---

## TASK 1: Serve React Client from Express in Production

**Problem:** `packages/boardroom-ai/server/src/index.ts` has no static file serving.
The Dockerfile builds the client to `client/dist/` but the server never serves it.
In production, there's no Vite dev server — the Express server must serve the SPA.

### 1a. Update `packages/boardroom-ai/server/src/index.ts`

After all API routes are registered, add static file serving for production:

```typescript
import path from 'path';
import { fileURLToPath } from 'url';

// ... after all API routes ...

// Serve React client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for any non-API route
  app.get('*', (req, res) => {
    // Don't catch API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}
```

**Important:** The SPA fallback must come AFTER all API routes and AFTER the
static middleware. It catches all non-API GET requests and returns index.html
so React Router handles client-side routing.

### 1b. Verify the Dockerfile copies client/dist correctly

Read `packages/boardroom-ai/Dockerfile`. The build stage should:
1. Build shared package first (`cd packages/shared && npm run build`)
2. Build boardroom-ai (`cd packages/boardroom-ai && npm run build`)
   - This runs both `tsc -p server/tsconfig.json` AND `vite build`
3. Copy `client/dist/` into the runner stage

If the Dockerfile doesn't copy client/dist, fix it. The runner stage needs:
```dockerfile
COPY --from=builder /app/packages/boardroom-ai/client/dist ./client/dist
```

### 1c. Update CORS_ORIGINS default for production

In production on Railway, the client and server are same-origin (both served
from port 3001). CORS is only needed for development. Update the CORS config
to reflect this — when no CORS_ORIGINS env var is set in production, default
to same-origin behavior.

**Validate:** `npm run typecheck`. Build the Docker image locally if Docker is
available: `docker build -t boardroom-test packages/boardroom-ai/`

---

## TASK 2: Environment Variable Validation at Startup

**Problem:** Some env vars throw lazily (JWT_SECRET, OMNIMIND_API_KEY),
others don't throw at all (ANTHROPIC_API_KEY only checked per-call in cortex
services). There's no single startup gate that validates all required vars.

### 2a. Create `packages/shared/src/utils/env-validator.ts`

```typescript
export interface EnvRequirement {
  name: string;
  required: boolean;
  description: string;
}

export function validateEnv(requirements: EnvRequirement[]): void {
  const missing: string[] = [];
  for (const req of requirements) {
    if (req.required && !process.env[req.name]) {
      missing.push(`  ${req.name} — ${req.description}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.join('\n')}\n\nSet these in your .env file or Railway dashboard.`
    );
  }
}
```

### 2b. Create env requirements for each service

**`packages/omnimind-api/src/lib/env.ts`:**
```typescript
import { validateEnv } from '@boardroom/shared';

export function validateOmniMindEnv(): void {
  validateEnv([
    { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for service-to-service auth' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
    { name: 'OPENAI_API_KEY', required: true, description: 'OpenAI API key for embeddings' },
    { name: 'ENCRYPTION_KEY', required: process.env.NODE_ENV === 'production', description: 'AES-256 key for OAuth token encryption' },
  ]);
}
```

**`packages/boardroom-ai/server/src/lib/env.ts`:**
```typescript
import { validateEnv } from '@boardroom/shared';

export function validateBoardRoomEnv(): void {
  validateEnv([
    { name: 'JWT_SECRET', required: true, description: 'Secret for JWT signing' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for OmniMind service' },
    { name: 'OMNIMIND_API_URL', required: true, description: 'URL of OmniMind API service' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
  ]);
}
```

### 2c. Call at startup BEFORE app.listen()

In each service's index.ts, call the validator as the first thing:
```typescript
// packages/omnimind-api/src/index.ts — top of file, after imports
validateOmniMindEnv();

// packages/boardroom-ai/server/src/index.ts — same
validateBoardRoomEnv();
```

**Important:** This runs at startup, NOT at module load time. Tests that don't
call `startServer()` won't trigger it. The lazy getters in auth.ts and
omnimind-client.ts remain as defense-in-depth.

**Validate:** `npm run typecheck` in all 3 packages. `npx vitest run` — no tests should break.

---

## TASK 3: Railway Configuration

**Problem:** Railway needs configuration files to know how to deploy each service.

### 3a. Create `railway.toml` at repo root

```toml
[build]
builder = "DOCKERFILE"

[deploy]
startCommand = ""
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

Note: Railway supports monorepo deployment. Each service is configured as a
separate Railway service pointing to its own Dockerfile via the Railway dashboard.
The toml provides defaults.

### 3b. Create `packages/omnimind-api/railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
numReplicas = 1
```

### 3c. Create `packages/boardroom-ai/railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
numReplicas = 1
```

### 3d. Create `packages/omnimind-api/Procfile` (Railway fallback)
```
web: node dist/index.js
```

### 3e. Create `packages/boardroom-ai/Procfile` (Railway fallback)
```
web: node dist/server/index.js
```

### 3f. Add `.node-version` at repo root
```
20
```

### 3g. Update Dockerfiles if needed

Verify both Dockerfiles:
1. Use `node:20-alpine` (confirmed)
2. Run `prisma generate` in omnimind-api build stage
3. Copy `docs/prompts/` into boardroom-ai container (for loadSystemPrompt)
4. Copy `client/dist/` into boardroom-ai runner stage
5. Set `NODE_ENV=production` in runner stage
6. Expose correct ports (3333 and 3001)

Read both Dockerfiles and fix any issues. Common problems:
- Missing `COPY --from=builder` for client dist
- Missing `NODE_ENV=production`
- Missing `docs/prompts/` copy for runtime prompt loading
- Prisma migration not running (should be in entrypoint or deploy hook, not build)

### 3h. Create `packages/omnimind-api/docker-entrypoint.sh`

```bash
#!/bin/sh
set -e

# Run Prisma migrations
npx prisma migrate deploy

# Enable pgvector extension (idempotent)
npx prisma db execute --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

# Start the server
exec node dist/index.js
```

Update the omnimind-api Dockerfile CMD to use this entrypoint:
```dockerfile
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
```

**Validate:** Docker builds successfully for both services.

---

## TASK 4: Fix docker-compose.yml for Local Development

**Problem:** The existing docker-compose.yml may need updates after remediation
(new env vars, correct port mappings, volume mounts for hot reload).

### 4a. Read and update `docker-compose.yml`

Ensure it has:

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: boardroom_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  omnimind-api:
    build:
      context: .
      dockerfile: packages/omnimind-api/Dockerfile
    ports:
      - "3333:3333"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/boardroom_dev
      OMNIMIND_API_KEY: ${OMNIMIND_API_KEY:-dev-key-local-only}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      OMNIMIND_PORT: 3333
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy

  boardroom-ai:
    build:
      context: .
      dockerfile: packages/boardroom-ai/Dockerfile
    ports:
      - "3001:3001"
    environment:
      JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret-local-only}
      OMNIMIND_API_URL: http://omnimind-api:3333
      OMNIMIND_API_KEY: ${OMNIMIND_API_KEY:-dev-key-local-only}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      BOARDROOM_PORT: 3001
      CORS_ORIGINS: http://localhost:3001,http://localhost:5173
      NODE_ENV: production
    depends_on:
      - omnimind-api

volumes:
  pgdata:
```

**Key points:**
- OmniMind connects to postgres via Docker network hostname `postgres`
- BoardRoom connects to OmniMind via `http://omnimind-api:3333`
- API keys pulled from host .env via `${VAR}` syntax
- Dev fallbacks only for non-secret keys (OMNIMIND_API_KEY between services)
- JWT_SECRET has dev fallback ONLY in docker-compose (not in code)

**Validate:** `docker-compose config` to verify syntax.

---

## TASK 5: E2E Test Suite — Critical User Flows

**Problem:** 110 unit/integration tests exist but zero tests verify the two
services work together end-to-end. We need confidence that the full stack works.

### 5a. Create test infrastructure: `tests/e2e/setup.ts`

```typescript
import { execSync } from 'child_process';

// E2E tests run against built services
// Requires: docker-compose up (postgres + both services)
// OR: both services running locally with test database

export const OMNIMIND_URL = process.env.OMNIMIND_URL || 'http://localhost:3333';
export const BOARDROOM_URL = process.env.BOARDROOM_URL || 'http://localhost:3001';

export async function waitForServices(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const [omni, board] = await Promise.all([
        fetch(`${OMNIMIND_URL}/health`),
        fetch(`${BOARDROOM_URL}/health`),
      ]);
      if (omni.ok && board.ok) return;
    } catch {
      // Services not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Services did not become healthy within timeout');
}

export async function registerTestUser(): Promise<{
  userId: string;
  cookie: string;
}> {
  const email = `test-${Date.now()}@boardroom-e2e.test`;
  const res = await fetch(`${BOARDROOM_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPass123!', name: 'E2E Test User' }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);
  const cookie = res.headers.get('set-cookie') || '';
  const body = await res.json() as { userId: string };
  return { userId: body.userId, cookie };
}

export function authedFetch(url: string, cookie: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...options.headers,
    },
  });
}
```

### 5b. Create `tests/e2e/flows/decision-session.e2e.test.ts`

**Flow 1: Full Decision Session Lifecycle**
1. Register user → get auth cookie
2. POST /sessions — create decision session with a question
3. Verify session created (has ID, question matches)
4. GET /sessions/:id — verify session is retrievable
5. GET /sessions — verify session appears in list
6. POST /sessions/:id/export — verify export works

This flow tests: auth → BoardRoom server → OmniMind data persistence → retrieval.

Note: Full persona dispatch requires ANTHROPIC_API_KEY and costs money.
For CI, test up to session creation. For local E2E, optionally test dispatch.

### 5c. Create `tests/e2e/flows/memory-lifecycle.e2e.test.ts`

**Flow 2: Memory Create → Store → Search → Archive**
1. Register user
2. POST /api/memories (via BoardRoom proxy or direct to OmniMind) — create a memory
3. Verify response has `{ id, status: 'created', validation: { syncPassed: true } }`
4. GET /api/memories — verify memory appears in list
5. GET /api/memories?q=keyword — verify memory is searchable
6. DELETE /api/memories/:id — archive the memory
7. GET /api/memories — verify memory no longer appears (soft deleted)

This flow tests: memory pipeline → validation → storage → search → soft delete.

### 5d. Create `tests/e2e/flows/entity-crud.e2e.test.ts`

**Flow 3: Entity CRUD (Goals, Projects, Tasks, People)**
1. Register user
2. For each entity type (goals, projects, tasks, people):
   - POST — create entity
   - GET — list entities, verify appears
   - PATCH — update entity
   - GET /:id — verify update persisted
   - DELETE — soft delete
   - GET — verify no longer in list

This flow tests: entity proxy routes → OmniMind CRUD → data ownership.

### 5e. Add E2E test scripts to root `package.json`

```json
"test:e2e": "vitest run tests/e2e/ --config vitest.e2e.config.ts"
```

Create `vitest.e2e.config.ts` at root:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'tests/e2e',
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: 'tests/e2e/setup.ts',
  },
});
```

**Validate:** Run E2E tests if services are available. Otherwise verify typecheck passes.

---

## TASK 6: Fix the 8 Skipped Tests

**Problem:** 8 tests in omnimind-api have been skipped since Phase 1.
Before launch, they should either pass or be documented as known limitations.

### 6a. Read each skipped test

Find all `it.skip` or `describe.skip` or `test.skip` in `packages/omnimind-api/tests/`.
For each, determine WHY it was skipped:
- Missing test database? → Add test DB setup
- Requires running service? → Convert to integration test or mock
- Feature not implemented? → Document as known limitation
- Flaky? → Fix the flakiness

### 6b. Fix or document each

For each skipped test:
- If fixable in <15 min: fix it, remove the skip
- If needs significant work: add a comment explaining why, create a TODO in the test
- If the feature is genuinely not implemented: remove the test entirely (don't ship dead tests)

**Validate:** `npx vitest run` in omnimind-api. Report final count: X passed, Y skipped, 0 failed.

---

## TASK 7: Prisma Migration Audit

**Problem:** 22+ models in schema.prisma, but only 1 migration visible.
Need to verify the migration history is clean and deployable.

### 7a. Check migration status

```bash
cd packages/omnimind-api
npx prisma migrate status
```

If there are pending migrations or drift, resolve them.

### 7b. Verify pgvector extension

The schema uses `Unsupported("vector(1536)")` for the embedding column.
The migration must include:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

If these aren't in the migration files, add them to the docker-entrypoint.sh
(already covered in Task 3h).

### 7c. Test migration from scratch

```bash
# Reset and replay all migrations
npx prisma migrate reset --force
npx prisma migrate deploy
```

This proves a fresh Railway Postgres can be initialized from zero.

**Validate:** `npx prisma migrate status` shows no pending migrations.

---

## TASK 8: Production Readiness Checklist Script

**Problem:** No automated way to verify the codebase is deployment-ready.

### 8a. Create `scripts/pre-deploy-check.sh`

```bash
#!/bin/bash
set -e

echo "=== BoardRoom AI Pre-Deploy Check ==="
echo ""

# 1. TypeScript compilation
echo "1/6 TypeScript compilation..."
npm run typecheck
echo "  ✓ TypeScript clean"

# 2. Tests
echo "2/6 Running tests..."
npm run test
echo "  ✓ Tests passed"

# 3. Prisma validation
echo "3/6 Prisma schema validation..."
cd packages/omnimind-api && npx prisma validate && cd ../..
echo "  ✓ Prisma schema valid"

# 4. Build
echo "4/6 Building all packages..."
npm run build
echo "  ✓ Build successful"

# 5. Docker build
echo "5/6 Docker image build..."
docker build -t boardroom-omnimind-check packages/omnimind-api/ -f packages/omnimind-api/Dockerfile .
docker build -t boardroom-ai-check packages/boardroom-ai/ -f packages/boardroom-ai/Dockerfile .
echo "  ✓ Docker images built"

# 6. Required files check
echo "6/6 Required files..."
FILES=(
  "packages/omnimind-api/Dockerfile"
  "packages/boardroom-ai/Dockerfile"
  "docker-compose.yml"
  "packages/omnimind-api/prisma/schema.prisma"
  ".env.example"
)
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  ✗ Missing: $f"
    exit 1
  fi
done
echo "  ✓ All required files present"

echo ""
echo "=== PRE-DEPLOY CHECK PASSED ==="
```

### 8b. Make executable and add to package.json

```bash
chmod +x scripts/pre-deploy-check.sh
```

Root package.json:
```json
"pre-deploy": "bash scripts/pre-deploy-check.sh"
```

**Validate:** Run the script. Fix any failures.

---

## TASK 9: Create Railway Deployment Guide

### 9a. Create `docs/DEPLOY-RAILWAY.md`

Document the step-by-step Railway deployment process:

```markdown
# Deploying BoardRoom AI to Railway

## Prerequisites
- Railway account (https://railway.app)
- GitHub repo connected to Railway
- Anthropic API key
- OpenAI API key (for embeddings)

## Step 1: Create Railway Project
1. New Project → Deploy from GitHub Repo
2. Select the boardroom-platform repository

## Step 2: Add PostgreSQL
1. New Service → Database → PostgreSQL
2. Railway auto-provisions pgvector-compatible Postgres
3. Copy the DATABASE_URL from the service variables

## Step 3: Deploy OmniMind API
1. New Service → GitHub Repo → select boardroom-platform
2. Settings:
   - Root Directory: `packages/omnimind-api`
   - Builder: Dockerfile
3. Variables (add all):
   - DATABASE_URL: (from Step 2, use internal Railway URL)
   - OMNIMIND_API_KEY: (generate: openssl rand -hex 32)
   - ANTHROPIC_API_KEY: sk-ant-...
   - OPENAI_API_KEY: sk-...
   - ENCRYPTION_KEY: (generate: openssl rand -hex 32)
   - OMNIMIND_PORT: 3333
   - NODE_ENV: production
4. Networking: Generate internal domain (e.g., omnimind-api.railway.internal)

## Step 4: Deploy BoardRoom AI
1. New Service → GitHub Repo → select boardroom-platform
2. Settings:
   - Root Directory: `packages/boardroom-ai`
   - Builder: Dockerfile
3. Variables:
   - JWT_SECRET: (generate: openssl rand -hex 32)
   - OMNIMIND_API_URL: http://omnimind-api.railway.internal:3333
   - OMNIMIND_API_KEY: (same as Step 3)
   - ANTHROPIC_API_KEY: sk-ant-...
   - BOARDROOM_PORT: 3001
   - CORS_ORIGINS: https://your-domain.railway.app
   - NODE_ENV: production
   - APP_URL: https://your-domain.railway.app
4. Networking: Generate public domain (this is your app URL)

## Step 5: Verify
1. Visit https://your-domain.railway.app/health — should return { status: "ok" }
2. Visit https://your-domain.railway.app — should load the React app
3. Register an account and run a test decision session

## Environment Variable Generation
# JWT_SECRET
openssl rand -hex 32

# OMNIMIND_API_KEY
openssl rand -hex 32

# ENCRYPTION_KEY (must be exactly 64 hex chars = 32 bytes)
openssl rand -hex 32

## Troubleshooting
- If health check fails: Check Railway logs for env var errors
- If migrations fail: Railway runs the docker-entrypoint.sh which auto-migrates
- If CORS errors: Verify CORS_ORIGINS matches your Railway public domain exactly
```

**Validate:** Read-only — verify all referenced env vars match .env.example.

---

## FINAL: PHASE-5 REPORT

After all tasks, create `docs/PHASE-5-REPORT.md`:

```markdown
# Phase 5 Report — Pre-Launch Hardening
Date: [date]
Agent: Claude Code (Opus) — Phase 5 Build Agent

## Tasks
1. [PASS/FAIL] Static file serving in production
2. [PASS/FAIL] Environment variable validation
3. [PASS/FAIL] Railway configuration files
4. [PASS/FAIL] docker-compose.yml update
5. [PASS/FAIL] E2E test suite (3 critical flows)
6. [PASS/FAIL] Skipped tests resolved
7. [PASS/FAIL] Prisma migration audit
8. [PASS/FAIL] Pre-deploy check script
9. [PASS/FAIL] Railway deployment guide

## Test Results
- Unit/Integration: X passed, Y skipped, 0 failed
- E2E: X flows tested
- Pre-deploy check: PASS/FAIL

## Deployment Readiness
- Docker builds: [PASS/FAIL]
- Prisma migrations: [CLEAN/PENDING]
- Static serving: [VERIFIED/NOT VERIFIED]
- Health checks: [BOTH SERVICES/PARTIAL]

## Remaining for Launch
- [List anything that couldn't be completed]
```

---

## EXECUTION ORDER

1. **Task 1** (static serving) — blocks all deployment testing
2. **Task 2** (env validation) — blocks safe deployment
3. **Task 3** (Railway config) — deployment infrastructure
4. **Task 4** (docker-compose) — local dev verification
5. **Task 5** (E2E tests) — confidence in full stack
6. **Task 6** (skipped tests) — test hygiene
7. **Task 7** (Prisma migration) — database deployability
8. **Task 8** (pre-deploy script) — automated verification
9. **Task 9** (deployment guide) — documentation

Begin Task 1 now. Commit after each task. Go.
