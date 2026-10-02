import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * WS-3 — Exponential decay with recall reinforcement.
 * AUDIT-2026-10-02 / O-103 — made NON-COMPOUNDING.
 *
 * Formula (unchanged in shape):
 *
 *   importance     = base * EXP(-λ * days_since_access) * (1 + recall_count * 0.2)
 *   λ (per-memory) = 0.16 * (1 - base * 0.8)
 *
 * What changed: `base` is now the persisted, undecayed `base_importance`
 * column, not the previous run's already-decayed `importance`. The old job
 * multiplied the decayed value by the TOTAL elapsed-time factor again on
 * every Sunday run, so a 0.5 memory crossed the 0.4 retrieval floor after
 * ~2.3 days of wall-clock time and kept sliding toward 0 forever. Running the
 * new formula twice with the same inputs yields the same output (idempotent),
 * and a recall (which refreshes last_accessed_at) restores importance toward
 * base instead of starting from the decayed floor.
 *
 * - `λ` is the decay constant. Higher `base` → smaller λ → slower decay.
 *   At base = 1.0 → λ = 0.032 (very slow decay). At base = 0.0 → λ = 0.16.
 * - `recall_count` reinforces strength: each retrieval hit adds a 20% multiplier.
 * - Reference timestamp is COALESCE(last_accessed_at, created_at), matching the
 *   retrieval-layer forgetting curves.
 *
 * `base_importance` is set on create/update by memory.service. Legacy rows
 * (NULL) are backfilled from their current `importance` on the first run
 * (and by migration 20261002000000_base_importance).
 */

// Exposed for testing — pure function, no I/O. Mirrors the SQL below exactly.
export function computeDecayedImportance(params: {
  baseImportance: number;
  recallCount: number;
  daysSinceAccess: number;
}): number {
  const { baseImportance, recallCount, daysSinceAccess } = params;
  const lambda = 0.16 * (1 - baseImportance * 0.8);
  const decayFactor = Math.exp(-lambda * daysSinceAccess);
  const reinforcement = 1 + recallCount * 0.2;
  const strength = baseImportance * decayFactor * reinforcement;
  // Clamp to [0, 1] — strength can momentarily exceed 1 for highly-recalled
  // items, but `importance` is conventionally bounded for retrieval filters.
  return Math.max(0, Math.min(1, strength));
}

export async function runImportanceDecay(): Promise<{ decayed: number }> {
  // SQL implementation of the same formula. In a single UPDATE every SET
  // expression sees the OLD row, so COALESCE(base_importance, importance)
  // consistently means "the undecayed base" for both assignments: the first
  // persists the backfill, the second recomputes importance from it.
  const result = await prisma.$executeRaw`
    UPDATE "memory_entries"
    SET base_importance = COALESCE(base_importance, importance),
        importance = LEAST(
                       1.0,
                       GREATEST(
                         0.0,
                         COALESCE(base_importance, importance)
                         * EXP(
                             -(0.16 * (1.0 - COALESCE(base_importance, importance) * 0.8))
                             * (EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed_at, created_at))) / 86400.0)
                           )
                         * (1.0 + recall_count * 0.2)
                       )
                     ),
        updated_at = NOW()
    WHERE deleted_at IS NULL
      AND COALESCE(base_importance, importance) > 0.0
  `;

  logger.info('Exponential importance decay complete (non-compounding, from base_importance)', {
    decayed: Number(result),
  });
  return { decayed: Number(result) };
}
