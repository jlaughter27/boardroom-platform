# Architecture Map — How Today's System Actually Wires Together

**Audience:** Anyone who needs to reason about blast radius before touching code.
**Purpose:** ASCII diagrams of the production data flows, annotated with audit findings (NOT-DURABLE, FAILS-OPEN, RACE, FACADE) so you can see the cracks at a glance.
**Source:** All four Wave 1 audits.

> **Annotation legend**
> - `NOT-DURABLE` — state lives in a single process; lost on restart.
> - `FAILS-OPEN` — error path lets the request through without the intended check.
> - `RACE` — concurrent operations can interleave to corrupt state.
> - `FACADE` — code/policy exists but isn't actually wired or enforced.
> - `BROKEN` — observable bug; production behavior diverges from intent.

---

## A. Service-boundary diagram (the big picture)

```
              ┌─────────────────────────────────────────────────┐
              │                   Browser (React 19)            │
              │  Zustand state · 70+ components · SSE consumer  │
              └────────────────────────┬────────────────────────┘
                                       │ httpOnly cookie
                                       │ boardroom_token (JWT, 7d, HS256)
                                       │     ⚠ no aud/iss/kid
                                       ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                  BoardRoom AI (Express, Railway)                     │
   │  Owns: persona dispatch, SSE streaming, orchestrator, agent runtime  │
   │  Stateful in-process:                                                │
   │   • SSE sessions Map<id, session>            ← NOT-DURABLE, no TTL   │
   │   • auth-rate-limiter Map                    ← NOT-DURABLE           │
   │   • session-rate-limiter Map                 ← NOT-DURABLE           │
   │   • subscription middleware (catch-all)      ← FAILS-OPEN            │
   │   • OmniMind circuit breaker (per-process)                           │
   └─────────────┬──────────────────────────────────────────┬─────────────┘
                 │ x-api-key (timing-safe)                  │
                 │ x-request-id (correlation, since 4-15)   │ HTTPS to
                 │ x-user-id (consumer-trusted)             │ Anthropic +
                 ▼                                          │ OpenAI APIs
    ┌────────────────────────────────────────────────────┐  │
    │            OmniMind API (Express, Railway)         │  │
    │  Owns: ALL persistent data, retrieval, cortex      │  │
    │  Stateful in-process:                              │  │
    │   • embedding queue EmbeddingJob[]   ← NOT-DURABLE │  │
    │   • rate-limiter Map                 ← NOT-DURABLE │  │
    │   • node-cron jobs (memo/patterns/contradictions)  │  │
    │   • redlock.ts in-process locks      ← FACADE      │  │
    │  Middleware chain (load-bearing order):            │  │
    │   1. helmet, CORS (wide-open ⚠), JSON 1mb          │  │
    │   2. apiKeyAuth                                    │  │
    │   3. (validateUserExists)            ← NEVER MOUNT │  │
    │   4. (attachRLSClient)               ← NEVER MOUNT │  │
    │   5. routes                                        │  │
    │   6. error handler (last)                          │  │
    └────────────────────┬───────────────────────────────┘  │
                         │ Prisma 6.3                       │
                         │ ?connection_limit=10 (default)   │
                         ▼                                  │
    ┌────────────────────────────────────────────────────┐  │
    │         PostgreSQL 16 (Railway plugin)             │  │
    │  Extensions: pgvector, pg_trgm, tsvector           │  │
    │  • IVFFlat index lists=100  (ceiling ≈ 40k vectors)│  │
    │  • RLS policies migration applied? ← UNCLEAR (D1)  │  │
    │  • db push --accept-data-loss on every boot ⚠      │  │
    │  • No baseline migration                           │  │
    │  • 6 orphan 2025-04-12 migrations sitting in tree  │  │
    └────────────────────────────────────────────────────┘  │
                                                            │
                  ┌─────────────────────────────────────────┘
                  ▼
       Anthropic (Sonnet 4.6 + Haiku 4.5) · OpenAI (text-embedding-3-small)
       Stripe webhooks ⚠ DOUBLE-BROKEN (raw body + auth wall)
       Google Calendar/Gmail OAuth ⚠ state hijack (security-audit §A1)
```

**Key invariant being broken (per security-audit.md §A4):** CLAUDE.md says "BoardRoom NEVER touches Postgres directly" — this holds. CLAUDE.md also says "RLS: All queries MUST include user_id filter" — this holds at the route level only; the Postgres-side RLS is a facade.

---

## B. Write path (memory create) — most-trafficked flow

