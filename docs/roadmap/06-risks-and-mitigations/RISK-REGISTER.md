# Risk Register — Master List

**Wave 2 Builder 4 · Risks & Mitigations**
**Date:** 2026-04-18
**Sources:** Wave 1 audits (security[1], data-integrity[2], scalability[3], code-quality[4]); Wave 1 research (security best practices[5], ops scaling[6]); `docs/roadmap/01-foundations/CONSTRAINTS.md`; landmines tracked in `docs/roadmap/02-current-state/LANDMINES.md`.

**How to read this:**

- **Severity** — 1 catastrophic / 2 high / 3 medium / 4 low / 5 cosmetic
- **Likelihood** — low (<10% in 6 months) / med (10–50%) / high (>50%)
- **Impact** — low / med / high (revenue, trust, recovery cost)
- **Owner** — service-area owner; "platform" = both
- **Status** — open / mitigated / accepted (deliberately deferred)
- **Phase that fixes** — canonical phase number from `04-roadmap/`. The Wave-4 reconciliation remapped Builder 4's older "Phase 11/12/13/14" labels to the canonical phases. See the phase-number map in `04-roadmap/ROADMAP-OVERVIEW.md` for the legend.

Cross-reference detail: `SECURITY-RISKS.md`, `DATA-RISKS.md`, `COST-RISKS.md`, `OPERATIONAL-RISKS.md`, `6-MONTH-FORECAST.md`, `12-MONTH-FORECAST.md`. Landmines (already-tripped wires) live in `02-current-state/LANDMINES.md` with IDs **L1..L10** and are referenced by ID, not duplicated.

**Landmine ↔ KI ↔ Risk ID cross-reference (canonical mapping):**

| Defect | Landmine | KI ID | Risk row(s) |
|---|---|---|---|
| `db push --accept-data-loss` | L1 | KI-001 | DAT-001, DAT-003 |
| RLS facade | L2 | KI-008, KI-031 | SEC-004 |
| In-memory embedding queue loss | L3 | KI-002, KI-011 | DAT-002, DAT-006, OPS-005 |
| `MemoryEntry.version` race | L4 | KI-010, KI-021 | DAT-005, DAT-012 |
| OAuth state hijack | L5 | KI-004 | SEC-001 |
| Stripe webhook double-broken | L6 | KI-005 | SEC-002, DAT-004 |
| `ENCRYPTION_KEY` fall-through | L7 | KI-007 | SEC-005 |
| WeeklyMemo race / cron blocks loop | L8 | KI-016, KI-017, KI-023 | DAT-011, SCL-002, OPS-006 |
| OAuth refresh silently swallowed | L9 | KI-024 | DAT-015 |
| Subscription middleware fails-open | L10 | KI-009 | SEC-011 |

Footnote keys: [1] security-audit.md, [2] data-integrity-audit.md, [3] scalability-audit.md, [4] code-quality-audit.md, [5] 02-security-best-practices.md, [6] 01-ops-scaling.md.

---

## Section 1 — Security risks

### Severity 1 — Catastrophic

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-001 | 1 | security | OAuth callback hijack — `state` is unsigned userId, attacker can attach own Google tokens to any victim account[1 §A1] | med | high | 0.25 (task 0.25.1) | BoardRoom | open |
| SEC-002 | 1 | security | Stripe webhook unreachable AND signature verification broken — every event 401s or fails `constructEvent`[1 §A2] | high | high | 0.25 (task 0.25.2) | BoardRoom | open |

### Severity 2 — High

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-003 | 2 | security | Mass-assignment on `PATCH /user-profile` — no Zod, `data as any` straight into Prisma[1 §A3] | med | med | 0.25 (task 0.25.3) | OmniMind | open |
| SEC-004 | 2 | security | RLS proxy in `db-audit.ts` is a façade — never imported, model list is wrong, mutates caller args[1 §A4][4 §C item 4] | med | high | 0.25 (delete facade) + 18 (real RLS) | OmniMind | open |
| SEC-005 | 2 | security | `ENCRYPTION_KEY` optional in non-prod — OAuth tokens stored in plaintext on env-var misconfig[1 §A5] | med | high | 0.25 (task 0.25.5) | OmniMind | open |
| SEC-006 | 2 | security | Per-tenant LLM token budget does not exist — one user can burn $1500+/mo in Anthropic spend[3 §A row 10][5 §10] | high | high | 0.25 (initial cap) + 18 (full) | platform | open |
| SEC-007 | 2 | security | Prompt-injection scrub missing from memory validation pipeline — cortex personas read user-controlled text and pass it to Claude[5 §4] | med | med | 5a (extends validation pipeline) | OmniMind | open |
| SEC-008 | 2 | security | PII (phone numbers, emails, possibly secrets) embedded in pgvector — partial inversion attack viable per Morris et al. 2023[5 §5] | low | high | 18 | OmniMind | open |

