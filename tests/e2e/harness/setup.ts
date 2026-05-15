/**
 * E2E harness — Postgres + OmniMind API lifecycle.
 *
 * Why a real harness (not mocks):
 *   The 4 Hermes bugs (agent_id NULL, cross-tenant leak, sourceWeight ignored,
 *   embedding never persists) all live IN THE SEAM between layers. Mocks
 *   replace the seam — they make the layer above pass while the actual
 *   wiring is broken. The only way to catch them is to spin up the real
 *   stack and assert on real DB rows.
 *
 * Stack the harness brings up:
 *   1. Test Postgres (docker-compose.test.yml, port 5433)
 *      - REQUIRED: `docker-compose -f docker-compose.test.yml up -d postgres-test`
 *      - The harness will assert it's reachable and fail with a clear message
 *        if not. We don't auto-start docker from Node (too many footguns:
 *        missing daemon, permission issues, port collisions).
 *   2. Prisma migrations applied to the test DB (extensions + tables)
 *      - Idempotent — `prisma db push` is used so we don't depend on
 *        migration baseline state.
 *   3. OmniMind API as a subprocess (tsx-run from packages/omnimind-api/src/index.ts)
 *      - Bound to `TEST_OMNIMIND_PORT` (default 3399) to avoid clashing
 *        with any dev instance.
 *      - Pointed at the test DB via `DATABASE_URL`.
 *      - All embedding traffic stubbed via missing `OPENAI_API_KEY` so the
 *        outbox path is exercised but no real network calls.
 *
 * The MCP stdio server is spawned per-test by `mcp-client.ts` (cheap, ~50 ms).
 *
 * Tests should call `setupHarness()` in `beforeAll` and `teardownHarness()`
 * in `afterAll`. Each test gets a clean DB via `resetDatabase()`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as path from 'node:path';
import * as net from 'node:net';

export interface HarnessConfig {
  /** Postgres connection string for the test DB. */
  databaseUrl: string;
  /** Port the test OmniMind API binds to. */
  apiPort: number;
  /** Base URL of the test API (computed from apiPort). */
  apiBaseUrl: string;
  /** The shared OMNIMIND_API_KEY used by both API and MCP. */
  apiKey: string;
}

export interface Harness {
  config: HarnessConfig;
  prisma: PrismaClient;
}

const DEFAULT_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://test_user:test_password@localhost:5433/boardroom_test';
const DEFAULT_API_PORT = parseInt(process.env.TEST_OMNIMIND_PORT ?? '3399', 10);
const DEFAULT_API_KEY = 'e2e-harness-api-key';

let apiProcess: ChildProcess | null = null;
let prismaClient: PrismaClient | null = null;

/**
 * Check Postgres reachability via a TCP probe. Faster + lighter than spawning
 * psql, and doesn't depend on Postgres client tooling being installed.
 */
async function isPostgresReachable(databaseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const url = new URL(databaseUrl);
  const host = url.hostname;
  const port = parseInt(url.port || '5432', 10);

  return new Promise<boolean>(resolve => {
    const socket = new net.Socket();
    const onDone = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => onDone(true));
    socket.once('timeout', () => onDone(false));
    socket.once('error', () => onDone(false));
    socket.connect(port, host);
  });
}

/**
 * Apply schema via `prisma db push` against the test DB. Idempotent — safe to
 * call multiple times. This intentionally skips the migration baseline dance
 * the production entrypoint does because the test DB is ephemeral.
 */
async function applyMigrations(databaseUrl: string): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const apiDir = path.join(repoRoot, 'packages/omnimind-api');
  const prismaBin = path.join(apiDir, 'node_modules/.bin/prisma');

  // 1. Enable extensions (idempotent).
  await runCommand(
    prismaBin,
    [
      'db',
      'execute',
      '--schema',
      'prisma/schema.prisma',
      '--stdin',
    ],
    {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdin: 'CREATE EXTENSION IF NOT EXISTS vector;\nCREATE EXTENSION IF NOT EXISTS pg_trgm;\n',
    }
  );

  // 2. Push schema. `--accept-data-loss` is safe — this is the test DB.
  await runCommand(
    prismaBin,
    ['db', 'push', '--schema', 'prisma/schema.prisma', '--accept-data-loss', '--skip-generate'],
    {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    }
  );
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeoutMs = opts.timeoutMs ?? 60000;
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
    }, timeoutMs);

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => (stdout += String(d)));
    proc.stderr?.on('data', d => (stderr += String(d)));

    proc.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    proc.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });

    if (opts.stdin !== undefined) {
      proc.stdin?.write(opts.stdin);
      proc.stdin?.end();
    }
  });
}

/**
 * Start the OmniMind API as a subprocess on `apiPort`, talking to the test DB.
 * Waits for `/health` to return 200 before resolving.
 */
