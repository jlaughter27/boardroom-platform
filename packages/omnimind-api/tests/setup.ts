// Vitest global setup for omnimind-api tests.
//
// This file is referenced by vitest.config.ts (setupFiles). It was missing
// pre-WS-7, which caused every test file in this package to fail at the
// file-collection step (18 file-level FAILs hiding 0 actual test failures).
//
// If a real setup is needed in the future (DB seed, env loading, global mocks),
// add it here.
export {};
