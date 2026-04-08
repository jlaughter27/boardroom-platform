#!/bin/sh
set -e

SCHEMA="--schema prisma/schema.prisma"

# Enable pgvector + pg_trgm FIRST (schema depends on vector type)
prisma db execute $SCHEMA --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

echo "Extensions enabled"

# Push schema to database (creates tables if missing, safe for existing schemas)
# Using db push for v1 deployment — switch to migrate deploy once baseline migration exists
prisma db push $SCHEMA --skip-generate --accept-data-loss 2>&1

echo "Schema push complete"

# Start the server
exec node dist/index.js
