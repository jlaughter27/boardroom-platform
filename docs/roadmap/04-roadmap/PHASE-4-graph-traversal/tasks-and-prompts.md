# Phase 4 — Tasks and Prompts

Six atomic tasks; ~18 hours over 1 week.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 4.1 | Recursive CTE design | `packages/omnimind-api/src/lib/graph-cte.ts` (new) | CTE returns nodes + edges | 5h |
| 4.2 | `findRelatedEntities` service | `src/services/relationship.service.ts` | Service returns valid graph for known fixtures | 4h |
| 4.3 | `/relationships/related/:id` route | `src/routes/relationships.routes.ts`, `packages/shared/src/validation/relationship-query.schema.ts` | Route returns JSON envelope; Zod validates query | 2h |
| 4.4 | Bi-temporal filter helper | `src/lib/temporal-filter.ts` (new) | Helper composable into CTE; existing services adopt it | 2h |
| 4.5 | Tests (unit + integration + perf) | `tests/unit/services/relationship.service.test.ts`, `tests/integration/relationships.test.ts` | All pass; perf test asserts p95 <300ms | 4h |
| 4.6 | Eval verification + commit | n/a | Multi-entity slice within 3% of baseline | 1h |

---

## Task 4.1 — Recursive CTE design

**Prompt:**

> The 6 link tables form a heterogeneous graph. We need a single recursive CTE that walks any of them up to N hops and returns a deduplicated edge list.
>
> Open `packages/omnimind-api/src/lib/graph-cte.ts`. Build a SQL string template:
>
> ```sql
> WITH RECURSIVE entity_walk AS (
>   -- Base case: the seed entity
>   SELECT
>     $1::text AS source_id,
>     $1::text AS target_id,
>     'seed'::text AS predicate,
>     0 AS depth,
>     ARRAY[$1::text] AS path
>
>   UNION ALL
>
>   -- Recursive case: walk all 6 link tables outward
>   SELECT * FROM (
>     -- GoalProjectLink (both directions)
>     SELECT w.target_id AS source_id, gpl.project_id AS target_id, 'goal-has-project' AS predicate, w.depth + 1, w.path || gpl.project_id
>       FROM entity_walk w JOIN goal_project_links gpl ON gpl.goal_id = w.target_id
>       WHERE w.depth < $2 AND NOT (gpl.project_id = ANY(w.path))
>         AND (gpl.valid_from IS NULL OR gpl.valid_from <= NOW())
>         AND (gpl.valid_to IS NULL OR gpl.valid_to > NOW())
>
>     UNION ALL
>
>     -- ProjectPersonLink, ProjectTaskLink, DecisionProjectLink, TaskDependency, CommitmentLink
>     -- ... same shape, both directions ...
>   ) edges
> )
> SELECT DISTINCT source_id, target_id, predicate, depth
>   FROM entity_walk
>   WHERE depth > 0
>   ORDER BY depth, source_id, target_id
>   LIMIT $3;
> ```
>
> Notes:
>
> - `$1` = seed entity ID, `$2` = max depth (capped at 2 in the service), `$3` = result LIMIT (default 200).
> - Path tracking via `ARRAY[...] || target` prevents cycles.
> - Bi-temporal filter included on each link table — non-negotiable per validator §1.
> - Both directions for each link table (e.g., goal→project AND project→goal) so the walk is undirected.
>
> Add a helper:
>
> ```ts
> export function buildEntityWalkSQL(includeLinks: LinkTableName[]): string {
>   // Generates the UNION ALL block for the requested link tables only.
>   // Default: all 6.
> }
> ```
>
> Test the raw SQL by running it against a known fixture in `psql`. Verify it returns expected edges and respects the depth cap.

---

## Task 4.2 — `findRelatedEntities` service

**Prompt:**

> Open `packages/omnimind-api/src/services/relationship.service.ts`. Add:
>
> ```ts
> import { buildEntityWalkSQL } from '../lib/graph-cte';
> import { prisma } from '../lib/db';
> import { logger } from '../lib/logger';
>
> const MAX_DEPTH = 2;
> const DEFAULT_LIMIT = 200;
>
> export interface RelatedEntity {
>   sourceId: string;
>   targetId: string;
>   predicate: string;
>   depth: number;
> }
>
> export async function findRelatedEntities(
>   userId: string,
>   entityId: string,
>   hops: number = 2,
>   limit: number = DEFAULT_LIMIT,
> ): Promise<RelatedEntity[]> {
>   if (hops > MAX_DEPTH) {
>     logger.warn({ userId, entityId, requestedHops: hops, cappedAt: MAX_DEPTH },
>       'Graph traversal capped at MAX_DEPTH');
>     hops = MAX_DEPTH;
>   }
>
>   const sql = buildEntityWalkSQL(['all']);
>   const rows = await prisma.$queryRawUnsafe<RelatedEntity[]>(sql, entityId, hops, limit);
>
>   // Post-CTE: filter out edges pointing to soft-deleted parents (link tables don't have deletedAt;
>   // see data-audit B3 for context). Lazy-load parent entities and drop edges with deletedAt set.
>   return await filterSoftDeletedTargets(userId, rows);
> }
> ```
>
> The `filterSoftDeletedTargets` helper does a batched lookup across the relevant entity tables (Goal, Project, Task, Person, Decision) for each unique target ID and drops rows whose target is soft-deleted. Use a single `WHERE id IN (...)` per table to avoid N+1.
>
> Add `userId` enforcement: the seed entity must belong to the user. Look up the seed entity's owning user before the CTE runs.

