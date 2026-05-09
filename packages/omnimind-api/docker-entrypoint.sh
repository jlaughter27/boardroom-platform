#!/bin/sh
set -e

SCHEMA="--schema prisma/schema.prisma"

# Enable pgvector + pg_trgm FIRST (schema depends on vector type)
prisma db execute $SCHEMA --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

echo "Extensions enabled"

# Establish migration baseline for databases previously set up via db push.
# prisma migrate resolve is idempotent — safe to run on every startup.
# For a fresh DB these will fail harmlessly; for existing DBs they register
# the pre-existing schema so migrate deploy can take over from here.
prisma migrate resolve $SCHEMA --applied 20250410_add_search_indexes 2>/dev/null || true
prisma migrate resolve $SCHEMA --applied 20260407000000_add_embedding_column 2>/dev/null || true
prisma migrate resolve $SCHEMA --applied 20260509000000_mcp_phase_1 2>/dev/null || true
prisma migrate resolve $SCHEMA --applied 20260509000001_mcp_phase_4 2>/dev/null || true

echo "Migration baseline resolved"

# Deploy any pending migrations (replaces db push — tracks history, no data-loss flag)
prisma migrate deploy $SCHEMA

echo "Migrations deployed"

# Start the server
exec node dist/index.js
