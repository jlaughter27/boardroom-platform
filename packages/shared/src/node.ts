// @boardroom/shared/node — Node-only utilities (S-103)
//
// Everything here touches a Node built-in (`crypto`) or `process.env` and
// must never be bundled into the browser client. Import as:
//
//   import { sha256Hash, validateEnv } from '@boardroom/shared/node';
//
// The same symbols are temporarily still re-exported from the root barrel for
// the three existing server importers; see the note in ./index.ts.

export { sha256Hash } from './utils/hashing';
export { validateEnv } from './utils/env-validator';
export type { EnvRequirement } from './utils/env-validator';
