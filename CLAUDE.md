# BoardRoom Platform — Principal Architect's Guidelines

> **For ongoing work:** the operator-ready dev roadmap lives at [`docs/roadmap/`](docs/roadmap/) — start there for any new task. This file captures the architectural principles that the roadmap respects; the roadmap is the live execution layer.

## Core Architectural Principles
1. **Cognitive Cohesion**: Personas analyze, Roadmap plans, Tasks execute—all share state via OmniMind's structured entities.
2. **Structured Entity Graph**: Goals → Projects → Tasks form a DAG with temporal constraints.
3. **Persona-Aware Context**: Personas receive tailored context but share common entity graph understanding.
4. **Proactive Intelligence**: System detects gaps, surfaces contradictions, suggests roadmap adjustments.

## Service Boundaries (Non-Negotiable)
| Service | Owns | Never Owns |
|---------|------|------------|
| **BoardRoom AI** | Persona orchestration, UI state, session flow, streaming | Persistent data, entity validation, cross-session state |
| **OmniMind API** | All persistent data, entity relationships, validation, background intelligence | Persona logic, UI components, streaming mechanics |
| **Shared Package** | Type definitions, Zod schemas, constants, pure utilities | Business logic, state management, I/O operations |

**Rule**: BoardRoom → OmniMind via HTTP only. No direct database access.

## Module Integration Gaps

### 1. Persona Module (BoardRoom)
- **Current**: Siloed context per persona via `context-strategy.ts`
- **Gap**: No shared session state; personas don't reference roadmap context
- **Fix**: Unified `SessionContext { goals, projects, tasks, decisions }` shared across personas

### 2. Roadmap Module (OmniMind)  
- **Current**: Goal/Project/Task entities exist but lack temporal planning
- **Gap**: No critical path analysis, milestone tracking, or timeline visualization
- **Fix**: Add `RoadmapService` with `/roadmap` endpoints for timeline analysis

### 3. Task Management Module (OmniMind)
- **Current**: Isolated CRUD operations
- **Gap**: No integration with persona analysis for prioritization or extraction
- **Fix**: Task extraction pipeline from decisions, effort validation against historical data

### 4. State Sharing Gap
- **Current**: Each persona gets different context slices
- **Target**: Shared session context with roadmap-aware entity chains
- **Integration**: Active goals → linked projects → critical path tasks → involved people

## Coding Conventions
- **TypeScript**: `interface` over `type`, strict null checks, barrel exports
- **Validation**: Zod schemas for all entities, runtime validation at boundaries
- **Entities**: Maintain Goal→Project→Task relationships via link tables
- **Prompts**: Live in `docs/prompts/*.system.md`, loaded at runtime

## State Management Rules
1. **Single Source of Truth**: OmniMind owns all persistent state
2. **Session State**: BoardRoom manages ephemeral session state
3. **Entity Consistency**: Maintain referential integrity via Prisma relations
4. **Cache Invalidation**: Invalidate on entity writes

## Integration Patterns to Implement
1. **Roadmap-Aware Context**: Include active goals, linked projects, critical tasks, involved people
2. **Task Extraction**: Doer proposes tasks, Technician validates, system creates with proper links
3. **Progress Tracking**: Weekly cortex jobs compare actual vs planned, detect slippage

## Future Direction
- **Phase 2.5**: RoadmapService with timeline analysis and critical path
- **Phase 3**: Proactive task management with extraction pipeline
- **Phase 4**: Unified session state with persona-to-persona messaging

## Anti-Patterns to Avoid
1. Direct DB access from BoardRoom
2. Bypassing Zod validation
3. Hardcoded persona logic in TypeScript
4. Ignoring Goal→Project→Task relationships
5. Siloed persona analysis without shared context

## Success Metrics
1. Persona responses reference related goals/projects/tasks
2. System detects and surfaces roadmap deviations
3. Automated task extraction with proper linking
4. "The system understands my priorities" user feedback

---
*Lines: 76/150 | Last updated: 2026-04-11*