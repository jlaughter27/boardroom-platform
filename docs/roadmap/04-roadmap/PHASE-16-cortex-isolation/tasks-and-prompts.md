# PHASE 16 — Tasks & Prompts

---

## Task 16.1 — Boundary contract

**Scope:** Documentation. Lock down what cortex owns, reads, writes, and shares with API.

**Prompt:**
> Write `docs/contracts/cortex-isolation.contract.md` covering: (1) tables cortex WRITES (`ThinkingPattern`, `ContradictionAlert`, `WeeklyMemo`, `OutcomeReviewNudge`, `OutboxEvent` for cortex-emitted events) — these are cortex-owned; the API reads them but never writes; (2) tables cortex READS (everything: memories, decisions, entities, link tables) — read-only contract; (3) shared infra (DB, Anthropic API key, OpenAI API key, encryption key); (4) services cortex reuses from `packages/omnimind-api/src/services/` (named list); (5) services cortex MUST NOT reuse (anything that depends on Express request context). Get my approval before code work.

**Verification:** Contract reviewed and approved.

---

## Task 16.2 — Scaffold `packages/omnimind-cron/`

**Scope:** Create the new package with workspace wiring, Dockerfile, entrypoint, minimal `index.ts`.

**Prompt:**
> Create `packages/omnimind-cron/`. `package.json`: name `@boardroom/omnimind-cron`, type `module` or commonjs matching the rest of the monorepo, dependencies on workspace packages (`@boardroom/shared`, `@boardroom/omnimind-api` for service imports), plus `node-cron` and `pino`. `tsconfig.json` matching `omnimind-api/tsconfig.json`. `Dockerfile` mirroring `packages/omnimind-api/Dockerfile` but with `CMD ["node", "dist/index.js"]` and the same Prisma extraction steps. `docker-entrypoint.sh` mirroring the API's but WITHOUT the `prisma migrate deploy` (cortex follows schema, doesn't own migrations — that's the API's responsibility). Add to root `pnpm-workspace.yaml` and `turbo.json`. Scaffold `src/index.ts` that: imports `dotenv/config`, initializes the OTel SDK from Phase 14 with `OTEL_SERVICE_NAME=omnimind-cron`, creates a Prisma client with `connection_limit=5` (override via env `CORTEX_PRISMA_CONNECTION_LIMIT`), logs "cortex service started", waits forever. No cron jobs registered yet. Verify it builds and runs locally.

**Verification:** `pnpm build` produces `dist/`; `node dist/index.js` runs and stays up; observability vendor shows the new service emitting traces.

---

## Task 16.3 — Move weekly-memo job

**Scope:** First job migration as a pattern. Subsequent jobs follow the same shape.

**Prompt:**
> Move the weekly-memo cron job from `packages/omnimind-api/src/jobs/cortex-scheduler.ts` to `packages/omnimind-cron/src/jobs/weekly-memo.job.ts`. Import the existing `WeeklyMemoService` from the api package's services barrel — do not duplicate the service code. Register a node-cron schedule `'0 18 * * 0'` (Sunday 6pm UTC) in `packages/omnimind-cron/src/index.ts`. Add observability: wrap the job execution in a span named `cortex.weekly_memo.run`, attribute `users_processed`, increment the `omnimind.cortex.job.duration` histogram with `job_type=weekly_memo`. Add error handling: catch top-level errors, log + emit an alert metric, re-throw to surface in vendor. Add a feature flag `CORTEX_IN_API=true` (env): if true, the API's old in-process scheduler runs this job instead and the cortex service skips it. Default to false in staging/prod after Task 16.7.

**Verification:** Manually trigger the job in cortex service; verify it produces the same output as the in-process version; verify observability shows the run.

---

## Task 16.4 — Move pattern-detection + contradiction-alert + outcome-review jobs

**Scope:** Three more jobs, same pattern as Task 16.3.

**Prompt:**
> Mirror the pattern from Task 16.3 for three more jobs: pattern-detection (`'0 3 * * 1'`, Monday 3am UTC), contradiction-alerts (`'0 21 * * 2'`, Tuesday 9pm UTC), outcome-review-nudges (`'0 12 * * 5'`, Friday noon UTC — verify the actual schedule from `cortex-scheduler.ts`). Each goes into its own file in `packages/omnimind-cron/src/jobs/`. Each respects the `CORTEX_IN_API` feature flag.

