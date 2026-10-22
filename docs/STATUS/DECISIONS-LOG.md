# Decisions Log

Append-only log of architectural / process decisions made while executing the roadmap. Most recent at top.

Format:
```
## YYYY-MM-DD — DEC-N — Title
**Decision:** What was decided
**Rationale:** Why
**Source:** Who/what (user, ADR, agent pipeline)
**Reversibility:** HIGH / MED / LOW
```

---

## 2026-10-22 — DEC-004 — Phase triage for roadmap phases 10–19 and a do-not-build list (Phase 8, M0-D2)

**Decision:** Each memory-system roadmap phase 10–19 (`docs/roadmap/04-roadmap/`) gets one status for the length of Phase 8 (`docs/roadmap/PHASE-8-ROADMAP.md`, 2026-10-22 → 2026-12-16). Keep: the Phase 10 remainder and the Phase 14 minimum. Shrink: Phase 11, to a one-shot export (M4-B1). Park with triggers: 12, 13, 16, 18, 19. Kill for now: 17. Phase 15 shipped. Nothing parked or killed is built until its trigger fires **and** the M4-F1 dogfood verdict (or a later DECISIONS-LOG entry) unparks it.

| Phase | Status | What that means in Phase 8 | Trigger |
|---|---|---|---|
| 10 — Memory MCP server | **Keep** (remainder) | The core shipped in Phase 7 (PR #21, `77607bf`). The remainder is scheduled: launch (M1-F1), tenant-safe entity tools (ADR-017: M1-B0 → M1-B4 → M1-B1, E2E-9), OAuth issuer (ADR-016: M1-F6, M2-A2, M2-F1). Connector Directory submission is not scheduled. | Scheduled now. Connector Directory submission: the M4-F1 verdict choosing memory-first. |
| 11 — Markdown export + git sync | **Shrink** | One-shot whole-account export only (M4-B1: zip of JSON with `tenantId` plus one Markdown file per entity, proxied by BoardRoom, Settings button). Bidirectional git sync, re-import and the round-trip test are not built. | Export: scheduled (M4). Sync/re-import: an exported Markdown file is edited and needs to come back in. |
| 12 — Webhooks + event bus | **Park** | Not built. Freshness stays turn-time reads: per `.claude/CLAUDE.md` Known Limitation 13, no shipping chat client turns MCP `notifications/resources/updated` / `list_changed` into a turn, so Phase 12 would push only to agents and UIs we control, not to Claude.ai, ChatGPT or Cursor. | The first consumer we control that needs push delivery and cannot poll (Known Limitation 13). |
| 13 — Public TypeScript SDK | **Park** | Not built. External agents use the MCP tools; BoardRoom uses `omnimind-client.ts`. The phase is sequenced after Phase 12 (its README). | A named third party needs programmatic access that the MCP tools and `docs/contracts/omnimind-api.contract.md` do not cover. |
| 14 — Observability suite | **Keep** (minimum) | Only what Phase 8 schedules: `/health` `version` + `/ready` (M0-A2), automatic post-deploy verification (M1-A1), `/admin/outbox-depth` + OBSERVABILITY.md for three services + LLM spend check (M3-A1), OTel export with five alerts, the backup dead-man and three `/ready` uptime checks (M3-F1). No metrics-export suite or dashboards beyond that. | Minimum: scheduled (M0–M3). Anything more: a production failure the M3-F1 alerts did not catch. |
| 15 — Migration history | **Shipped** (keep the remainder) | `0_init` baseline (`e28f397`, via PR #20) and `prisma migrate deploy` with baseline detection in `docker-entrypoint.sh`. Remainder: the migration-drift guard against a separate shadow DB (M0-A3). | Scheduled (M0-A3). |
| 16 — Cortex isolation | **Park** | Cron jobs stay in the OmniMind process (ADR-009); M3-A2 adds `pg_try_advisory_lock` to the job guard. | ADR-009's revisit condition: a job run exceeds 30 s, or more than 500 users; or measured API p95 impact during a cron window. |
| 17 — Persona marketplace | **Kill for now** | Not built, not designed further. | DEF-014's flip-back condition (`docs/roadmap/04-roadmap/DEFERRED/persona-marketplace.md`): ≥5 customer requests in a 90-day window, or a strategic decision to publish curated persona sets. |
| 18 — Resilience + multitenant fairness | **Park** | Two slices are pulled into Phase 8 instead: the per-user monthly LLM budget (M4-A1) and the job advisory lock (M3-A2). Postgres-backed rate limiting, real RLS and the subscription-middleware change are not built. | Scale-out or abuse (the Phase 8 "Not doing" trigger for ENG-15). |
| 19 — Horizontal API scale | **Park** | `numReplicas = 1` on all three services stays a hard constraint (MCP sessions live in an in-process map; M3-A2 documents it). | The Phase 19 README's own: ~2,000 active users or p95 event-loop lag > 50 ms sustained for 1 h. |

**Do not build in Phase 8** (the roadmap's "Not doing (and why)", recorded here):

| Not doing | Why | Trigger to revisit |
|---|---|---|
| Self-serve tenant provisioning + BoardRoom email verification (PRD-05) | Blocks the first non-founder user, not the founder's dogfood; auto-link without verification opens an account-binding hole; no email channel yet | The first invited user — ship tenants, email verification and the email channel together |
| Outbound email and password reset (email half of PRD-08) | Needs a provider choice | Before signups (Capture M3-B2 and Today M3-C1 are scheduled) |
| Pricing and packaging changes, a second Stripe tier, entitlement checks at introspection (PRD-11) | The dogfood exists to decide these | The M4-F1 verdict |
| A server-emitted human-readable "thinking" stream | Would change every prompt in `docs/prompts`; M1-C1 gets the same UX | — |
| UI-22, UI-23, UI-26, UI-27 (impact ≤3) | Low impact | A device-pass P1, or the top friction in the self-log |
| ENG-15 (Postgres auth limiters) and multi-replica work beyond the advisory lock | Single replica is the documented constraint (ADR-009, Known Limitation 7) | Scale-out or abuse |
| ENG-18 (subscription fail-open caching) | No paying non-founder users yet | With PRD-11 |
| ENG-24 (trailer rewrite) | Cosmetic; `main` is never rewritten | — |
| Scrubbing git history | Rotation (M0-F2) is the fix; repo visibility is the founder's decision | — |
| PRD-17 (MCP 2026-07-28 dual-stack) | — | A client fails to connect, a second MCP instance, or Q1 2027 |
| Phases 12, 13, 16/18/19 and 17 | See the table above | See the table above |
| A built-in OAuth authorization server, more than 20 MCP tools, multi-model routing, agent frameworks, re-enabling ministry | Settled by Known Limitation 14, ADR-001, ADR-002 and the sovereignty rule (ministry never falls back to OpenAI) | — |
| Leaderboard benchmarking, a graph renderer swap, more UI-foundation passes | — | A measured user-facing gap |

**Rationale:** Phase 8 has one goal — a verified, tenant-safe one memory plus an honest BoardRoom, judged by a 30-day dogfood (2026-11-12 → 2026-12-11) — and a founder whose bandwidth is the critical path. Anything that does not move the dogfood scorecard or guard the first non-founder user waits for evidence. The verdict entry (M4-F1) names the phases to unpark.
**Source:** `docs/roadmap/PHASE-8-ROADMAP.md` M0-D2 row and "Not doing (and why)"; triggers from `.claude/CLAUDE.md` Known Limitations 7, 13 and 14, ADR-009, DEF-014 and the Phase 19 README. Lane D, 2026-10-22.
**Reversibility:** HIGH (every row is a status, not a deletion; the phase folders stay as specs)

## 2026-04-18 — DEC-001 — Adopt the validator's 16-22 week plan over synthesis's 12 weeks

**Decision:** The Stage 5 validator's scoped 8-phase plan supersedes the synthesis's 12-week plan
**Rationale:** Pragmatic reviewer found timeline 40% light; verified `DecisionOutcome` doesn't exist as table; synthesis silently downgraded `memoryType` enum
**Source:** Stage 5 final validator + parent-agent verification of schema.prisma
**Reversibility:** HIGH (we can compress scope later if execution velocity justifies)

## 2026-04-18 — DEC-002 — Bring `Make-it-10` features (MCP, SDK, markdown export, observability, deep KG) into the roadmap

**Decision:** These get their own phases (10-16) after the mem0 core work completes
**Rationale:** User asked for everything missing/broken/unfinished/landmines in one document. Limiting to mem0 leaves gaps the team will rediscover at scale
**Source:** User directive, current session
**Reversibility:** HIGH

## 2026-04-18 — DEC-003 — Roadmap is the single source of truth; older planning docs are superseded

**Decision:** `docs/MEM0_RE_INTEGRATION_PLAN.md` and `docs/MEM0_INTEGRATION_PLAN.md` and the synthesis doc are now historical reference only
**Rationale:** Single source of truth. Updates flow through `docs/STATUS/` not the older files
**Source:** This roadmap scaffold
**Reversibility:** LOW (but easy enough to revert if the roadmap structure proves wrong)
