# 6-Month Forecast — What Breaks if We Don't Ship the Roadmap

**Wave 2 Builder 4 · Risks & Mitigations**
**Date:** 2026-04-18 (Wave 4 reconciliation note: phase numbers in body text may use the older Builder 4 scheme; canonical mapping is in `RISK-REGISTER.md` Section 6)
**Horizon:** April 2026 → October 2026
**Posture:** Pre-PMF, growing from <100 active users to ~500 active users, single Railway instance per service, no CI gate, no alerting beyond `/health`.

This is a top-10 list of scenarios that the audits and research project as the **likely** failure modes between now and October 2026. Each entry names the trigger, the symptom the user actually sees, the blast radius, the phase that closes the risk, and an honest recovery time.

Cross-reference: `RISK-REGISTER.md` for full risk IDs (canonical phase numbers); `12-MONTH-FORECAST.md` for what comes next.

> **Phase-number translation key:** see `RISK-REGISTER.md` header — Builder 4's "Phase 11/12/13/14" labels map to canonical Phase 0.25/14/15/16/18/19 per the table in `04-roadmap/ROADMAP-OVERVIEW.md`.

---

## Scenario 1 — Stripe webhooks silently fail; revenue leaks for weeks

**Risks:** SEC-002, DAT-004
**Probability:** **>90%** (already happening today per security-audit §A2 and data-integrity §A4)
**Trigger:** Any Stripe event — `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`. Two compounding bugs make the webhook unreachable AND, if it were reachable, signature verification would throw because `express.json()` consumed the raw body.

**Symptom (user-visible):**
- New paying user completes Stripe Checkout, returns to BoardRoom, still sees "Free Trial" badge.
- After the 14-day trial, paying user gets cut off mid-session ("Subscribe to continue").
- Cancellation requests don't downgrade — refund disputes follow.

**Blast radius:** Every paying user, retroactively. Trust damage on first 50 paying customers is the worst possible time to take it.

**Fix:** Phase 12 (Hardening). 1 hour code + ~2 hours back-fill from Stripe API + idempotency table.

**Recovery time:** Bug fix is fast (< 1 day). Reconciliation script for affected accounts: ~1 day per 100 users. **Reputational recovery: months.** First-customer trust is hard to re-earn after a billing screw-up.

---

## Scenario 2 — OAuth state hijack incident — attacker reads victim's Gmail

**Risks:** SEC-001, DAT-015
**Probability:** **15–25%** (low motivated-attacker bar, but obscure path)
**Trigger:** Attacker discovers a userId (CUID enumeration via `/auth/user/:id` SEC-009, leaked in shared room URL, or social engineering). Hand-crafts callback URL with attacker's own Google `code` and victim's userId in `state`. Victim's `OAuthToken` row gets the **attacker's** Google tokens.

**Symptom:** Victim opens BoardRoom Gmail integration, sees the attacker's inbox content. Attacker's inbox content gets fed to memory-extractor → Cortex memos start citing attacker-controlled "memories." Victim thinks they're hallucinating.

**Blast radius:** Per-user. Combined with SEC-009 user enumeration, attacker can target known users (founders are public). One incident = security advisory + potential disclosure obligations under state breach laws (CA, NY, MA).

**Fix:** Phase 12. Sign the `state` parameter as a 5-min JWT containing `userId + nonce`. Move callback handlers above the auth wall. Add Redis-or-DB nonce table to prevent code replay. **3 hours.**

**Recovery time:** Patch + force-disconnect-all-OAuth-tokens: 1 day. Discovery-to-fix window if the attack happens before the fix: indefinite — there is no signal in logs today that this is happening. **Detection lag is the worst part.**

---

## Scenario 3 — `prisma db push --accept-data-loss` drops a column on deploy

**Risks:** DAT-001, DAT-003
**Probability:** **40–60%** in a 6-month window with active schema work
**Trigger:** Any schema rename, type narrow, or removed-then-re-added column. The container entrypoint hardcodes `--accept-data-loss`. A teammate's local rename gets pushed to `main`, Railway redeploys, Prisma silently drops the old column.

**Symptom (user-visible):** Memories with content in the affected column return blank or null. UI may render OK but cortex outputs deteriorate. Specific case worth highlighting: removing the ghost `searchVector` column from schema (DAT-016) → `db push` drops it → if any future migration relied on it, FTS retrieval breaks.

**Blast radius:** Every user, every memory. Recovery requires **a backup restore that has never been drilled** (DAT-009, OPS-004). And the restore itself triggers `db push` on first boot of the restored DB — which can mutate the restored schema.

**Fix:** Phase 14 (Migration history). Generate baseline init migration, switch entrypoint to `migrate deploy`, gate `db push` behind dev-only env flag.

**Recovery time:** With backups: 4–8 hours assuming the snapshot exists and is < 24h old. Without confidence in backups: **days, with permanent partial data loss likely.**

---

## Scenario 4 — Embedding queue silent loss — memories never become searchable

