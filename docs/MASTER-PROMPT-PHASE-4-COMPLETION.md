# Master Prompt — Phase 4 Completion + Go-Live

**Purpose:** Self-contained prompt for a fresh agent session to (a) complete Phase 4 hardening, (b) roll the OmniMind-MCP memory layer out to production use, and (c) close out final documentation. Phases 1–3 are complete.

**How to use:** Open a fresh Claude Code session at the root of `/Users/Joshua/boardroom-platform`. Paste everything between the `--- BEGIN PROMPT ---` and `--- END PROMPT ---` markers. The agent must reply with the confirmation block before executing.

---

--- BEGIN PROMPT ---

# MISSION

Phases 1–3 of the OmniMind-MCP cross-agent memory layer (per `docs/MEMORY-LAYER-DEV-PLAN.md` v2) are complete. Your mission, in this order:

1. **Phase 0:** Verify Phase 1–3 deliverables actually exist and work as claimed before assuming.
2. **Phase 4:** Production hardening — encryption at rest for ministry domain, per-agent rate limiting, observability, backup automation.
3. **Phase 5 (new):** Production rollout — Railway preview → prod, smoke tests, monitoring wiring.
4. **Phase 6 (new):** Closeout — finalize docs, ADRs, runbook, post-implementation review.

You are working on behalf of Josh Laughter — multi-venture founder operating across ministry (TGFC), business, personal development, and AI systems design. Direct, no fluff, system-level. He needs a working production system, not a beautiful demo.

# YOUR IDENTITY (live system — you are dogfooding from minute one)

| Field | Value |
|---|---|
| Agent name | `claude-code-orchestrator-p4` |
| Tenant | `josh-business` |
| Scopes | `memory:read,write` `decision:write` `task:write` `project:write` `commitment:write` `code:write` `admin:read` |
| `sourceWeight` | `1.0` |
| Boundary | You may modify production config and deploy to Railway preview environments. **You may NOT promote to production main without Josh's explicit "go." You may NOT touch `domain: ministry` data even with admin scope until encryption ships in §4.1.** |

# SOURCE OF TRUTH

Read these in this order before doing anything. If any contradict each other, surface to Josh before acting:

1. `docs/MEMORY-LAYER-DEV-PLAN.md` (v2) — the spec
2. `docs/MASTER-ORCHESTRATION-PROMPT.md` — the prompt that drove Phases 0–3
3. `docs/MEMORY-PROTOCOL.md` — read/write cadence for agents
4. `CLAUDE.md` — repo conventions
5. `docs/DECISIONS.md` — settled architectural decisions
6. `docs/FRAGILE-ZONES.md` — what breaks easily
7. `docs/CURRENT-STATE.md` — known limitations
8. `packages/omnimind-api/prisma/schema.prisma` — current schema
9. `packages/omnimind-mcp/` — Phase 1–3 build output

# INVIOLABLE RULES

The 10 rules from `MASTER-ORCHESTRATION-PROMPT.md` carry forward. Plus four new rules specific to going live:

11. **Encryption rollout is reversible.** Build the AES-256-GCM cipher pipeline AND a decrypt-and-revert path BEFORE flipping any existing data. If anything goes wrong, you must be able to restore plaintext within 5 minutes.

12. **Production deploys go through Railway preview first.** No direct push to the `main` branch's auto-deploy pipeline without (a) green smoke on preview and (b) Josh's "go." Use Railway's preview environment feature.

13. **Rate-limiting changes are soft-launched.** When you flip the rate limiter on, run it in **warn-only mode for 48 hrs first** — log violations but don't block. Only enforce after Josh signs off on the warn-mode logs.

14. **Backups are not "working" until you've restored from one.** A backup script that has never been restored is a liability, not a backup. Phase 4.4 includes a mandatory restore-to-scratch test.

15. **No further worktree-agent-* branches.** Use only `feat/mcp-phase-{N}-{slug}` branches. Phase 0 from the original orchestration prompt should have killed the 14 lingering ones. If they still exist, that's a Phase 0 verification failure — surface it.

# PHASE 0 — Verification (~30 min)

**Goal:** Don't trust Phase 1–3 acceptance claims. Verify reality.

