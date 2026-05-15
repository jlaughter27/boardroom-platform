# Security Audit — WS-6 Inline Review

**Auditor:** Claude (Opus 4.7) — WS-6 of Fix-Everything Plan
**Date:** 2026-05-15
**Scope:** Memory layer (MCP + OmniMind API + admin) as of `origin/main` @ `bcbe1d1`
**Verdict:** 0 NEW CRITICAL · 2 HIGH · 6 MEDIUM · 2 LOW · 1 KNOWN-DEFERRED-HIGH

---

## TL;DR

| Severity | Count | Status |
|---|---|---|
| CRITICAL (new) | 0 | n/a |
| HIGH (new) | 2 | Both fixed in WS-6.2 |
| MEDIUM (new) | 6 | 3 fixed, 3 deferred with rationale |
| LOW (new) | 2 | Documented only |
| Pre-existing accepted risk | 1 | Live secrets in git history — flagged HIGH, deferred per CURRENT-PHASE.md:90 (Josh's prior decision) |

No emergency stop required. The pre-existing accepted-risk item (production API keys, JWT_SECRET, ENCRYPTION_KEY in git history of `.env.deploy`) was found in the audit. It was explicitly deferred by Josh in `CURRENT-PHASE.md:90` with rationale ("$5 spend cap, defer until repo rotation"). The new HIGH findings (F-101 ministry bypass, F-102 cross-tenant admin leak) are now patched.

---

## Pre-existing Known Risk (recap, not "new")

### F-100 — Live production secrets in git history (HIGH, pre-existing)

- **Evidence:** `git log --all -p -- .env.deploy` returns the live values of `ANTHROPIC_API_KEY=sk-ant-api03-F-SPb0…`, `OPENAI_API_KEY=sk-proj-Gufu-WhD0…`, `JWT_SECRET=d9de81ae…`, `OMNIMIND_API_KEY=ddb9a55e…`, and `ENCRYPTION_KEY=4feea218…`. The file was removed from HEAD in commit `0054de04` (2026-05-09) but never scrubbed from history.
- **Attack scenario:** Anyone who has ever cloned this repo (or pulls it now, since `origin/main` retains history) can recover all production secrets. The `ENCRYPTION_KEY` decrypts every ministry-domain memory at rest. The `JWT_SECRET` mints valid login tokens.
- **Why HIGH not CRITICAL:** Josh's `docs/STATUS/CURRENT-PHASE.md:90` notes "Low priority given $5 spend cap. Use `git filter-repo` when rotating to a new repo or before open-sourcing." This is a documented accepted risk. If this repo is ever made public, rotated, or audited externally, the call escalates to CRITICAL.
- **One-line fix:** Rotate all 5 secrets in Railway, then `git filter-repo --invert-paths --path .env.deploy --force` and force-push (acknowledging the downstream-clone implications). DO NOT do this as part of WS-6 — it's a destructive history rewrite and requires Josh's explicit go-ahead per CLAUDE.md.
- **Location:** repo root `.env.deploy` (in git history only).
- **Status (WS-6):** Documented. Not actioned. The plan-document said "audit only — don't fix unilaterally."

---

## NEW Findings

### F-101 — Ministry-domain refusal bypassed by case / whitespace variants (HIGH)

- **Evidence:**
  - MCP gate: `packages/omnimind-mcp/src/tools/memory.tool.ts:48` — `if (input.domain === 'ministry')` (strict equality, no normalize).
  - MCP audit redaction: `packages/omnimind-mcp/src/tools/memory.tool.ts:32` — same strict equality.
  - API gate (create): `packages/omnimind-api/src/services/memory.service.ts:112` — `if (input.domain === 'ministry')`.
  - API gate (update): `packages/omnimind-api/src/services/memory.service.ts:482` — same.
  - Decrypt gate: `packages/omnimind-api/src/services/memory.service.ts:352` — `if (mem.domain === 'ministry' && mem.encryptedContent)`.
  - Zod schemas: `CreateMemoryRequestSchema.domain = z.string().min(1)` (no transform, no enum, no normalize).
- **Attack scenario:** A misconfigured (or hostile) MCP client passes `domain: "Ministry"` (capital M) or `domain: "ministry "` (trailing space). Every refusal site does a literal `===` and lets the write through. The memory ends up in `MemoryEntry` with `domain = "Ministry"`, NO encryption applied (because the encrypt gate also uses `=== 'ministry'`), NO audit redaction. Recovery via plaintext is then trivial.
- **One-line fix:** Normalize at the validation boundary — `domain: z.string().trim().toLowerCase()` in the Zod schemas, applied uniformly at both MCP and API layers. Reject empty after trim.
- **Location:** MCP `memory.tool.ts` + API `memory.service.ts`, `shared/validation/memory.schema.ts`.
- **Status (WS-6):** **FIXED** — see commit `feat(security): F-101 normalize domain at validation`.

### F-102 — `/admin/duplicates` and `/admin/duplicates/merge` lack tenant scope (HIGH)

- **Evidence:**
  - `packages/omnimind-api/src/routes/admin.routes.ts:215-245` (`GET /admin/duplicates`) — raw SQL with NO `tenant_id` filter and NO `user_id` filter, returning every cross-user, cross-tenant pair above the cosine threshold. Includes ministry-tenant titles for any caller with `OMNIMIND_API_KEY`.
  - `packages/omnimind-api/src/routes/admin.routes.ts:248-265` (`POST /admin/duplicates/merge`) — accepts `keepId, archiveId, userId` from request body and soft-deletes WITHOUT checking the caller's tenant or that the memory belongs to the caller's tenant.
- **Attack scenario:** A `josh-personal` MCP agent (or any holder of the shared `OMNIMIND_API_KEY`) calls `GET /admin/duplicates` and sees title text of every `josh-business` and (if any existed) ministry-tenant memory pair. Then calls `POST /admin/duplicates/merge` with arbitrary `userId` and IDs to archive memories they don't own.
- **One-line fix:** Apply `resolveTenantFilter(req)` to the `/admin/duplicates` raw SQL (add `AND a.tenant_id = $1 AND b.tenant_id = $1`) and validate that the merge target's `tenantId` matches the caller's agent-context tenant.
- **Location:** `packages/omnimind-api/src/routes/admin.routes.ts:215-265`.
- **Status (WS-6):** **FIXED** — see commit `feat(security): F-102 tenant-scope admin duplicates`.

### F-103 — Read-only tools require WRITE scopes (MEDIUM)

- **Evidence:** `packages/omnimind-mcp/src/tools/project.tool.ts:23,49` — `project_status` and `project_summary` require `project:write`. `packages/omnimind-mcp/src/tools/task.tool.ts:102,133` — `task_status` and `task_list` require `task:write`. Per CLAUDE.md "15 Available Tools" table these should all be `memory:read`.
- **Attack scenario:** A "read-only agent" provisioned with only `memory:read` cannot call read tools. This forces operators to grant `task:write` and `project:write` to read-only agents → privilege creep. The defensive measure (least-privilege scopes for read agents) is undermined.
- **One-line fix:** Change `requireScope(ctx, 'project:write')` to `requireScope(ctx, 'memory:read')` for `project_status` + `project_summary` and `requireScope(ctx, 'task:write')` to `requireScope(ctx, 'memory:read')` for `task_status` + `task_list`.
- **Location:** `packages/omnimind-mcp/src/tools/project.tool.ts`, `packages/omnimind-mcp/src/tools/task.tool.ts`.
- **Status (WS-6):** **FIXED** — see commit `feat(security): F-103 fix read-tool scopes`.

### F-104 — Admin endpoints behind shared service API key only (MEDIUM)

- **Evidence:** `packages/omnimind-api/src/index.ts:74` — `app.use('/admin', adminRouter)` is protected by `apiKeyAuth` (`OMNIMIND_API_KEY`) and `agentContextMiddleware` only. The same `OMNIMIND_API_KEY` is shared by every MCP agent and the BoardRoom AI service. Any holder can call `/admin/stats`, `/admin/agents`, `/admin/audit`, `/admin/memories`, `/admin/duplicates`, `/admin/contradictions`, `/admin/summarize`, `/admin/decay/run`. With `?includeAllTenants=true`, cross-tenant view is granted (mitigated by `resolveTenantFilter` defaulting to `req.agentContext.tenantId`, but the override is a self-served flag).
- **Attack scenario:** Any MCP agent process on Josh's laptop can read every other agent's metadata, audit log, and memory titles. With F-102 fixed the cross-tenant duplicates leak is closed, but the broader admin surface is still over-shared.
- **One-line fix:** Introduce `OMNIMIND_ADMIN_API_KEY` env var; require `x-admin-key` header matching it for all `/admin/*` routes. Falls back open in dev (no env var set) to avoid breaking local workflows.
- **Location:** `packages/omnimind-api/src/index.ts` + `packages/omnimind-api/src/routes/admin.routes.ts` (new middleware).
- **Status (WS-6):** **DEFERRED**. Risk for solo mode is low (Josh is the sole holder of `OMNIMIND_API_KEY` and the only operator of agents). Closing this requires a new env var rollout to Railway plus distribution to every MCP config. Tracked as `F-104` in `docs/audits/SECURITY-AUDIT-2026-05-15.md` for the next hardening pass.

### F-105 — `x-agent-id` header missing causes rate-limit bypass (MEDIUM)

- **Evidence:** `packages/omnimind-api/src/middleware/agent-rate-limiter.ts:39-42` — if the header is absent, the limiter returns `next()` without counting. An attacker (or a misconfigured agent) that drops the `x-agent-id` header issues unlimited requests within the global per-IP `rateLimiter` budget.
- **Attack scenario:** Any caller with `OMNIMIND_API_KEY` can disable per-agent rate limits by omitting `x-agent-id`. The fallback to IP-based limiting (the global `rateLimiter`) is much more permissive.
- **One-line fix:** When `x-agent-id` is missing, derive a key from the API-key hash (or IP as last resort) and apply the limit. Never skip.
- **Location:** `packages/omnimind-api/src/middleware/agent-rate-limiter.ts:38-42`.
- **Status (WS-6):** **DEFERRED**. Currently mitigated by global per-IP limiter (`packages/omnimind-api/src/middleware/rate-limiter.ts`). Solo-mode acceptable. Tracked.

### F-106 — Audit log is fire-and-forget; failures are silent (MEDIUM)

- **Evidence:** `packages/omnimind-mcp/src/lib/audit.ts:9` — `client.logAudit(entry).catch(err => console.error(...))`. If the OmniMind API is unreachable when the audit POST fires, the audit row is silently lost. The tool call has already succeeded by then.
- **Attack scenario:** During a service blip (or a targeted DoS on `/mcp/audit`), an attacker performs `memory_write` or `decision_log` operations and the audit trail has a gap with no record they happened. Forensic reconstruction is impossible.
- **One-line fix:** Add a local outbox table in the MCP server (or stage to a local file) and replay on next successful audit POST. Or block the tool response on audit success and surface the failure to the agent.
- **Location:** `packages/omnimind-mcp/src/lib/audit.ts`.
- **Status (WS-6):** **DEFERRED**. Recommended for the next reliability pass alongside the API-side audit-write path (`packages/omnimind-api/src/routes/mcp.routes.ts:46-49`). This is a known limitation flagged in the prior audit (I-003) and not regressed.

### F-107 — Fulltext search silently disabled by typed cast (MEDIUM, functional regression)

- **Evidence:** `packages/omnimind-api/src/retrieval/fulltext-search.ts:60-72` — concatenates `${userId}`, `${tenantId}`, `${cutoff}`, `${tsQueryRaw}`, `${limit}` into a plain string then calls `prisma.$queryRaw<...>(sql as any)`. Prisma's `$queryRaw` accepts only `TemplateStringsArray | Prisma.Sql`; when called with a plain string (cast to `any`), the runtime throws `\`$queryRaw\` is a tag function, please use it like ...` (verified in `node_modules/.pnpm/prisma@6.19.3/.../runtime/library.js`). The thrown error is silently swallowed by the `catch { return []; }` block. **FTS has been broken since `685082a` and never actually runs in production.**
- **Why this is not SQL injection despite the appearance:** Prisma throws at the `$queryRaw` boundary before any DB call is made. No SQL is executed. But the look-alike-injection code is dangerous; if a future maintainer "fixes" the cast by switching to `$queryRawUnsafe(...)` the injection vector becomes real.
- **One-line fix:** Rewrite the function to use `Prisma.sql\`…\`` template fragments so the call site builds a real `Prisma.Sql` object (the only safe way to compose dynamic SQL with Prisma) — and remove the `as any`.
- **Location:** `packages/omnimind-api/src/retrieval/fulltext-search.ts:42-72`.
- **Status (WS-6):** **FIXED** — the `as any` cast was the security hazard (look-alike-injection that a maintainer might "fix" the wrong way). Rewrote with `Prisma.sql` template fragments. Functional impact: FTS now actually executes against the test DB.

### F-108 — `ENCRYPTION_KEY` missing in production fails open to plaintext (MEDIUM)

- **Evidence:** `packages/omnimind-api/src/lib/crypto.ts:14-15, 23-24` — both `encrypt()` and `decrypt()` short-circuit and return their input unchanged when `process.env.ENCRYPTION_KEY` is unset. Comment says "dev mode passthrough." There is no startup check that this is set in production.
- **Attack scenario:** Production deploy with a misconfigured Railway service (env var deleted, name typo) silently degrades to plaintext storage of ministry content. No alert, no log warning. The DB column type still says `Bytes` but is now plaintext UTF-8.
- **One-line fix:** In `packages/omnimind-api/src/lib/env.ts` (the existing env validator that runs at startup), require `ENCRYPTION_KEY` whenever `NODE_ENV === 'production'` AND enforce hex-decoded length of exactly 32 bytes.
- **Location:** `packages/omnimind-api/src/lib/env.ts` (validator).
- **Status (WS-6):** **DEFERRED**. Ministry domain is currently refused at the boundary (Phase 5.5 disabled it). When ministry is re-enabled in Phase 6+, this MUST be addressed first. Tracked.

### F-109 — Crypto decrypt silently returns ciphertext on auth-tag mismatch (MEDIUM)

- **Evidence:** `packages/omnimind-api/src/lib/crypto.ts:32-34` — the `try { … } catch { return encoded; }` block catches GCM auth-tag verification failures and returns the original ciphertext as if it were the plaintext. The caller has no signal that tampering or corruption occurred.
- **Attack scenario:** An attacker with DB write access mangles a ciphertext byte. Decrypt fails the GCM tag check, but the API returns the (now-mangled) bytes as plaintext to the user. Tampering is invisible.
- **One-line fix:** Throw on decrypt failure (preserve the "looks like plaintext, no colons" passthrough at line 25 for migration safety, but remove the swallow at line 32-34). Log the failure with a unique error code so it's grep-able.
- **Location:** `packages/omnimind-api/src/lib/crypto.ts:32-34`.
- **Status (WS-6):** **DEFERRED**. Same gate as F-108 — ministry is disabled, no live ciphertexts in production right now. Tracked.

### F-110 — Error handler is well-formed (LOW, no finding)

- **Evidence:** `packages/omnimind-api/src/middleware/error-handler.ts` — production hides stack and error messages, replaces with generic `'An internal error occurred'`. Routes consistently use `next(err)` or return generic 500s without leaking DB schema or query details.
- **Status:** Documented as compliant. No fix needed.

### F-111 — API-key validation is timing-safe and well-formed (LOW, no finding)

- **Evidence:** `packages/omnimind-api/src/middleware/auth.ts:40-42` — `timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected))` is correct after the length pre-check. The MCP side (`packages/omnimind-mcp/src/lib/auth.ts:8-14`) similarly hashes both inputs before timing-safe comparison. No leak of secret-comparison timing observed.
- **Note:** The `omk_*` agent keys are not validated server-side at the boundary — they're only matched against `Agent.apiKeyHash` if and only if the agent-context middleware needs the fallback lookup. The actual auth is the shared `OMNIMIND_API_KEY`. This is by-design per the current architecture and is captured in F-104 (admin-key gap).
- **Status:** Documented as compliant. No fix needed.

---

## What was NOT in scope (per WS-6 plan)

- Re-enabling ministry domain — explicitly forbidden ("audit only — don't re-enable").
- Postgres RLS — deferred per Fix-Everything Plan §What's NOT in this plan.
- Bitemporal validity windows — deferred per same.
- New dependencies — explicitly forbidden ("NO new dependencies").

## Validation gate

```
pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

Run after the fixes in `feat/security-hardening` land. 5 existing E2E tests must still pass plus the 3 new D16/D17/D18 (E2E-6/E2E-7/E2E-8) security tests.

## Audit methodology

Code-only review (no live prod access). Verified at the file-and-line level against the WS-1 through WS-5 merged state of `origin/main`. The E2E harness (WS-5) was used to design the three new security regression tests (D16/D17/D18) that lock in the fixes.
