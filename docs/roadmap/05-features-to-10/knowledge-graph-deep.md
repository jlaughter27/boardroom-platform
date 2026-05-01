# Knowledge Graph (Deep)

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). ADR-004 says "no knowledge graph in v1" with the revisit trigger of "500+ memories per user, sustained." This feature is the answer for what to do when that threshold is crossed.

---

## Problem

OmniMind's typed link tables (`MemoryEntityLink`, `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`) cover the 80% case: "give me everything about Project X" is a single JOIN. Recursive CTEs handle 2-3 hops cleanly: "find all memories about people on projects linked to active goals."

That breaks down in three concrete situations:

1. **Pattern-match queries** — "find all people connected to stalled projects via shared goals" or "show me decisions whose assumptions touch entities involved in this week's contradictions." These are trivial in Cypher (`MATCH (p:Person)-[:INVOLVED_IN]->(:Project {status: 'stalled'})-[:LINKED_TO]->(:Goal)<-[:LINKED_TO]-(:Project)<-[:INVOLVED_IN]-(other:Person)`) and painful in SQL.
2. **Variable-depth traversal** — "show me everything within 3 hops of Person Alex." Recursive CTEs work but get slower per hop and require careful index design.
3. **Property-graph reasoning** — "what's the shortest causal chain from Goal X to recent slippage?" needs path algorithms (shortest path, Personal PageRank, community detection) that SQL doesn't natively express.

The trigger for adopting a deeper graph layer is **measured**, not aspirational: a user crosses 500+ memories *and* shows pattern-match queries in their workload (cortex jobs, advanced retrieval). Until both conditions hit, recursive CTEs are cheaper end-to-end than running a second stateful service.

## Approach

### Two viable architectures

**Option A — Apache AGE (Postgres-native, openCypher).**

- AGE is a Postgres extension that adds Cypher query support over property graphs stored in Postgres tables.
- Same DB, same backup, same auth, same connection pool. Operationally equivalent to adding pgvector.
- Cypher syntax for pattern-match; existing recursive CTEs stay valid for traversal.
- Caveats: AGE is lower-velocity than Neo4j; managed-host support is inconsistent — Railway, Supabase, RDS may or may not support it. Verify availability at the time of adoption.

**Option B — Neo4j sidecar.**

- Neo4j AuraDB or self-hosted Neo4j as a separate stateful service.
- Cypher native, mature, the default in every published memory-graph paper (Graphiti, Mem0g, Cognee).
- Operational cost: a second stateful service, separate backup story, separate auth, doubled attack surface, ~$5-50/mo extra.
- Sync layer: outbox-pattern replication from Postgres to Neo4j on every entity / link write. Eventually consistent; ~seconds of lag acceptable.

### Comparison

| Axis | Apache AGE | Neo4j sidecar |
|---|---|---|
| Operational cost | Same as today | +1 service, +backup, +auth, +$/mo |
| Query language | openCypher | Cypher (more mature) |
| Maturity | Lower velocity | Industry standard for graphs |
| Managed availability | Inconsistent on Railway | AuraDB cloud-managed |
| Ecosystem | Small | Large (drivers, GUIs, viz) |
| ADR alignment | Stays Postgres-only | Adds a new stateful dependency |
| Replication | Native (same DB) | Outbox + worker |
| Backup | Existing pg_dump | Separate Neo4j dump |

### Recommendation

**Default to Apache AGE if it's available on the deployment platform. Fall back to a Neo4j sidecar only if AGE is unavailable or pattern-match performance is inadequate.** This preserves the Postgres-only operational story (ADR-003 spirit) and avoids doubling the backup + auth surface. Re-evaluate at 500K+ entities — at that scale Neo4j's specialised storage and query planner may pay back the operational tax.

### Migration path from typed link tables

The typed link tables don't go away. They remain the source of truth; the graph layer is a derived view.

1. **Backfill.** A one-time job reads every link table row and writes equivalent edges into the graph (AGE labels or Neo4j relationships). Maps:
   - `MemoryEntityLink(memory, entity, kind)` → `(:Memory)-[:MENTIONS {kind}]->(:Entity)`
   - `GoalProjectLink` → `(:Goal)-[:OWNS]->(:Project)`
   - `ProjectPersonLink` → `(:Person)-[:INVOLVED_IN]->(:Project)`
   - `ProjectTaskLink` → `(:Project)-[:CONTAINS]->(:Task)`
   - `DecisionProjectLink` → `(:Decision)-[:AFFECTS]->(:Project)`
   - `TaskDependency` → `(:Task)-[:BLOCKS]->(:Task)`

2. **Forward writes.** Outbox pattern (same outbox as [webhooks-event-bus.md](webhooks-event-bus.md)). Every link-table write emits a graph-edge event; a worker drains it.

