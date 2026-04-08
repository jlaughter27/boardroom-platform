# DEPLOYMENT ORCHESTRATOR — Railway Launch

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Execute pre-deploy validation, fix any remaining blockers,
>   and prepare the repo for Railway deployment.
> **Duration**: ~1-2 hours.
> **Prereqs**: Final audit complete. All blockers resolved.

---

Read .claude/CLAUDE.md first. You are the DEPLOYMENT AGENT.

The final audit has been run. Your job is to:
1. Run the pre-deploy script and fix any failures
2. Verify Docker builds parse correctly
3. Ensure all deployment artifacts are complete
4. Run one final build + typecheck + test cycle
5. Produce the deployment checklist with exact Railway commands

**Commit format:** `deploy: description — DEPLOY-{N}`

---

## TASK 1: Pre-Deploy Validation

```bash
npm run pre-deploy
```

If ANY check fails:
- Fix the issue
- Re-run the failing check
- Commit the fix
- Continue

Expected checks (from `scripts/pre-deploy-check.sh`):
1. TypeScript compilation (shared, omnimind-api, boardroom-ai)
2. Unit tests (vitest)
3. Prisma schema validation
4. Build verification
5. Docker image builds (skip if no Docker daemon)
6. Required files presence

**All 6 must pass (or skip gracefully) before proceeding.**

---

## TASK 2: Final Build Cycle

Run all three in sequence — each must succeed:

```bash
# 1. Clean build
npm run build

# 2. Type safety
cd packages/shared && npx tsc --noEmit && cd ../..
cd packages/omnimind-api && npx tsc --noEmit && cd ../..
cd packages/boardroom-ai && npx tsc --noEmit && cd ../..

# 3. Tests
npm run test

# 4. Client build (verify output exists)
cd packages/boardroom-ai && npx vite build && cd ../..
ls -la packages/boardroom-ai/client/dist/index.html
```

Report: pass/fail for each. Fix any failures.

---

## TASK 3: Deployment Artifact Verification

Verify all deployment files exist and are correctly configured:

### 3a. Dockerfiles

Read and verify:
- `packages/omnimind-api/Dockerfile`:
  - Base: `node:20-alpine`
  - Copies prisma directory
  - Runs `prisma generate`
  - Uses `docker-entrypoint.sh`
  - Exposes 3333
- `packages/boardroom-ai/Dockerfile`:
  - Base: `node:20-alpine`
  - Builds client (Vite)
  - Copies `client/dist/` to runner
  - Copies `docs/prompts/` for runtime prompt loading
  - Exposes 3001

### 3b. Railway configs

Read and verify:
- `railway.toml` (root)
- `packages/omnimind-api/railway.toml`
- `packages/boardroom-ai/railway.toml`

Each must have:
- `[build]` section with `builder = "DOCKERFILE"`
- `[deploy]` section with `healthcheckPath = "/health"`

### 3c. Docker entrypoint

Read `packages/omnimind-api/docker-entrypoint.sh`:
- Must run `npx prisma migrate deploy`
- Must create pgvector + pg_trgm extensions
- Must exec the node process (not fork)

### 3d. Environment example

Read `.env.example` at repo root.
Verify it documents ALL required variables:
- DATABASE_URL
- ANTHROPIC_API_KEY
- OPENAI_API_KEY
- OMNIMIND_API_KEY
- OMNIMIND_API_URL
- JWT_SECRET
- ENCRYPTION_KEY
- NODE_ENV
- OMNIMIND_PORT
- BOARDROOM_PORT
- CORS_ORIGINS

### 3e. Procfiles (Railway fallback)

Verify:
- `packages/omnimind-api/Procfile`: `web: node dist/index.js`
- `packages/boardroom-ai/Procfile`: `web: node dist/server/index.js`

---

## TASK 4: Health Endpoint Verification

### 4a. OmniMind health

Read the health route in `packages/omnimind-api/src/routes/` or `src/index.ts`.
Verify:
- Endpoint: `GET /health`
- Checks database connectivity (`SELECT 1`)
- Returns `{ status: "ok" | "degraded", service: "omnimind-api" }`
- No auth required

### 4b. BoardRoom health

Read the health route in `packages/boardroom-ai/server/src/`.
Verify:
- Endpoint: `GET /health`
- Checks OmniMind connectivity
- Returns `{ status: "ok" | "degraded", service: "boardroom-ai" }`
- No auth required

### 4c. Static file serving

Read `packages/boardroom-ai/server/src/index.ts`.
Verify production static serving:
- `express.static()` for `client/dist/`
- SPA fallback: non-API routes serve `index.html`
- API routes registered BEFORE static fallback

---

## TASK 5: Environment Variable Safety

### 5a. No hardcoded secrets

```bash
grep -rn "sk-ant-" packages/ --include='*.ts' | grep -v node_modules | grep -v '.env'
grep -rn "sk-proj-" packages/ --include='*.ts' | grep -v node_modules | grep -v '.env'
```

Must return 0 results.

### 5b. Env validation at startup

Verify both services validate env vars before starting:
- `packages/omnimind-api/src/lib/env.ts` — calls `validateOmniMindEnv()`
- `packages/boardroom-ai/server/src/lib/env.ts` — calls `validateBoardRoomEnv()`