```
  POST /memories
    │  body validated by Zod (express middleware)
    │  userId taken from x-user-id header   ← consumer-trusted; not validated
    ▼
  memory.service.createMemory(userId, input)
    │
    ▼
  runValidationPipeline(input)
    ├─ schemaValidator       (Zod again — defense in depth)
    ├─ temporalValidator     (validAt < invalidAt; supersededBy resolves)
    └─ budgetEnforcer        (per-user-per-domain caps: ministry 300 / business 400 / …)
                             ⚠ short-circuits early — spam attempts don't hit DB but still consume CPU
    │
    ▼
  prisma.memoryEntry.create({ ..., status: DRAFT, embedding: NULL, version: 1 })
    │  WHERE deletedAt IS NULL not relevant on insert
    │  ❗ insert succeeds even if embedding generation will later fail (B2)
    │
    ▼
  queueEmbedding(memoryId, content, 'high').catch(log)    ← fire-and-forget
    │     │
    │     └── enqueued in const queue: EmbeddingJob[]     ⚠ NOT-DURABLE
    │           on Railway redeploy / OOM / crash → job lost forever
    │           failed-after-3-attempts also leaves embedding NULL
    │           getEmbeddingStatus reports "pending" for both states (B2)
    ▼
  return 201 with the new row

  ─── BACKGROUND ───────────────────────────────────────────────────
  embedding-queue worker (~100ms tick)
    ├─ pop job (priority high → normal → low)
    ├─ openai.embeddings.create(content)  ← sequential for-loop, no Promise.all (D row 2)
    ├─ UPDATE memory_entries SET embedding = $1 WHERE id = $2
    └─ on error: retry up to 3, then drop silently — no DB column written
```

**Concurrency landmine (per data-integrity-audit.md §B1):**

```
  PATCH /memories/:id  (writer A)               PATCH /memories/:id  (writer B)
   │                                             │
   ▼ findFirst({ id, userId })  ✓                ▼ findFirst({ id, userId })  ✓
   │  (both read version=1)                      │
   ▼ update({ where: { id },                     ▼ update({ where: { id },
              data: { …, version: { inc: 1 }}})            data: { …, version: { inc: 1 }}})
   │  → version 2, A's payload                   │  → version 3, B's payload
   ▼                                             ▼
  RACE — A's write is silently overwritten. version went 1→3 with no failure raised.
  "Optimistic concurrency" comment is aspirational. (memory.service.ts:151)
  Same shape in decision.service.ts:90, entity.service.ts:82.
  commitment.service.ts:64 doesn't even increment version.   (data §A5)
```

---

## C. Read path (assemble persona context)

```
  GET /context/:persona?query=…
    │
    ▼
  contextAssembler.assembleContextForPersona(userId, query, persona)
    │
    ├──► generateEmbedding(query)   ← OpenAI 1536-dim
    │
    └──► Promise.all([
            structuredFilter(userId, query, limit=20),    ← exact match domain/tags
            fulltextSearch(userId, query, limit=20),      ← to_tsvector inline
            trigramSearch(userId, query, limit=20),       ← pg_trgm sim ≥ 0.3
            semanticSearch(userId, embedding, limit=20),  ← IVFFlat probes=1 (default)
          ])
          ⚠ semantic-search has NO unit test (code-quality §B.5)
          ⚠ trigram-search has NO unit test
          ⚠ structured-filter has NO unit test
          ⚠ no retrieval cache; every query runs all 4 layers fresh (mem0 baseline §B)
    │
    ▼
  ranker.rankAndDedupe(results)
    │  fixed weights: structured 0.30 · FTS 0.25 · trigram 0.20 · semantic 0.25
    │  +0.10 if accessed within 7 days  (binary, no exp decay)
    │  +0.10 if importance ≥ 0.8
    │  ⚠ weights designed, not EV-tuned; no MRR/NDCG/recall measurements
    ▼
  contextPackager.pack(persona)
    │  per-persona tag boost +0.15 (optimist→success/win, critic→risk/blocker, …)
    │  cap = 10 items / 2000 tokens (CEO: 15 / 3000)
    │  exclude over-budget items, do not truncate
    ▼
  return ContextPackage { items[], tokenEstimate, metadata }
```

**Cortex services bypass the soft-delete filter on the source decisions table** (per data-integrity-audit.md §B4):

```
  cortex-memo.service.ts:19 — decision.findMany({ where: { userId, createdAt: {gte:…} } })
                              MISSING: deletedAt: null
                              → soft-deleted decisions inflate "decisionsMade"

  cortex-memo.service.ts:22 — commitment.findMany({ where: { userId, status: 'OPEN' } })
                              MISSING: deletedAt: null
                              → trashed commitments leak into LLM-summarized memos

  cortex-patterns.service.ts:21 — same shape
```

---

## D. Cortex job pipeline (node-cron, in-process)

