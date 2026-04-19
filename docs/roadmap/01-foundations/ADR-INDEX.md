# ADR Index

**Source of truth:** `docs/DECISIONS.md` in the repo root.
**This file:** Quick-lookup index pointing into the source of truth, plus copies in `08-references/adrs/` for offline reference.

---

## Active ADRs

| ID | Title | Date | Status |
|---|---|---|---|
| 001 | Custom agent runtime, no frameworks | 2025-Q4 | ACTIVE |
| 002 | Anthropic Claude only | 2025-Q4 | ACTIVE |
| 003 | PostgreSQL + pgvector, no separate vector DB | 2025-Q4 | ACTIVE |
| 004 | No knowledge graph in v1 (under review in this roadmap) | 2025-Q4 | UNDER REVIEW (Phase 4) |
| 005 | Persona prompts in `docs/prompts/*.system.md` | 2026-Q1 | ACTIVE |
| 006 | Soft-delete on entity tables | 2026-Q1 | ACTIVE |
| 007 | Claude Code as sole build agent (DeepSeek RETIRED) | 2026-Q1 | ACTIVE |
| 008 | Native Anthropic tool_use, NOT MCP (for internal tool calls) | 2026-Q1 | ACTIVE |
| 009 | node-cron for background jobs, no Redis | 2026-Q1 | ACTIVE |
| 010 | Subscription middleware fails open | 2026-Q1 | ACTIVE |
| 011 | OpenAI text-embedding-3-small for embeddings | 2026-Q1 | ACTIVE |
| 012 | Zod validation at all boundaries | 2026-Q2 | ACTIVE |
| 013 | BoardRoom never touches Postgres directly | 2026-Q2 | ACTIVE |

## Pending (this roadmap will write these)

| Proposed ID | Title | When | Where to write |
|---|---|---|---|
| ADR-014 | Mem0 integration strategy: pattern-first, LLM-augmented, no framework dep | End of Phase 9 | `docs/DECISIONS.md` + copy to `08-references/adrs/` |
| ADR-015 | Retrieval eval harness as non-regression gate | End of Phase 0.5 | Same |
| ADR-016 | Bi-temporal link tables and supersession semantics | End of Phase 1 | Same |
| ADR-017 | Memory MCP server as external interface (does NOT contradict ADR-008 which is about internal tool_use) | End of Phase 10 | Same |
| ADR-018 | Markdown export via git as data portability layer | End of Phase 11 | Same |
| ADR-019 | Migration history baseline and switch to `prisma migrate deploy` | End of Phase 15 | Same |
| ADR-020 | Cortex isolation as separate Railway service | End of Phase 16 | Same |
| ADR-021 | Webhooks + event bus as the platform-grade external surface (HMAC + retries + DLQ) | End of Phase 12 | Same |
| ADR-022 | Resilience + multitenant fairness — Postgres-backed rate limiter and real RLS rollout | End of Phase 18 | Same |
| ADR-023 | Horizontal API scale enablers (sticky SSE, shared breaker, PgBouncer in path) | End of Phase 19 | Same |

## How to add a new ADR

1. Number sequentially. Don't reuse retired numbers.
2. Append to `docs/DECISIONS.md` with full text.
3. Copy to `08-references/adrs/ADR-NNN-{slug}.md`.
4. Update this index.
5. Update `01-foundations/CONSTRAINTS.md` if the ADR creates a new constraint.
6. If the ADR retires an older one, mark the old as RETIRED in this index.

## Anti-patterns (don't do this)

- Re-litigating an ACTIVE ADR mid-phase. Open a new ADR proposal in `STATUS/DECISIONS-LOG.md` first.
- Skipping the copy to `08-references/adrs/` — that breaks offline reference.
- Editing existing ADR text. ADRs are append-only; supersede with a new ADR instead.
