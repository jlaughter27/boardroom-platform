# Embedding Model Versioning

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). ADR-011 locks us to OpenAI `text-embedding-3-small` (1536-dim) until "cost/quality review or model deprecation" — this feature is the operational answer for either trigger.

---

## Problem

Every memory in OmniMind is a 1536-dimensional vector produced by OpenAI's `text-embedding-3-small`. Three things will eventually force a model change:

1. **Provider deprecation.** OpenAI announces `text-embedding-3-small` retirement. We have a window — typically 6-12 months — to migrate every embedding before the model is shut off.
2. **Better model available.** A successor (real or hypothetical: `text-embedding-4-small`, Voyage v3, Nomic, etc.) demonstrates measurably better retrieval quality at acceptable cost. We want to upgrade without a flag day.
3. **Cost or vendor strategy shift.** Switching providers (e.g., self-hosting a sentence-transformers model) for cost or sovereignty reasons.

Today, the schema assumes one model. `MemoryEntry.embedding` is `Unsupported("vector(1536)")`. Switching providers means **re-embedding every row in the database synchronously** with no fallback — a multi-day, irreversible operation that breaks retrieval the moment it starts and produces ranked results that disagree with cached results until backfill completes.

We need a graceful migration path: **two embedding columns coexisting during the transition window**, queries reading from whichever is current, and a backfill job that produces parity over hours-to-days without interrupting service.

## Approach

### Core idea

Add an `embeddingModel` column to `MemoryEntry`. Add a sibling vector column (`embeddingV2`) when migrating. Run two embedding columns side-by-side during the migration window. Switch the active column atomically via a feature flag. Drop the old column after backfill is verified.

### Migration phases

**Phase 0 — single-model (today):**
- One column: `embedding vector(1536)`
- One model: `text-embedding-3-small`

**Phase 1 — annotated:**
- Add `embeddingModel String` column (default `text-embedding-3-small`)
- Backfill: every existing row gets the default
- Forward writes record the model name explicitly
- Schema is now ready for migration but no migration has started

**Phase 2 — coexisting (transition window):**
- Add `embeddingV2 Unsupported("vector(N)")` for the new model's dimension
- Add `embeddingModelV2 String?`
- Embedding worker: every NEW write produces both V1 and V2
- Backfill worker: scans existing rows in batches, computes V2, writes it
- Retrieval: still reads from V1 (active column unchanged)
- HNSW indexes built on V2 in the background as the column populates

**Phase 3 — atomic switch:**
- Feature flag `embeddings.activeColumn = "v2"` flipped
- Retrieval starts reading V2 immediately
- V1 column still present (rollback insurance)
- Monitor retrieval quality metrics (top-k overlap with V1 results, persona output evals) for 1-2 weeks

**Phase 4 — deprecation:**
- Embedding worker stops writing V1 for new rows
- After confidence period, drop the V1 column + index
- Rename `embeddingV2` → `embedding`, `embeddingModelV2` → `embeddingModel`

### Backfill strategy

The hard part isn't the math — it's not breaking production while doing it. Constraints:

- Backfill at most 1,000 rows per minute per worker (avoid OpenAI rate limits)
- Run during off-peak windows; gate on `omnimind.embedding.queue.depth` < 100 to avoid blocking new writes
- Resume-able: persist `lastProcessedId` per backfill run so a worker restart doesn't re-do work
- Idempotent: re-running on a row that already has V2 is a no-op
- Cost-aware: emit `omnimind.embedding.backfill.cost.cents` metric per batch

Estimated cost for a 1M-memory backfill at `text-embedding-3-small` rates: ~$20. At a hypothetical successor 2-3x cost: ~$60. Trivial vs. the operational risk of a flag-day cutover.

## Schema impact

```prisma
model MemoryEntry {
  id              String   @id @default(cuid())
  userId          String
  content         String
  domain          String
  // ... existing fields ...

  embedding       Unsupported("vector(1536)")?   // V1; nullable during transition
  embeddingModel  String                          // "text-embedding-3-small"
  embeddingHash   String                          // sha256 of content; skip re-embed if unchanged

  // V2 columns added during migration; dropped after Phase 4 stabilises
  embeddingV2       Unsupported("vector(N)")?
  embeddingModelV2  String?

  embeddedAt      DateTime?
  embeddedAtV2    DateTime?

  @@index([embeddingModel])
}

model EmbeddingBackfillRun {
  id               String   @id @default(cuid())
  fromModel        String
  toModel          String
  toDimensions     Int
  status           String   @default("running") // running | completed | paused | failed
  totalRows        Int
  processedRows    Int      @default(0)
  lastProcessedId  String?
  startedAt        DateTime @default(now())
  completedAt      DateTime?
  costCents        Int      @default(0)
}
```

`embeddingHash` is shared infrastructure with [markdown-export-import.md](markdown-export-import.md): both features want "did the content change since last embed?"

## API surface

Internal only. Operator endpoints (admin-scoped):

- `POST /v1/admin/embeddings/backfill` — kick off a backfill run
- `GET /v1/admin/embeddings/backfill/:id` — status
- `POST /v1/admin/embeddings/active-column` — set the active column (with confirmation)

## Phases

- [`../04-roadmap/PHASE-15-migration-history/`](../04-roadmap/PHASE-15-migration-history/) — Phase 15 ships the schema-extension work (annotation phase) under canonical numbering (was tagged "Phase 14" by Builder 4). The actual model migration is triggered on demand when (a) deprecation is announced or (b) a successor model is evaluated and approved.

Estimated effort: ~2 weeks for the framework (schema + backfill worker + retrieval read-flag). The migration itself is then a few days of backfill plus a 1-2 week confidence window.

## Risks

- **Rank-order divergence.** V1 and V2 produce different rankings; users may notice "the same query returns different memories now." Mitigation: pre-switch eval suite that compares top-k overlap; document the change in release notes; offer a "compare retrieval" debug view (ties into [retrieval-explainability.md](retrieval-explainability.md)).
- **HNSW index build time.** Building a new HNSW index on millions of rows is slow and CPU-intensive. Mitigation: build during low-traffic window; pgvector supports `CREATE INDEX CONCURRENTLY`.
- **Storage doubling during transition.** Two vector columns means ~2x the per-row storage. Mitigation: brief, planned; Postgres reclaims after column drop + VACUUM.
- **Backfill costs surprise the budget.** Mitigation: dry-run mode that estimates total cost from row count + per-token rate before kickoff.
- **A row gets edited mid-backfill.** Content changes between when V2 is computed and when it's written. Mitigation: backfill recomputes `embeddingHash` and skips if it doesn't match the row's current hash.

## Success metrics

- Zero downtime during migration (retrieval p95 latency stays within ±10%)
- Top-k overlap between V1 and V2 results ≥ 85% (sanity check; perfect parity isn't expected)
- 100% of rows have a non-null `embeddingV2` before active-column switch
- Backfill cost matches dry-run estimate within ±5%
- Schema rollback (revert to V1) takes < 5 minutes if needed during the confidence window

## Dependencies on other features

- **Markdown export + import** (Phase 11) — `embeddingHash` is shared infrastructure
- **Observability suite** (Phase 13) — backfill metrics, queue-depth gating
- **Per-tenant cost controls** (Phase 14) — backfill cost is operator-borne, not user-borne; must be excluded from per-tenant accounting
