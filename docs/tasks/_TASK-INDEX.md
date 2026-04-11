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

## Phase 3: Agentic Upgrades + External Cortex - DEFERRED

Phase 3 transforms the multi-persona decision tool into a cognitive co-pilot with tool use,
thinking pattern detection, contradiction alerts, and proactive intelligence delivery.
Will be implemented after Phase 4 core features.

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 300 | Phase 3 Types & Contracts | ⬜ Ready | Claude | 004 | Full |
| 301 | Tool-Enabled Agent Runtime | ⬜ Ready | Claude | 009 | Full |
| 302 | Google Calendar Integration | ⬜ Ready | Claude | 300 | Full |
| 303 | Stripe Subscription System | ⬜ Ready | Claude | 300 | Full |
| 304 | Cortex Intelligence Layer | ⬜ Ready | Claude | 300 | Full |
| 305 | Proactive Notification System | ⬜ Ready | Claude | 304 | Full |
| 306 | Launch Readiness & Polish | ⬜ Ready | Claude | 301-305 | Full |

## Phase 4: Intelligence Layer + Scale Features - DEFERRED

Phase 4 completes the retrieval engine (semantic search), adds user-definable personas,
improves synthesis quality, builds decision simulations, and creates dynamic widget +
relationship visualization systems that make the product sticky.
Will be implemented after Phase 5 pre-launch hardening.

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 400 | Pgvector Semantic Search — Completing the 4th Retrieval Layer | ⬜ Ready | Claude | 001, 005 | Full |
| 401 | Custom Persona Creation | ⬜ Ready | Claude | 100, 300 | Full |
| 402 | Improved Synthesis + Outcome-Informed Reasoning | ⬜ Ready | Claude | 100, 300 | Full |
| 403 | Lightweight Decision Simulations | ⬜ Ready | Claude | 300, 304 | Full |
| 404 | Dynamic Widget System | ⬜ Ready | Claude | 002, 011 | Full |
| 405 | Relationship Visualization + Enhanced Memory Linking | ⬜ Ready | Claude | 011, 013 | Full |
| 406 | API Hub V1 — Email-to-Memory Integration | ⬜ Ready | Claude | 300, 302 | Full |

## Phase 5: Pre-Launch Hardening + Railway Deployment - DEFERRED

Phase 5 focuses on production readiness, deployment infrastructure, and end-to-end testing
to prepare for v1.0 launch.
Will be implemented after Phase 6 scale features.

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 500 | Static File Serving in Production | ⬜ Ready | Claude | 002 | Full |
| 501 | Environment Variable Validation at Startup | ⬜ Ready | Claude | 004 | Full |
| 502 | Railway Configuration Files | ⬜ Ready | Claude | 008 | Full |
| 503 | Docker Compose Updates for Local Development | ⬜ Ready | Claude | 008 | Full |
| 504 | E2E Test Suite (3 Critical Flows) | ⬜ Ready | DeepSeek | 014 | Full |
| 505 | Fix Skipped Tests | ⬜ Ready | DeepSeek | 014 | Full |
| 506 | Prisma Migration Audit | ⬜ Ready | Claude | 001 | Full |
| 507 | Production Readiness Checklist Script | ⬜ Ready | Claude | 008 | Full |
| 508 | Railway Deployment Guide | ⬜ Ready | Claude | 008 | Full |

## Phase 6: Scale & Growth Features - DEFERRED

Phase 6 focuses on scale features for growth from 100→2000+ users, including
team boards, enterprise features, mobile app, and multi-model evaluation.
Will be implemented after Phase 7 future vision features.

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 600 | Team Boards (Shared Decisions) | ⬜ Ready | Claude | 300, 304 | Full |
| 601 | Role-Based Access Control | ⬜ Ready | Claude | 300, 600 | Full |
| 602 | Mobile App (React Native) | ⬜ Ready | DeepSeek | 002, 011 | Full |
| 603 | Multi-Model Evaluation (Gemini Flash, DeepSeek) | ⬜ Ready | Claude | 004 | Full |
| 604 | Enterprise Features: SSO, Audit Trails | ⬜ Ready | Claude | 500, 501 | Full |
| 605 | SOC2 Compliance Preparation | ⬜ Ready | Claude | 604 | Full |
| 606 | Knowledge Graph Implementation | ⬜ Ready | Claude | 400, 405 | Full |
| 607 | Novelty Personas (Celebrity/Historical) | ⬜ Ready | Claude | 100, 401 | Full |

## Phase 7: Future Vision & Advanced AI (SPRINT 7) - ACTIVE

Phase 7 focuses on advanced AI capabilities, predictive analytics, and
next-generation features beyond the current roadmap.

| ID | Task | Status | Agent | Dependencies | Isolation |
|----|------|--------|-------|-------------|-----------|
| 700 | Predictive Analytics Engine | ⬜ Ready | Claude | 304, 400 | Full |
| 701 | Advanced Decision Simulations (Monte Carlo) | ⬜ Ready | Claude | 403, 400 | Full |
| 702 | Real-time Collaboration Features | ⬜ Ready | Claude | 600, 601 | Full |
| 703 | Advanced Knowledge Graph with Temporal Reasoning | ⬜ Ready | Claude | 606, 400 | Full |
| 704 | AI-Powered Research Assistant | ⬜ Ready | Claude | 300, 406 | Full |
| 705 | Automated Outcome Analysis & Learning | ⬜ Ready | Claude | 304, 400 | Full |
| 706 | Cross-Platform Integration Hub | ⬜ Ready | Claude | 406, 600 | Full |
| 707 | Advanced Personalization Engine | ⬜ Ready | Claude | 304, 400 | Full |

## Status Legend
- ⬜ Ready: Can start now
- ⬜ Blocked: Waiting on dependencies
- Active: Currently being worked on
- Done: Completed and verified
