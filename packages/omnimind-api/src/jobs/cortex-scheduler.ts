import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { CORTEX_CONFIG } from '@boardroom/shared';
import { generateWeeklyMemo } from '../services/cortex-memo.service';
import { detectPatterns } from '../services/cortex-patterns.service';

let memoJob: ScheduledTask | null = null;
let patternJob: ScheduledTask | null = null;

export function startCortexScheduler(): void {
  // Weekly memo — Sunday 6 PM
  memoJob = schedule(CORTEX_CONFIG.memoSchedule, async () => {
    logger.info('Running weekly memo generation...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      for (const user of users) {
        try {
          await generateWeeklyMemo(user.id, prisma);
        } catch (err) {
          logger.error('Memo generation failed for user', { userId: user.id, error: (err as Error).message });
        }
      }
      logger.info('Weekly memo generation complete', { userCount: users.length });
    } catch (err) {
      logger.error('Memo scheduler error', { error: (err as Error).message });
    }
  });

  // Pattern scan — Monday 3 AM
  patternJob = schedule(CORTEX_CONFIG.patternScanSchedule, async () => {
    logger.info('Running pattern detection scan...');
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      for (const user of users) {
        try {
          await detectPatterns(user.id, prisma);
        } catch (err) {
          logger.error('Pattern detection failed for user', { userId: user.id, error: (err as Error).message });
        }
      }
      logger.info('Pattern detection complete', { userCount: users.length });
    } catch (err) {
      logger.error('Pattern scheduler error', { error: (err as Error).message });
    }
  });

  logger.info('Cortex scheduler started', { memoSchedule: CORTEX_CONFIG.memoSchedule, patternSchedule: CORTEX_CONFIG.patternScanSchedule });
}

export function stopCortexScheduler(): void {
  memoJob?.stop();
  patternJob?.stop();
  logger.info('Cortex scheduler stopped');
}
