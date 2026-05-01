# Phase 2 — Tasks and Prompts

Eight atomic tasks; ~40 hours over 2.5 weeks calendar.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 2.1 | `MemoryWriteEvent` write at memory creation | `packages/omnimind-api/src/services/memory.service.ts`, `lib/memory-write-event.ts` (new) | Every memory create produces a PENDING row | 6h |
| 2.2 | Boot-time PENDING drain + nightly stale-sweep | `src/services/embedding-queue.ts`, `src/jobs/cortex-scheduler.ts`, `src/jobs/memory-event-sweep.job.ts` (new) | Restart drains; stale rows re-queued | 4h |
| 2.3 | Pattern entity extractor | `src/services/entity-extractor.service.ts` (new), `src/lib/extractors/{person,org,url,date,mention,topic}.ts` (new) | All 6 types extract correctly | 8h |
| 2.4 | ADD/UPDATE/NOOP decision (no DELETE) | `src/services/memory-consolidation.service.ts` (new) | Test cases pass for all three actions | 6h |
| 2.5 | Copy-on-write supersession | `src/services/memory.service.ts` | Old row SUPERSEDED, new row references it | 4h |
| 2.6 | Feature flag wiring | `src/lib/env.ts`, `.env.example`, `docs/DEPLOYMENT-RUNBOOK.md` | Flag default OFF; toggleable via Railway env | 1h |
| 2.7 | Tests + 100-pair precision sample | `tests/unit/services/{memory-consolidation,entity-extractor}.test.ts`, `tests/fixtures/dedup-pairs.json` | Pattern dedup precision ≥70% on hand-labeled 100 pairs | 8h |
| 2.8 | Eval runs (off + on) + rollback script | `scripts/rollback-mem0-supersession.sql` (new) | Both eval runs within 3% of baseline | 3h |

---

## Task 2.1 — `MemoryWriteEvent` write at memory creation

**Prompt:**

> Per validator §4.2, every memory write must persist a `MemoryWriteEvent` row before the in-process queue picks it up. This is the durability layer that makes Phase 2 ADR-009-compliant.
>
> **Step 1.** Create `packages/omnimind-api/src/lib/memory-write-event.ts`:
>
> ```ts
> import { prisma } from './db';
> import type { MemoryWriteAction } from '@prisma/client';
>
> export function buildReplayKey(memoryId: string, version: number, action: MemoryWriteAction): string {
>   return `${memoryId}:${version}:${action}`;
> }
>
> export async function persistWriteEvent(input: {
>   userId: string;
>   memoryId: string;
>   memoryVersion: number;
>   action: MemoryWriteAction;
>   payload?: Record<string, unknown>;
> }) {
>   const replayKey = buildReplayKey(input.memoryId, input.memoryVersion, input.action);
>   return prisma.memoryWriteEvent.upsert({
>     where: { replayKey },
>     create: {
>       userId: input.userId,
>       memoryId: input.memoryId,
>       memoryVersion: input.memoryVersion,
>       action: input.action,
>       replayKey,
>       payload: input.payload ?? {},
>       consolidationStatus: 'PENDING',
>     },
>     update: {}, // idempotent; existing row stays
>   });
> }
> ```
>
> **Step 2.** Open `packages/omnimind-api/src/services/memory.service.ts`. In `createMemory`, after the `prisma.memoryEntry.create` call AND in the same transaction (use `prisma.$transaction`), call `persistWriteEvent` with `action: 'ADD'` and `memoryVersion: 1`. Same for `updateMemory` (action: 'UPDATE') and any deletion paths (action: 'DELETE').
>
> If the memory write fails, the transaction rolls back the event row too. If both succeed, the event is durable.
>
> **Step 3.** Add unit tests in `packages/omnimind-api/tests/unit/services/memory.service.test.ts`: after `createMemory`, query `prisma.memoryWriteEvent.findUnique({ where: { replayKey: ... } })` and assert `consolidationStatus === 'PENDING'`.
>
> **Step 4.** Verify the existing `embedding-queue.ts` still works — the new write event is additional, not a replacement.

---

## Task 2.2 — Boot-time PENDING drain + nightly stale-sweep cron

**Prompt:**

