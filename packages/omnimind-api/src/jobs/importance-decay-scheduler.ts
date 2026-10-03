import { schedule, type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger';
import { runImportanceDecay } from '../services/importance-decay.service';
import { createJobGuard } from './job-guard';

let decayJob: ScheduledTask | null = null;

// Sunday 2am
const DECAY_SCHEDULE = process.env.IMPORTANCE_DECAY_SCHEDULE ?? '0 2 * * 0';

// O-109: full-table UPDATE must never overlap itself.
const decayGuard = createJobGuard('importance-decay');

export function startImportanceDecayScheduler(): void {
  decayJob = schedule(DECAY_SCHEDULE, () => decayGuard.run(async () => {
    logger.info('Running importance decay...');
    try {
      const result = await runImportanceDecay();
      logger.info('Importance decay complete', result);
    } catch (err) {
      logger.error('Importance decay error', { error: (err as Error).message });
    }
  }));

  logger.info('Importance decay scheduler started', { schedule: DECAY_SCHEDULE });
}

export function stopImportanceDecayScheduler(): void {
  decayJob?.stop();
  decayJob = null;
}
