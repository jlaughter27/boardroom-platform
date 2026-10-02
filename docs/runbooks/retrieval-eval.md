# Retrieval IR eval — how to run, extend and ratchet

The labeled retrieval evaluation lives under `eval/retrieval/` and runs in CI
(`retrieval-eval` job in `.github/workflows/ci.yml`) against a fresh pgvector
Postgres with deterministic mock embeddings. It answers one question: *did this
change make hybrid retrieval worse on queries we know the answer to?*

| Piece | Path |
|---|---|
| Seed corpus (136 synthetic memories, 3 archetypes) | `eval/retrieval/seed-memories.json` |
| Gold queries (38 per archetype; slices temporal/update/abstention/entity/general) | `eval/retrieval/gold/{business,personal,ministry-shaped}.json` |
| Gates | `eval/retrieval/thresholds.json` |
| Seeder (idempotent, HTTP only) | `eval/retrieval/seed.ts` |
| Runner | `eval/runners/eval-retrieval-ir.ts` |
| Pure metrics + validators (unit-tested) | `eval/retrieval/metrics.ts`, `eval/retrieval/gold-schema.ts` |
| Results | `eval/results/retrieval-ir-<date>.{json,md}`, `eval/results/.seed-map.json` |

## Run locally

```bash
# 1. a pgvector Postgres
docker compose -f docker-compose.test.yml up -d postgres-test   # localhost:5433, pgvector/pgvector:pg16

# 2. OmniMind against it (separate terminal). Mock embeddings = no OpenAI calls.
cd packages/omnimind-api
DATABASE_URL=postgresql://test_user:test_password@localhost:5433/boardroom_test \
OMNIMIND_API_KEY=dev-omnimind-api-key-local-only EMBEDDING_PROVIDER=mock \
ANTHROPIC_API_KEY=x OPENAI_API_KEY=x \
pnpm exec prisma db execute --schema prisma/schema.prisma --stdin <<<'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
DATABASE_URL=... pnpm exec prisma migrate deploy --schema prisma/schema.prisma
DATABASE_URL=... OMNIMIND_API_KEY=dev-omnimind-api-key-local-only EMBEDDING_PROVIDER=mock ANTHROPIC_API_KEY=x OPENAI_API_KEY=x pnpm dev

# 3. seed + evaluate (repo root)
OMNIMIND_API_URL=http://localhost:3333 OMNIMIND_API_KEY=dev-omnimind-api-key-local-only pnpm eval:retrieval:ir
```

Useful switches:

| Env | Effect |
|---|---|
| `EVAL_IR_SKIP_SEED=1` | reuse `eval/results/.seed-map.json` (fast re-runs while tuning the ranker) |
| `EVAL_IR_SKIP_MEMORY_SEARCH=1` | only the `/context/for-persona` leg (halves the request count) |
| `EVAL_IR_ARCHETYPES=business,personal` | subset |
| `EVAL_IR_USER_PREFIX=eval-ir` | the synthetic user ids are `<prefix>-business`, `<prefix>-personal`, `<prefix>-community` |
| `EVAL_IR_DATE=2026-10-02` | fixed result filename |
| `pnpm eval:retrieval:seed` | seed only |

Runtime is dominated by OmniMind's limiter (20 requests/min per user per HTTP
method). The client sleeps on 429 and the three archetypes run concurrently
under different users, so a full run is ~6–8 minutes; `EVAL_IR_SKIP_SEED=1
EVAL_IR_SKIP_MEMORY_SEARCH=1` brings re-runs to ~2 minutes.

Against a **real** OmniMind (real embeddings) the same command works; just do
not run it against production — it writes 136 tagged memories per user
(`tags: ['eval-ir', …]`, `metadata.evalKey`). Clean up with
`DELETE /memories/:id` over the ids in `.seed-map.json` if you must.

## What is measured

Per gold query, two legs:
- `forPersona`: `POST /context/for-persona { query, persona }` → memory items in rank order (≤ 10 for personas, ≤ 15 for CEO) with `relevanceScore`.
- `memorySearch`: `POST /memories/search { query, limit: 10 }` (Phase 6 hybrid search; skipped when the route is 404).

Metrics (binary relevance): **recall@5, recall@10, MRR, nDCG@10**, overall,
per slice and per archetype. Extras:
- **abstention accuracy** — abstention queries have an empty gold set and score 1 when nothing with `relevanceScore ≥ abstentionScoreThreshold` (0.3) comes back. They enter the overall averages as 0/1 in every column.
- **stale-hit rate** (update slice) — fraction of update queries where the *superseded* memory still appears in the top-10. The seeder issues `PATCH /memories/:newId { supersedes: oldId }`; if the server has not landed that contract the seed map records the pairs as `supersedeUnconfirmed` and this number will be high.

Gating: only the `gateOn` leg (`forPersona`) and only `gates` in
`thresholds.json` fail the run (exit 1). `informational` metrics are reported
but never gate. Exit 2 = infrastructure failure (server down, invalid gold).

## Adding gold queries

1. Pick the archetype file. Add `{ id, query, persona, relevantMemoryKeys, slice }`.
   - `id` unique within the file (`biz-q39`), `persona` one of the seven built-ins.
   - `relevantMemoryKeys` must exist in `seed-memories.json` **and** belong to the same archetype.
   - `slice`: `temporal` (a date/when question), `update` (the answer is the *new* version of a superseded pair — list only the new key), `abstention` (empty list; the corpus genuinely has nothing), `entity` (a who/what-is-X question), `general`.
2. If the fact does not exist yet, add a memory first: stable `key`, `createdAtOffsetDays ≤ 0`, optional `explicitDate`, optional `supersedes` (same archetype). Keep it synthetic; never paste real data, and never use domain `ministry` (refused by the API and off-limits for synthetic pastoral content).
3. Phrase queries the way a founder asks a persona, and let them share at least one distinctive term with the gold memory — with mock embeddings only lexical layers carry signal, so a purely paraphrased query measures the embedder, not the ranker.
4. Abstention queries should avoid the corpus' proper nouns (a shared name makes the trigram layer fire legitimately).
5. `pnpm exec vitest run eval/` — `gold.test.ts` enforces all of the above (≥ 35 queries and ≥ 5 abstention per archetype, keys resolve, slices covered, update queries don't list stale keys).

## How thresholds ratchet

`thresholds.json` starts low on purpose (`recallAt10 ≥ 0.5`, `mrr ≥ 0.35`)
because CI's semantic layer is deterministic noise. Rules:
- **Up only.** After three consecutive green runs on `main`, set each gate to
  `floor((observed − 0.05) / 0.05) × 0.05` and add a row to `history`.
- Promote an `informational` metric to `gates` once it has been stable for a month (nDCG@10 and abstention accuracy are the next candidates).
- Lowering a gate requires a note here with the reason (e.g. a deliberate
  ranker change that trades recall for precision) and a link to the PR.
- Changing the corpus or gold set resets the three-run counter.
- When the real-embedding run (manual, against a staging OmniMind) is wired
  into a nightly job, it gets its own thresholds file; do not share gates
  between mock and real embeddings.

## Reading a failure
The job log ends with the markdown summary; the artifact
`retrieval-ir-results` has the per-query rows (`queries[].forPersona.leg.rankedKeys`
shows what came back). Typical causes, in order of frequency: a ranker weight
change dropping FTS hits below semantic noise; the status/validity filters
excluding fresh rows (`DRAFT` must still be retrievable); a layer reporting
`degraded: true` (a SQL error swallowed into `[]` — the summary counts these).