> The `MemoryWriteEvent` table is now populated, but nothing reads from it yet. Wire the in-process queue worker to drain PENDING events on boot and on each cycle.
>
> **Step 1.** Open `packages/omnimind-api/src/services/embedding-queue.ts`. On startup (when `startWorker()` is called from `index.ts`), add a one-shot drain:
>
> ```ts
> async function drainPendingEvents() {
>   const pending = await prisma.memoryWriteEvent.findMany({
>     where: { consolidationStatus: 'PENDING' },
>     orderBy: { createdAt: 'asc' },
>     take: 1000,
>   });
>   for (const event of pending) {
>     await processWriteEvent(event); // wraps the existing extraction + consolidation logic
>   }
> }
> ```
>
> Call `drainPendingEvents()` once at startup, then continue with the existing tick loop. Mark events `PROCESSING` while in flight and `APPLIED` on success / `FAILED` on terminal error.
>
> **Step 2.** Create `packages/omnimind-api/src/jobs/memory-event-sweep.job.ts`:
>
> ```ts
> // Re-queue any PENDING events older than 24 hours (boot drain may have missed them
> // during a long Railway downtime, or extraction itself failed silently).
> export async function memoryEventSweep() {
>   const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
>   const stale = await prisma.memoryWriteEvent.findMany({
>     where: { consolidationStatus: 'PENDING', createdAt: { lt: cutoff } },
>   });
>   for (const event of stale) {
>     await processWriteEvent(event);
>   }
>   logger.info({ count: stale.length }, 'memory-event sweep complete');
> }
> ```
>
> **Step 3.** Wire into `src/jobs/cortex-scheduler.ts`. The existing scheduler has a Mon 03:00 slot — add `memoryEventSweep` to that slot (sequential after existing jobs):
>
> ```ts
> cron.schedule('0 3 * * 1', async () => {
>   await detectPatterns();          // existing
>   await memoryEventSweep();        // new
> });
> ```
>
> **Step 4.** Tests: integration test that creates a memory, manually corrupts the event row to be 25h old + PENDING, runs the sweep, asserts the row is now APPLIED.

---

## Task 2.3 — Pattern entity extractor

**Prompt:**

> Build a regex/heuristic extractor for the 6 entity types defined in Phase 1's `EntityType` enum: `PERSON`, `ORG`, `URL`, `DATE`, `MENTION`, `TOPIC`.
>
> **Step 1.** Create one file per extractor in `packages/omnimind-api/src/lib/extractors/`:
>
> - `person.ts` — capitalized two-word sequences ("Alex Chen"), `@`-prefixed handles
> - `org.ts` — `Acme Inc`, `Acme Corp`, `Acme LLC`, plus a curated list of common SaaS companies (Stripe, GitHub, etc.)
> - `url.ts` — RFC 3986-ish URL regex; normalize to bare domain for canonical name
> - `date.ts` — ISO dates, `Jan 15`, `January 15, 2026`, `last Tuesday`, `next month`. Use `chrono-node` (~30kb, MIT) — pre-existing dep check first
> - `mention.ts` — `@username`, `#tag`
> - `topic.ts` — top 3 noun phrases via simple POS heuristic. Use `compromise` (~150kb, MIT, no LLM) for lightweight NLP. If too heavy, defer TOPIC to Phase 5a's LLM extraction
>
> Each file exports `extract(text: string): ExtractedEntityCandidate[]`.
>
> **Step 2.** Create `packages/omnimind-api/src/services/entity-extractor.service.ts`:
>
> ```ts
> import { extract as extractPerson } from '../lib/extractors/person';
> // ... etc.
>
> export async function extractEntitiesFromMemory(memory: { id: string; userId: string; title: string; content: string }) {
>   const text = `${memory.title}\n${memory.content}`;
>   const candidates = [
>     ...extractPerson(text).map(c => ({ ...c, entityType: 'PERSON' as const })),
>     ...extractOrg(text).map(c => ({ ...c, entityType: 'ORG' as const })),
>     // ... etc.
>   ];
>   // Dedup within this memory by (entityType, canonicalName)
>   const deduped = dedupByCanonical(candidates);
>   for (const c of deduped) {
>     await upsertExtractedEntity({
>       userId: memory.userId,
>       entityType: c.entityType,
>       canonicalName: c.canonicalName,
>       surfaceForms: c.surfaceForms,
>       confidence: c.confidence,
>     });
>   }
>   await prisma.entityExtractionEvent.create({
>     data: { userId: memory.userId, memoryId: memory.id, extractor: 'pattern', entityCount: deduped.length, durationMs: 0 },
>   });
> }
> ```
>
> **Step 3.** Wire into the worker's `processWriteEvent` from task 2.2 — for `action: 'ADD'`, call `extractEntitiesFromMemory`.
>
> **Step 4.** Tests:
>
> - Each extractor has 5+ positive cases and 5+ negative cases
> - Integration: a memory with content "spoke with @alex about acme.com on Jan 15" produces ≥4 entity rows
> - No LLM calls happen (assert via mocked Anthropic client)

---

## Task 2.4 — Deterministic ADD/UPDATE/NOOP decision

**Prompt:**