async function startApiServer(config: HarnessConfig): Promise<ChildProcess> {
  const repoRoot = path.resolve(__dirname, '../../..');

  // The harness's own entrypoint sets NODE_ENV=test (skips validator + the
  // index.ts auto-listen) then calls app.listen() itself. This lets us run
  // without OPENAI_API_KEY / ANTHROPIC_API_KEY being real — embedding +
  // extraction failures are exactly the paths E2E-4 wants to exercise.
  const apiEntrypoint = path.join(repoRoot, 'tests/e2e/harness/api-entrypoint.ts');

  const apiEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: config.databaseUrl,
    OMNIMIND_API_KEY: config.apiKey,
    PORT: String(config.apiPort),
    OMNIMIND_PORT: String(config.apiPort),
    // Empty (not absent) keys: NODE_ENV=test skips validateOmniMindEnv, so
    // empty is allowed. Empty is BETTER than a placeholder because
    // getOpenAIClient() returns null immediately on empty — no retry storm,
    // no 401 round-trips. The outbox-pending state is reached on the first
    // call (E2E-4's exact assertion).
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
  };

  // Use the omnimind-api package's local tsx so we don't depend on a root
  // install of tsx. Each workspace package owns its own tsx — pnpm hoists
  // them but the .bin symlink is per-package.
  const tsxBin = path.join(repoRoot, 'packages/omnimind-api/node_modules/.bin/tsx');

  const proc = spawn(tsxBin, [apiEntrypoint], {
    cwd: repoRoot,
    env: apiEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Pipe stderr so failures are debuggable but don't pollute the test report.
  let logBuf = '';
  proc.stderr?.on('data', d => {
    logBuf += String(d);
    // Print on bring-up failure or known crashes.
    if (logBuf.includes('FATAL') || logBuf.includes('Error:')) {
      process.stderr.write(`[api] ${String(d)}`);
    }
  });
  proc.stdout?.on('data', d => {
    logBuf += String(d);
  });

  // Wait for /health.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`API process exited prematurely (code ${proc.exitCode}). Logs:\n${logBuf}`);
    }
    try {
      const res = await fetch(`${config.apiBaseUrl}/health`);
      if (res.ok) return proc;
    } catch {
      // not ready yet
    }
    await sleep(250);
  }

  proc.kill('SIGKILL');
  throw new Error(`API failed to become healthy within 30s. Last log:\n${logBuf.slice(-2000)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Wipe all rows from the tables we touch in tests. Call between tests to keep
 * isolation. We TRUNCATE rather than drop because the schema doesn't change
 * between tests — just the data.
 *
 * Order matters: child tables before parent tables (FK constraints).
 */
export async function resetDatabase(harness: Harness): Promise<void> {
  // CASCADE handles any leftover FKs we didn't explicitly enumerate.
  await harness.prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "embedding_outbox",
      "mcp_audit_logs",
      "memory_entries",
      "agents",
      "users"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Start the harness: Postgres reachability check → migrations → API process.
 *
 * Fails fast with an actionable message if Postgres isn't running so the
 * test author isn't left wondering why everything timed out.
 */
export async function setupHarness(): Promise<Harness> {
  const config: HarnessConfig = {
    databaseUrl: DEFAULT_DB_URL,
    apiPort: DEFAULT_API_PORT,
    apiBaseUrl: `http://localhost:${DEFAULT_API_PORT}`,
    apiKey: DEFAULT_API_KEY,
  };

  if (!(await isPostgresReachable(config.databaseUrl))) {
    throw new Error(
      `Test Postgres not reachable at ${config.databaseUrl}.\n\n` +
        `Start it first:\n` +
        `  docker-compose -f docker-compose.test.yml up -d postgres-test\n\n` +
        `Then re-run \`pnpm test:e2e\`.\n` +
        `See docs/runbooks/test-e2e.md for full setup.`
    );
  }

  // Migrate against the test DB.
  await applyMigrations(config.databaseUrl);

  // Boot Prisma client pointed at the test DB so assertions hit the same data
  // the API sees.
  prismaClient = new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });

  // Boot the API.
  apiProcess = await startApiServer(config);

  const harness: Harness = { config, prisma: prismaClient };
  await resetDatabase(harness);
  return harness;
}

/**
 * Shut down everything the harness started. Safe to call multiple times.
 */
export async function teardownHarness(): Promise<void> {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill('SIGTERM');
    // Give it a moment to clean up, then SIGKILL.
    await new Promise<void>(resolve => {
      const t = setTimeout(() => {
        apiProcess?.kill('SIGKILL');
        resolve();
      }, 2000);
      apiProcess?.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  apiProcess = null;

  if (prismaClient) {
    await prismaClient.$disconnect().catch(() => {});
    prismaClient = null;
  }
}
