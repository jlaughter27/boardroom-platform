# Blockers

**Last updated:** 2026-04-18

---

## Decisions awaiting user input

| ID | Question | Default proposed | Blocks |
|---|---|---|---|
| BLK-001 | Drop `searchVector` column or convert to `GENERATED ALWAYS AS STORED`? | Drop (it's dead code) | Phase 0 task #4 |
| BLK-002 | `memoryType` enum (`SEMANTIC`/`EPISODIC`/`PROCEDURAL`) on `MemoryEntry` — accept the schema change with heuristic backfill? | Accept | Phase 1 |
| BLK-003 | LLM cost caps for Phase 5a — $2/user/month + $50/day global, OK? | Accept | Phase 5a |
| BLK-004 | Build a baseline Prisma migration NOW (before any schema work)? | Strongly recommended; user must confirm timing | Phase 1 (and the entire mem0 schema work) |
| BLK-005 | Memory MCP server — build as part of make-it-10 (Phase 10), or earlier? | Phase 10 (after core mem0 work) | Phase 10 timing |

## Production gaps that block specific phases

| Gap | Blocks |
|---|---|
| No log drain wired | Phase 5a (need observability before LLM calls in batch) |
| No retrieval eval harness | Phase 3, 6, 7a — every phase that claims a quality lift |
| No `MemoryWriteEvent` durability layer | Phase 2 (would silently lose entity-extraction work on Railway restart) |
| No baseline Prisma migration | Phase 1 (any schema change risks `--accept-data-loss`) |
| Railway plan at 1GB RAM | Phase 8 (reranker needs ≥4GB) |
| `Decision.outcome` populated on <200 decisions | Phase 7b (no signal to feed back) |

## External dependencies

None at present.
