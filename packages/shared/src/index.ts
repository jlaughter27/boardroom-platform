// @boardroom/shared — Types, validation schemas, constants, and utilities
// Shared between omnimind-api and boardroom-ai services

// Types
export * from './types/memory.types';
export * from './types/persona.types';
export * from './types/entities.types';
export * from './types/decision.types';
export * from './types/commitment.types';
export * from './types/user-profile.types';
export * from './types/modes.types';
export * from './types/api.types';
export * from './types/api-responses';
export * from './types/tool.types';
export * from './types/cortex.types';
export * from './types/calendar.types';
export * from './types/subscription.types';
export * from './types/embedding.types';
export * from './types/custom-persona.types';
export * from './types/simulation.types';
export * from './types/widget.types';
export * from './types/integration.types';
export * from './types/internal.types';
export * from './types/sse-events.types';
export * from './types/context-capsule.types';
export * from './types/utility.types';

// Validation schemas
export * from './validation';

// Constants
export * from './constants/persona-config';
export * from './constants/memory-config';
export * from './constants/rate-limits';
export * from './constants/tool-config';
export * from './constants/cortex-config';

// Utilities
// NOTE (S-103): `hashing` (Node `crypto`) and `env-validator` (`process.env`)
// are Node-only. They are ALSO exported from the `@boardroom/shared/node`
// subpath (src/node.ts) — server code should import from there. They remain
// on the root barrel only because three server files still import them from
// here (boardroom-ai/server/src/services/prompt-cache.ts,
// boardroom-ai/server/src/lib/env.ts, omnimind-api/src/lib/env.ts). Once those
// move to '@boardroom/shared/node', drop the two lines below and the
// `sha256Hash` / `env-validator` re-exports in ./utils/index.ts so the
// browser bundle never sees them.
export * from './utils/hashing';
export * from './utils/temporal';
export * from './utils/token-counter';
export * from './utils/env-validator';
export * from './utils';