---

## Task 4.3 — `/relationships/related/:id` route

**Prompt:**

> Add to `packages/shared/src/validation/relationship-query.schema.ts`:
>
> ```ts
> export const RelatedEntitiesQuerySchema = z.object({
>   hops: z.coerce.number().int().min(1).max(2).default(2),
>   limit: z.coerce.number().int().min(1).max(500).default(200),
> }).strict();
> ```
>
> Add to `packages/omnimind-api/src/routes/relationships.routes.ts`:
>
> ```ts
> router.get('/related/:id', async (req, res, next) => {
>   try {
>     const userId = req.userId!;
>     const entityId = req.params.id;
>     const parsed = RelatedEntitiesQuerySchema.safeParse(req.query);
>     if (!parsed.success) return res.status(422).json({ error: 'validation_failed', details: parsed.error.format() });
>
>     const edges = await findRelatedEntities(userId, entityId, parsed.data.hops, parsed.data.limit);
>     return res.json({ success: true, data: edges, meta: { count: edges.length } });
>   } catch (err) {
>     next(err);
>   }
> });
> ```
>
> Mount the router in `index.ts` if not already mounted.
>
> Document the endpoint in `docs/contracts/omnimind-api.md`: GET `/relationships/related/:id?hops={1,2}&limit={1..500}` → `{success, data: RelatedEntity[], meta: {count}}`.

---

## Task 4.4 — Bi-temporal filter helper

**Prompt:**

> The bi-temporal filter is now duplicated in the CTE and any other code that touches link tables. Extract:
>
> Create `packages/omnimind-api/src/lib/temporal-filter.ts`:
>
> ```ts
> /**
>  * Returns a SQL snippet that filters bi-temporal link rows to only those currently valid.
>  * Use inside raw SQL: `WHERE ${temporalFilterSQL('gpl')}`
>  */
> export function temporalFilterSQL(alias: string, asOf: Date = new Date()): string {
>   const ts = `'${asOf.toISOString()}'::timestamptz`;
>   return `(${alias}.valid_from IS NULL OR ${alias}.valid_from <= ${ts})
>           AND (${alias}.valid_to IS NULL OR ${alias}.valid_to > ${ts})`;
> }
>
> /**
>  * Returns Prisma-style where filter for ORM queries.
>  */
> export function temporalFilterPrisma(asOf: Date = new Date()) {
>   return {
>     AND: [
>       { OR: [{ validFrom: null }, { validFrom: { lte: asOf } }] },
>       { OR: [{ validTo: null }, { validTo: { gt: asOf } }] },
>     ],
>   };
> }
> ```
>
> Refactor the CTE in task 4.1 to use `temporalFilterSQL`. Refactor any existing services that touch link tables (audit `relationship.service.ts`, `entity.service.ts`) to use `temporalFilterPrisma`.
>
> Add a unit test for both helpers covering: NULL valid_from / NULL valid_to (always valid); past valid_to (invalid); future valid_from (not yet valid); current (valid).

---

## Task 4.5 — Tests

**Prompt:**

> Two test files:
>
> **`tests/unit/services/relationship.service.test.ts`:**
>
> - Seed a fixture: 1 Goal → 2 Projects → 5 Tasks. Call `findRelatedEntities(goalId, hops=1)` → expect 2 edges. Call with `hops=2` → expect 7 edges (2 projects + 5 tasks).
> - Cycle test: create A → B → A. Call with `hops=5` → no infinite loop, returns 2 edges.
> - Soft-delete test: soft-delete one Project. Call with `hops=2` → that project's tasks no longer appear.
> - Bi-temporal test: set `validTo` in past on one ProjectTaskLink. Call with `hops=2` → that task is excluded.
> - Depth cap test: call with `hops=10` → log warning, results match `hops=2`.
>
> **`tests/integration/relationships.test.ts`:**
>
> - `GET /relationships/related/<knownGoalId>` → 200, returns array of edges.
> - Hops out of range (`hops=3`) → 422 with Zod error.
> - Cross-user attempt (Goal belongs to user A, request from user B) → 404 (don't leak existence).
> - Performance: seed 100 entities for one user; assert request completes in <300ms p95 over 50 sequential calls.

---

## Task 4.6 — Eval verification + commit

**Prompt:**

> Run `npm run eval:retrieval`. The multi-entity slice (10 queries) is the relevant signal. Compare to baseline.
>
> Note: this phase doesn't change retrieval directly — only adds a graph endpoint. Eval should be neutral. The lift from graph traversal happens in Phase 6 when the ranker reads from it.
>
> If eval shows unexpected change >3%, investigate (something else moved).
>
> Commit message:
>
> ```
> feat(phase-4): graph traversal via recursive CTE
>
> - findRelatedEntities(entityId, hops) over 6 typed link tables
> - GET /relationships/related/:id with Zod validation
> - Bi-temporal filter helper (temporalFilterSQL + temporalFilterPrisma)
> - Depth capped at 2; soft-deleted parents filtered post-CTE
> - p95 <300ms at 100 entities/user
> ```