> Create `packages/omnimind-api/src/services/memory-consolidation.service.ts`. This is the deterministic write-decision loop. NO LLM in this phase.
>
> ```ts
> export type ConsolidationDecision =
>   | { action: 'ADD'; reason: string }
>   | { action: 'UPDATE'; targetMemoryId: string; reason: string }
>   | { action: 'NOOP'; targetMemoryId: string; reason: string }
>   | { action: 'PENDING_REVIEW'; reason: string }; // boundary cases for Phase 5b
>
> export async function decideConsolidation(input: {
>   userId: string;
>   newMemory: { title: string; content: string; embedding?: number[] };
>   extractedEntities: ExtractedEntityCandidate[];
> }): Promise<ConsolidationDecision> {
>   // Rule 1: exact match on (userId, title, content) → NOOP
>   const exact = await prisma.memoryEntry.findFirst({
>     where: { userId: input.userId, title: input.newMemory.title, content: input.newMemory.content, deletedAt: null },
>   });
>   if (exact) return { action: 'NOOP', targetMemoryId: exact.id, reason: 'exact_match' };
>
>   // Rule 2: same canonical entities + high content trigram similarity → UPDATE
>   if (input.extractedEntities.length > 0) {
>     const candidates = await findCandidatesByEntities(input.userId, input.extractedEntities);
>     for (const candidate of candidates) {
>       const similarity = trigramSimilarity(input.newMemory.content, candidate.content);
>       if (similarity > 0.85) {
>         return { action: 'UPDATE', targetMemoryId: candidate.id, reason: `entity_overlap_high_trigram_${similarity.toFixed(2)}` };
>       }
>       if (similarity > 0.65) {
>         return { action: 'PENDING_REVIEW', reason: `boundary_case_trigram_${similarity.toFixed(2)}` };
>       }
>     }
>   }
>
>   // Rule 3: default → ADD
>   return { action: 'ADD', reason: 'no_dedup_match' };
> }
> ```
>
> Note: NO `DELETE` action in this phase. Contradictions show up as `PENDING_REVIEW` and Phase 5b's LLM check decides their fate.
>
> **Step 2.** Wire into `processWriteEvent`: for `action: 'ADD'`, after extraction, call `decideConsolidation`. If decision is UPDATE, call `supersedeMemory(targetMemoryId, newMemoryData)` (task 2.5). If NOOP, mark the event APPLIED and skip. If PENDING_REVIEW, leave the event PENDING — Phase 5b will pick it up.
>
> **Step 3.** Tests: each rule has at least 3 happy-path test cases. Use mocked `findCandidatesByEntities` and `trigramSimilarity` to control the inputs.

---

## Task 2.5 — Copy-on-write supersession

**Prompt:**

> Per validator §7 rollback plan, supersession must be copy-on-write — never mutate the existing memory row.
>
> **Step 1.** Add a `status` field to `MemoryEntry` if not already present (Phase 1 schema may already have it; verify). Allowed values: `CONFIRMED` (default), `SUPERSEDED`, `DELETED`. Add a `supersedes String?` self-relation field for the new row to point at the old one.
>
> If the field doesn't exist, add to `schema.prisma`:
>
> ```prisma
> enum MemoryStatus {
>   CONFIRMED
>   SUPERSEDED
>   DELETED
> }
>
> // ... in MemoryEntry:
> status      MemoryStatus @default(CONFIRMED)
> supersedes  String?      @map("supersedes")
> supersedeBy MemoryEntry? @relation("Supersession", fields: [supersedes], references: [id])
> superseded  MemoryEntry[] @relation("Supersession")
> ```
>
> **Step 2.** In `memory.service.ts`, add:
>
> ```ts
> export async function supersedeMemory(oldMemoryId: string, newMemoryData: CreateMemoryInput) {
>   return prisma.$transaction(async (tx) => {
>     const newMemory = await tx.memoryEntry.create({
>       data: { ...newMemoryData, status: 'CONFIRMED', supersedes: oldMemoryId, version: 1 },
>     });
>     await tx.memoryEntry.update({
>       where: { id: oldMemoryId },
>       data: { status: 'SUPERSEDED', updatedAt: new Date() },
>     });
>     await persistWriteEvent({
>       userId: newMemory.userId,
>       memoryId: newMemory.id,
>       memoryVersion: 1,
>       action: 'UPDATE',
>     });
>     return newMemory;
>   });
> }
> ```
>
> **Step 3.** All retrieval queries MUST filter `WHERE status = 'CONFIRMED'`. Audit `retrieval/semantic-search.ts`, `fulltext-search.ts`, `trigram-search.ts`, `context-packager.ts` for the existing `deletedAt: null` filter — add `status: 'CONFIRMED'` next to it. Tests for each.
>
> **Step 4.** Create `scripts/rollback-mem0-supersession.sql` (per validator §7):
>
> ```sql
> -- Roll back supersession applied after the given timestamp.
> -- Usage: psql $DATABASE_URL -v cutoff="'2026-04-XX 00:00:00'" -f rollback-mem0-supersession.sql
> UPDATE memory_entries
>   SET status = 'CONFIRMED'
>   WHERE status = 'SUPERSEDED'
>     AND id IN (SELECT supersedes FROM memory_entries WHERE supersedes IS NOT NULL AND created_at >= :cutoff);
>
> UPDATE memory_entries
>   SET supersedes = NULL, status = 'DELETED'
>   WHERE supersedes IS NOT NULL AND created_at >= :cutoff;
> ```
>
> Document in `docs/runbooks/rollback-mem0.md` how to run this safely.