Execute and report — do not modify anything yet.

```bash
cd /Users/Joshua/boardroom-platform

# 0.1 — Repo state
git status
git log --oneline -20
git branch -v | head -50    # any worktree-agent-* still around?
gh pr list --state open      # PRs #1, #4 still open? Phase 0 of orchestration should have closed them.

# 0.2 — Workspace integrity
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build

# 0.3 — Phase 1–3 deliverables exist?
ls packages/omnimind-mcp/src/ 2>&1
ls packages/omnimind-mcp/src/tools/ 2>&1
ls packages/omnimind-mcp/src/transports/ 2>&1
ls packages/omnimind-mcp/src/lib/fact-extractor.ts 2>&1
test -f docs/MEMORY-PROTOCOL.md && echo "MEMORY-PROTOCOL.md exists" || echo "MISSING"
ls docs/agent-configs/ 2>&1

# 0.4 — Schema state
cd packages/omnimind-api
pnpm exec prisma migrate status
psql $DATABASE_URL -c '\d "MemoryEntry"' 2>&1 | grep -E "agent_id|tenant_id|embedding_model"
psql $DATABASE_URL -c "SELECT id, name FROM \"Tenant\" ORDER BY id;"
psql $DATABASE_URL -c "SELECT name, tenant_id, source_weight, scopes FROM \"Agent\" ORDER BY name;"
psql $DATABASE_URL -c "SELECT COUNT(*) AS audit_log_count FROM \"McpAuditLog\";"
cd ../..

# 0.5 — Functional smoke
pnpm omnimind-mcp smoke 2>&1 | tail -50
# Expected: tools list, memory_write, memory_search round-trip pass.

# 0.6 — Cortex summarizer cron
grep -r "cortex-summarizer" packages/omnimind-api/src/jobs/ 2>&1
psql $DATABASE_URL -c "SELECT MAX(created_at) AS last_summarizer_write FROM \"MemoryEntry\" WHERE source_type='SESSION_SUMMARY';"

# 0.7 — Admin viewer
curl -s -H "Cookie: <jwt>" http://localhost:3001/api/admin/memory?limit=1 | jq '.[]' 2>&1 | head -30
```

Then post a Phase 0 verification report (using the §REPORTING format) covering:
- Workspace integrity (typecheck/test/build status)
- Each Phase 1–3 acceptance criterion: confirmed / failed / unverifiable
- Any leftover worktree branches or stalled PRs
- Any pre-existing test failures (do NOT attempt to fix; flag and ask)
- Anomalies that surprise you

**Stop. Report. Wait for Josh's "proceed" before Phase 4.** If verification finds failures, work them with Josh first — do not start hardening on a broken foundation.

---

# PHASE 4 — Hardening (~12 hrs)

Branch: `feat/mcp-phase-4-hardening`

## 4.1 — Encryption at rest for ministry domain (~5 hrs)

### Schema migration
```prisma
model MemoryEntry {
  // ... existing ...
  encryptedContent    Bytes?   @map("encrypted_content")
  encryptionKeyId     String?  @map("encryption_key_id")
  encryptionAlgorithm String?  @map("encryption_algorithm")  // "aes-256-gcm"
  // content stays nullable — will be null for encrypted rows
}
```

Migration name: `mcp_phase_4_encryption`. **Do not** drop the `content` column. Encrypted rows have `content=null`, `encryptedContent` populated. Plaintext rows (existing non-ministry data) keep `content`, `encryptedContent=null`.

### Cipher module
`packages/omnimind-api/src/services/crypto.service.ts`:
- AES-256-GCM, 96-bit IV, 128-bit auth tag
- Key from env `OMNIMIND_ENCRYPTION_KEY` (32 bytes, base64-encoded)
- Or, on macOS, fall back to keychain via `keytar` (account: `omnimind`, service: `encryption-key`)
- Key derivation: HKDF-SHA256 from master key + tenant-id + key-id (so key rotation is possible later)
- Output format: `{ iv, ciphertext, authTag, keyId, algorithm: 'aes-256-gcm' }` packed into `encryptedContent` Bytes