```
  packages/omnimind-api/src/jobs/cortex-scheduler.ts
    │
    ├── cron('0 18 * * 0', weeklyMemoJob)             Sun 18:00
    ├── cron('0 3  * * 1', patternDetectionJob)        Mon 03:00
    └── cron('0 4  * * 1', contradictionScanJob)       Mon 04:00
                  │
                  ▼ for each user (sequential, fail-safe per-user)
        ┌────────────────────────────────────────┐
        │  cortexMemoService.generateForUser()   │
        │   ├─ load decisions (RACE, see below)  │
        │   ├─ load patterns                     │
        │   ├─ load contradictions               │
        │   ├─ Anthropic Haiku call              │
        │   └─ prisma.weeklyMemo.create({...})   │
        │       ⚠ no @@unique([userId, weekStart])│
        │       ⚠ no idempotency check            │
        └────────────────────────────────────────┘
                  │
        On Railway redeploy at Sun 18:01:
          old container's cron may still be mid-loop
          new container starts → cron fires again
          → 2 WeeklyMemo rows for the same week
          ⚠ RACE / non-idempotent (data §B5)
```

**Spend ceiling (per security-audit.md §C3):** `/cortex/contradictions/scan`, `/cortex/patterns/scan`, `/cortex/memo/generate`, `/cortex/simulate` are user-triggerable POST endpoints with no body params and only the global 60/min rate limit. A user with N=20 projects = 190 pair comparisons = 38 Haiku calls per scan. No per-user-per-day cap.

**Scaling ceiling (per scalability-audit.md §A row 4):**
- 100 users × 30 s/user = 50 min — fine.
- 2 000 users × 30 s/user = 16.6 hours — three jobs collide; Sunday memo still running on Tuesday.

---

## E. Auth flow (BoardRoom)

```
  POST /auth/register   (3 / hour / IP — NOT-DURABLE, resets on redeploy)
    │
    ▼ bcrypt.hash(password, 12)
    ▼ prisma.user.create()
    ▼ sign JWT { sub: userId, email, iat, exp(7d) } with HS256(JWT_SECRET)
       ⚠ no aud / no iss / no kid → cross-env token reuse risk (sec §C1)
    ▼ Set-Cookie: boardroom_token=…; HttpOnly; Secure(prod); SameSite=Lax
    ▼ return 201

  POST /auth/login      (5 / 15 min / IP — NOT-DURABLE)
    │  ⚠ no per-account lockout — botnet bypasses entirely (sec §B4)
    │  ⚠ Railway auto-deploys clear the limiter several times per day
    ▼ same flow

  Authenticated requests:
    Cookie: boardroom_token=…
    │
    ▼ jwt.verify(token, JWT_SECRET)  → req.user = { id, email }
    │
    ▼ subscriptionMiddleware
       try { sub = await omnimindClient.getSubscription(userId); enforce tier }
       catch { next() }              ⚠ FAILS-OPEN on every error class (sec §B3)
    │                                  401, 422, 500, network, breaker-open → all pass
    ▼ route handler
```

**OAuth callback (Google Calendar — same shape for Gmail):**

```
  Browser  ──► GET /calendar/auth-url
                 │  state = userId        ⚠ unsigned, not bound to nonce/exp (sec §A1)
                 ▼ generates Google authorize URL
            ◄── redirect to accounts.google.com
            ──► user approves
  Google   ──► GET /calendar/callback?code=…&state=<userId>
                 │
                 │  ⚠ effective mounted path is /calendar/callback BEHIND the auth wall
                 │     (routes/calendar.routes.ts defines /callback INSIDE the router)
                 │     in index.ts the router is mounted AFTER authMiddleware → 401 to Google
                 │     either prod is silently broken OR someone hot-patched server-side
                 ▼
            handleCallback(state, code)
              │  ⚠ no signature on state → attacker can supply victim's userId + own code
              │  ⚠ writes ATTACKER's tokens into VICTIM's OAuthToken row
              ▼
            crypto.encrypt(accessToken)   ⚠ falls through to plaintext if NODE_ENV ≠ "production" (sec §A5)
            prisma.oAuthToken.upsert({ where: { userId } })
```

---

## F. Stripe webhook (DOUBLE-BROKEN, per security §A2)

```
  Stripe ──► POST /subscription/webhook   (no cookie, no JWT)
              │
              ▼ in index.ts the global app.use(express.json()) ran first
              │   → req.body is now an Object, NOT a Buffer
              │
              ▼ subscriptionRouter is mounted AFTER authMiddleware
              │   → request gets 401 before reaching the handler
              │
              ▼ even if it got there:
              │   stripe.webhooks.constructEvent(req.body, sig, secret)
              │     requires raw bytes → throws → 400 → Stripe retries 3x → endpoint disabled
              │
              ▼ even if signature verified:
              │   no event.id idempotency table → duplicate retries cause double-create
              │   no try/catch → P2002 on unique(userId) escapes → Stripe sees 500 → loop
              │
              ▼ user-visible: subscriptions never transition TRIALING → ACTIVE
                              paying users could lose access at currentPeriodEnd
                              free trials continue forever
```

