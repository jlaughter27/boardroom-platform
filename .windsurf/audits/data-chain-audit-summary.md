# Data Chain Audit Summary: BoardRoom AI → OmniMind

**Date:** 2026-04-10 | **Status:** Complete

---

## Architecture Flow

```
React Client (5173) → Vite Proxy → BoardRoom Server (3001) → OmniMindClient → OmniMind API (3333) → PostgreSQL
```

---

## Authentication Layers

| Layer | Method | Key Files |
|-------|--------|-----------|
| Client→BoardRoom | JWT Cookie (httpOnly) | `auth.store.ts` |
| BoardRoom→OmniMind | x-api-key + x-user-id | `omnimind-client.ts:27-32` |
| OmniMind Entry | timingSafeEqual + CUID check | `auth.ts:14-39`, `user-validator.ts:13-97` |

---

## Data Validation Chain

| Stage | Validation | Location |
|-------|-----------|----------|
| Client Input | React form state | Components |
| API Transit | None (pass-through) | `omnimind-client.ts` |
| OmniMind Entry | Zod schemas + User check | `validate.ts:5-23`, `user-validator.ts` |
| Service Layer | Business rules | `*.service.ts` files |
| Database | Prisma ORM + constraints | `schema.prisma` |

---

## Critical Findings

### ✅ Strengths (7)
1. Constant-time API key comparison (timingSafeEqual)
2. CUID validation prevents NoSQL injection
3. User existence verified on every protected route
4. Shared Zod schemas (@boardroom/shared)
5. Row-level isolation (userId column)
6. Rate limiting enabled
7. PII masked in logs

### ⚠️ Medium Risk (4)
1. HTTP (not HTTPS) for internal service communication
2. No retry logic in OmniMindClient
3. 1mb global body limit (no route-specific)
4. Client doesn't pre-validate with Zod

### 🔴 Recommendations (5)
1. Add `x-request-id` for distributed tracing
2. Implement circuit breaker pattern
3. Add route-specific body limits
4. Client-side Zod validation
5. Health check before OmniMind routing

---

## Example: Memory Creation Flow

```
1. User clicks Save → api.createMemory()
2. POST /api/memories (with JWT cookie)
3. BoardRoom Server validates JWT
4. omnimindClient.createMemory(userId, data)
5. POST localhost:3333/memories (x-api-key, x-user-id)
6. OmniMind: apiKeyAuth → validateUserExists → validateBody
7. memoryService.createMemory() → Prisma → DB
```

---

## Key Files

### Client
- `packages/boardroom-ai/client/src/lib/api.ts` - HTTP client
- `packages/boardroom-ai/client/vite.config.ts` - Proxy /api → :3001

### BoardRoom Server
- `packages/boardroom-ai/server/src/services/omnimind-client.ts` - OmniMind HTTP client

### OmniMind API
- `packages/omnimind-api/src/middleware/auth.ts` - API key auth
- `packages/omnimind-api/src/middleware/user-validator.ts` - User validation
- `packages/omnimind-api/src/middleware/validate.ts` - Zod validation

### Shared
- `packages/shared/src/validation/*.schema.ts` - Zod schemas

---

## Security Status: MODERATE-HIGH ✅

- SQL Injection: Protected (Prisma)
- XSS: Protected (helmet CSP)
- Auth: Multi-layer (JWT + API Key)
- Input Validation: Zod schemas
- Logging: PII masked

**Overall Grade: B+**
