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
 *
 * Exits non-zero (and prints nothing useful) when the database is unreachable
 * so `set -e` in the entrypoint aborts the boot instead of guessing.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({ log: [] });
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT to_regclass('public.memory_entries') IS NOT NULL AS has_tables, " +
        "to_regclass('public._prisma_migrations') IS NOT NULL AS has_history"
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
    const hasTables = row.has_tables === true;
    const hasHistory = row.has_history === true;
    process.stderr.write(`detect-baseline: has_tables=${hasTables} has_history=${hasHistory}\n`);
    process.stdout.write(hasTables ? 'existing' : 'fresh');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  process.stderr.write(`detect-baseline: failed to inspect database: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