### Severity 3 — Medium

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-009 | 3 | security | `/auth/user/:id` allows arbitrary user enumeration with API key only[1 §B1] | med | med | 9 (route hardening) | OmniMind | open |
| SEC-010 | 3 | security | `validateUserExists` middleware exists but is dead code — no defense-in-depth between API-key gate and Prisma[1 §B2] | med | med | 9 | OmniMind | open |
| SEC-011 | 3 | security | Subscription middleware fails open on **all** errors including 401/422 — paid features for free during outages[1 §B3][2 §A3][5 §10] | high | med | 18 (narrow catch with ADR-010 update) | BoardRoom | open |
| SEC-012 | 3 | security | Rate limiters in-memory; reset on every Railway redeploy = several brute-force windows/day[1 §B4][3 §E row 1][6 §9] | high | med | 18 (Postgres-backed) | platform | open |
| SEC-013 | 3 | security | SSE session store is unbounded in-memory; OOM under sustained POST volume[1 §B5] | med | med | 18 | BoardRoom | open |
| SEC-014 | 3 | security | Cortex `/scan` endpoints are open LLM-spend triggers — no per-user-per-day cap[1 §C3] | med | med | 18 (per-tenant cap enforces) | OmniMind | open |
| SEC-015 | 3 | security | Memory-entity links endpoint trusts `entityId` without ownership check — cross-user graph edges possible[1 §C2] | low | med | 9 (ownership check) | OmniMind | open |
| SEC-016 | 3 | security | JWT lacks `aud`/`iss` claims, no `kid` for rotation; secret rotation = global logout[1 §C1][5 §2] | med | med | 18 | BoardRoom | open |
| SEC-017 | 3 | security | OmniMind CORS wide open in dev (`cors()` no opts) — clickjacking surface if any debug UI lands[1 §B6] | low | low | 9 | OmniMind | open |
| SEC-018 | 3 | security | Logger leaks raw Prisma params (incl. `passwordHash`) in dev mode; staging misconfig = log-secret bleed[1 §B7][5 §8] | med | med | 9 | OmniMind | open |

### Severity 4 — Low

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-019 | 4 | security | Per-process circuit breaker on omnimind-client — N replicas → N× failures before opening[1 §C5] | low | low | 19 (shared breaker for horizontal scale) | BoardRoom | accepted |
| SEC-020 | 4 | security | `createMemory` lacks per-user-per-day quota cap at route layer — embedding spend drain path[1 §C6] | low | med | 18 (per-tenant fairness) | OmniMind | open |
| SEC-021 | 4 | security | No content-length guard on file-like endpoints; BoardRoom default 100kb may surprise on long sessions[1 §C4] | low | low | 9 | platform | open |
| SEC-022 | 4 | security | No SSO / no MFA — password + JWT only; first 10 enterprise convos will ask[1 §E item 8] | high | low (today) | DEFERRED (first SOC 2 / enterprise convo) | BoardRoom | accepted |

### Severity 5 — Cosmetic / Compliance-deferred

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-023 | 5 | security | No SOC 2 audit log table — required for CC7.2 once 10+ enterprise convos[1 §E item 1][5 §9] | low | low (today) | DEFERRED (first SOC 2 conversation) | platform | accepted |
| SEC-024 | 5 | security | No DSAR endpoint / hard-delete cron — GDPR Art. 15/17 blocker for first EU customer[1 §E item 2,6][5 §9] | low | low (today) | 18 (with RLS rollout — feature spec at 05-features-to-10/data-export-gdpr.md) | OmniMind | open |
| SEC-025 | 5 | security | Single Railway region, no data residency control — enterprise EU blocker[1 §E item 4] | low | low | DEFERRED (first EU enterprise customer) | platform | accepted |

