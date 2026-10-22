#!/usr/bin/env node
/**
 * O-104 — decide whether this database needs the db-push baseline resolved.
 *
 * Prints exactly one word on stdout:
 *   fresh     → no application tables yet. docker-entrypoint.sh must NOT run
 *               `prisma migrate resolve --applied ...`; `migrate deploy` will
 *               apply 0_init and every later migration.
 *   existing  → application tables exist (created by `prisma db push` before
 *               migrations were introduced, or by an earlier deploy). The
 *               entrypoint marks the baseline migrations as applied so
 *               `migrate deploy` only runs what is genuinely new.
 *   unknown   → the probe answered, but not with a boolean (M0-A3). Printed
 *               with exit code 1: guessing "fresh" here would make the
 *               entrypoint skip the baseline resolve on a populated database.
 *
 * Exits non-zero (and prints nothing on stdout) when the database is
 * unreachable, so `set -e` in the entrypoint aborts the boot instead of
 * guessing.
 *
 * The logic is exported for unit tests (tests/unit/prisma/detect-baseline.test.ts);
 * the CLI entry point below only runs when the file is executed directly.
 */

const PROBE_SQL =
  "SELECT to_regclass('public.memory_entries') IS NOT NULL AS has_tables, " +
  "to_regclass('public._prisma_migrations') IS NOT NULL AS has_history";

/**
 * Map the probe's first row to a database state.
 * @param {unknown} rows result of `$queryRawUnsafe(PROBE_SQL)`
 * @returns {'fresh' | 'existing' | 'unknown'}
 */
function classify(rows) {
  const row = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] : undefined;
  if (!row) return 'unknown';
  if (row.has_tables === true) return 'existing';
  if (row.has_tables === false) return 'fresh';
  return 'unknown';
}

function defaultCreateClient() {
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ log: [] });
}

/**
 * Probe the database and report its state. Never throws.
 * @param {{ createClient?: () => { $queryRawUnsafe: (sql: string) => Promise<unknown>, $disconnect: () => Promise<void> },
 *           stdout?: { write: (s: string) => unknown }, stderr?: { write: (s: string) => unknown } }} [deps]
 * @returns {Promise<number>} the process exit code (0 = fresh/existing printed, 1 = unknown or unreachable)
 */
async function detectBaseline(deps = {}) {
  const createClient = deps.createClient || defaultCreateClient;
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  let prisma;
  try {
    prisma = createClient();
    const rows = await prisma.$queryRawUnsafe(PROBE_SQL);
    const state = classify(rows);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
    stderr.write(`detect-baseline: has_tables=${row.has_tables} has_history=${row.has_history}\n`);
    if (state === 'unknown') {
      stderr.write('detect-baseline: unexpected probe result; refusing to guess\n');
      stdout.write('unknown');
      return 1;
    }
    stdout.write(state);
    return 0;
  } catch (err) {
    stderr.write(`detect-baseline: failed to inspect database: ${err && err.message ? err.message : err}\n`);
    return 1;
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
  }
}

module.exports = { PROBE_SQL, classify, detectBaseline };

if (require.main === module) {
  detectBaseline().then(code => process.exit(code));
}
