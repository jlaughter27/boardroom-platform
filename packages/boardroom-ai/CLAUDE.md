# BoardRoom AI — Frontend + Persona Orchestration

## This Service's Job
Beautiful executive dashboard. Multi-persona decision analysis. Streaming
responses. Session management. User authentication.

## What I Own
- React frontend (client/)
- Agent runtime + persona orchestration (server/src/agents/)
- Persona prompt loading + context strategy (server/src/personas/)
- User auth (JWT + httpOnly cookies)
- Decision sessions (create, stream, export)
- All UI components and state management

## What I Do NOT Own
- Persistent data storage (-> OmniMind API)
- Memory validation or retrieval (-> OmniMind API)
- I call OmniMind via HTTP for ALL data operations

## OmniMind Integration
- Client: server/src/services/omnimind-client.ts
- Auth: API key in x-api-key header
- Base URL: OMNIMIND_API_URL env var (default http://localhost:3333)
- Before any persona fires, call POST /context/for-persona to get context

## Agent Runtime (server/src/agents/)
~200 lines total. No frameworks.
- agent.ts: Base class (spawn, reason, validate)
- orchestrator.ts: CEOOrchestrator (parallel dispatch, synthesis, modes)
- sufficiency.ts: Context sufficiency scoring (fires before personas)
- streaming.ts: SSE helpers for real-time response delivery

## Persona System
- Prompts loaded from docs/prompts/*.system.md at startup (not hardcoded)
- Context strategy in server/src/personas/context-strategy.ts
- Each persona gets DIFFERENT memory slices (see docs/MASTER-FRAMEWORK.md)
- Modes (Decide/StressTest/Plan/Quick) map to persona combos in mode-router.ts

## Frontend (client/)
- React + TypeScript + Tailwind + Vite
- Pages: Dashboard, DecisionLab, MemoryExplorer, PeopleDirectory, Settings
- State: Zustand stores (session.store.ts, ui.store.ts)
- Streaming: hooks/useStreaming.ts parses SSE events

## Running
- `npm run dev` — starts server on 3001, client on 5173
- `npm run test` — all tests
- `npm run build` — production build
