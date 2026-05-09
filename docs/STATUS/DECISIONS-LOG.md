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
