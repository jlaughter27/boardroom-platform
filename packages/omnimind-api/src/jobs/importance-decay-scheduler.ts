import { schedule, type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger';
import { runImportanceDecay } from '../services/importance-decay.service';

let decayJob: ScheduledTask | null = null;

// Sunday 2am
const DECAY_SCHEDULE = process.env.IMPORTANCE_DECAY_SCHEDULE ?? '0 2 * * 0';

export function startImportanceDecayScheduler(): void {
  decayJob = schedule(DECAY_SCHEDULE, async () => {
    logger.info('Running importance decay...');
    try {
      const result = await runImportanceDecay();
      logger.info('Importance decay complete', result);
    } catch (err) {
      logger.error('Importance decay error', { error: (err as Error).message });
    }
  });

  logger.info('Importance decay scheduler started', { schedule: DECAY_SCHEDULE });
}

export function stopImportanceDecayScheduler(): void {
  decayJob?.stop();
  decayJob = null;
}
