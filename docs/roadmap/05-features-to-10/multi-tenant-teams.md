# Multi-Tenant Teams

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). This is the largest single architectural lift in the roadmap.

---

## Problem

OmniMind is single-user only today. The Prisma schema already includes `Team` and `TeamMember` models — they're scaffolded but not wired into the auth layer, the retrieval layer, or any service. Every memory, decision, and entity is scoped by `userId`. Every session belongs to one user.

That hard wall is fine — and arguably correct — for the current ICP (solo founders, indie hackers, consultants). It becomes a ceiling the moment any of these happen:

- A founder hires a chief of staff and wants them to share BoardRoom context
- A consultancy wants every consultant to have the same client context for handoffs
- A team wants a shared "company-wide cortex" that synthesizes across members
- An enterprise prospect asks "can my five-person leadership team use this together"

Solving it is a big lift. Multi-tenancy in an AI memory system has more failure modes than in a typical SaaS because **memory itself is the product**, and per-row access controls have to apply at retrieval time, at synthesis time, at cortex job time, and at every export/delete pipeline. There is no part of the system that doesn't need to know about scopes.

This is **deferred until Phase 18+**, after the foundational features (MCP, SDK, observability, cost controls, GDPR pipeline) are in place. Shipping it earlier risks encoding shaky assumptions into every other feature.

## Approach

### Three scope tiers

Every memory, decision, and entity gets a `scope` triple: `{ ownerId, teamId, visibility }`.

- `visibility = "private"` — only `ownerId` reads it
- `visibility = "team"` — all `TeamMember`s of `teamId` read it
- `visibility = "team_admins"` — only team admins read it (sensitive HR/legal context)

Default visibility per writer:
- Solo user: `private`
- Team member writing in a team session: `team`
- User can override per memory in the editor

### Role-based access

Three roles inside a team:

- **Owner** — billing, member management, can delete the team
- **Admin** — invite/remove members, configure team-wide cortex, see audit logs
- **Member** — read team memories, write team memories, invoke personas with team context

Permissions enforced at the route layer (Express middleware) and at the data layer (Prisma extensions that auto-apply scope filters per request).

### Team-wide cortex

A second cortex layer that runs on the team's union of memories and emits team-scoped outputs:

- **Team weekly memo** — synthesizes across all members' weeks
- **Team contradiction alerts** — facts disagreeing across members ("Alex thinks the launch is May 1; Jamie thinks April 22")
- **Cross-member pattern detection** — themes recurring across the team's combined memory

Per-user cortex still runs independently. Team cortex is additive, not a replacement.

### Shared entities, scoped memories

Entities (Person, Project, Goal, Task) are shared across the team by default — there's exactly one `Project: Q2 Launch`, not one per member. Memories *about* that entity are individually scoped: a private 1:1 conversation about Q2 Launch stays private; a team standup transcript is team-visible.

This requires entity dedup at write time across team members. Already a hard problem for a single user; multi-tenant makes it harder.

### Retrieval impact

Every retrieval query gains a scope filter:

```sql
WHERE (
  owner_id = $userId AND visibility = 'private'
) OR (
  team_id = $userTeamId AND visibility = 'team'
) OR (
  team_id = $userTeamId AND visibility = 'team_admins' AND $userIsAdmin
)
AND deleted_at IS NULL
```

Indexes need a rebuild — composite `(team_id, visibility, deleted_at)` plus the existing pgvector indexes scoped per team for efficient HNSW search.

## Schema impact

