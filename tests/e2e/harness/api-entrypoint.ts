/**
 * Tiny entrypoint the harness spawns instead of the package's main index.ts.
 *
 * Why this exists: `packages/omnimind-api/src/index.ts` runs
 * `validateOmniMindEnv()` (which requires OPENAI_API_KEY + ANTHROPIC_API_KEY
 * to be set to truthy values) UNLESS `NODE_ENV === 'test'`. But under
 * `NODE_ENV === 'test'` it also skips `app.listen()`, which we need for the
 * subprocess to bind a port.
 *
 * We bridge the gap: set NODE_ENV=test (skips validator AND skips listen),
 * import the express app, then call listen() ourselves.
 *
 * This keeps the production source code untouched — no test-only flags
 * leaking into runtime paths. WS-5 is strictly additive (test files only).
 *
 * Implementation note: we use `require()` for the source imports, NOT ES
 * `import`. The TypeScript compiler (and tsx) hoist all `import` statements
 * to the top of the emitted CJS, before any other module-body code — so an
 * `import` would evaluate index.ts BEFORE our NODE_ENV mutation took effect.
 * Module-body `require()` runs in source order, which is what we need here.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

process.env.NODE_ENV = 'test';

interface LoggerLike {
  info: (msg: string, extra?: Record<string, unknown>) => void;
}

const { logger } = require('../../../packages/omnimind-api/src/lib/logger') as {
  logger: LoggerLike;
};

// `default` is an Express Application; we don't import the @types here to
// keep this entrypoint dependency-light.
interface ExpressLike {
  listen: (port: number, cb: () => void) => unknown;
}

const app = require('../../../packages/omnimind-api/src/index').default as ExpressLike;

const port = parseInt(process.env.PORT ?? process.env.OMNIMIND_PORT ?? '3399', 10);

app.listen(port, () => {
  logger.info(`[e2e-harness] OmniMind API listening on :${port}`);
  // Stamp on stderr too so the parent process can grep for readiness if it
  // needs to bypass the /health probe.
  // eslint-disable-next-line no-console
  console.error(`[e2e-harness-ready] port=${port}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
