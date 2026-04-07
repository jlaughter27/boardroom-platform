# Shared Package — @boardroom/shared

## This Package's Job
TypeScript types, Zod validation schemas, constants, and pure utility
functions shared between OmniMind API and BoardRoom AI.

## Rules
- NEVER put business logic here. Types and validation only.
- Every type file maps to a matching Zod schema file. No orphan types.
- Imported as @boardroom/shared by both services.
- Changes here affect both services — run full typecheck after editing.

## Complete Type Inventory
Every type file maps to a Prisma model and a Zod validation schema:
- memory.types.ts → memory.schema.ts (Memory, AtomicFact, MemoryProposal)
- persona.types.ts → persona.schema.ts (PersonaResponse, SynthesisReport)
- entities.types.ts → entities.schema.ts (Person, Goal, Project, Task)
- decision.types.ts → decision.schema.ts (Decision, DecisionOutcome, Assumption)
- commitment.types.ts → commitment.schema.ts (Commitment, CommitmentStatus)
- user-profile.types.ts (UserProfile, RiskProfile, CognitivePattern)
- modes.types.ts (UserMode, ModePersonaMapping)
- api.types.ts (request/response types for all endpoints)

RULE: If you add a type, add the matching Zod schema. No orphan types.

## Utilities (src/utils/)
- hashing.ts — SHA-256 dedup for memory content
- temporal.ts — Date helpers for memory validity (valid_at, invalid_at)
- token-counter.ts — Estimate token counts before LLM calls

## Constants (src/constants/)
- persona-config.ts — Model assignments (Sonnet/Haiku), token budgets
- memory-config.ts — Retention tiers, domain limits, decay rates
- rate-limits.ts — Per-user, per-endpoint rate limit configs
