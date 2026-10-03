import { schedule, type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { hasAnthropicKey } from '../lib/anthropic';
import { runReflectionPass, reflectionThreshold } from '../services/reflection.service';
import { createJobGuard } from './job-guard';

let reflectionJob: ScheduledTask | null = null;

// Nightly 02:30 (contract §Reflection / capsules). Override with REFLECTION_SCHEDULE.
const REFLECTION_SCHEDULE = process.env.REFLECTION_SCHEDULE ?? '30 2 * * *';

// O-109: a slow pass (many Haiku calls) must never overlap the next tick.
const reflectionGuard = createJobGuard('reflection');

export function startReflectionScheduler(): void {
  reflectionJob = schedule(REFLECTION_SCHEDULE, () => reflectionGuard.run(async () => {
    if (!hasAnthropicKey()) {
      logger.warn('[reflection] ANTHROPIC_API_KEY not set — skipping pass');
      return;
    }
    logger.info('[reflection] Running nightly reflection pass...', { threshold: reflectionThreshold() });
    try {
      const result = await runReflectionPass(prisma);
      logger.info('[reflection] Pass complete', result);
    } catch (err) {
      logger.error('[reflection] Scheduler error', { error: (err as Error).message });
    }
  }));

  logger.info('[reflection] Reflection scheduler started', { schedule: REFLECTION_SCHEDULE, threshold: reflectionThreshold() });
}

export function stopReflectionScheduler(): void {
  reflectionJob?.stop();
  reflectionJob = null;
}