---

## Section 2 — Data-integrity risks

### Severity 1 — Catastrophic

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| DAT-001 | 1 | data | `prisma db push --accept-data-loss` runs on every container boot — column rename = silent drop, restore-from-backup mutates schema[2 §A1] | high | high | 15 (Migration history) | OmniMind | open |
| DAT-002 | 1 | data | In-process embedding queue loses jobs on restart — created memory rows stuck `embedding IS NULL` forever[2 §A2][3 §E row 2][6 §3] | high | high | 1 (durability layer, with pg-boss-style queue) | OmniMind | open |
| DAT-003 | 1 | data | No baseline migration — any restore-from-backup cannot run `prisma migrate deploy`[2 §C1] | med | high | 15 | OmniMind | open |

### Severity 2 — High

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| DAT-004 | 2 | data | Stripe webhooks no idempotency / no signature replay protection / no reconciliation job[2 §A4][1 §A2] | high | high | 0.25 (task 0.25.2) | BoardRoom | open |
| DAT-005 | 2 | data | `MemoryEntry.version` is performative — `where` clause never includes expected version, two PATCHes silently last-write-wins[2 §B1] | med | med | 0.25 (task 0.25.6) | OmniMind | open |
| DAT-006 | 2 | data | Embedding write path has no failure observability — `getEmbeddingStatus` reports `'pending'` for both "not started" and "permanently failed"[2 §B2] | high | med | 1 (durability layer) + 14 (observability) | OmniMind | open |
| DAT-007 | 2 | data | Soft-delete is application-layer only and not cascading; `User` has no `deletedAt`, link tables leak ghosts[2 §B3][2 §D4] | high | med | 15 | OmniMind | open |
| DAT-008 | 2 | data | No GDPR / user-export endpoint; first DSAR = hand-written SQL[2 §C2][1 §E item 6][5 §9] | low | med | 18 (with RLS rollout) | OmniMind | open |
| DAT-009 | 2 | data | Backup strategy is "Railway does it" — no scripted dump, no documented RPO/RTO, restore never drilled[2 §C3][6 §7] | med | high | 0.5 (Backup drill) | platform | open |
| DAT-010 | 2 | data | Six 2025-04 orphan migrations with snake_case/camelCase mismatch — re-fire on next `migrate deploy`[2 §D1][4 §A4] | high | med | 15 | OmniMind | open |
| DAT-011 | 2 | data | `WeeklyMemo` lacks `@@unique([userId, weekStart])` — Sunday redeploy at 6:01 PM = duplicate memos[2 §B5][2 §D6] | med | med | 15 (constraint) + 16 (worker isolation) | OmniMind | open |

### Severity 3 — Medium

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| DAT-012 | 3 | data | `commitment.update` skips version increment — concurrent edits silently overwrite[2 §A5] | low | med | 0.25 (task 0.25.6 extends to commitments) | OmniMind | open |
| DAT-013 | 3 | data | Cortex services skip `deletedAt` filter on decision/commitment reads — stale memos cite trashed decisions[2 §B4] | high | low | 9 | OmniMind | open |
| DAT-014 | 3 | data | Cortex jobs not idempotent across restarts — `redlock.ts` is in-process only[2 §B5][3 §E row 4] | med | med | 16 (worker isolation) | OmniMind | open |
| DAT-015 | 3 | data | OAuth refresh failure absorbed silently — `getStatus()` reports "connected" forever; no `OAuthToken.error` column[2 §B6][1 §A1 follow-on] | high | med | 0.25 (foundation) + 14 (observability surfaces it) | BoardRoom | open |
| DAT-016 | 3 | data | `searchVector` column declared `Unsupported("tsvector")` but no migration creates it — `db push` allocates a NULL column[2 §B7][2 §D2][4 §A3] | high | low | 0 (drop the column) | OmniMind | open |

