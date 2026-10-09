import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { getCommitmentNudges, setCachedNudges } from '../services/commitment.service';
import { createJobGuard } from './job-guard';

let nudgeJob: ScheduledTask | null = null;

// Daily 07:00 (contract §Commitment nudges). Override with COMMITMENT_NUDGE_SCHEDULE.
const COMMITMENT_NUDGE_SCHEDULE = process.env.COMMITMENT_NUDGE_SCHEDULE ?? '0 7 * * *';

const nudgeGuard = createJobGuard('commitment-nudges');

/**
 * SQL only, no LLM. Computes due-soon (≤3 days) / overdue OPEN commitments
 * per user and refreshes the in-process nudge list that
 * `GET /commitments/nudges`, the Doer context and the weekly digest read.
 * (No dedicated table exists in the frozen schema; the list is recomputed
 * live on request and precomputed here so the morning digest is warm.)
 */
export async function runCommitmentNudgePass(): Promise<{ users: number; dueSoon: number; overdue: number }> {
  const users = await prisma.user.findMany({ select: { id: true } });
  let dueSoon = 0;
  let overdue = 0;
  for (const user of users) {
    try {
      const nudges = await getCommitmentNudges(user.id, prisma);
      setCachedNudges(user.id, nudges);
      dueSoon += nudges.dueSoon.length;
      overdue += nudges.overdue.length;
      if (nudges.dueSoon.length + nudges.overdue.length > 0) {
        logger.info('[commitment-nudges] user has pending commitments', {
          userId: user.id, dueSoon: nudges.dueSoon.length, overdue: nudges.overdue.length,
        });
      }
    } catch (err) {
      logger.error('[commitment-nudges] failed for user', { userId: user.id, error: (err as Error).message });
    }
  }
  return { users: users.length, dueSoon, overdue };
}

export function startCommitmentNudgeScheduler(): void {
  nudgeJob = schedule(COMMITMENT_NUDGE_SCHEDULE, () => nudgeGuard.run(async () => {
    logger.info('[commitment-nudges] Running daily pass...');
    try {
      const result = await runCommitmentNudgePass();
      logger.info('[commitment-nudges] Pass complete', result);
    } catch (err) {
      logger.error('[commitment-nudges] Scheduler error', { error: (err as Error).message });
    }
  }));
  logger.info('[commitment-nudges] Scheduler started', { schedule: COMMITMENT_NUDGE_SCHEDULE });
}

export function stopCommitmentNudgeScheduler(): void {
  nudgeJob?.stop();
  nudgeJob = null;
}