---

## Task 2.6 — Feature flag wiring

**Prompt:**

> Add `MEM0_EXTRACTION_ENABLED` env var to `packages/omnimind-api/src/lib/env.ts`. Default `false`. Document in `.env.example`:
>
> ```
> # Phase 2: enable pattern entity extraction + ADD/UPDATE/NOOP write loop.
> # Default OFF until eval baseline confirms no regression.
> MEM0_EXTRACTION_ENABLED=false
> ```
>
> In `processWriteEvent` (task 2.2), guard the extraction + consolidation calls behind this flag. When false, the worker still drains events but only does the existing embedding work.
>
> Document in `docs/DEPLOYMENT-RUNBOOK.md` under a new "Feature flags" section: this flag stays OFF until eval shows no regression with it ON. Once stable for 48 hours in prod with eval green, flip default to true and remove the flag in Phase 6.

---

## Task 2.7 — Tests + 100-pair precision sample

**Prompt:**

> Per validator §8 confidence register: pattern-only dedup must achieve ≥70% precision on a hand-labeled 100-pair sample. If it falls below, the Phase 5b LLM upgrade gets pulled forward.
>
> **Step 1.** Create `packages/omnimind-api/tests/fixtures/dedup-pairs.json`. Hand-label 100 memory pairs from Joshua's actual session history:
>
> ```json
> [
>   {
>     "id": "pair-001",
>     "memoryA": { "title": "...", "content": "..." },
>     "memoryB": { "title": "...", "content": "..." },
>     "expectedAction": "UPDATE",   // or "NOOP" or "ADD" or "PENDING_REVIEW"
>     "rationale": "Same pricing decision discussed twice with different surface wording"
>   }
> ]
> ```
>
> Aim for distribution: ~30 NOOP (true duplicates), ~30 UPDATE (near-dups), ~30 ADD (genuinely different), ~10 PENDING_REVIEW (boundary cases that should defer to Phase 5b).
>
> **Step 2.** Create `tests/integration/dedup-precision.test.ts`. For each pair, run `decideConsolidation` and compare to `expectedAction`. Compute:
>
> - Precision per action: of the times we decided X, how often was X correct?
> - Recall per action: of the times X was correct, how often did we catch it?
> - Overall accuracy
>
> Assert: overall precision on UPDATE+NOOP ≥ 70%. If below, fail the test — that's the phase 5b acceleration trigger.
>
> **Step 3.** Standard unit tests:
>
> - Each extractor: positive + negative cases (already in 2.3)
> - `decideConsolidation`: each rule path
> - `supersedeMemory`: transaction commit, status flip, supersedes link, write event row
> - Boot-time drain (already in 2.2)
> - Stale sweep (already in 2.2)
> - Replay key uniqueness: re-running same key is no-op

---

## Task 2.8 — Eval runs + rollback verification

**Prompt:**

> Run the Phase 0.5 eval harness twice — once with `MEM0_EXTRACTION_ENABLED=false` (baseline-equivalent), once with `MEM0_EXTRACTION_ENABLED=true`.
>
> Both runs must show:
>
> - MRR within 3% of `eval/baselines/2026-04.json`
> - nDCG@10 within 3% of baseline
> - P@5 within 3% of baseline
>
> If the flag-OFF run regresses, the new code path is somehow slowing the read path — investigate (probably the supersession `status = CONFIRMED` filter on a non-indexed column).
>
> If the flag-ON run regresses, supersession is dropping good memories or extracting noise into context. Tune the consolidation rules; consider bumping the trigram threshold from 0.85 to 0.90.
>
> Manually rehearse the rollback script: pick a test memory in staging, force a supersession, run `rollback-mem0-supersession.sql`, verify the original memory is back to `CONFIRMED` status.
>
> Commit. Deploy with flag OFF. Wait 24 hours. Watch logs for any unexpected events. Then flip the flag ON in staging, observe for 48 hours, then prod.