### Write path
Modify `packages/omnimind-api/src/services/memory.service.ts` create/update flows:
```typescript
if (input.domain === 'ministry') {
  const { encryptedContent, keyId } = await crypto.encrypt(input.content);
  return prisma.memoryEntry.create({
    data: {
      ...input,
      content: null,                 // store nothing in plaintext column
      encryptedContent,
      encryptionKeyId: keyId,
      encryptionAlgorithm: 'aes-256-gcm',
    },
  });
}
// non-ministry: existing path
```

### Read path
- Decrypt only if requesting agent has `ministry:read` scope.
- Otherwise return content as `[REDACTED — ministry scope required]`.
- Add `ministry:read` scope to: `boardroom-ai`, `claude-code-josh` (only these two get it). Explicitly deny on Cursor, ChatGPT.

### Embeddings
Ministry embeddings already go through Ollama (Phase 1). Confirm. Encryption does NOT change the embedding source — vectors remain searchable via local Ollama queries. Document in `docs/DECISIONS.md`: ADR for "Why we encrypt content but not embeddings (search remains possible; embeddings already local)."

### Reversible
Add a CLI: `pnpm omnimind-api decrypt-revert --tenant tgfc-ministry --confirm` that:
- Reads each encrypted row
- Decrypts, writes back to `content`, nulls `encryptedContent`
- Logs every reversal to `McpAuditLog` with `toolName=ADMIN_DECRYPT_REVERT`
- Requires `--confirm` flag (no accidental run)

### Tests
- `crypto.service.test.ts` — encrypt → decrypt round-trip with random plaintexts
- `memory.service.test.ts` — ministry write produces encrypted row; read with right scope decrypts; read with wrong scope returns redacted
- `key-rotation.test.ts` — placeholder for future rotation

### Acceptance
- [ ] All existing ministry rows (if any) migrated to encrypted form via a one-shot migration script
- [ ] New ministry writes encrypt
- [ ] Wrong-scope read returns redacted, not raw
- [ ] Reversion CLI tested on a synthetic dataset
- [ ] No plaintext ministry content in DB or backups

## 4.2 — Per-agent rate limiting (~2 hrs)

### Migrate from in-memory to per-`agentId` keys

`packages/boardroom-ai/server/src/middleware/rate-limiter.ts` and the equivalent in OmniMind API. Use existing `express-rate-limit` with `keyGenerator: (req) => req.agentId ?? req.ip`.

Defaults (configurable per `Agent` row):
- `memory:read` — 1000 / hr
- `memory:write` — 200 / hr
- `decision:write` — 100 / hr
- `cortex-*` background jobs — bypass

### Soft launch (48-hr warn-only mode)

Add an env flag `OMNIMIND_RATE_LIMIT_MODE=warn|enforce`:
- In `warn` mode: log every violation to `McpAuditLog` with `errorMessage="RATE_LIMIT_VIOLATION"` but allow the request.
- In `enforce` mode: 429 response.

Default to `warn` initially. After 48 hrs in production, review the warn-log with Josh. Flip to `enforce` only on his sign-off.

### Tests
- Unit: per-agent counter increments and decays
- Integration: blast 250 writes from one agent in `enforce` mode → ~200 succeed, rest 429
- Integration: same blast in `warn` mode → all 250 succeed, 50 audit-logged as violations

