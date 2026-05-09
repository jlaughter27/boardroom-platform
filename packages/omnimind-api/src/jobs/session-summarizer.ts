import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { summarizeRecentSessions } from '../services/session-summarizer.service';

let summarizerJob: ScheduledTask | null = null;

export function startSessionSummarizer(): void {
  // Every 10 minutes
  summarizerJob = schedule('*/10 * * * *', async () => {
    try {
      await summarizeRecentSessions(prisma);
    } catch (err) {
      logger.error('[session-summarizer] Job error', { error: (err as Error).message });
    }
  });

  logger.info('[session-summarizer] Session summarizer started (every 10 min)');
}

export function stopSessionSummarizer(): void {
  summarizerJob?.stop();
  logger.info('[session-summarizer] Session summarizer stopped');
}
