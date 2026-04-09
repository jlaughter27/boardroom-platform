# Fragile Zones — What Breaks & Why

> Hard-won lessons from deployment. Read this before touching Docker, middleware ordering, Prisma, or the shared package build.

## 1. Docker Build Order (Both Services)

The multi-stage Docker builds have a strict execution sequence. Reordering any step can cause silent build failures.

### Shared package must build first

Both Dockerfiles follow the same pattern:

```
Install ALL deps → Build shared (tsc) → Overlay shared dist into node_modules → Build service → pnpm deploy --prod --legacy
```

**Why it breaks:** pnpm workspace symlinks don't resolve inside Docker's COPY between stages. The shared package at `node_modules/@boardroom/shared` is a symlink to `../../packages/shared` — which doesn't exist in the runner stage. Fix: manually copy `packages/shared/dist` into `node_modules/@boardroom/shared/dist` after building.

**The tsbuildinfo trap:** The shared package uses `"composite": true` in its tsconfig, which enables incremental builds and produces `.tsbuildinfo` files. If a stale `.tsbuildinfo` is cached (e.g., from a previous Docker layer), `tsc` may exit 0 *without emitting any files*. Both Dockerfiles run `rm -f tsconfig.tsbuildinfo` before `tsc` to prevent this. **Do not remove that line.**

### OmniMind: Prisma client location

The generated Prisma client lives deep inside pnpm's `.pnpm` virtual store, not at the expected `node_modules/.prisma/client`. The Dockerfile uses `find` to locate it and copies it to a stable path:

```dockerfile
find /app/node_modules/.pnpm -path '*/.prisma/client/index.js' -exec dirname {} \; | head -1
```

**What breaks:** If you add a second Prisma version to dependencies, `head -1` may grab the wrong client. If you skip this step entirely, the runner stage has no generated Prisma types and every DB query fails at runtime.

### OmniMind: Prisma CLI pinned to 6.19.3

The runner stage installs `prisma@6.19.3` globally. **Do not change this to `npx prisma`** — npx downloads the latest version, and Prisma 7.x introduced breaking changes to the `datasource` block syntax that make our schema invalid.

### pnpm deploy --legacy

Both services use `pnpm deploy --prod --legacy` to create a standalone deployment directory with real files (not symlinks). The `--legacy` flag is required because pnpm 10+ changed the deploy behavior and requires `inject-workspace-packages=true` in `.npmrc` without it.

**Rule: Don't touch the pnpm deploy command without testing the full Docker build.**

## 2. Express Middleware Ordering (boardroom-ai)

The middleware stack in `packages/boardroom-ai/server/src/index.ts` has a strict order. Moving any block causes silent auth or routing failures.

### The sequence (do not reorder):

```
1. Global middleware (helmet, CORS, JSON parser, cookie parser)
2. API prefix rewriting (/api/* → /*)
3. Static file serving + SPA fallback (production only)
4. Public routes (health, auth, OAuth callbacks)
5. Auth wall (JWT middleware)
6. Protected routes (sessions, settings, etc.)
7. Error handler (must be last)
```

### Why each position matters:

**API prefix rewriting BEFORE static serving:** The frontend API client prefixes all requests with `/api` (for Vite dev proxy compatibility). In production, middleware strips this prefix. If this runs after static serving, API requests get served `index.html` instead of reaching route handlers.

**Static serving BEFORE auth wall:** Browser requests for `/`, `/login`, CSS, JS, images all need to be served without JWT. If static serving moves below the auth wall, every page load returns `{"error":"unauthorized"}`.

**SPA fallback route exclusion:** The wildcard SPA route (`*`) checks if the request path starts with known API prefixes (`/auth`, `/sessions`, `/health`, etc.) and calls `next()` instead of serving `index.html`. **If you add a new API route at the top level, add it to this exclusion list** or it will be masked by the SPA fallback.

**Cookie parser BEFORE auth middleware:** Auth reads JWT from `req.cookies.boardroom_token`. Without cookie parser running first, `req.cookies` is undefined.

## 3. Prisma & Database Schema

### Extensions must exist before schema push

`docker-entrypoint.sh` runs in this exact order:

```
1. CREATE EXTENSION IF NOT EXISTS vector
2. CREATE EXTENSION IF NOT EXISTS pg_trgm
3. prisma db push --skip-generate --accept-data-loss
```

The schema uses `Unsupported("vector(1536)")` for the embedding column. If pgvector isn't enabled first, `db push` fails because the `vector` type doesn't exist.

