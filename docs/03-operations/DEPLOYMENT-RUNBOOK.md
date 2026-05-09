# Deployment Runbook — Railway

> Everything you need to deploy, debug, and maintain the BoardRoom platform on Railway.

## Services

| Service | Railway Name | Public URL | Internal URL |
|---------|-------------|------------|--------------|
| BoardRoom AI | boardroom-ai | `https://boardroom-ai-production-1092.up.railway.app` | — |
| OmniMind API | omnimind-api | `https://omnimind-api-production.up.railway.app` | `omnimind-api.railway.internal` |
| PostgreSQL | (Railway plugin) | — | `postgres.railway.internal:5432` |

## Environment Variables

### omnimind-api

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | PostgreSQL connection string | Railway Postgres plugin (auto-set) |
| `OMNIMIND_API_KEY` | Shared secret for service-to-service auth | Generate with `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Anthropic API key | console.anthropic.com |
| `OPENAI_API_KEY` | OpenAI API key (embeddings only) | platform.openai.com |
| `ENCRYPTION_KEY` | AES-256 key for OAuth token encryption | Generate with `openssl rand -hex 32` |
| `PORT` | Injected by Railway automatically | Do not set manually |

### boardroom-ai

| Variable | Description | Source |
|----------|-------------|--------|
| `JWT_SECRET` | Secret for JWT signing | Generate with `openssl rand -hex 32` |
| `OMNIMIND_API_KEY` | Must match omnimind-api's value exactly | Same value as above |
| `OMNIMIND_API_URL` | URL to reach OmniMind | `https://omnimind-api-production.up.railway.app` |
| `ANTHROPIC_API_KEY` | Anthropic API key | console.anthropic.com |
| `PORT` | Injected by Railway automatically | Do not set manually |

### Critical: OMNIMIND_API_URL

Currently uses the **public** domain. For lower latency, switch to Railway's private networking: `http://omnimind-api.railway.internal:PORT`. Requires both services on the same Railway private network.

## Docker Build Architecture

Both services use multi-stage Docker builds with `pnpm deploy --legacy` for production node_modules.

### Build sequence (both services):
1. Install ALL deps (including devDeps) in builder stage
2. Build shared package (`tsc` with `rm -f tsconfig.tsbuildinfo` first)
3. Copy shared dist to `node_modules/@boardroom/shared/`
4. Build service-specific code
5. `pnpm deploy --prod --legacy` creates standalone deploy output
6. Runner stage copies deploy output's node_modules (real files, not symlinks)
7. Overlays shared dist on top

### omnimind-api additional steps:
- `prisma generate` runs before tsc (needs generated types)
- Generated `.prisma` client copied from pnpm store to stable path
- `npm install -g prisma@6.19.3` in runner for migrations at startup
- `docker-entrypoint.sh` runs extensions + `prisma db push` + starts server

## Railway CLI Commands

```bash
# Link to project
cd /path/to/boardroom-platform
railway link

# View logs
railway service boardroom-ai
railway logs --lines 50
railway logs --build --latest --lines 30

# Switch service context
railway service omnimind-api
railway logs --lines 50

# Set variables
railway variables set KEY=value

# Redeploy
railway redeploy -y

# Generate public domain (if missing)
railway domain -s omnimind-api
```

## Common Issues & Fixes

### Build fails: "shared declarations not found"
**Cause**: Stale `tsconfig.tsbuildinfo` cached by TypeScript incremental compilation.
**Fix**: Already handled in Dockerfiles (`rm -f tsconfig.tsbuildinfo` before tsc). If it recurs, check that `*.tsbuildinfo` is in `.gitignore`.

### Build fails: pnpm "frozen-lockfile" mismatch
**Cause**: `pnpm-lock.yaml` out of sync with package.json changes.
**Fix**: Run `pnpm install` locally, commit the updated lockfile.

### Runtime: "Cannot find module 'express'"
**Cause**: pnpm workspace symlinks don't resolve in Docker runner stage.
**Fix**: Already handled via `pnpm deploy --legacy --prod`. If it recurs, check that the COPY order in the runner stage pulls from `/app/deploy-output/node_modules`.

### Runtime: Prisma 7.x schema error
**Cause**: `npx prisma` downloads latest (7.x) which broke the `datasource url` syntax.
**Fix**: Already handled — prisma@6.19.3 installed globally in omnimind-api runner. Do NOT use `npx prisma` in the runner stage.

### Health check fails / "Application not found"
**Cause**: Service listens on wrong port. Railway injects `PORT` env var.
**Fix**: Both services now check `process.env.PORT` first. Do not hardcode port values.

### boardroom-ai: "Authentication required" on page load
**Cause**: Static files served after auth middleware, or API requests missing `/api` prefix rewrite.
**Fix**: Static serving registered before auth wall. `/api` prefix stripped by middleware before route matching.

### omnimind-api: "P3009 failed migration"
**Cause**: A previous migration attempt failed and is stuck in `_prisma_migrations` table.
**Fix**: `prisma migrate resolve --rolled-back <migration_name>` or use `prisma db push` (current approach).

## Deploy Checklist

1. Verify `npm run typecheck` passes locally
2. Verify `npm run test` passes locally (110+ tests)
3. Commit and push to `main`
4. Railway auto-builds on push (~60s build time)
5. Check build logs: `railway logs --build --latest --lines 30`
6. Check health: `curl https://boardroom-ai-production-1092.up.railway.app/health`
7. Check health: `curl https://omnimind-api-production.up.railway.app/health`
8. Both should return `{"status":"ok"}`
