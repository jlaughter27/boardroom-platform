# Task Index

## Phase 0: Foundation & Memory Core (Weeks 1-5) - IN PROGRESS

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 001 | Prisma schema + migrations | Done | Claude | None | Full |
| 002 | Memory CRUD endpoints | Active | Claude | 001 | Full |
| 003 | Sync validation pipeline | Active | Claude | 001 | Full |
| 004 | Shared types + Zod schemas | Done | DeepSeek | None | Full |
| 005 | Hybrid retrieval engine | ⬜ Blocked | Claude | 001, 004 | Full |
| 006 | Seed data generator | ⬜ Blocked | DeepSeek | 001 | Full |
| 007 | Utility functions (hash, dates, tokens) | Done | DeepSeek | None | Full |
| 008 | Docker Compose + dev setup | Done | DeepSeek | None | Full |
| 009 | Custom agent runtime | Active | Claude | 004 | Full |
| 010 | Onboarding flow (frontend) | ⬜ Blocked | Claude | 002 | Partial |
| 011 | Entity CRUD routes (people, goals, projects, tasks) | Active | Claude | 001 | Full |
| 012 | Decision + Commitment routes | Active | Claude | 001 | Full |
| 013 | Context assembler + cross-entity search | ⬜ Blocked | Claude | 005, 011 | Full |
| 014 | Golden test scenarios (50) | Done | DeepSeek | None | Full |
| 015 | pgvector + embedding generation | ⬜ Blocked | Claude | 001, 005 | Full |

## Phase 1: Multi-Persona Intelligence (Weeks 6-10) - DEFERRED

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 100 | Persona prompts (all 7) | ⬜ Blocked | Claude | 009 | Full |
| 101 | Parallel dispatch + streaming | ⬜ Blocked | Claude | 009, 100 | Full |
| 102 | CEO synthesis | ⬜ Blocked | Claude | 101 | Full |
| 103 | Sufficiency scoring + ambiguity router | ⬜ Blocked | Claude | 009 | Full |
| 104 | Session-to-memory extraction pipeline | ⬜ Blocked | Claude | 002, 009 | Full |
| 105 | Commitment tracking + follow-ups | ⬜ Blocked | Claude | 012 | Full |
| 106 | Export decision packages | ⬜ Blocked | Claude | 102 | Full |
| 107 | Eval runners (retrieval, personas, e2e) | ⬜ Blocked | DeepSeek | 014 | Full |
| 108 | Rate limiting + prompt caching + cost tracking | ⬜ Blocked | Claude | 101 | Full |

## Phase 2: Dashboard & Intelligence Layer - DEFERRED

Features are described in docs/tasks/phase-2/ as specifications.
Will be implemented after Phase 3 core features.

| ID | Feature | Depends On | Notes |
|----|---------|-----------|-------|
| 020 | Thinking Pattern Detection | Curator + 200+ memories | May extend curator.ts or become new module |
| 021 | Weekly Intelligence Briefing | User profile + decision journal | May be a cron job or async worker |
| 022 | Cross-Project Collision Scan | Entity links + project deadlines | May extend context-assembler or be standalone |
| 023 | Decision Simulation / Pre-Mortem | Full persona system + outcome data | Extension of Critic persona, not separate engine |

## Phase 3: Agentic Upgrades + External Cortex (SPRINT 3) - ACTIVE

Phase 3 transforms the multi-persona decision tool into a cognitive co-pilot with tool use,
thinking pattern detection, contradiction alerts, and proactive intelligence delivery.

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 300 | Phase 3 Types & Contracts | ⬜ Ready | Claude | 004 | Full |
| 301 | Tool-Enabled Agent Runtime | ⬜ Ready | Claude | 009 | Full |
| 302 | Google Calendar Integration | ⬜ Ready | Claude | 300 | Full |
| 303 | Stripe Subscription System | ⬜ Ready | Claude | 300 | Full |
| 304 | Cortex Intelligence Layer | ⬜ Ready | Claude | 300 | Full |
| 305 | Proactive Notification System | ⬜ Ready | Claude | 304 | Full |
| 306 | Launch Readiness & Polish | ⬜ Ready | Claude | 301-305 | Full |

## Status Legend
- ⬜ Ready: Can start now
- ⬜ Blocked: Waiting on dependencies
- Active: Currently being worked on
- Done: Completed and verified
