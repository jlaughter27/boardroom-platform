# Current State — What's Live, What's Next

> Living document. Update after each deploy or phase completion.
>
> **Last updated:** 2026-04-08

## Deployment Status

| Service | Status | URL | Health |
|---------|--------|-----|--------|
| BoardRoom AI | **Live** | `https://boardroom-ai-production-1092.up.railway.app` | `/health` → `{"status":"ok","omnimindConnected":true}` |
| OmniMind API | **Live** | `https://omnimind-api-production.up.railway.app` | `/health` → `{"status":"ok","dbConnected":true}` |
| PostgreSQL | **Live** | `postgres.railway.internal:5432` | Connected (pgvector + pg_trgm enabled) |

**Platform:** Railway (auto-deploy on push to `main`)
**Build time:** ~60 seconds per service
**Private networking:** Not yet enabled. BoardRoom → OmniMind uses public domain.

## What's Built (Phase 1 — Complete)

### OmniMind API
- Full Prisma schema with 12+ models (User, Room, Session, MemoryEntry, Decision, Commitment, Person, Goal, Project, Task, etc.)
- Memory validation pipeline (Zod + temporal + contradiction check)
- Hybrid retrieval engine (vector similarity + trigram + tsvector full-text)
- REST API with API key auth
- Rate limiting (in-memory)
- Background jobs (node-cron): weekly memo, pattern detection, contradiction scan
- Health endpoint with DB connectivity check
- OpenAI embeddings (vector(1536)) for semantic search

### BoardRoom AI
- React frontend with dark theme design system (CSS custom properties → Tailwind → CVA components)
- JWT auth (email/password registration, httpOnly cookies)
- Custom agent runtime (~200 lines, no LangChain)
- 7-persona system: Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO
- Persona prompt loading from `docs/prompts/*.system.md`
- SSE streaming for decision session responses
- Context packager (top 7-10 memories per persona call)
- OmniMind HTTP client for all data operations
- Login/signup page with premium UI (parallax blobs, rotating testimonials, Framer Motion animations)
- Static file serving with SPA fallback
- API prefix rewriting (`/api/*` → `/*`) for dev/prod parity

### Shared Package
- TypeScript interfaces for all data models
- Zod validation schemas (companion to each interface)
- Constants and enums (matching Prisma)
- Pure utility functions

## What's Spec'd but Not Built (Phase 2)

Refer to `docs/MASTER-FRAMEWORK.md` and `docs/tasks/` for full specs.

### Planned Features
- **Subscription/billing** — Stripe integration, plan tiers, usage metering
- **OAuth integrations** — Google Calendar, Slack, Notion for memory ingestion
- **Enhanced retrieval** — Reranking, query expansion, adaptive context windows
- **Cortex system** — Proactive weekly memos, pattern analysis, contradiction alerts
- **Collaboration** — Multi-user rooms, shared decision sessions
- **Mobile responsive** — Full mobile layout optimization
- **Baseline migration** — Replace `prisma db push` with proper migration history

### Infrastructure Upgrades Needed
- Switch `OMNIMIND_API_URL` to Railway private networking
- Redis-backed rate limiting (for multi-instance scaling)
- Proper migration history (baseline migration + `prisma migrate deploy`)
- CI/CD pipeline (typecheck + test gate before deploy)
- Monitoring/alerting beyond health checks

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
- Development happens directly on `main` during Phase 1. Feature branches recommended for Phase 2.

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