### Severity 4 — Low

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| DAT-017 | 4 | data | No restore-from-soft-delete UI — fat-fingered DELETE recoverable only via SQL[2 §C4] | low | low | DEFERRED (after-the-fact recovery is a real product capability — gate on demand) | OmniMind | accepted |
| DAT-018 | 4 | data | `MemoryEntry.supersededBy` declared, never written or read — dead column[2 §D3][4 §A2] | high | cosmetic | 15 | OmniMind | open |
| DAT-019 | 4 | data | `Decision` lacks `@@unique([userId, sessionId])` — concurrent create from same DecisionSession produces duplicates[2 §D5] | low | low | 15 | OmniMind | open |
| DAT-020 | 4 | data | Per-user data lookups don't use partial indexes consistently — `WHERE userId AND deletedAt IS NULL` walks full per-user index[2 §D7] | high | low | 19 (perf for horizontal scale) | OmniMind | open |

---

## Section 3 — Scalability / cost risks

### Severity 1–2 — High-impact ceilings

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SCL-001 | 2 | scale | Anthropic Sonnet 4.6 ITPM (Tier 2: 80k) saturates at ~4 concurrent decide-mode sessions = breaks at ~500 users[3 §B] | high | high | 0.25 (p-limit quick win) + 18 (per-key workload split) | platform | open |
| SCL-002 | 2 | scale | Cortex single-process loop blocks API event loop; 2000 users × 30s = 16.6h overlap, three weekly jobs collide[3 §B][3 §A row 5][6 §6] | high | high | 16 (Cortex isolation) | OmniMind | open |
| SCL-003 | 2 | scale | pgvector IVFFlat at `lists=100` degrades past 40k vectors; 400k vectors @ 2000 users → p95 400–800ms[3 §A row 3][3 §B] | med | med | 3 (HNSW migration) | OmniMind | open |
| SCL-004 | 2 | scale | Prisma connection pool default 10 saturates at 15 concurrent ops during cron/API overlap[3 §A row 2][6 §2] | high | med | 0.25 (Quick win) + 19 (PgBouncer in path) | OmniMind | open |
| SCL-005 | 2 | scale | Embedding write rate is sequential `for` loop; burst of 200 chunks = 80s[3 §A row 7][6 §5] | high | med | 1 (with durability layer; current code is dead per DEAD-CODE) | OmniMind | open |
| SCL-006 | 2 | cost | Per-tenant token budget absent — billing crisis trigger at 2000 users (1% bad actors × $1500/mo = $30k surprise)[3 §B] | high | high | 0.25 (initial cap) + 18 (full enforcement) | platform | open |

### Severity 3 — Medium

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SCL-007 | 3 | scale | Single Railway instance per service — no failover, no horizontal scale[CONSTRAINTS][3 §E][6 §1] | med | med | 19 | platform | open |
| SCL-008 | 3 | scale | Express throughput ~80 RPS/instance on 1 vCPU before p95 > 1s[3 §A row 1] | low | med | 19 | platform | open |
| SCL-009 | 3 | scale | Embedding queue depth grows with no backpressure; 5k jobs ≈ 80MB → 1GB RAM pressure[3 §A row 6] | low | med | 1 (durability layer with bounded queue) | OmniMind | open |
| SCL-010 | 3 | scale | DB connection starvation during cron — cron holds conns during Anthropic calls[3 §A row 14] | med | med | 16 (cortex isolation) | OmniMind | open |
| SCL-011 | 3 | cost | OpenAI embedding model deprecation forces re-embed of entire `MemoryEntry` table; no `embedding_model` column today to do per-row migration[2 §E2 Phase 3] | low | high | post-Phase 15 (per `embedding-model-versioning.md` feature spec) | OmniMind | open |

### Severity 4 — Low

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| SCL-012 | 4 | scale | Multi-tenant noisy neighbor — one 5k-memory user blocks event loop 90s during pattern run[3 §A row 16] | low | med | 16 (cortex isolation) | OmniMind | open |
| SCL-013 | 4 | scale | RAM under load reaches ~700MB at 500 users (rate Map + queue + Prisma + SSE)[3 §A row 12] | med | low | 18 (Postgres-backed rate limiter) + 19 (replicas) | platform | open |
| SCL-014 | 4 | cost | SSE bandwidth scales to 22 GB/mo @ 500 users × 5 sessions/day[3 §A row 13] | low | low | DEFERRED (low impact) | BoardRoom | accepted |
| SCL-015 | 4 | cost | Anthropic prompt-cache savings unrealized — static persona system prompts not sent with `cache_control`[3 §F][6 §10] | high | low | 14 (observability surfaces it) — fix opportunistically in Phase 9 | BoardRoom | open |

