# Current Phase

**Phase in flight:** Phase 0 — Foundation cleanup (IN PROGRESS)
**Active task (within current phase):** Task 0.1 — Archive scratchpads + gitignore editor files
**Last update:** 2026-04-18 (Phase 0 kickoff)
**Updated by:** Claude (Phase 0 execution session)

---

## What's actively being worked on

Nothing yet. The roadmap was just scaffolded and Wave 4 finished reconciling phase numbering, cross-references, and the canonical phase order. Phase 0 is the next thing to start.

## Next 5 actions (this week, <2 hours each)

These come from `04-roadmap/PHASE-0-foundation/tasks-and-prompts.md`. They build momentum without committing to anything irreversible.

1. **Archive scratchpads + gitignore editor files + commit clean status** (~30 min)
2. **Verify pgvector version on Railway** (~30 min)
3. **Sign up Better Stack/Axiom + wire log drain** (~90 min)
4. **Drop the `searchVector` dead column** (~45 min)
5. **Hand-label 10 retrieval queries from your own session history** (~60 min)

After this week: clean repo, known pgvector version, working log drain, no dead column, 10 labeled queries. Phase 0 essentially done. Phase 0.25 is the next stop (NEW per the security audit — see below). Phase 0.5 follows.

## About Phase 0.25 (NEW)

Phase 0.25 was added between Phase 0 and Phase 0.5 by the wave-1 audits. It bundles six **critical, exploitable-today** security and data fixes that the audits flagged as P0:

- **A1 — OAuth state hijack** (`security-audit.md` §A1): unsigned `state=userId` lets an attacker attach their Google tokens to any victim account.
- **A2 — Stripe webhook double-broken** (`security-audit.md` §A2 + `data-integrity-audit.md` §A4): raw-body break + auth-wall mount + no idempotency.
- **A3 — Mass-assignment on `PATCH /user-profile`** (`security-audit.md` §A3): no Zod schema, `data as any` straight into Prisma.
- **A4 — RLS facade deletion** (`security-audit.md` §A4): `db-audit.ts` exports `getPrismaClient` / `attachRLSClient` that nothing imports, with a wrong model list. Delete to remove false confidence.
- **A5 — `ENCRYPTION_KEY` fail-closed** (`security-audit.md` §A5): currently optional outside `production` → OAuth tokens silently in plaintext on env typo.
- **B1 — `MemoryEntry.version` race** (`data-integrity-audit.md` §B1): performative `version: { increment: 1 }` with no `where: { version: expected }` check — silent last-write-wins.

Phase 0.25 is ~16 hours of focused work (3 days), and the README at `04-roadmap/PHASE-0.25-critical-fixes/README.md` is the canonical spec. **A1, A2, A5 are exploitable today**, so Phase 0.25 is treated as a hard-prereq for Phase 1 (any schema work after Phase 0.25 is built on a defused foundation).

## Phase queue (canonical order)

```
Mem0 core:
Phase 0 → Phase 0.25 → Phase 0.5 → Phase 1 → Phase 2
(0.5w)   (~3 days)     (2w)        (1.5w)    (2.5w)

Phase 3 → Phase 4 → Phase 5a → Phase 5b
(1.5w)    (1w)       (2w)       (1w)

Phase 6 + 7a (parallel, 1w combined)
   ↓
Phase 9 (purge _disabled/, write ADRs) → Mem0 core DONE
   ↓
Make-it-10:
Phase 10 (MCP) → Phase 11 (Markdown) → Phase 12 (Webhooks) → Phase 13 (SDK) → Phase 14 (Observability) → Phase 17 (Persona marketplace, optional)
   ↓
Scale:
Phase 15 (Migration history) → Phase 16 (Cortex isolation) → Phase 18 (Resilience + multitenant fairness) → Phase 19 (Horizontal API scale)
```

DEFERRED until triggers fire: Phase 7b (outcome-weighted ranker), Phase 8 (cross-encoder reranker). See `04-roadmap/DEFERRED/` for triggers.

## Open decisions

These need user input before Phase 0 can complete:

1. **`searchVector` column** — delete (default) or convert to `GENERATED ALWAYS AS STORED`?
2. **`memoryType` enum** — confirm Phase 1 schema change with backfill heuristic
3. **LLM cost cap** — validator proposes $2/user/month + $50/day global. Adjust?

See `STATUS/BLOCKERS.md` for the full list.

---

**How to keep this file fresh:** Every session that picks up a task must update `Phase in flight` and `Active task (within current phase)` at the start of the session. Every session that ships a task must update `Active task` again at the end. This is the single fix for the executor-feasibility staleness bug from the Wave-3 review.
