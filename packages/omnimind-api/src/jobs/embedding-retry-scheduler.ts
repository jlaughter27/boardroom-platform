import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { processEmbeddingOutboxEntry } from '../services/memory.service';

let retryJob: ScheduledTask | null = null;

const MAX_ATTEMPTS = 5;
const MAX_BATCH_SIZE = 50;

/**
 * WS-2.3 — Embedding Outbox retry cron.
 *
 * Every 2 minutes, sweep the embedding_outbox table for rows where:
 *   - succeeded_at IS NULL (still pending)
 *   - attempts < 5 (haven't hit the dead-letter ceiling)
 *
 * Each row gets retried with exponential backoff: skip if
 *   last_attempt_at > NOW() - (2^attempts minutes)
 *
 * Backoff cadence (assuming 2-min cron tick):
 *   attempt 1 → wait  1 min  → next tick retries
 *   attempt 2 → wait  2 min  → next tick retries
 *   attempt 3 → wait  4 min  → 2 ticks later
 *   attempt 4 → wait  8 min  → 4 ticks later
 *   attempt 5 → wait 16 min  → 8 ticks later (then dead-letter)
 *
 * After 5 attempts the row remains in the table but stops getting retried;
 * `/admin/embedding-failures` (future endpoint) will surface stuck rows for
 * manual triage.
 */
async function runRetryTick(): Promise<{ tried: number; succeeded: number; failed: number; skipped: number }> {
  const now = new Date();

  // Pull candidates. We over-select then filter in JS for the backoff check;
  // doing the full backoff math in SQL is awkward across DB dialects and the
  // outbox volume is bounded by write rate × OpenAI failure rate (low).
  const candidates = await prisma.embeddingOutbox.findMany({
    where: {
      succeededAt: null,
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_BATCH_SIZE,
  });

  let tried = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    // Exponential backoff: 2^attempts minutes since last attempt
    if (row.lastAttemptAt) {
      const backoffMs = Math.pow(2, row.attempts) * 60_000;
      if (now.getTime() - row.lastAttemptAt.getTime() < backoffMs) {
        skipped++;
        continue;
      }
    }

    tried++;
    const result = await processEmbeddingOutboxEntry(row.memoryId, prisma);
    if (result.succeeded) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { tried, succeeded, failed, skipped };
}

export function startEmbeddingRetryScheduler(): void {
  // Every 2 minutes
  retryJob = schedule('*/2 * * * *', async () => {
    try {
      const stats = await runRetryTick();
      if (stats.tried > 0 || stats.succeeded > 0 || stats.failed > 0) {
        logger.info('[embedding-retry] Tick complete', stats);
      }
    } catch (err) {
      logger.error('[embedding-retry] Job error', { error: (err as Error).message });
    }
  });

  logger.info('[embedding-retry] Embedding retry scheduler started (every 2 min)');
}

export function stopEmbeddingRetryScheduler(): void {
  retryJob?.stop();
  logger.info('[embedding-retry] Embedding retry scheduler stopped');
}

// Exposed for the audit test (D10) and for manual triggering via /admin.
export { runRetryTick };
