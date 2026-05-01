# DEF-006 — Bi-Temporal Transaction-Time Axis

**Capability:** Add a system-time axis to memory + decision records: not just "when was this true in the world" (valid time, partly addressed by Phase 1 bi-temporal-lite) but **"when did the system know this"** (transaction time). Enables queries like "what did the system believe about Alex's role on March 1?" — useful for forensic debugging and compliance.

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE:**
A user files a real "what did the system *believe* about X on date Y" support ticket **≥3 times**. Three tickets in any time window means the question is recurring rather than a one-off curiosity.

**Work estimate when triggered:** 2-3 weeks.

Breakdown per the wave 1 data-architecture research §7:
- 0.5 week: schema design. Add `recordedAt timestamptz NOT NULL DEFAULT now()` and `supersededAt timestamptz NULL` to `MemoryEntry`, `Decision`. Optionally: full `tstzrange` validity column with GiST exclusion constraint preventing overlapping facts.
- 1 week: pipeline updates. Memory validation pipeline preserves the prior version on update (sets `supersededAt = now()` on the old row, inserts a new row). Read paths default to "current" (latest non-superseded) but expose an `asOf` query parameter that filters by `recordedAt <= $1`.
- 0.5 week: a `memories_as_of(t)` Postgres function and a `memory_entries_current` view for ergonomic point-in-time queries.
- 0.5-1 week: eval scenarios for point-in-time queries; a `/admin/forensic` endpoint exposing the time-machine query for support tickets.

**Why deferred:**

The wave 1 research called this "elegant and powerful but premature." Reasons:

1. **No demand signal yet.** Zero support tickets in scope. Adding the schema overhead now costs storage (every update doubles a memory row) and complexity (every query must specify "current" or "as-of") for benefit that doesn't have a customer.

2. **Phase 1 bi-temporal-LITE is sufficient for the core use case.** "Memory says X today; was correct as of last week; now superseded" — the validation pipeline already handles this implicitly via soft-delete + new memory creation. The full transaction axis is for the more exotic forensic case.

3. **Storage growth.** A naive implementation (preserve every prior version) would 10x memory-row storage for users who frequently update beliefs. Mitigation paths exist (compression, monthly archival to cold storage) but add complexity.

**What we have today (sufficient for v1):**
- Phase 1 bi-temporal-lite: `validFrom`, `validTo` columns on memories
- Soft-delete with `deletedAt` preserves history
- The `OutboxEvent` log (Phase 12) provides a partial system-time view: every state change emits an event with `occurredAt`

**References:**
- `docs/research/omnimind-roadmap-2026/wave1-research/03-data-architecture.md` §7
- Snodgrass *Developing Time-Oriented Database Applications in SQL* (canonical text on bi-temporal modeling)
- Phase 1 README — the lite version we shipped