### db push vs. migrate deploy

We currently use `prisma db push` instead of `prisma migrate deploy`. This is intentional — the project only has one migration (`add_embedding_column`) that ALTERs a table, but no CREATE TABLE baseline migration exists. `db push` syncs the full schema declaratively.

**Phase 2 action:** Create a baseline migration with `prisma migrate dev --name baseline`, then switch the entrypoint to `prisma migrate deploy` for proper migration history tracking.

### --accept-data-loss flag

The `--accept-data-loss` flag on `db push` allows Prisma to drop columns if the schema removes them. This is dangerous in production with real user data. Acceptable now during v1 deployment; revisit when users exist.

### Soft deletes

Multiple models use `deletedAt DateTime?` for soft deletes: Room, Session, MemoryEntry, Decision, Commitment, Person, Goal, Project, Task. **Every query against these models must filter `WHERE deletedAt IS NULL`** or deleted records reappear in the UI.

## 4. Environment Variables

### PORT comes from Railway

Both services read `process.env.PORT` first (injected by Railway), then fall back to their service-specific vars (`BOARDROOM_PORT`, `OMNIMIND_PORT`), then hardcoded defaults. **Never hardcode a port value in production config.**

### Required vars cause immediate exit

Both services validate required env vars at startup and call `process.exit(1)` if any are missing. This is intentional — fail fast. Required vars:

| Service | Required |
|---------|----------|
| boardroom-ai | `JWT_SECRET`, `OMNIMIND_API_KEY`, `OMNIMIND_API_URL`, `ANTHROPIC_API_KEY` |
| omnimind-api | `DATABASE_URL`, `OMNIMIND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ENCRYPTION_KEY` (prod) |

### OMNIMIND_API_KEY must match exactly

Both services share the same API key value. If you rotate it in one service but not the other, all service-to-service calls fail with 401.

### OMNIMIND_API_URL

Currently set to the **public** Railway domain (`https://omnimind-api-production.up.railway.app`). For lower latency, switch to Railway private networking (`http://omnimind-api.railway.internal:PORT`). Requires both services on the same Railway private network.

## 5. Auth System

### JWT cookie name is hardcoded

The cookie name `boardroom_token` appears in auth middleware and the login/logout handlers. If you change it in one place but not others, auth silently breaks (no error, just 401 on every request).

### Service-to-service auth uses timing-safe comparison

OmniMind's API key check uses `crypto.timingSafeEqual` to prevent timing attacks. Don't replace this with `===` string comparison.

### Subscription middleware fails open

If the OmniMind subscription check fails (network error, timeout), the middleware **lets the request through** rather than blocking. This is intentional (don't break the app over billing errors) but means a prolonged OmniMind outage unlocks all features for all users.

## 6. Rate Limiting

Rate limiting in OmniMind uses an **in-memory** store (no Redis). This means:

- All rate limit state resets on server restart
- If you scale to multiple instances, each has independent counters
- A user hitting instance A and instance B gets 2x the rate limit

**Phase 2 action:** Move to Redis-backed rate limiting if scaling beyond one instance.

## 7. Shared Package (`packages/shared`)

### Types and validation only

The shared package must contain **zero business logic**. Only: TypeScript interfaces, enums, Zod schemas, constants, and pure utility functions (no side effects, no runtime dependencies).

### Zod schemas must match companion types

Every Zod schema in `packages/shared/src/schemas/` has a corresponding TypeScript interface in `packages/shared/src/types/`. If you modify one without the other, either runtime validation or compile-time checks will silently pass incorrect data.

### Convention enforcement

- `interface` for data shapes (not `type` aliases)
- TypeScript `enum` keyword (matching Prisma enums)
- `camelCase` for all field names
- All IDs are `string`
- All timestamps are `Date`

## Quick Reference: What NOT to Touch

| File/Area | Rule |
|-----------|------|
| Dockerfile `rm -f tsconfig.tsbuildinfo` | Never remove |
| Dockerfile `pnpm deploy --legacy --prod` | Don't change flags |
| Dockerfile `npm install -g prisma@6.19.3` | Don't upgrade without testing schema compat |
| `docker-entrypoint.sh` extension order | Extensions before db push, always |
| `index.ts` middleware stack (boardroom-ai) | Don't reorder blocks 1-7 |
| SPA fallback route exclusion list | Update when adding new top-level API routes |
| Cookie name `boardroom_token` | Grep all usages before changing |
| `OMNIMIND_API_KEY` | Must match in both services |
| Shared package `composite: true` | Required for project references |