```prisma
model Team {
  id          String   @id @default(cuid())
  name        String
  ownerId     String
  plan        String   @default("team_starter")
  createdAt   DateTime @default(now())
  deletedAt   DateTime?
  members     TeamMember[]
  // ... billing, settings ...
}

model TeamMember {
  id        String   @id @default(cuid())
  teamId    String
  userId    String
  role      String   // "owner" | "admin" | "member"
  joinedAt  DateTime @default(now())
  deletedAt DateTime?

  team      Team     @relation(fields: [teamId], references: [id])
  user      User     @relation(fields: [userId], references: [id])

  @@unique([teamId, userId])
}

// Add to MemoryEntry, Decision, Person, Goal, Project, Task:
model MemoryEntry {
  // ... existing fields ...
  ownerId     String
  teamId      String?
  visibility  String   @default("private") // "private" | "team" | "team_admins"

  @@index([teamId, visibility, deletedAt])
  @@index([ownerId, deletedAt])
}
```

The migration is the largest single schema change in OmniMind history. Backfill: every existing row gets `ownerId = userId`, `teamId = null`, `visibility = "private"`. Solo users see no behavior change.

## API surface

- `POST /v1/teams` — create
- `POST /v1/teams/:id/invitations` — invite
- `POST /v1/teams/:id/members/:userId/role` — change role
- `DELETE /v1/teams/:id/members/:userId` — remove (cascade soft-delete their team memories)
- `GET /v1/teams/:id/cortex/weekly-memo` — team-wide cortex outputs
- All existing memory/decision/entity routes gain optional `?teamId=` filter

## Phases

- [`../04-roadmap/PHASE-DEFERRED/`](../04-roadmap/PHASE-DEFERRED/) — slot as Phase 18+ after the foundations are stable; revisit when paying-user count exceeds 1,000 OR when a strategic enterprise deal demands it
- Estimated effort: **8-12 weeks of focused work**, plus ongoing maintenance burden across every other feature

## Risks

- **Cross-team data leakage.** A scope filter forgotten in one query exposes another team's data. Mitigation: Prisma middleware that auto-applies scope filters AND CI gate that fails any query missing a `teamId` predicate; integration tests that simulate a malicious team trying to read another's data; security review by an external firm before launch.
- **Cortex job blast radius.** A team-wide cortex job that runs over hundreds of members' memories blows up token cost and runtime. Mitigation: per-team cortex budget cap; chunked processing; defer team cortex until per-team < 50 members has been validated.
- **Entity dedup gets harder.** "Q2 Launch" in two team members' contexts is the same entity; "John" might be different Johns. Mitigation: confirm-on-merge UX; per-team canonicalization service.
- **Billing complexity.** Per-seat pricing, overage handling, downgrades that strand data. Mitigation: build pricing into Phase 18's per-tenant cost controls so it's already there when teams launch.
- **Migration risk.** Adding scope columns to live tables on a single Postgres instance is a long blocking operation. Mitigation: use `ALTER TABLE ... ADD COLUMN ... DEFAULT NULL` (non-blocking), backfill in batches, then add the NOT NULL constraint last.
- **Enterprise SSO + SCIM expectations.** Enterprises want SAML/SCIM, not magic links. Mitigation: deferred until paying enterprise demand exists; WorkOS integration is the reasonable answer.

## Success metrics

- Zero cross-team data leakage incidents in the first 12 months
- p95 retrieval latency stays under 1.5s with team-scoped queries (validated under load test)
- ≥ 5 paying teams within 90 days of launch
- ≥ 80% of team members invoke team-wide cortex outputs at least weekly
- Team cortex token cost per member ≤ 1.5x solo cortex (proxy for fanout efficiency)

## Dependencies on other features

- **Per-tenant cost controls** (Phase 18) — extends naturally to per-team caps and per-seat billing
- **GDPR data export + deletion** (Phase 18) — team-member removal must cascade their personal scope cleanly without affecting team-shared data
- **Observability suite** (Phase 14) — every metric needs a `team_id` tag added
- **Webhooks event bus** (Phase 12) — team-scoped events (`team.member.added`, `team.cortex.memo.published`) extend the taxonomy
- **Persona marketplace** (Phase 17) — teams want curated team-wide persona installs; install scope = team, not user
