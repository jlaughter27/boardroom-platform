# Deploying BoardRoom AI to Railway

## Prerequisites
- Railway account (https://railway.app)
- GitHub repo connected to Railway
- Anthropic API key
- OpenAI API key (for embeddings)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐
│  BoardRoom AI   │────>│  OmniMind API   │────>│  PostgreSQL   │
│  (port 3001)    │     │  (port 3333)    │     │  (pgvector)   │
│  React + Express│     │  Express + Prisma│     │              │
└─────────────────┘     └─────────────────┘     └──────────────┘
    Public domain          Internal only          Railway DB
```

BoardRoom AI serves the React SPA and handles auth/sessions.
OmniMind API is internal-only — BoardRoom proxies all data requests to it.

## Step 1: Create Railway Project

1. New Project → Deploy from GitHub Repo
2. Select the boardroom-platform repository

## Step 2: Add PostgreSQL

1. New Service → Database → PostgreSQL
2. Railway auto-provisions pgvector-compatible Postgres
3. Note the `DATABASE_URL` from the service variables (use the internal URL)

## Step 3: Deploy OmniMind API

1. New Service → GitHub Repo → select boardroom-platform
2. **Settings:**
   - Root Directory: `packages/omnimind-api`
   - Builder: Dockerfile
3. **Variables** (add all):

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference Railway Postgres |
| `OMNIMIND_API_KEY` | `openssl rand -hex 32` | Generate unique key |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Your Anthropic key |
| `OPENAI_API_KEY` | `sk-...` | Your OpenAI key |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | For OAuth token encryption |
| `OMNIMIND_PORT` | `3333` | |
| `NODE_ENV` | `production` | |

4. **Networking:** Generate internal domain (e.g., `omnimind-api.railway.internal`)
   - Do NOT generate a public domain — this service should only be accessible internally

## Step 4: Deploy BoardRoom AI

1. New Service → GitHub Repo → select boardroom-platform
2. **Settings:**
   - Root Directory: `packages/boardroom-ai`
   - Builder: Dockerfile
3. **Variables:**

| Variable | Value | Notes |
|----------|-------|-------|
| `JWT_SECRET` | `openssl rand -hex 32` | Generate unique key |
| `OMNIMIND_API_URL` | `http://omnimind-api.railway.internal:3333` | Internal Railway URL |
| `OMNIMIND_API_KEY` | Same as Step 3 | Must match OmniMind's key |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Your Anthropic key |
| `BOARDROOM_PORT` | `3001` | |
| `CORS_ORIGINS` | `https://your-domain.railway.app` | Your public Railway domain |
| `NODE_ENV` | `production` | |
| `APP_URL` | `https://your-domain.railway.app` | For Stripe redirects |

4. **Networking:** Generate public domain (this is your app URL)

## Step 5: Verify

1. Visit `https://your-domain.railway.app/health` — should return `{ status: "ok" }`
2. Visit `https://your-domain.railway.app` — should load the React app
3. Register an account and run a test decision session

## Optional: Google Calendar Integration

If using Google Calendar, add these to **BoardRoom AI** and **OmniMind API**:

| Variable | Value |
|----------|-------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://your-domain.railway.app/calendar/callback` |

## Optional: Stripe Payments

Add to **BoardRoom AI**:

| Variable | Value |
|----------|-------|
| `STRIPE_SECRET_KEY` | From Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhook config |
| `STRIPE_PRICE_ID` | Your subscription price ID |

## Environment Variable Generation

```bash
# JWT_SECRET
openssl rand -hex 32

# OMNIMIND_API_KEY (use the same value for both services)
openssl rand -hex 32

# ENCRYPTION_KEY (must be exactly 64 hex chars = 32 bytes)
openssl rand -hex 32
```

## How Deployment Works

1. Railway detects the Dockerfile in each service's root directory
2. **OmniMind API:** The `docker-entrypoint.sh` runs Prisma migrations and enables pgvector/pg_trgm extensions before starting the server
3. **BoardRoom AI:** The server serves the React SPA from `client/dist/` in production — no separate frontend deployment needed
4. Health checks on `/health` verify both services are running

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Health check fails | Check Railway logs for env var errors (missing required vars) |
| Migrations fail | Check DATABASE_URL is correct; ensure Postgres is healthy |
| CORS errors | Verify `CORS_ORIGINS` matches your Railway public domain exactly |
| 502 errors on sessions | Check `OMNIMIND_API_URL` points to correct internal domain |
| React app shows blank | Verify `client/dist/` was built in Dockerfile (check build logs) |
| Auth not working | Ensure `JWT_SECRET` is set and consistent across deploys |

## Scaling

- OmniMind API: Increase `numReplicas` in `railway.toml` (stateless, safe to scale)
- BoardRoom AI: Increase `numReplicas` (stateless, JWT auth is self-contained)
- PostgreSQL: Use Railway's built-in scaling or migrate to a managed provider