**Risks:** DAT-002, DAT-006, OPS-005
**Probability:** **>95%** (happens every Railway deploy, multiple times a day)
**Trigger:** Any container restart between memory create and embedding generation (1–60s window). The in-memory `queue: EmbeddingJob[] = []` array is just thrown away.

**Symptom (user-visible):** User saves a memory, asks the next persona about it, gets "I don't see anything related" because semantic search misses memories with `embedding IS NULL`. FTS catches some content; trigram catches typos; semantic — the smartest layer — misses entirely. **No error is shown.** `getEmbeddingStatus` reports `'pending'` whether the embed is queued, dropped, or permanently failed.

**Blast radius:** Every memory created in the lossy window. Power users (most memories per day) are most affected. Cortex memos will reference older memories disproportionately.

**Fix:** Phase 11 (Persistent queue). Add `embedding_status` enum + `embedding_attempts` + `embedding_last_error` columns; on boot, sweep `WHERE embedding IS NULL AND status='pending'` and re-enqueue. Phase 13 swap to `pg-boss` or `graphile-worker` for true durability.

**Recovery time:** Backfill cron can re-enqueue in hours. **But until the schema columns land, you cannot tell which memories were dropped.** First-time backfill at 100-user scale: ~10 minutes of OpenAI calls; at 500-user scale: ~$3 + 30 minutes.

---

## Scenario 5 — Cortex weekly job blocks the API event loop on Sunday evening

**Risks:** SCL-002, OPS-006, DAT-014
**Probability:** **>70%** by month 3
**Trigger:** Sunday 6 PM cron fires `cortex-memo` for every user sequentially in the same Node process as the API. As power users grow memory stores past ~500 entries, JSON.parse on the full memory set blocks the event loop ~150ms per user.

**Symptom (user-visible):** Sunday 6 PM–9 PM, the app feels slow. SSE streams stall mid-persona. Browser shows "Reconnecting..." Some sessions die. Users assume "they're doing maintenance."

**Blast radius:** Every active user during the 3-hour window. Worst case at 500 users: API is unusable for an entire evening, weekly.

**Fix:** Phase 13 (Cron worker isolation). Spin up `omnimind-cron` as a second Railway service (~$10/mo). Same monorepo, separate Dockerfile entrypoint. Drains the same Postgres job queue, but its event loop is its own.

**Recovery time:** None needed if caught early. If the bad UX persists into the first 100 paying users, refunds + churn = real revenue. **The fix is mechanically simple but requires Phase 11 (persistent queue) to land first.**

---

## Scenario 6 — One bad actor burns $1500+/mo in Anthropic spend

**Risks:** SEC-006, SCL-006, SCL-001, SEC-014
**Probability:** **30–40%** if any growth experiment runs (Product Hunt, viral X post)
**Trigger:** Authenticated user (or trial-abuser registering 50 accounts) hits Cortex `/scan` endpoints in a loop. Each scan = 38 Haiku calls. 100 scans in a day per account = $5–15 in spend. 50 accounts = $250–750/day. **No per-user-per-day cap exists.**

**Symptom (user-visible):** Honest users see degraded latency as Anthropic's RPM throttles kick in (SCL-001 triggers earlier under attack). Founder sees the Anthropic invoice.

**Blast radius:** Anthropic bill, not user data. But the bill alone can extinguish runway — at 40% gross margin a $1500 surprise eats a month of revenue from 100 paying users.

**Fix:** Phase 11 (Cost controls). Per-tenant `LlmUsage` table tracking input/output tokens × current price. Reject when daily $-spend exceeds plan cap. Account-level Anthropic Console usage limit as panic-button backstop. **1 day of work.**

**Recovery time:** Anthropic billing supports usage limits — set a hard cap immediately. Refund? Anthropic may or may not credit at their discretion. **Assume no refund, assume the loss.** Reputation: nil if you spot it within a week.

---

## Scenario 7 — Anthropic Sonnet 4.6 ITPM cap saturates at ~500 users

**Risks:** SCL-001, OPS-001
**Probability:** **High by month 4–5** if MAU growth is on plan
**Trigger:** 7-persona dispatch + ~3 KB context per persona = ~21k input tokens per decide-mode session. Anthropic Tier 2 limit: 80k ITPM. Four simultaneous decide sessions = saturated.

**Symptom (user-visible):** "Service unavailable, please retry" mid-session. Persona outputs hang. SSE streams die. Some users see partial responses (Optimist OK, Critic times out).

**Blast radius:** Every concurrent user. Probability of co-occurring decide sessions rises with WAUs squared.

**Fix:** Phase 11 — apply for Anthropic Tier 3/4 deposit early. Add `p-limit(20)` around Sonnet client to smooth bursts. Phase 13 — split keys by workload (cortex on a separate key from interactive sessions).

**Recovery time:** Tier upgrade is fast (deposit + email). `p-limit` change: 1 hour. **The risk is forgetting to upgrade before the spike, then explaining "the AI is rate-limited" to early adopters.**

---

## Scenario 8 — RLS façade discovered after an enterprise sales call

