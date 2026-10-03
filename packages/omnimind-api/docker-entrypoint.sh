#!/bin/sh
set -e

SCHEMA="--schema prisma/schema.prisma"

# Enable pgvector + pg_trgm FIRST (schema depends on vector type)
prisma db execute $SCHEMA --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

echo "Extensions enabled"

# ---------------------------------------------------------------------------
# Migration baseline (AUDIT-2026-10-02 / O-104)
#
# Production was set up with `prisma db push` before migrations existed, so
# its tables were never created by a migration. For such databases we mark the
# baseline migrations as applied and let `migrate deploy` run only what is new.
#
# IMPORTANT: `prisma migrate resolve --applied` does NOT "fail harmlessly" on
# a fresh database — it succeeds, records the migration as applied without
# running it, and the next migration then crashes with
# `relation "memory_entries" does not exist`. That was the O-104 crash loop.
# So we first detect whether application tables exist and only resolve the
# baseline when they do. A fresh database simply runs `migrate deploy`, which
# applies 0_init (full schema) followed by every later migration (all of which
# are idempotent — see prisma/migrations/README.md).
# ---------------------------------------------------------------------------
DB_STATE="$(node prisma/scripts/detect-baseline.cjs)"
echo "Database state: ${DB_STATE}"

if [ "$DB_STATE" = "existing" ]; then
  # Each resolve is idempotent across restarts ("already applied" → non-zero
  # exit, which is why `|| true` is used). Order matters: 0_init first.
  prisma migrate resolve $SCHEMA --applied 0_init 2>/dev/null || true
  prisma migrate resolve $SCHEMA --applied 20250410_add_search_indexes 2>/dev/null || true
  prisma migrate resolve $SCHEMA --applied 20260407000000_add_embedding_column 2>/dev/null || true
  prisma migrate resolve $SCHEMA --applied 20260509000000_mcp_phase_1 2>/dev/null || true
  prisma migrate resolve $SCHEMA --applied 20260509000001_mcp_phase_4 2>/dev/null || true
  echo "Migration baseline resolved (existing database)"
elif [ "$DB_STATE" = "fresh" ]; then
  echo "Fresh database — skipping baseline resolve; migrate deploy will apply 0_init"
else
  echo "Could not determine database state (got '${DB_STATE}'); refusing to guess" >&2
  exit 1
fi

# Deploy any pending migrations (replaces db push — tracks history, no data-loss flag)
prisma migrate deploy $SCHEMA

echo "Migrations deployed"

# Start the server
exec node dist/index.js
