-- RD-17 — Decision Lab sessions persisted in OmniMind.
--
-- Additive only: one enum, five new columns on decision_sessions (all
-- nullable or defaulted), one nullable column + unique index + FK on
-- decisions. No existing column, row or constraint is changed or dropped.
-- Idempotent per prisma/migrations/README.md (re-runs and fresh-DB boots are
-- no-ops). Generated with `prisma migrate diff --from-migrations … --to-schema-datamodel`
-- and the known-drift statements (prisma/known-drift.sql) removed.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DecisionSessionStatus') THEN
    CREATE TYPE "DecisionSessionStatus" AS ENUM ('OPEN', 'DISPATCHED', 'SYNTHESIZED', 'DECIDED');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "decision_sessions" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "mode" TEXT,
ADD COLUMN IF NOT EXISTS "state" JSONB,
ADD COLUMN IF NOT EXISTS "status" "DecisionSessionStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "decision_session_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "decisions_decision_session_id_key" ON "decisions"("decision_session_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_decision_session_id_fkey') THEN
    ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decision_session_id_fkey"
      FOREIGN KEY ("decision_session_id") REFERENCES "decision_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
