import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { summarizeRecentSessions } from '../services/session-summarizer.service';
import { createJobGuard } from './job-guard';

let summarizerJob: ScheduledTask | null = null;

// O-109: a slow Haiku call must not overlap the next 10-minute tick (which
// would write duplicate summaries and double the spend).
const summarizerGuard = createJobGuard('session-summarizer');

export function startSessionSummarizer(): void {
  // Every 10 minutes
  summarizerJob = schedule('*/10 * * * *', () => summarizerGuard.run(async () => {
    try {
      await summarizeRecentSessions(prisma);
    } catch (err) {
      logger.error('[session-summarizer] Job error', { error: (err as Error).message });
    }
  }));

  logger.info('[session-summarizer] Session summarizer started (every 10 min)');
}

export function stopSessionSummarizer(): void {
  summarizerJob?.stop();
  summarizerJob = null;
  logger.info('[session-summarizer] Session summarizer stopped');
}
