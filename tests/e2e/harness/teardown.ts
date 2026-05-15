/**
 * Teardown helpers. The heavy lifting (killing the API process, disconnecting
 * Prisma) is in `setup.ts` where the lifecycle state lives — this file just
 * re-exports for symmetry so test files can `import { teardownHarness }`
 * from either path.
 */

export { teardownHarness, resetDatabase } from './setup';
