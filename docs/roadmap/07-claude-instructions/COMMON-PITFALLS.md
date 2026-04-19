# Common Pitfalls — Things New Claude Sessions Get Wrong

**Audience:** Claude (every new session).
**Purpose:** A catalog of the specific mistakes a fresh Claude session is most likely to make on this codebase. Each entry: the scenario, why it happens, how to detect it, how to prevent it.

If you find yourself about to do anything in this list, **stop and re-read the relevant docs first**.

---

## 1. Adding business logic to `packages/shared/`

**Scenario:** You're writing a utility that needs Prisma, an HTTP client, env vars, or anything stateful. You drop it in `packages/shared/src/utils/` because "it's used by both services."

**Why it happens:** Shared looks like a natural home for cross-cutting code. New Claude sessions don't immediately register that shared has zero runtime deps except `zod`.

**How to detect:** Open `packages/shared/package.json`. If the file you're adding needs anything beyond `zod`, it doesn't belong in shared.

**How to prevent:** Shared is for **types, Zod schemas, constants, pure utilities**. If it has I/O, state, or business logic, it goes in `packages/omnimind-api/src/` or `packages/boardroom-ai/server/src/`. See [`01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md) "Service boundaries". Cross-package logger and prompt-loader duplication exists today because someone moved business logic up; see audit items #22, #23 in [`code-quality-audit.md`](../../research/omnimind-roadmap-2026/wave1-audit/code-quality-audit.md).

---

## 2. Using global `prisma` instead of recognizing the RLS facade is unwired

**Scenario:** You need DB access, you import `prisma` from `lib/db.ts`, you ship it.

**Why it happens:** `db.ts` exports `prisma` (legacy global), `getPrismaClient(userId)` (RLS-scoped), `systemPrisma` (admin), and `attachRLSClient` middleware. The RLS-scoped path *looks* wired but **is not registered in `app.use`** anywhere in `src/index.ts`. Every active route uses the legacy global.

**How to detect:** `grep "attachRLSClient" packages/omnimind-api/src/index.ts` returns nothing. The Postgres ROW SECURITY policies in `20250412010000_add_row_security_policies` are the *only* RLS enforcement.

**How to prevent:** Either (a) follow the existing convention and use the global `prisma` (DB-layer RLS only), or (b) explicitly wire `attachRLSClient` middleware AND refactor every route to use `req.prisma`. Don't half-wire it. See audit item #4. If you're unsure which path the project chose, check `STATUS/DECISIONS-LOG.md` before changing the pattern.

---

## 3. Running `prisma db push` without checking the entrypoint

**Scenario:** You change `schema.prisma`, run `prisma db push`, see "schema updated", commit.

**Why it happens:** `db push` is the documented dev command. New Claude doesn't realize the **production entrypoint** (`packages/omnimind-api/docker-entrypoint.sh`) runs `prisma db push --skip-generate --accept-data-loss` on every deploy. Any column drop or type change in your local `db push` will replay against prod and **destroy data**.

**How to detect:** Read `packages/omnimind-api/docker-entrypoint.sh`. If you see `--accept-data-loss`, every schema change is loaded.

**How to prevent:** Until Phase 14 ships proper migration history, treat schema changes as **destructive by default**. See [`02-current-state/LANDMINES.md`](../02-current-state/LANDMINES.md) and [`06-risks-and-mitigations/DATA-RISKS.md`](../06-risks-and-mitigations/DATA-RISKS.md). Pull Phase 14 forward if you're touching schema. Never drop or rename columns without a backfill plan.

---

## 4. Embedding strings in `try/catch` and silently `next()`-ing

**Scenario:** You wrap a service call in `try { ... } catch (err) { next(err) }` and inline a `res.status(500).json({ error: 'something failed' })` for one specific code path. Or you call `loadPrompt('x')` inside a try/catch that falls back to a hardcoded prompt string.

**Why it happens:** "Defensive coding." Looks robust. Hides drift.

**How to detect:** Search for `readFileSync(resolve(__dirname, '../../../../docs/prompts/`. Three call sites today have inline prompt fallbacks (`gmail.service.ts:142`, `simulation.service.ts:49`, `llm-quality-scorer.service.ts:19`) — these are tech debt, not patterns to follow. See audit item #7 and #6.

**How to prevent:** Use the `prompt-loader.ts` `loadPrompt(id)` / `loadSystemPrompt(id)` API. If the markdown file is missing, **fail loudly at startup** rather than serving a stale string. CLAUDE.md rule 5 says prompts live in `docs/prompts/*.system.md` — there is no "fallback inline string" tier.

---

## 5. Mounting `express.json()` before `raw()` for webhooks

**Scenario:** You add a Stripe webhook route, mount it after the global `app.use(express.json())`. Stripe signature verification fails because the body has been re-serialized.

**Why it happens:** Express middleware order is load-bearing and not obvious. The default `express.json()` consumes the request body and leaves it as a parsed object — Stripe's signature check needs the raw bytes.

**How to detect:** If your webhook returns 400 with "No signatures found matching the expected signature" or similar, body parsing is the culprit.

**How to prevent:** Webhook routes that need raw bodies must be mounted **before** `express.json()`, with `express.raw({ type: 'application/json' })` applied to *that route specifically*. See the existing Stripe webhook setup in `packages/boardroom-ai/server/src/routes/` and the middleware ordering note in CLAUDE.md "Express Middleware Ordering". Don't rearrange the global middleware stack.

---

## 6. Missing `deletedAt: null` filters in cortex / new queries

**Scenario:** You write a new Prisma query in a cortex service: `prisma.memoryEntry.findMany({ where: { userId } })`. It returns 200 results in dev. In prod you start seeing soft-deleted memories surface in weekly memos.

**Why it happens:** Soft-delete is convention (ADR-006), not enforced by Prisma. New Claude sees the schema field, doesn't realize active queries elsewhere all include `deletedAt: null`.

**How to detect:** `grep -r "deletedAt" packages/omnimind-api/src/services/` — every service that reads soft-deletable entities filters explicitly. If your new query doesn't, it's a bug.

**How to prevent:** Whenever you query `MemoryEntry`, `Decision`, `Goal`, `Project`, `Task`, `Person`, or any link table, **add `deletedAt: null` to the where clause**. Treat it as a non-optional part of the query. Cortex jobs are especially exposed because they batch-process and a single missed filter can leak across all users at once.

---

## 7. Importing from `_disabled/` accidentally

**Scenario:** Your editor autocompletes an import path, you don't notice the `_disabled/` segment, you ship a PR that re-introduces dead code or links to a service that doesn't compile.

**Why it happens:** `tsconfig.json` excludes `_disabled/**` from typecheck (line 29-30 of `packages/omnimind-api/tsconfig.json`), so an import from `_disabled/` may not error in your editor but will fail at runtime — or worse, succeed if the file happens to compile.

**How to detect:** Before committing, `grep -r "from ['\"].*_disabled" packages/` should return zero results in `src/` and `server/src/`. Test imports are fine.

**How to prevent:** Never import from `_disabled/`. If you need code from there, the right fix is to un-quarantine it (rename the folder, remove from tsconfig exclude, add tests, write an ADR justifying the resurrection). The 25 quarantined files are scheduled for deletion in Phase 9 — don't add new dependencies on them.

---

## 8. Adding a new LLM provider "just for one feature"

**Scenario:** You need a feature that "would work better" with OpenAI, Voyage, or Google. You add the SDK, wrap it in an interface, ship it.

**Why it happens:** ADR-002 looks like a default that can be overridden. It cannot.

**How to detect:** `grep -r "@google-ai\|@openai/sdk\|voyageai" packages/`. The OpenAI SDK is in `packages/omnimind-api/package.json` for **embeddings only** (text-embedding-3-small per ADR-011). Any LLM call must use Anthropic.

**How to prevent:** ADR-002 says Anthropic-only until 5,000+ paying users. If you think you need another provider, the answer is "stop and write an ADR proposal" — not "ship it and ask later." See [`01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## 9. Bypassing Zod validation for "internal" data

**Scenario:** You're parsing data that came "from the database, so it's safe" or "from another service in our own infra, so we can trust it." You skip the Zod parse.

**Why it happens:** Validation feels like ceremony when both ends are yours.

**How to detect:** Any LLM output going to a user without `safeParse` is a CLAUDE.md rule 10 violation. Any HTTP boundary without Zod parse is an ADR-012 violation.

**How to prevent:** Zod at every boundary. The schema lives in `packages/shared/src/validation/`. If you're adding a new entity, add the schema first, then the type. They must match structurally.

---

## 10. Re-reading the entire codebase "to be safe"

**Scenario:** A user asks for a small change. You spend 50% of context budget reading 30 files "for background" before making a 10-line edit.

**Why it happens:** Anxiety about missing context. Default-thoroughness instinct.

**How to detect:** If you've read more than 5 files and still haven't started the task, you're over-loading.

**How to prevent:** Use [`CONTEXT-LOAD-ORDER.md`](CONTEXT-LOAD-ORDER.md). It tells you the 2-3 specific files for whatever task you're doing. If you genuinely need more, the load-order doc is wrong and should be updated — but the default is "trust the map." See also [`SESSION-START-CHECKLIST.md`](SESSION-START-CHECKLIST.md).

---

## 11. Writing prompts as TypeScript template literals

**Scenario:** You add a new persona or a new LLM-driven check. You inline the prompt as a `const PROMPT = \`You are...\`` at the top of the service file.

**Why it happens:** It's faster than creating a markdown file. The prompt feels "owned" by the code.

**How to detect:** `grep -rn "You are " packages/*/src/ packages/*/server/src/` will find inline prompts.

**How to prevent:** CLAUDE.md rule 5 / ADR-005: prompts live in `docs/prompts/{name}.system.md`. Load via `loadSystemPrompt('name')` from `prompt-loader.ts`. The one current violation (`QUALITY_EVALUATION_PROMPT` in `llm-quality-scorer.service.ts`) is logged as audit item #6 and scheduled for fix in Phase 9 / 0.

---

## 12. Skipping the STATUS/ updates because "the work was small"

**Scenario:** You make a 1-file change, run tests, commit. You don't touch `STATUS/` because the work felt minor.

**Why it happens:** Bookkeeping feels heavy relative to a small change.

**How to detect:** If your `git diff` is non-empty and `STATUS/CHANGELOG.md` is unchanged, you skipped it.

**How to prevent:** Every session ends with the [`SESSION-END-CHECKLIST.md`](SESSION-END-CHECKLIST.md). Even small work updates `BLOCKERS.md` if a blocker was resolved. Even no-code sessions update CHANGELOG with a research/planning entry. The next Claude needs to know what you did without reading commits.

---

## 13. Security incident triage — acute mode

**Scenario:** A user says "we just had a security incident" or "credentials may be leaked" or "a webhook is throwing 500s." This is **acute** mode, not planning mode — different routing applies.

**Why it happens:** The roadmap's risk catalog (`SECURITY-RISKS.md`) and landmines doc (`LANDMINES.md`) are organized for *planning* fixes, not for *executing* an incident response. A fresh Claude under time pressure will spin its wheels searching for a runbook that doesn't exist yet.

**How to detect:** User language includes "leaked," "exploited," "compromised," "auth bypass," "PII exposure," "production data loss," "OAuth tokens," "Stripe webhook," "credentials." Or: a third party (Stripe, Google, Anthropic) reports anomalous activity.

**How to prevent / what to do RIGHT NOW:**

1. **Do not write code reflexively.** Open `02-current-state/LANDMINES.md` and find the closest match in L1..L10. The "Scenario / Symptom / Blast radius / Fix" structure is your triage guide.
2. **Cross-reference `06-risks-and-mitigations/SECURITY-RISKS.md`** for the same defect's mitigation phase + residual-risk model. Use the cross-reference table at the top of `RISK-REGISTER.md` (Landmine ↔ KI ↔ Risk ID).
3. **Match the right acute-mode response per scenario:**
   - **OAuth tokens cross-leaked (L5/L7):** invalidate all `OAuthToken` rows for the affected user(s) → revoke Google access via Admin SDK → force re-auth. SECURITY-RISKS.md A.1 / A.5 is the planning-side fix.
   - **Stripe webhook silently failing (L6):** query Stripe for the last 24h events → reconcile against `Subscription` rows → alert affected paying users. The Phase 0.25 task 0.25.2 spec contains the back-fill script template.
   - **Memory contradiction in cortex output (prompt injection, SEC-007):** disable the cortex feature flag (`CORTEX_ENABLED=false` in Railway env) → audit prompt-injection envelope → force re-extraction.
   - **Plaintext OAuth tokens in DB (L7 detonation):** rotate `ENCRYPTION_KEY` → migrate-and-re-encrypt all `OAuthToken` rows → invalidate sessions. Phase 0.25 task 0.25.5 is the prevention.
4. **Open `STATUS/BLOCKERS.md`** with an `INCIDENT-N` entry tracking the response. **Do not** push code without updating it.
5. **After containment, add a postmortem entry** to `STATUS/CHANGELOG.md`. If the incident reveals a missing runbook, file a TODO to add it to a future `SECURITY-INCIDENT-RUNBOOK.md` (not yet written — see Wave 4 validator summary).

**Routing:** This pitfall is the canonical handler for CLAUDE-WORKFLOW.md task type **I** (Security incident triage).