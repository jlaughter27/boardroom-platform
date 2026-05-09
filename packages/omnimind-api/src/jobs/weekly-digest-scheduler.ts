import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { buildWeeklyDigest, saveAndSendDigest } from '../services/weekly-digest.service';

let digestJob: ScheduledTask | null = null;

// Friday 6 PM
const DIGEST_SCHEDULE = process.env.DIGEST_SCHEDULE ?? '0 18 * * 5';

export function startWeeklyDigestScheduler(): void {
  digestJob = schedule(DIGEST_SCHEDULE, async () => {
    logger.info('Running weekly digest generation...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      const now = new Date();
      const weekEnd = new Date(now);
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);

      for (const user of users) {
        try {
          const stats = await buildWeeklyDigest(user.id, weekStart, weekEnd, prisma);
          await saveAndSendDigest(stats, prisma);
        } catch (err) {
          logger.error('Digest failed for user', { userId: user.id, error: (err as Error).message });
        }
      }
      logger.info('Weekly digest generation complete', { userCount: users.length });
    } catch (err) {
      logger.error('Digest scheduler error', { error: (err as Error).message });
    }
  });

  logger.info('Weekly digest scheduler started', { schedule: DIGEST_SCHEDULE });
}

export function stopWeeklyDigestScheduler(): void {
  digestJob?.stop();
  digestJob = null;
}