3. **Reads.** Pattern-match queries use Cypher. Traversal queries can stay on recursive CTEs against link tables (no need to migrate working code). Cortex jobs that need patterns (e.g., advanced cross-entity contradictions) gain a graph dependency.

4. **Bi-temporal lite already in place.** Per the hierarchical-temporal research, the link tables gain `validFrom`, `validTo`, `supersededBy` columns (Phase 4 work). Graph edges replicate those properties so point-in-time queries work either way.

## When the deeper graph pays off

Concrete signals — adopt only when **two or more** are true:

- ≥ 500 memories per active user, sustained for 30+ days
- Cortex jobs need pattern-match queries (advanced cross-entity contradictions, recommended-next-actions over multi-hop entity webs)
- Recursive CTE p95 query time > 500ms even with optimised indexes
- A new persona requires multi-hop reasoning ("trace the dependency chain from this stalled task to its root cause")
- Power users explicitly request graph-style queries via the SDK or admin UI

Until at least two of these are true, **recursive CTEs on existing tables remain the right answer**. The intellectual appeal of a knowledge graph is real; the operational cost is also real.

## Schema impact

If Apache AGE: minor — install the extension, add per-tenant graph "label spaces" (`SELECT * FROM ag_catalog.create_graph('user_${userId}_g')`).

If Neo4j sidecar:

```prisma
model GraphSyncOutbox {
  id          String   @id @default(cuid())
  operation   String   // "create_node" | "update_node" | "delete_node"
                       // | "create_edge" | "update_edge" | "delete_edge"
  payload     Json
  tenantId    String
  status      String   @default("pending")
  attempts    Int      @default(0)
  createdAt   DateTime @default(now())
  syncedAt    DateTime?

  @@index([status, createdAt])
}
```

## API surface

- `POST /v1/graph/query` — admin-scoped Cypher query endpoint (sandboxed: read-only, per-user scope filter, query-time budget cap)
- `GET /v1/graph/neighbors?entityId=&depth=` — convenient depth-limited traversal
- `GET /v1/graph/path?from=&to=&maxHops=` — shortest path between two entities
- `GET /v1/graph/health` — graph-store status

Cortex jobs and persona-context-assembly use the graph internally; not exposed publicly until power-user demand emerges.

## Phases

- DEFERRED — knowledge-graph-deep does not have a dedicated phase folder under canonical numbering. The original "Phase 16" slot now hosts cortex isolation. KG-deep activates on the trigger conditions named above (recursive-CTE p95 >500ms AND pattern-match queries become a confirmed product feature). When triggered, slot it as a new phase number after the active scale phases.
- Gated on the trigger conditions above. See `04-roadmap/ROADMAP-OVERVIEW.md` "Where DEFERRED phases re-enter" table for the un-deferral procedure.

Estimated effort: ~4-6 weeks for AGE adoption (extension install + backfill + cortex query rewrites). ~6-8 weeks for Neo4j sidecar (additional sync layer + ops).

## Risks

- **AGE compatibility.** Extension may be unavailable on the production Postgres host. Mitigation: verify before committing; fall back to Neo4j sidecar.
- **Sync lag (Neo4j).** Outbox-driven replication is eventually consistent; queries may see stale graphs. Mitigation: surface the lag in the admin UI; cortex jobs tolerate seconds of lag.
- **Query injection.** A Cypher endpoint exposed to anyone is a vector for resource exhaustion. Mitigation: read-only role; per-query CPU + result-size budgets; per-user rate limits.
- **Maintenance burden.** A graph schema is now another thing to evolve in lockstep with Prisma. Mitigation: schema generated from typed link tables; CI gate that fails when link table changes don't have a graph-schema counterpart.
- **Premature adoption.** Building a graph layer before it's needed wastes engineering time and adds an operational surface for marginal benefit. Mitigation: enforce trigger conditions in the phase entry doc; explicitly do not start work until two are true.

## Success metrics

- Pattern-match queries that previously timed out at the recursive-CTE layer return in < 200ms p95
- Zero data drift between link tables and graph (verified daily by a reconciliation job)
- ≥ 1 cortex job demonstrably benefits (more accurate or more efficient) from graph adoption
- Operational cost increase < $50/mo (AGE) or < $100/mo (Neo4j AuraDB starter)
- Backup + restore drill works for the new graph store

## Dependencies on other features

- **Phase 4 graph traversal** ([`../04-roadmap/PHASE-4-graph-traversal/`](../04-roadmap/PHASE-4-graph-traversal/)) — ships the recursive-CTE foundation that this feature later supersedes for pattern-match
- **Advanced cortex** (Phase 15) — first consumer of pattern-match queries
- **Webhooks event bus** (Phase 13) — outbox infrastructure shared with the graph-sync worker (Neo4j path)
- **Observability suite** (Phase 13) — `omnimind.graph.query.duration` metric required
- **Multi-tenant teams** (Phase 18+) — graph queries must respect team scope; design now even though enforcement comes later
