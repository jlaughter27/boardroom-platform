# TASK-001: Prisma Schema + Migrations

## Status: ⬜ Ready
## Assigned: Claude Code
## Isolation: Full (only touches packages/omnimind-api/prisma/)

## Objective
Create the complete Prisma schema implementing all entities from the master
framework data model, including the 4-layer memory system, first-class
Decision and Commitment entities, and all normalized join tables.

## Files to Create/Modify
- packages/omnimind-api/prisma/schema.prisma (CREATE)
- packages/omnimind-api/prisma/migrations/ (GENERATED)

## Files to Read First
- docs/MASTER-FRAMEWORK.md (Section 4: Data Model)
- packages/shared/src/types/ (TypeScript interfaces to match)
- docs/contracts/omnimind-api.contract.md (API shapes)

## Do NOT Touch
- Anything in packages/boardroom-ai/
- Anything in packages/shared/ (TASK-004 handles types)

## Requirements
1. All entity tables: memories, decisions, commitments, people, goals,
   projects, tasks, user_profiles, decision_sessions, context_capsules
2. Normalized join tables: project_tasks, project_people, goal_projects,
   decision_projects, decision_assumptions, memory_entity_links,
   task_dependencies, commitment_links
3. Enable extensions: pg_trgm, vector, btree_gin
4. Add embedding vector(1536) column on memories (nullable)
5. Add tsvector column with GIN index for FTS on memories
6. Memory enums: MemoryClass, MemoryStatus, Confidence, SourceType
7. Decision enums: DecisionStatus
8. Commitment enums: CommitmentStatus
9. user_id indexed on every table. All queries must filter by user_id.
10. Soft deletes: deletedAt DateTime? on all entities
11. Optimistic concurrency: version Int @default(1) on all mutable entities
12. Source weighting: sourceWeight Decimal @default(1.0) on memories
13. JSONB metadata column on memories for flexible extension

## Acceptance Criteria
- [ ] `npx prisma migrate dev` runs cleanly
- [ ] `npx prisma generate` produces client without errors
- [ ] All tables match the master framework data model
- [ ] Extensions enabled in migration SQL
- [ ] Every table has userId + createdAt + updatedAt
- [ ] All enums defined and match shared types

## Coordination Note
TASK-004 (shared types) is being built in parallel from the same spec.
Both reference docs/MASTER-FRAMEWORK.md Section 4 as source of truth.
If naming conflicts arise, the master framework wins. Run typecheck
after both complete to catch any drift.
