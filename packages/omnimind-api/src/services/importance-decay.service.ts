import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * WS-3 — Exponential decay with recall reinforcement.
 *
 * Previous behavior (linear): every memory not accessed in the last 7 days
 * lost a flat 0.05 from `importance` per cron run. Frequently-recalled
 * memories decayed at the same rate as never-touched ones.
 *
 * New behavior (YourMemory pattern, 52% Recall@5 on LoCoMo vs Mem0's 28%):
 *
 *   strength       = importance * EXP(-λ * days_since_access)
 *                                * (1 + recall_count * 0.2)
 *   λ (per-memory) = 0.16 * (1 - importance * 0.8)
 *
 * - `λ` is the decay constant. Higher `importance` → smaller λ → slower decay.
 *   At importance = 1.0 → λ = 0.032 (very slow decay).
 *   At importance = 0.0 → λ = 0.16  (fast decay).
 * - `recall_count` reinforces strength: each retrieval hit adds a 20% multiplier.
 *
 * We keep `importance` as the stored field (DB layer), but write back the decayed
 * value computed by the formula. The stored `importance` continues to be the
 * single source of truth for retrieval-time filters (forgetting curve,
 * structured filter ≥ 0.4 floor, etc.) — but its evolution over time is now
 * shaped by exponential decay weighted by recall history rather than a flat -0.05.
 *
 * Memories never accessed (last_accessed_at IS NULL) use `created_at` as the
 * reference timestamp.
 */

// Exposed for testing — pure function, no I/O.
export function computeDecayedImportance(params: {
  importance: number;
  recallCount: number;
  daysSinceAccess: number;
}): number {
  const { importance, recallCount, daysSinceAccess } = params;
  const lambda = 0.16 * (1 - importance * 0.8);
  const decayFactor = Math.exp(-lambda * daysSinceAccess);
  const reinforcement = 1 + recallCount * 0.2;
  const strength = importance * decayFactor * reinforcement;
  // Clamp to [0, 1] — strength can momentarily exceed 1 for highly-recalled
  // items, but `importance` is conventionally bounded for retrieval filters.
  return Math.max(0, Math.min(1, strength));
}

export async function runImportanceDecay(): Promise<{ decayed: number }> {
  // SQL implementation of the same formula. Operates on every non-deleted
  // memory with importance > 0 — exponential decay is continuous, so there's
  // no 7-day "untouched" gate anymore. The formula naturally protects
  // recently-accessed and well-recalled memories.
  //
  // Postgres EXP() expects double precision. EXTRACT(EPOCH FROM ...) / 86400
  // gives fractional days since the reference timestamp (last_accessed_at,
  // falling back to created_at).
  const result = await prisma.$executeRaw`
    UPDATE "memory_entries"
    SET importance = LEAST(
                       1.0,
                       GREATEST(
                         0.0,
                         importance
                         * EXP(
                             -(0.16 * (1.0 - importance * 0.8))
                             * (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed_at, created_at))) / 86400.0)
                           )
                         * (1.0 + recall_count * 0.2)
                       )
                     ),
        updated_at = NOW()
    WHERE importance > 0.0
      AND deleted_at IS NULL
  `;

  logger.info('Exponential importance decay complete', { decayed: Number(result) });
  return { decayed: Number(result) };
}
