# DEF-015 — Multi-User Collaborative Rooms

**Capability:** Multiple users co-present in the same `Room`, sharing session context, seeing each other's questions and persona invocations in real time, with persona outputs visible to all participants. The original product spec's Phase 4 vision: "BoardRoom AI" as a multi-player decision room, not just a solo-founder tool.

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE:**
Roadmap re-prioritization decision — i.e., a deliberate strategic call by the founder + advisors that multi-user collaboration is the next-most-important product investment after the current roadmap (Phases 0-19) ships. Driven by signal like: a B2B customer asking, eval evidence that solo decision-making is not the wedge product expects, or the founder simply pivoting product direction.

This is not a measurable trigger like the others. It's an intentional strategic reset.

**Work estimate when triggered:** 6-8 weeks.

Breakdown:
- 1 week: schema. `Room`, `Participant`, `RoomInvitation`, `RoomPermission` tables exist in stub form per CLAUDE.md ("Future: multi-user rooms (stub: `// app.use('/rooms', roomsRouter)` in index.ts)") — enrich with real fields. Per-room shared `SessionContext` model.
- 2 weeks: real-time fanout. SSE per-room broadcast: each persona invocation streams to all participants. Requires per-room subscriber registry; either in-memory (single replica) or Postgres LISTEN/NOTIFY (multi-replica from Phase 19 onward). Sticky sessions per room (Phase 19 sticky-session pattern extends naturally).
- 2 weeks: collaboration UX. BoardRoom client renders co-presence (who's in the room, who's typing, whose question is being answered now). Avatars, typing indicators, attention model.
- 1 week: permissions + invitations. Email-based invitations, role enum (owner / member / viewer), revocation, per-room rate-limit interplay with the per-user rate-limit from Phase 18.
- 1 week: data model implications. Memories created in a room — whose memory store do they belong to? Options: (a) the room owner's, (b) shared room-scoped memory pool, (c) each participant gets a copy. (b) is cleanest but requires extending the entire entity-link model with a `roomId` axis. Decision needs an ADR.
- 1 week: eval + rollout.

**Why deferred:**

1. **Wedge focus.** The current roadmap targets solo founders, indie hackers, and consultants — explicitly individual-mode users. Multi-player adds substantial UX complexity that distracts from polishing the core single-user experience.
2. **Architectural cost.** Every existing data model is single-user. Extending to room-scoped semantics adds a `roomId` (or `tenantId` in the broader sense) axis to memories, decisions, entities, links — a meaningful refactor.
3. **No paying B2B customer asking.** Until a real B2B opportunity surfaces, the work is speculative.
4. **Phase 19 prerequisite.** Multi-user rooms only make sense when the API is multi-replica with sticky-session SSE. Phase 19 ships that infrastructure; multi-user rooms can't precede it.

**Stub status today:**
- `// app.use('/rooms', roomsRouter)` exists commented in `packages/boardroom-ai/server/src/index.ts`
- `Room`, `Participant` tables exist in `packages/omnimind-api/prisma/schema.prisma` from the original spec
- No code wires them up
- No UX renders them

**References:**
- CLAUDE.md "Phase Status" table — Phase 4+ Collaboration is Future
- Original product spec in `docs/MASTER-FRAMEWORK.md` — full multi-user vision
- `docs/roadmap/04-roadmap/PHASE-19-horizontal-api-scale/` — sticky-session SSE pattern that this would extend

**Anti-pattern to avoid when triggering:**
Don't ship multi-user rooms before Phase 19. The single-instance API cannot serve room-scoped SSE fanout reliably; sticky sessions and PgBouncer are prerequisites. Sequencing: Phase 19 first, then multi-user rooms as a follow-on phase (likely 2-3 phases of subdivided work).