---

## Section 4 — Operational risks

### Severity 1–2 — High-impact

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| OPS-001 | 2 | operational | Single Railway instance per service — Anthropic outage or Railway region outage = product down (no fallback model per ADR-002)[CONSTRAINTS][3 §E] | med | high | DEFERRED (multi-region pricing decision) | platform | accepted |
| OPS-002 | 2 | operational | No alerting beyond health checks — failures discovered when users complain[CONSTRAINTS][6 §8] | high | high | 14 (Observability) | platform | open |
| OPS-003 | 2 | operational | JWT_SECRET rotation absent — single static secret, rotation = invalidate every active session[1 §C1][5 §2] | low | high | 18 | BoardRoom | open |
| OPS-004 | 2 | operational | Restore-from-backup never drilled — "Railway does daily snapshots" is theoretical[2 §C3][6 §7] | high | high | 0.5 (Backup drill) | platform | open |
| OPS-005 | 2 | operational | OpenAI embedding outage — embedding queue piles up in memory, deploys lose it (compounds DAT-002)[3 §A row 6] | low | high | 1 (durability layer) | OmniMind | open |

### Severity 3 — Medium

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| OPS-006 | 3 | operational | In-process queue + cron sharing API event loop — large JSON.parse blocks all requests[3 §A row 5][6 §6] | high | med | 16 (Cron worker isolation) | OmniMind | open |
| OPS-007 | 3 | operational | `OMNIMIND_API_URL` is the public Railway domain — service-to-service calls cross the internet[CONSTRAINTS] | med | med | 9 (operational hardening) — Railway private networking config | platform | open |
| OPS-008 | 3 | operational | No CI/CD gate — manual typecheck/test before push, broken builds reach `main`[CONSTRAINTS] | high | med | 18 (operational hardening) — bootstrap GitHub Actions | platform | open |
| OPS-009 | 3 | operational | Subscription cache absent — every protected request makes a synchronous OmniMind round-trip[1 §B3][5 §10] | high | low | 18 (with ADR-010 narrowing) | BoardRoom | open |
| OPS-010 | 3 | operational | Six 2025-04-12 orphan migrations create tables (`feature_flags`, audit, performance_monitoring, mem0_hybrid_search) no service writes to[4 §A4] | high | low | 15 | OmniMind | open |

### Severity 4 — Low

| ID | Sev | Cat | Title | Likelihood | Impact | Phase | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| OPS-011 | 4 | operational | Disabled `_disabled/` 13.6k LOC alongside live code; contributor confusion + accidental re-enable[4 §A1] | high | low | 9 (Phase 9 purge) | platform | open |
| OPS-012 | 4 | operational | Active-but-dead services (incremental-embedding, semantic-dedup, etc.) — 1.7k LOC[4 §A2] | high | low | 9 | platform | open |
| OPS-013 | 4 | operational | `package.json` scripts reference deleted paths (`test:integration`, `test:security`, `test:performance`, `test:rollback`) — fresh contributor breaks day one[4 §C item 3] | high | low | 9 | OmniMind | open |
| OPS-014 | 4 | operational | No incident postmortem template / runbooks for restore, embedding-drain, stripe-reconciliation, oauth-revoked, gdpr-export[2 §F items 1–10] | high | med | 14 (with observability) | platform | open |
| OPS-015 | 4 | operational | `prompt-loader.ts` exists in two places (omnimind-api + boardroom-ai) — divergence risk[4 §C item 22] | low | low | 9 | platform | open |
| OPS-016 | 4 | operational | `logger.ts` exists in two places — same shape problem[4 §C item 23] | low | low | 9 | platform | open |

---

## Section 5 — Landmines (already-tripped, see `02-current-state/LANDMINES.md`)

The landmines doc enumerates wires that have already detonated or been discovered live. They are not duplicated in this register — the table below cross-references them by ID and points to the controlling phase. If a landmine is also a forward risk (e.g. it can re-trip), it is listed above with a "see LANDMINE-X" note.