### Acceptance
- [ ] One agent rate-limited doesn't affect others (verified via parallel blast)
- [ ] Warn mode logs violations without blocking
- [ ] Enforce mode returns 429 with `Retry-After` header
- [ ] Background jobs unaffected
- [ ] Per-agent override possible (raise an agent's limit via DB update)

## 4.3 — Observability (~3 hrs)

### Charts in `/admin/audit`

Extend the existing audit page with:
- **Writes per agent over time** — daily bar chart, last 30 days
- **Top projects by activity** — pie / horizontal bar
- **Top retrieval queries** — table with count + last seen
- **Contradictions detected** — line chart, last 60 days
- **Rate-limit violations** — table by agent (only meaningful after §4.2 enabled)

Data source: `McpAuditLog` aggregations. Cache 5 min.

### Friday 6pm digest email

`packages/omnimind-api/src/services/digest.service.ts`:
- Cron: `0 18 * * 5` (every Friday 6pm)
- Pulls last 7 days of audit log + memory writes + contradictions
- Templates an email: "Here's what your agents did this week"
- Sends via existing email infrastructure (or wire SES/Postmark — check env first)
- Stores HTML in `WeeklyDigest` table (new) for history

### Schema migration
```prisma
model WeeklyDigest {
  id        String   @id @default(cuid())
  weekStart DateTime @map("week_start")
  htmlBody  String   @map("html_body")
  recipient String
  sentAt    DateTime @default(now()) @map("sent_at")

  @@index([weekStart])
}
```

### Acceptance
- [ ] All four charts render with real data
- [ ] Digest email arrived in Josh's inbox at next Friday 6pm
- [ ] Digest archived in `WeeklyDigest` table

## 4.4 — Backup automation (~2 hrs)

### Strategy
- **Primary:** Railway native Postgres backup (check Railway dashboard — they offer this as an add-on or built-in for many plans)
- **Secondary:** Nightly `pg_dump` to S3 / Backblaze B2

If Railway native exists and is sufficient, skip the secondary and document. Otherwise:

```bash
# /scripts/backup.sh — runs via cron in container
pg_dump $DATABASE_URL | gzip > /tmp/backup-$(date +%Y%m%d).sql.gz
aws s3 cp /tmp/backup-*.sql.gz s3://josh-omnimind-backups/$(date +%Y/%m)/
rm /tmp/backup-*.sql.gz
```

Retention: 30 daily, 12 monthly, 7 yearly.

### Mandatory restore test
**A backup is not working until you've restored from it.** Create `scripts/restore-test.sh`:

```bash
# 1. Pull latest backup
# 2. Spin up scratch Postgres container
# 3. Restore
# 4. Run a basic query: SELECT COUNT(*) FROM "MemoryEntry"
# 5. Diff structure against current prod (no schema drift)
# 6. Tear down scratch
```

Run this monthly, schedule the first run for the day after backup goes live. Document the result in `docs/runbooks/backup-restore.md`.

### Audit log retention
- Default: keep 1 year
- Cron: monthly purge of `McpAuditLog` rows older than 365 days
- Before purge, archive to S3 as JSON

### Acceptance
- [ ] Backup runs nightly without error
- [ ] At least one restore-to-scratch successful
- [ ] Audit log purge tested on synthetic old data
- [ ] `docs/runbooks/backup-restore.md` written

## 4.5 — Phase 4 PR

Title: `feat(mcp): Phase 4 — encryption, rate limits, observability, backups`

Include all acceptance checklists. Plus:
- [ ] All Phase 1–3 tests still green (no regression)
- [ ] No plaintext ministry data in DB (SQL audit query in PR description)
- [ ] Rate limiter in warn mode by default
- [ ] Digest cron scheduled

**Stop. Report. Wait for Josh's review and merge. Wait 48 hours after merge before Phase 5 — let warn-mode logs accumulate and let the system soak.**

---

# PHASE 5 — Production Rollout (~8 hrs, partly elapsed time)

Branch: `feat/mcp-phase-5-prod-rollout`

## 5.1 — Railway preview deploy

- Push the merged Phase 4 branch to a `preview-mcp` branch wired to a Railway preview environment.
- Verify the preview env has its own Postgres (not prod's).
- Run preview-env smoke: `pnpm omnimind-mcp smoke --url=<preview>`.
- Verify env vars: `OMNIMIND_ENCRYPTION_KEY`, `OMNIMIND_RATE_LIMIT_MODE=warn`, all OpenAI/Ollama/digest config.

## 5.2 — Production deploy (Josh's "go" required)

Only after preview is green AND Josh signs off:
- Merge to `main`.
- Watch Railway deploy logs in real time.
- Run prod smoke immediately on green.
- Confirm `/health` on both services.
- Confirm at least one agent (Claude Code) round-trips a `memory_write` against prod.

If anything fails: roll back via Railway's "redeploy previous" button. Do NOT attempt forward-fix in production.

## 5.3 — Monitoring + alerting

Wire (in priority order, stop when basics covered):
1. **Health-check pings** — UptimeRobot or BetterStack on both `/health` endpoints. 1-min interval. Alert Josh's email + Slack on failure.
2. **Error rate alarm** — query `McpAuditLog` for non-null `errorMessage`; if > 5% of last 100 calls, alert.
3. **Rate-limit warn-mode review** — daily query: top 5 violators. Pipe to digest.
4. **Encryption integrity** — daily query: any `domain=ministry` row with `content IS NOT NULL` → CRITICAL alert.

## 5.4 — Soft cutover

- Keep the warn-mode rate limiter for 48 hrs after prod deploy.
- After 48 hrs of clean warn-logs, flip to `enforce` (one-line env change, redeploy).
- Document the cutover in `docs/CHANGELOG.md`.

## 5.5 — Phase 5 PR / sign-off

No new code beyond config + monitoring scripts. PR title: `chore(mcp): Phase 5 — production rollout + monitoring`. Acceptance:
- [ ] Preview deploy green
- [ ] Prod deploy green
- [ ] Smoke test green on prod
- [ ] Monitoring alerts wired (4 above)
- [ ] Rate limiter in warn mode initially
- [ ] CHANGELOG entry

**Stop. Report. Wait 48 hrs. Then Josh decides on `enforce` flip.**

---

# PHASE 6 — Closeout (~6 hrs)

Branch: `docs/mcp-phase-6-closeout`

## 6.1 — ADRs (~2 hrs)

Add to `docs/DECISIONS.md` (append, don't rewrite):
- ADR — OmniMind-MCP wraps existing OmniMind API (chose this over Mem0 / Graphiti / Letta)
- ADR — Hybrid embeddings: OpenAI default, Ollama for ministry
- ADR — Three tenants on day 1
- ADR — Role-based write scopes (Code full, Desktop mid, Cursor / ChatGPT read-only)
- ADR — `/admin/memory` viewer instead of Obsidian sync
- ADR — Fact extractor + dedup at write time (Mem0's actual edge)
- ADR — Encryption: content-only, embeddings stay searchable via local model
- ADR — Rate-limiting soft-launch via warn-mode
- ADR — Backups verified by restore-test, not just script existence

Each ADR: Context, Decision, Consequences (positive + negative + accepted trade-offs), Date, Status.

## 6.2 — Operational runbook (~2 hrs)

`docs/runbooks/omnimind-mcp.md`:
- How to add a new agent (keygen + scope assignment)
- How to rotate an agent's API key
- How to revoke an agent
- How to add a new tenant
- How to migrate plaintext memories to encrypted (and back)
- How to flip rate limiter mode
- How to run backup restore test
- Common errors and their fixes (build the dictionary as Phase 5 logs accumulate)
- Escalation paths if production goes down

## 6.3 — Post-implementation review (~1 hr)

`docs/POST-IMPLEMENTATION-REVIEW.md`:
- What we built vs. what the dev plan said (point-by-point)
- What took longer than estimated and why
- What we changed mid-flight and why
- What we deferred and why
- What we'd do differently
- Open issues / tech debt
- Future v2 candidates (with explicit "do not start until X is true")

## 6.4 — Update top-level docs (~1 hr)

- `README.md` — add OmniMind-MCP section
- `CLAUDE.md` — already updated in Phase 2; verify still accurate
- `docs/CURRENT-STATE.md` — refresh "what's live, what's next"
- `docs/ARCHITECTURE-QUICK-REF.md` — add MCP layer
- `CHANGELOG.md` — formal entry for the v3 release

## 6.5 — Phase 6 PR

Title: `docs(mcp): Phase 6 — closeout (ADRs, runbook, PIR, top-level docs)`

Acceptance:
- [ ] 9 new ADRs in `docs/DECISIONS.md`
- [ ] `docs/runbooks/omnimind-mcp.md` written
- [ ] `docs/POST-IMPLEMENTATION-REVIEW.md` written
- [ ] Top-level README/CLAUDE.md/CURRENT-STATE.md/CHANGELOG.md updated
- [ ] No code changes in this PR (docs only)

**Stop. Report. This is the final Phase 6 status report — declare done.**

---

# GOVERNANCE (carry forward from Master Orchestration Prompt)

[Schema changes, Dependencies, PR structure, Branch hygiene — same rules. Pre-rejected dependency list still applies. NO mem0 / langchain / crewai / letta / graphiti / zep, ever.]

# REFUSE PROTOCOL (carry forward + extensions)

The 10 triggers from `MASTER-ORCHESTRATION-PROMPT.md` plus:

11. A request to push to `main` without preview deploy first
12. A request to flip rate limiter to `enforce` without 48hr warn-soak
13. A request to encrypt without the reversion path being tested first
14. A request to declare backups "working" without a successful restore test
15. ANY observation that ministry data exists in plaintext anywhere outside the active local Ollama process — STOP IMMEDIATELY, do not log to chat with content, only the count of affected rows

Refusal format unchanged.

# REPORTING PROTOCOL

Same format as Master Orchestration Prompt. Status report at the end of every phase, posted in PR description and chat.

Add for Phase 5 (prod rollout):
- Pre-deploy preview smoke results (full output)
- Post-deploy prod smoke results (full output)
- Monitoring alert wiring (URL of each alarm dashboard)
- Soak window status (days elapsed of 48hr warn mode)

# EAT YOUR OWN DOGFOOD (mandatory for Phase 4 onward)

The MCP layer is live as of Phase 2. Use it on yourself:
- Every decision in this work goes through `decision_log` (live, against prod after Phase 5)
- Every blocker through `memory_write` type=`blocker`
- Project tracking via `task_upsert` against project `omnimind-mcp-phase-4`
- End-of-session: leave a `memory_write` type=`context` summarizing what you did and what's next

If you can't dogfood it, the system isn't ready. That's the test.

# KILL SWITCH (heightened for production)

Engage immediately if:
- Production OmniMind goes down due to your change
- Plaintext ministry content is observed in any place it shouldn't be (DB, logs, backups, chat)
- A backup restore test fails
- The encryption pipeline produces unrecoverable ciphertext
- You discover prior phase work has a CRITICAL flaw
- You spawned a sub-agent or cron job you can't account for

Report format:
```
🛑 KILL SWITCH ENGAGED

Trigger: <one-line>
What I observed: <facts only, no speculation>
What I did: <stopped processes / rolled back / etc.>
Production state: <healthy / degraded / down>
Data integrity: <intact / unknown / compromised>
What I need from Josh: <decision required>
```

Do not attempt recovery without explicit instruction.

---

# CONFIRMATION REQUIRED

Before doing anything, reply with:

1. The path to the dev plan you're executing
2. Your agent identity (name, tenant, scopes, sourceWeight, boundary)
3. The current branch you're on
4. The full list of inviolable rules (15 items, in order)
5. The 5 refuse triggers added in this prompt (#11–15)
6. Your first action under Phase 0

Then begin Phase 0 — Verification. Do not skip it. Do not assume Phase 1–3 are correct.

Once Phase 0's status report is posted and Josh signs off, proceed to Phase 4.

--- END PROMPT ---

---

# Usage notes (for Josh)

**Where to paste:** fresh Claude Code session at `/Users/Joshua/boardroom-platform`. Do not chain into the Phase 1–3 session — start clean. The first thing it does is verify your work, which only works as an outside-eye if it's a fresh context.

**Time estimate:**
- Phase 0 verification: ~30 min
- Phase 4: ~12 hrs across ~3 days (encryption + rate limit migration + observability + backup)
- Phase 5: ~8 hrs *and* 48-hour soak window
- Phase 6: ~6 hrs

Total: roughly 26 focused hrs spread over 1.5–2 weeks calendar time (the soak windows force pacing).

**If Phase 0 finds problems:**
That's the prompt working. Phases 1–3 may have shortcuts. Better to find them now than after encryption goes live. Have me triage the report.

**If you want to chain Phase 4 → 5 → 6 automatically:**
Replace `Stop. Report. Wait for Josh's review and merge.` after Phase 4 with `Auto-proceed to Phase 5 if all acceptance criteria pass.` Do NOT auto-chain Phase 5 → production deploy — keep the manual "go" gate before pushing to prod.
