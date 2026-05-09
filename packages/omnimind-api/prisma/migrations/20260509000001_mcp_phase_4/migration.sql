-- Phase 4: AES-256-GCM encryption fields for ministry MemoryEntry content
ALTER TABLE "memory_entries"
  ADD COLUMN IF NOT EXISTS "encrypted_content"    BYTEA,
  ADD COLUMN IF NOT EXISTS "encryption_key_id"    TEXT,
  ADD COLUMN IF NOT EXISTS "encryption_algorithm" TEXT DEFAULT 'aes-256-gcm';

-- Phase 4: Weekly digest tracking
CREATE TABLE IF NOT EXISTS "weekly_digests" (
  "id"               TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "week_start"       TIMESTAMP(3) NOT NULL,
  "week_end"         TIMESTAMP(3) NOT NULL,
  "memories_created" INTEGER NOT NULL DEFAULT 0,
  "memories_updated" INTEGER NOT NULL DEFAULT 0,
  "decisions_logged" INTEGER NOT NULL DEFAULT 0,
  "tasks_completed"  INTEGER NOT NULL DEFAULT 0,
  "top_domains"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "highlights"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sent_at"          TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "weekly_digests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "weekly_digests_user_id_week_start_idx"
  ON "weekly_digests"("user_id", "week_start");