| Landmine | Risk row(s) above | Notes |
|---|---|---|
| L1 (`db push --accept-data-loss`) | DAT-001, DAT-003 | Already in production entrypoint, will detonate on next column rename |
| L2 (RLS façade) | SEC-004 | Cosmetic guarantee — discipline holds today; Phase 0.25 deletes facade, Phase 18 ships real RLS |
| L3 (in-memory embedding queue) | DAT-002, DAT-006, OPS-005 | Already losing jobs on every Railway redeploy |
| L4 (`MemoryEntry.version` race) | DAT-005, DAT-012 | Phase 0.25 ships `If-Match` enforcement |
| L5 (OAuth state hijack) | SEC-001 | Phase 0.25 task 0.25.1 |
| L6 (Stripe webhook broken) | SEC-002, DAT-004 | Subscriptions silently never transitioning; Phase 0.25 task 0.25.2 |
| L7 (`ENCRYPTION_KEY` fall-through) | SEC-005 | Phase 0.25 task 0.25.5 |
| L8 (WeeklyMemo race / cron blocks loop) | DAT-011, SCL-002, OPS-006 | Symptomatic at 100+ users with deep memory stores; Phase 15 (constraint) + Phase 16 (worker) |
| L9 (OAuth refresh silently swallowed) | DAT-015 | Phase 0.25 foundation, Phase 14 observability |
| L10 (Subscription middleware fails-open) | SEC-011 | Phase 18 narrows the catch |
| Orphan migrations (sub-finding, no L-ID) | DAT-010, OPS-010 | Will fire the moment we switch to `migrate deploy` — Phase 15 |
| Persona prompt-fallback drift (no L-ID — code-quality finding) | OPS-014 (need eval gates) | Inline-prompt fallbacks (`gmail.service.ts`, `simulation.service.ts`) silently drift[4 §C item 7] — Phase 9 |

---

## Section 6 — Risk-by-phase quick map (canonical numbering)

| Phase | Risks closed |
|---|---|
| **0 — Foundation cleanup** | DAT-016 (drop `searchVector`) |
| **0.25 — Critical fixes** | SEC-001, SEC-002, SEC-003, SEC-005, SEC-006 (initial cap), DAT-004, DAT-005, DAT-012, DAT-015 (foundation), SCL-001 (p-limit), SCL-004 (connection_limit), SCL-006 (initial cap); also deletes the L2 facade per task 0.25.4 (SEC-004 partial) |
| **0.5 — Eval harness** | DAT-009, OPS-004 (backup drill) |
| **1 — Schema alignment + durability** | DAT-002, DAT-006 (durability layer), SCL-005, SCL-009, OPS-005 |
| **3 — HNSW + RRF** | SCL-003 |
| **5a/5b — LLM augmentation/consolidation** | SEC-007 (extends validation pipeline) |
| **9 — Purge + standardize** | SEC-009, SEC-010, SEC-015, SEC-017, SEC-018, SEC-021, DAT-013, OPS-007, OPS-011, OPS-012, OPS-013, OPS-015, OPS-016 |
| **14 — Observability suite** | DAT-006 (visibility), DAT-015 (visibility), SCL-015 (cache visibility), OPS-002, OPS-014 |
| **15 — Migration history** | DAT-001, DAT-003, DAT-007, DAT-010, DAT-011 (constraint), DAT-018, DAT-019, OPS-010 |
| **16 — Cortex isolation** | DAT-011 (worker isolation), DAT-014, SCL-002, SCL-010, SCL-012, OPS-006 |
| **18 — Resilience + multitenant fairness** | SEC-004 (real RLS), SEC-006 (full enforcement), SEC-008, SEC-011, SEC-012, SEC-013, SEC-014, SEC-016, SEC-020, SEC-024, DAT-008, OPS-003, OPS-008, OPS-009, SCL-013 |
| **19 — Horizontal API scale** | DAT-020, SEC-019, SCL-007, SCL-008, SCL-013 (replicas) |
| **DEFERRED / accepted** | SEC-022, SEC-023, SEC-025, DAT-017, SCL-014, SCL-011 (post-Phase 15 per embedding-model-versioning spec), OPS-001 |

---

## Section 7 — Owner summary

| Owner | Open risks |
|---|---|
| **OmniMind** | 36 |
| **BoardRoom** | 11 |
| **Platform** (both) | 14 |
| **Accepted** (no fix) | 7 |

Total tracked: **68** risks across 5 categories, mapped to 4 implementation phases plus accepted-residual.

---

**End of register.** Detail and recovery plans live in the companion docs in this folder.
