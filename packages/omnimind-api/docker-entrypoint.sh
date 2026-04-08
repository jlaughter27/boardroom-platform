#!/bin/sh
set -e

# Use the pinned Prisma CLI (copied from builder, not npx which pulls latest)
PRISMA="node node_modules/prisma/build/index.js"

# Run Prisma migrations
$PRISMA migrate deploy

# Enable pgvector extension (idempotent)
$PRISMA db execute --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

# Start the server
exec node dist/index.js