Both should:
- Check required vars exist
- Throw descriptive error if missing
- Skip validation in test mode

### 5c. .gitignore

Verify `.env` is in `.gitignore`:
```bash
grep '\.env' .gitignore
```

Must NOT commit `.env` files with real secrets.

---

## TASK 6: Deployment Guide Update

Read `docs/DEPLOY-RAILWAY.md`. Verify it's accurate and complete.

If it's missing or outdated, update it with this structure:

```markdown
# Deploying BoardRoom AI to Railway

## Architecture
- BoardRoom AI (public) → OmniMind API (internal) → PostgreSQL

## Prerequisites
- Railway account
- Anthropic API key
- OpenAI API key
- GitHub repo connected to Railway

## Step 1: Create Railway Project
- New Project → "BoardRoom AI"

## Step 2: Add PostgreSQL
- New Service → Database → PostgreSQL
- Railway auto-provisions with pgvector support
- Copy DATABASE_URL from the service variables

## Step 3: Deploy OmniMind API
- New Service → GitHub Repo → boardroom-platform
- Root Directory: packages/omnimind-api
- Builder: Dockerfile

Environment Variables:
  DATABASE_URL = ${{Postgres.DATABASE_URL}}
  OMNIMIND_API_KEY = [generate: openssl rand -hex 32]
  ANTHROPIC_API_KEY = [your Anthropic key]
  OPENAI_API_KEY = [your OpenAI key]
  ENCRYPTION_KEY = [generate: openssl rand -hex 32]
  OMNIMIND_PORT = 3333
  NODE_ENV = production

Networking:
  - Generate INTERNAL domain (e.g., omnimind-api.railway.internal)
  - Do NOT generate public domain

## Step 4: Deploy BoardRoom AI
- New Service → GitHub Repo → boardroom-platform
- Root Directory: packages/boardroom-ai
- Builder: Dockerfile

Environment Variables:
  JWT_SECRET = [generate: openssl rand -hex 32]
  OMNIMIND_API_URL = http://[omnimind-internal-domain]:3333
  OMNIMIND_API_KEY = [same as OmniMind service above]
  ANTHROPIC_API_KEY = [your Anthropic key]
  BOARDROOM_PORT = 3001
  CORS_ORIGINS = https://[your-boardroom-domain].railway.app
  NODE_ENV = production
  APP_URL = https://[your-boardroom-domain].railway.app

Networking:
  - Generate PUBLIC domain (this is the user-facing URL)

## Step 5: Verify
1. curl https://[your-domain].railway.app/health
   → { "status": "ok", "service": "boardroom-ai" }
2. Open https://[your-domain].railway.app
   → React app loads, login page visible
3. Register a test account
4. Complete onboarding
5. Create a decision session → personas stream → synthesis works

## Troubleshooting
- OmniMind health degraded → check DATABASE_URL, run prisma migrate deploy
- BoardRoom can't reach OmniMind → check OMNIMIND_API_URL uses internal domain
- CORS errors → check CORS_ORIGINS matches your public domain exactly
- 500 on persona dispatch → check ANTHROPIC_API_KEY is valid
- Embeddings fail → check OPENAI_API_KEY is valid
```

---

## TASK 7: Final Verification

### 7a. One more build

```bash
npm run build && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test && echo "TESTS: PASS" || echo "TESTS: FAIL"
```

### 7b. Deployment readiness report

```markdown
# DEPLOYMENT READINESS REPORT
Date: [date]

## Build Status
- Shared types: [PASS/FAIL]
- OmniMind API: [PASS/FAIL]
- BoardRoom server: [PASS/FAIL]
- BoardRoom client: [PASS/FAIL]

## Test Status
- Total: [N] pass / [N] fail / [N] skip
- Critical failures: [none / list]

## Deployment Artifacts
- [ ] Dockerfiles valid (both services)
- [ ] railway.toml files present (root + both services)
- [ ] docker-entrypoint.sh executable
- [ ] Prisma migrations present
- [ ] .env.example complete
- [ ] DEPLOY-RAILWAY.md up to date
- [ ] Health endpoints verified
- [ ] Static file serving configured
- [ ] SPA fallback route in place
- [ ] Procfiles present

## Required API Keys
CRITICAL (get these before deploying):
1. ANTHROPIC_API_KEY — https://console.anthropic.com
2. OPENAI_API_KEY — https://platform.openai.com
3. DATABASE_URL — Railway auto-generates

GENERATE (run these commands):
4. JWT_SECRET: openssl rand -hex 32
5. ENCRYPTION_KEY: openssl rand -hex 32
6. OMNIMIND_API_KEY: openssl rand -hex 32

OPTIONAL (skip for MVP):
7. GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET — Google Cloud Console
8. STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET — Stripe Dashboard
9. SERPER_API_KEY — serper.dev

## VERDICT: [READY TO DEPLOY / NOT READY]
```

---

## EXECUTION ORDER

1. Task 1 — Pre-deploy validation (15 min)
2. Task 2 — Final build cycle (10 min)
3. Task 3 — Artifact verification (10 min)
4. Task 4 — Health endpoints (5 min)
5. Task 5 — Env variable safety (5 min)
6. Task 6 — Deploy guide update (15 min)
7. Task 7 — Final verification + report (10 min)

Begin Task 1 now. Go.