**Risks:** SEC-004
**Probability:** **20–30%** if any enterprise lead reads the schema
**Trigger:** Enterprise prospect asks "do you have row-level security?" The answer in `CLAUDE.md` and `db-audit.ts` says yes. The reality (audit §A4) is no — `getPrismaClient(userId)` is exported but never called; the model list is wrong; the proxy mutates caller args. Discovery happens during a security-questionnaire response or a demo-environment probe.

**Symptom:** Founder gives an honest answer ("we have application-layer filters; the RLS proxy is not yet wired") and loses the deal. Or gives a misleading answer and loses the deal twice — once to the question, once to discovery.

**Blast radius:** Per-deal. No data is actually exposed today (route-level discipline holds). The risk is reputational + sales.

**Fix:** Phase 13 (RLS rollout). Real Postgres `ENABLE ROW LEVEL SECURITY` policies on all user-scoped tables. Per-request `SET LOCAL app.user_id = $1` inside a transaction wrapper. Documented as the *backstop*, not the primary, of which the route-level filter remains the actual enforcement.

**Recovery time:** Deletion of the false-confidence façade: 30 min. Real RLS rollout: 3–5 days. **Sales-cycle damage from a discovered façade: months.**

---

## Scenario 9 — Encryption key fallthrough discovered after a breach

**Risks:** SEC-005
**Probability:** **5–15%** (requires breach + env-var typo combo)
**Trigger:** Two events. (1) `ENCRYPTION_KEY` env var typo on a Railway redeploy → `getKey()` returns 32 zero bytes → crypto silently passes through plaintext. (2) Postgres backup leaks via account compromise, or any SQL access. OAuth tokens read as plaintext = account takeover for every connected Google account.

**Symptom:** Disclosure obligation under state breach laws (CA, NY, MA) within 60–72 hours of confirming PII exposure. Customers receive breach notices. Press cycle.

**Blast radius:** Every connected Google/Gmail OAuth user (Phase 3 integration users). At 500 users with ~30% integration adoption, ~150 accounts disclosed.

**Fix:** Phase 12 (Hardening). Make `ENCRYPTION_KEY` required in **all** environments (crash on startup if missing). Remove the dev passthrough. Replace silent decrypt failures with explicit throws. **1 hour.**

**Recovery time:** Patch: 1 hour. Disclosure: weeks of legal + comms work. **A 1-hour fix preventing a 60-day disclosure circus is the highest-ROI security work in the book.**

---

## Scenario 10 — `MemoryEntry.version` race causes lost updates discovered by power user

**Risks:** DAT-005, DAT-012
**Probability:** **>50%** at 200+ users with multi-tab usage
**Trigger:** User opens the same memory in two browser tabs, edits both, saves both. `version: { increment: 1 }` runs without `where: { version: expected }` — second write silently overwrites the first.

**Symptom (user-visible):** "I just edited that, where did my changes go?" Power user posts on Twitter. Other power users start checking for the same.

**Blast radius:** Per-user, per-edit-conflict. Cumulatively erodes "the system is reliable" trust.

**Fix:** Phase 11. Implement real optimistic concurrency: `If-Match: <version>` header → `prisma.memoryEntry.update({ where: { id, version: expected } })` → P2025 → 409 Conflict response. Same pattern across `decision`, `entity`, `commitment`. **2–3 hours per service.**

**Recovery time:** No recovery for already-lost updates. Going forward: instant once shipped. **The memory store is the product's moat — silent data loss here is fatal to trust.**

---

## Top-3 priority order (if we ship nothing else by October 2026)

1. **Phase 11 cost & queue & observability** closes Scenarios 4, 6, 7, 10. Without it, the platform either bleeds money (#6), bleeds memories (#4, #10), or bleeds users to performance complaints (#7).
2. **Phase 12 hardening** closes Scenarios 1, 2, 9. Each is a low-frequency, high-blast-radius event whose patch costs hours but whose untreated form costs months.
3. **Phase 13 RLS + cron isolation + GDPR** closes Scenarios 5, 8. These pay back in sales motion (#8) and stable evening UX (#5).

Phase 14 (migration history, HNSW, multi-instance enablers) is **scenario 3's only real fix**, but the probability is low enough in a 6-month window that it sits behind 11–13.

---

## What we are explicitly accepting in the 6-month window

- **OPS-001 (single-instance failover risk)** — accepted; cost of multi-instance pre-Phase 14 (cron-duplication, queue-loss multiplication) exceeds the cost of an hour-long Railway region outage at <500 users.
- **SEC-022 (no SSO/MFA)** — accepted; first 10 enterprise convos may ask, but no paying user will refuse a deal over it in this window.
- **SCL-014 (SSE bandwidth at 22 GB/mo)** — accepted; well within Railway Pro tier.
- **DAT-017 (no soft-delete restore UI)** — accepted; SQL is enough recovery for 100-500 user scale.

These are the ones we deliberately leave on the field. Everything else has a phase.

---

**Word count: ~1,500.**
