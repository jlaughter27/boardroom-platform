-- WS-2: Embedding Outbox
-- Durable per-memory retry queue. The createMemory path inserts an outbox row
-- alongside the memory row (fire-and-forget); the embedding-retry-scheduler
-- cron polls every 2 min and retries any row where succeededAt IS NULL AND
-- attempts < 5, with exponential backoff.

CREATE TABLE IF NOT EXISTS "embedding_outbox" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded_at" TIMESTAMP(3),

    CONSTRAINT "embedding_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "embedding_outbox_memory_id_key"
    ON "embedding_outbox"("memory_id");

CREATE INDEX IF NOT EXISTS "embedding_outbox_succeeded_at_last_attempt_at_idx"
    ON "embedding_outbox"("succeeded_at", "last_attempt_at");
