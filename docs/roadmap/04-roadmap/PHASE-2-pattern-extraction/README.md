# Phase 2 — Pattern-Only Entity Extraction + Write-Decision Loop + Durability

**Time budget:** 2.5 weeks
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** Medium-high — modifies the memory write path, which is the core data flow

---

## What this phase is

Three layered pieces, sequenced carefully:

1. **`MemoryWriteEvent` durability layer** (validator §4.2 — REQUIRED before extraction work) — every memory write persists a `MemoryWriteEvent` row with `consolidationStatus: PENDING` and a deterministic `replayKey = ${memoryId}:${version}:${action}`. The in-process queue worker reads from this table on boot and on each cycle. Replay is safe because the key encodes the exact mutation. A nightly cortex sweep (Mon 03:00) re-queues any PENDING rows older than 24 hours.

2. **Regex/heuristic entity extractor** — extract `PERSON`, `ORG`, `URL`, `DATE`, `MENTION`, `TOPIC` from memory `title + content`. Fire-and-forget from `memory.service.ts::createMemory()` after the row is committed. Pattern-only — no LLM. Writes to `ExtractedEntity` (created in Phase 1).

3. **Deterministic ADD/UPDATE/DELETE/NOOP write-decision loop** — for each new memory, decide whether it's a new fact (ADD), an update of an existing one (UPDATE — supersession), a contradiction (DELETE the old, ADD the new), or a duplicate (NOOP). Pattern-only dedup using exact-match + canonical-name fuzzy match. Copy-on-write: never mutate existing rows; supersession sets `MemoryEntry.status = SUPERSEDED` on the old row and creates a new row with `supersedes` pointing at it.

Behind a flag: `MEM0_EXTRACTION_ENABLED=false` by default. Eval harness must show no regression with the flag off (proves the new code path doesn't slow / break the read path) AND with the flag on (proves the new artifacts don't degrade retrieval).

## Why now

Phase 2 is where mem0's actual product value starts. Up to this point we've built the foundation; from here on each phase delivers a measurable user-visible improvement. The sequencing matters:

- Pattern-only first (HIGH confidence). Get the write loop right with deterministic logic.
- LLM augmentation later (Phase 5b, MED confidence). Add Haiku only on UPDATE/NOOP boundary cases where pattern dedup is unsure.

Without the durability layer, the in-memory queue (already a known landmine per data audit A2) doubles its blast radius. ADR-009 (no Redis) holds, but only because `MemoryWriteEvent` is a tiny intent log, not a queue.

## Prereqs

- Phase 1 complete (`MemoryWriteEvent`, `ExtractedEntity` tables exist; Zod schemas in shared)
- Phase 0.5 eval harness baseline captured

## Exit criteria

| Criterion | How to verify |
|---|---|
| `MemoryWriteEvent` row written for every memory create | Manual test: create a memory, confirm a PENDING row in `memory_write_events` |
| Worker drains PENDING on boot | Restart the API, confirm any PENDING rows from before restart are processed |
| Replay-safe: re-running same `replayKey` is a NOOP | Manually insert a duplicate `replayKey` — confirm `INSERT ... ON CONFLICT` skips, no double-write |
| Nightly cortex sweep re-queues stale PENDING | Force-create a stale PENDING row, run the sweep, confirm it's re-queued |
| Pattern extractor produces ExtractedEntity rows | Create a memory with content like "spoke with @alex about acme.com on Jan 15"; confirm 4 entity rows (PERSON @alex, ORG Acme, URL acme.com, DATE 2026-01-15) |
| ADD/UPDATE/DELETE/NOOP loop works deterministically | Test cases: identical memory → NOOP; near-duplicate (>0.9 cosine on canonical names) → UPDATE; contradictory ("X is true" → "X is false") → manual review (no auto-DELETE in pattern-only mode) |
| Copy-on-write supersession | After UPDATE, old row has `status = SUPERSEDED`; new row has `supersedes = oldId` |
| `MEM0_EXTRACTION_ENABLED=false` is the deploy default | `.env.example` documents it; no behavior change with flag off |
| Eval harness with flag OFF: no regression | `npm run eval:retrieval` within 3% of baseline |
| Eval harness with flag ON: no regression | Same |

## Dependencies

- **Upstream:** Phase 1 schema (5 new models, bi-temporal columns, Zod schemas)
- **Downstream blocker:** Phase 5a (LLM entity augmentation) needs `ExtractedEntity` rows to augment
- **Downstream blocker:** Phase 5b (LLM consolidation) needs the deterministic ADD/UPDATE/DELETE/NOOP boundary cases identified

## Time budget detail

| Task | Hours |
|---|---|
| 2.1 — `MemoryWriteEvent` write at memory creation + worker integration | 6 |
| 2.2 — Boot-time PENDING drain + nightly stale-sweep cron | 4 |
| 2.3 — Pattern extractor for PERSON / ORG / URL / DATE / MENTION / TOPIC | 8 |
| 2.4 — Deterministic ADD/UPDATE/NOOP decision (no DELETE in pattern-only) | 6 |
| 2.5 — Copy-on-write supersession in `memory.service.ts` | 4 |
| 2.6 — Feature flag wiring + behind-flag rollout | 1 |
| 2.7 — Tests (unit + integration) | 8 |
| 2.8 — Eval runs (flag-off + flag-on) + rollback script | 3 |
| **Total** | **~40 hours / 2.5 weeks at solo cadence** |

## Risks accepted

- **DELETE is not auto-applied in pattern-only mode.** Contradictions surface as PENDING_REVIEW rows in `memory_write_events`. Phase 5b adds the LLM check that can promote these to APPLIED. Risk: a contradictory memory sits as a duplicate fact until Phase 5b. Acceptable because pattern-only confidence on contradiction detection is too low to trust auto-DELETE.
- **Pattern dedup precision is bounded.** The validator's confidence flip-trigger is "<70% precision on hand-labeled 100-pair sample." Build the sample as part of 2.7 testing.
- **In-process queue still loses jobs on restart.** That's exactly what the durability layer fixes — but the small window between row commit and PENDING insert remains. Mitigation: insert PENDING in the same transaction as the memory write.
- **Nightly cron at Mon 03:00 collides with existing cortex jobs.** Slot it into the existing `cortex-scheduler.ts`; existing jobs run sequentially, not in parallel.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 2, §4.2, §7 (rollback)
- Data-integrity audit on queue durability: `docs/research/omnimind-roadmap-2026/wave1-audit/data-integrity-audit.md` §A2
- Landmine fixed: `02-current-state/LANDMINES.md` (LM-02 in-memory embedding queue)
- Risk register: `06-risks-and-mitigations/RISK-REGISTER.md` (pattern dedup precision)
- Used by: PHASE-5a (LLM augments these entities), PHASE-5b (LLM checks the boundary cases this phase identifies)

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