**Verification:** Each job runs cleanly when triggered manually; observability shows traces.

---

## Task 16.5 — Move embedding queue worker

**Scope:** The in-process `setInterval` debounced batcher in `incremental-embedding.service.ts` moves to cortex.

**Prompt:**
> The current embedding flow in `packages/omnimind-api/src/services/incremental-embedding.service.ts` uses an in-process `pendingQueue` with a `setTimeout` batch debounce. Refactor: when the API receives a memory write, instead of pushing to the in-process queue, INSERT a row into a new `EmbeddingQueueItem(id, memoryId, text, createdAt, processedAt)` table. The cortex service runs a new node-cron job `embedding-batch-drain` every 5 seconds: `SELECT … FROM "EmbeddingQueueItem" WHERE "processedAt" IS NULL LIMIT 50 FOR UPDATE SKIP LOCKED`, batch-call OpenAI's embeddings API with up to 50 inputs per request, write embeddings back to `MemoryEntry.embedding`, mark queue items processed. Use exponential backoff on 429 errors (1s, 2s, 4s, 8s, max 30s). Honor the OpenAI tier limits documented in `docs/research/omnimind-roadmap-2026/wave1-research/01-ops-scaling.md` §5. Add the `EmbeddingQueueItem` table via a real Prisma migration (now possible per Phase 15). Add observability metrics: `omnimind.embedding.queue.depth` (gauge), `omnimind.embedding.batch.size` (histogram).

**Verification:** Memory writes still get embedded; latency comparable to or better than the in-process version; observability shows queue depth and batch sizes.

---

## Task 16.6 — Provision Railway service for cortex

**Scope:** Manual ops. Create a new Railway service in the same project, pointing at the same monorepo with a different Dockerfile.

**Prompt:**
> Document and execute the Railway service creation: (1) in the Railway UI, in the existing project, create a new service "omnimind-cron" pointing at the same GitHub repo and branch as omnimind-api, (2) set the Dockerfile path to `packages/omnimind-cron/Dockerfile`, (3) set env vars: copy `DATABASE_URL`, `OMNIMIND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ENCRYPTION_KEY`, `OBSERVABILITY_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME=omnimind-cron`, `CORTEX_PRISMA_CONNECTION_LIMIT=5`, (4) deploy. Update `docs/DEPLOYMENT-RUNBOOK.md` with a "Two-service Railway setup" section documenting the configuration, how to deploy each independently, how to roll one back without affecting the other, how to view logs for each. Verify the cortex service comes up cleanly and stays up for 24 hours.

**Verification:** Both services live; cortex service stable for 24h; cortex logs visible in vendor.

---

## Task 16.7 — Cutover: turn off in-process cron in API

**Scope:** Set `CORTEX_IN_API=false` (or remove the API-side scheduler entirely) so jobs run only from cortex service.

**Prompt:**
> Once Tasks 16.3-16.6 have been verified in staging for 7 days: (1) set `CORTEX_IN_API=false` in prod (default already), (2) verify that all 4 cortex jobs run on schedule from the cortex service and NOT from the API service (check observability for the next scheduled run of each), (3) delete `packages/omnimind-api/src/jobs/cortex-scheduler.ts` and remove its import from `packages/omnimind-api/src/index.ts`, (4) commit with message "feat(cortex): remove in-process scheduler from omnimind-api after cortex isolation cutover", (5) deploy. Monitor for 48h before declaring done.

**Verification:** API event loop free of cortex work (verify by spans in observability — the API service no longer emits `cortex.*` spans); cortex service runs all jobs as expected.

---

## Task 16.8 — Eval: API p95 unaffected by cortex run

**Scope:** Eval scenario asserting the isolation actually delivered the latency benefit.

**Prompt:**
> In `eval/scenarios/`: create `cortex-isolation-latency.scenario.ts`. Steps: (1) record API p95 latency over a 5-minute baseline window, (2) trigger a manual cortex run (large weekly-memo job), (3) record API p95 over the run window. Assert: p95 increase <20% during cortex run (was ~10x before isolation per the audit). Use the observability vendor's API to fetch percentiles, OR run a synthetic load generator hitting the API and measure locally. Add to `npm run eval:all` as a "scale-and-fairness" eval (this category is new in Phase 16, will grow in Phase 18).

**Verification:** Eval passes consistently; documented baseline number in `docs/observability/cortex-isolation-baseline.md`.
