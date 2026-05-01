// Utility exports - TASK-007 (Utility functions)
// Central export file for all utility functions

// Hash utilities
// NOTE: ./hash and ./token were moved to ./_disabled/ — they imported
// bcryptjs and jsonwebtoken which use Node's `util` module and break
// when bundled into the browser. They had ZERO consumers anywhere in
// the codebase (the real auth middleware in boardroom-ai/server uses
// bcryptjs and jsonwebtoken directly). Re-add to barrel only if you
// move the implementations to a server-only package.
export { sha256Hash } from './hashing';

// Date utilities
export * from './date';
export * from './temporal';

// Token utilities (counting only — JWT generation lives in _disabled/)
export * from './token-counter';

// Environment validation
export * from './env-validator';

// String utilities
export * from './string';

// Number utilities  
export * from './number';

// Validation helpers
export * from './validation-helpers';