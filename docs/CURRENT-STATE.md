# Current State — What's Live, What's Next

> Living document. Update after each deploy or phase completion.
>
> **Last updated:** 2026-04-11

## Deployment Status

| Service | Status | URL | Health |
|---------|--------|-----|--------|
| BoardRoom AI | **Live** | `https://boardroom-ai-production-1092.up.railway.app` | `/health` → `{"status":"ok","omnimindConnected":true}` |
| OmniMind API | **Live** | `https://omnimind-api-production.up.railway.app` | `/health` → `{"status":"ok","dbConnected":true}` |
| PostgreSQL | **Live** | `postgres.railway.internal:5432` | Connected (pgvector + pg_trgm enabled) |

**Platform:** Railway (auto-deploy on push to `main`)
**Build time:** ~60 seconds per service
**Private networking:** Not yet enabled. BoardRoom → OmniMind uses public domain.

## Current Phase: SPRINT 5 (Phase 5) - Pre-Launch Hardening + Railway Deployment

The project has moved to **Sprint 5 (Phase 5)** focusing on production readiness, deployment infrastructure, and end-to-end testing to prepare for v1.0 launch.

### What's Built (Phase 0 — In Progress)

**Core Infrastructure Complete:**
- Prisma schema with all entities (12+ models)
- Shared TypeScript types and Zod validation schemas
- Docker Compose dev setup
- Golden test scenarios (50+)
- Utility functions (cryptography, dates, tokens)

**Active Development (Phase 0 tasks):**
- Memory CRUD endpoints (in progress)
- Sync validation pipeline (in progress) 
- Custom agent runtime (in progress)
- Entity CRUD routes (people, goals, projects, tasks, decisions, commitments)
- Context assembler + cross-entity search

**Deferred to After Phase 5:**
- Phase 1 (Multi-Persona Intelligence): Persona prompts, parallel dispatch, CEO synthesis
- Phase 2 (Dashboard & Intelligence): Thinking pattern detection, weekly briefing, cross-project scan
- Phase 3 (Agentic Upgrades + External Cortex): Tool-enabled agent runtime, Google Calendar integration, Stripe subscriptions, cortex intelligence layer
- Phase 4 (Intelligence Layer + Scale Features): Semantic search, custom personas, decision simulations, dynamic widgets, relationship visualization, email integration

### Phase 5 Focus: Pre-Launch Hardening + Railway Deployment

**Sprint 5 Tasks (500-508):**
1. **Static File Serving in Production** — Serve React client from Express in production with SPA fallback
2. **Environment Variable Validation at Startup** — Early validation of required env vars with descriptive errors
3. **Railway Configuration Files** — Railway.toml, Procfiles, .node-version, Docker entrypoint scripts
4. **Docker Compose Updates for Local Development** — Fix env vars, port mappings, and service dependencies
5. **E2E Test Suite (3 Critical Flows)** — Decision session, memory lifecycle, entity CRUD end-to-end tests
6. **Fix Skipped Tests** — Resolve or document the 8 skipped tests in OmniMind API
7. **Prisma Migration Audit** — Verify migration history, pgvector extensions, and clean deployability
8. **Production Readiness Checklist Script** — Automated verification of deployment readiness
9. **Railway Deployment Guide** — Step-by-step documentation for deploying to Railway

### Infrastructure Status

**Live Services:** Both BoardRoom AI and OmniMind API are deployed and healthy on Railway
**Database:** PostgreSQL with pgvector + pg_trgm enabled
**Authentication:** JWT auth with httpOnly cookies
**Rate Limiting:** In-memory (needs Redis for production scaling)

## Environment Configuration

### Railway Variables (both services configured)

| Variable | boardroom-ai | omnimind-api |
|----------|:---:|:---:|
| `PORT` | auto | auto |
| `JWT_SECRET` | ✅ | — |
| `OMNIMIND_API_KEY` | ✅ | ✅ |
| `OMNIMIND_API_URL` | ✅ | — |
| `ANTHROPIC_API_KEY` | ✅ | ✅ |
| `OPENAI_API_KEY` | — | ✅ |
| `ENCRYPTION_KEY` | — | ✅ |
| `DATABASE_URL` | — | auto (Railway Postgres plugin) |

## Test Suite

- **110+ tests** across both services
- Run: `npm run test` from monorepo root
- Typecheck: `npm run typecheck`
- No CI gate yet — tests are manual pre-push

## Known Limitations

1. **No CI/CD gate** — Tests and typecheck must be run manually before pushing. Railway auto-deploys on push regardless of test status.
2. **In-memory rate limiting** — Resets on restart, no cross-instance coordination.
3. **Public domain for service-to-service** — Higher latency than private networking. Switch when both services confirmed on same Railway private network.
4. **db push instead of migrations** — No rollback history. Safe for v1 with no user data; must migrate to proper migration workflow before production users exist.
5. **Subscription middleware fails open** — If OmniMind is unreachable, billing checks are skipped and all features are unlocked.
6. **No monitoring** — Only health check endpoints. No error tracking (Sentry), no metrics (Datadog/Grafana), no alerting.
7. **Single Railway instance per service** — No horizontal scaling configured.

## Git Branching

- **`main`** — Production branch. Railway auto-deploys on push.
- Development happens directly on `main`. Feature branches recommended for complex changes.

## Key Files to Start Any Session

| Need | Read |
|------|------|
| Quick context | `docs/PROJECT-BRIEF.md` |
| Architecture map | `docs/ARCHITECTURE-QUICK-REF.md` |
| Deployment & Railway | `docs/DEPLOYMENT-RUNBOOK.md` |
| What breaks easily | `docs/FRAGILE-ZONES.md` |
| This file | `docs/CURRENT-STATE.md` |
| Full product spec | `docs/MASTER-FRAMEWORK.md` |
| Architectural decisions | `docs/DECISIONS.md` |
| Dev rules & conventions | `.claude/CLAUDE.md` |
| API contracts | `docs/contracts/*.contract.md` |
| Sprint 5 Plan | `docs/prompts/PHASE-5-ORCHESTRATOR.md` |
| Task Tracking | `docs/tasks/_TASK-INDEX.md` |
