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

## Current Phase: SPRINT 8 (Phase 8) - Visionary Platform & Ecosystem

The project has moved to **Sprint 8 (Phase 8)** focusing on creating a complete decision intelligence ecosystem, including marketplace features, advanced integrations, and platform capabilities.

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

**Deferred to After Phase 8:**
- Phase 1 (Multi-Persona Intelligence): Persona prompts, parallel dispatch, CEO synthesis
- Phase 2 (Dashboard & Intelligence): Thinking pattern detection, weekly briefing, cross-project scan
- Phase 3 (Agentic Upgrades + External Cortex): Tool-enabled agent runtime, Google Calendar integration, Stripe subscriptions, cortex intelligence layer
- Phase 4 (Intelligence Layer + Scale Features): Semantic search, custom personas, decision simulations, dynamic widgets, relationship visualization, email integration
- Phase 5 (Pre-Launch Hardening + Railway Deployment): Static file serving, env validation, Railway config, E2E tests, production readiness
- Phase 6 (Scale & Growth Features): Team boards, mobile app, enterprise features, multi-model evaluation
- Phase 7 (Future Vision & Advanced AI): Predictive analytics, advanced decision simulations, AI-powered research assistant

### Phase 8 Focus: Visionary Platform & Ecosystem

**Sprint 8 Tasks (800-807):**
1. **Persona Marketplace** — Community-driven persona sharing and discovery
2. **Advanced Integration Framework** — Unified platform for third-party tool integration
3. **Automated Research Synthesis Engine** — AI-powered analysis of external research
4. **Cross-User Pattern Analysis** — Anonymous insights from aggregated decision patterns
5. **Decision Quality Scoring System** — Automated assessment of decision quality over time
6. **Advanced Visualization Suite** — Interactive data exploration and insight discovery
7. **Platform API & Developer Tools** — Comprehensive API for external developers
8. **Ecosystem Growth Features** — Community building, gamification, and network effects

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
| Sprint 8 Plan | `docs/prompts/PHASE-8-ORCHESTRATOR.md` |
| Task Tracking | `docs/tasks/_TASK-INDEX.md` |
