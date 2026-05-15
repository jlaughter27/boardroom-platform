import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

const DECAY_AMOUNT = 0.05;
const UNACCESSED_DAYS = 7;

export async function runImportanceDecay(): Promise<{ decayed: number }> {
  const cutoff = new Date(Date.now() - UNACCESSED_DAYS * 86400 * 1000);

  const result = await prisma.$executeRaw`
    UPDATE "memory_entries"
    SET importance = GREATEST(importance - ${DECAY_AMOUNT}, 0.0),
        updated_at = NOW()
    WHERE (last_accessed_at IS NULL OR last_accessed_at < ${cutoff})
      AND importance > 0.0
      AND deleted_at IS NULL
  `;

  logger.info('Importance decay complete', { decayed: Number(result), cutoff });
  return { decayed: Number(result) };
}
