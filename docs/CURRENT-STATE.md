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

## Current Phase: SPRINT 6 (Phase 6) - Scale & Growth Features

The project has moved to **Sprint 6 (Phase 6)** focusing on scale features for growth from 100→2000+ users, including team boards, enterprise features, mobile app, and multi-model evaluation.

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

**Deferred to After Phase 6:**
- Phase 1 (Multi-Persona Intelligence): Persona prompts, parallel dispatch, CEO synthesis
- Phase 2 (Dashboard & Intelligence): Thinking pattern detection, weekly briefing, cross-project scan
- Phase 3 (Agentic Upgrades + External Cortex): Tool-enabled agent runtime, Google Calendar integration, Stripe subscriptions, cortex intelligence layer
- Phase 4 (Intelligence Layer + Scale Features): Semantic search, custom personas, decision simulations, dynamic widgets, relationship visualization, email integration
- Phase 5 (Pre-Launch Hardening + Railway Deployment): Static file serving, env validation, Railway config, E2E tests, production readiness

### Phase 6 Focus: Scale & Growth Features

**Sprint 6 Tasks (600-607):**
1. **Team Boards (Shared Decisions)** — Collaborative decision-making with shared access
2. **Role-Based Access Control** — Granular permissions for team members
3. **Mobile App (React Native)** — Native mobile experience for iOS and Android
4. **Multi-Model Evaluation (Gemini Flash, DeepSeek)** — Fallback providers for cost optimization
5. **Enterprise Features: SSO, Audit Trails** — Single sign-on and comprehensive audit logging
6. **SOC2 Compliance Preparation** — Security and compliance framework implementation
7. **Knowledge Graph Implementation** — Advanced relationship mapping beyond tags
8. **Novelty Personas (Celebrity/Historical)** — Custom persona templates based on famous thinkers

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
| Sprint 6 Plan | `docs/prompts/PHASE-6-ORCHESTRATOR.md` |
| Task Tracking | `docs/tasks/_TASK-INDEX.md` |