**Fix sequence (per security-audit.md §A2):** mount `app.post('/subscription/webhook', express.raw({type:'application/json'}), handler)` at the *top* of `index.ts`, before both `express.json()` and `authMiddleware`. Add `processed_stripe_events(id text PRIMARY KEY, processed_at timestamptz)` and `INSERT … ON CONFLICT DO NOTHING`.

---

## G. Express middleware ordering (BoardRoom — load-bearing per CLAUDE.md)

```
  1. helmet()
  2. cors()                                  (open in dev — sec §B6)
  3. cookieParser()
  4. express.json()                          (default 100kb — sec §C4)
  ───── PUBLIC routes here MUST go above the wall ─────
  5. /health
  6. /auth/login, /auth/register
  7. /calendar/callback, /integrations/gmail/callback   ← SHOULD BE PUBLIC; currently behind wall
  8. /subscription/webhook                              ← SHOULD BE PUBLIC + raw body; currently broken
  ───── auth wall ─────
  9. authMiddleware (JWT)
  10. subscriptionMiddleware (FAILS-OPEN)
  ───── PROTECTED routes ─────
  11. /sessions, /context, /memories, /decisions, …
  12. SPA fallback (production only) — exclusion list ↦ /api/*, /health, /auth/*, etc.
  13. error handler (must be last; leaks err.message if NODE_ENV ≠ "production")
```

If you add a new top-level API route, add it to the SPA fallback exclusion list **and** decide which side of the auth wall it belongs on. The webhook + OAuth callback bugs are both "wrong side of wall" failures.

---

## H. Deployment / migration boot (per data-integrity-audit.md §A1)

```
  Railway redeploy (push to main, no CI gate)
    │
    ▼ Docker build (omnimind-api):
       ├─ rm -f tsconfig.tsbuildinfo
       ├─ tsc -p tsconfig.json
       ├─ Prisma client extracted from pnpm virtual store via `find`
       └─ pnpm deploy --legacy --prod
    │
    ▼ docker-entrypoint.sh:
       ├─ CREATE EXTENSION IF NOT EXISTS vector
       ├─ CREATE EXTENSION IF NOT EXISTS pg_trgm
       ├─ prisma db push --skip-generate --accept-data-loss   ⚠⚠⚠ LANDMINE
       │     • Prisma diffs schema.prisma vs live DB
       │     • Renaming a column → DROP old + ADD new → all data lost
       │     • Narrowing a type → DROP + recreate → data lost
       │     • Restored backup with extra columns → DROPPED on first boot
       │     • Six orphan 2025-04-12 migrations sit in tree but db push ignores history
       └─ node dist/index.js
```

**No baseline migration exists** (per data-integrity-audit.md §C1) — even if you wanted to switch to `prisma migrate deploy`, you can't, because there's nothing to roll forward from.

---

## I. The "what each box owns" matrix

| Concern | Lives in | Stateful piece | Multi-instance ready? |
|---|---|---|---|
| Persona dispatch | BoardRoom | none (per-request) | yes |
| SSE session map | BoardRoom | `sessions` Map | **no** — sticky required |
| Auth rate limit | BoardRoom | Map per IP | **no** — multiplies by N |
| Subscription cache | BoardRoom | none (re-fetched) | yes (but FAILS-OPEN) |
| OmniMind circuit breaker | BoardRoom | per-process state | **no** |
| Memory CRUD | OmniMind | none | yes |
| Embedding queue | OmniMind | `EmbeddingJob[]` | **no** — items lost |
| Validation pipeline | OmniMind | none | yes |
| Cortex cron | OmniMind | node-cron + jobs | **no** — duplicate fires |
| Rate limiter | OmniMind | Map per user | **no** |
| `redlock.ts` | OmniMind | in-process | **no** (and unused — DEAD-CODE) |
| Persistent state | Postgres | rows | yes |

Items marked "no" are the gates between us and horizontal scale. See [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md) §B (multi-instance unlocks) and the scalability audit §E.

---

## J. Cross-references

- The audit findings annotated above are all in [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md) (severity-ranked) and [`LANDMINES.md`](LANDMINES.md) (the hidden-risk subset).
- Capability descriptions (what each box does on a good day) live in [`CAPABILITIES-INVENTORY.md`](CAPABILITIES-INVENTORY.md).
- Dead/unused code referenced in the diagrams is catalogued in [`DEAD-CODE.md`](DEAD-CODE.md).
- The function-size and prompt-extraction tech debt called out in §G is in [`TECH-DEBT.md`](TECH-DEBT.md).
