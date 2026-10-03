import type { PrismaClient } from '@prisma/client';
import type { CalibrationBin, CalibrationReport, PersonaForecast } from '@boardroom/shared';

/**
 * Phase 6 — calibration (research §3, contract §Decisions / calibration).
 *
 * Brier = mean((p − o)²), o = outcomeRating ≥ successThreshold ? 1 : 0, over
 * decisions with `outcomeRating != null && probabilitySuccess != null`.
 * Bins: [0,.2) [.2,.4) [.4,.6) [.6,.8) [.8,1].
 * Per-persona Brier uses `personaForecasts[].confidence` ONLY where that
 * persona's recommendation matched `chosenPath` (exact or case-insensitive
 * prefix either way) — otherwise the persona is skipped for that decision.
 */

export const CALIBRATION_MIN_FOR_SIGNAL = 20;
export const BIN_LOWER_BOUNDS = [0, 0.2, 0.4, 0.6, 0.8] as const;

export interface CalibrationDecisionInput {
  chosenPath: string | null;
  probabilitySuccess: number | null;
  outcomeRating: number | null;
  personaForecasts: unknown;
}

export function binIndex(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  // Compare against the bound list (not floor(p / 0.2)): 0.6 / 0.2 is
  // 2.9999999999999996 in IEEE-754 and would land in the wrong bin.
  for (let i = BIN_LOWER_BOUNDS.length - 1; i > 0; i--) {
    if (clamped >= BIN_LOWER_BOUNDS[i]) return i;
  }
  return 0;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** exact or case-insensitive prefix (either direction), non-empty on both sides */
export function recommendationMatchesChosenPath(recommendation: string, chosenPath: string | null): boolean {
  if (!chosenPath) return false;
  const a = norm(recommendation);
  const b = norm(chosenPath);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

interface Sample { p: number; o: 0 | 1 }

function summarize(samples: Sample[]): { brier: number | null; bins: CalibrationBin[] } {
  const acc = BIN_LOWER_BOUNDS.map(lower => ({ lower, count: 0, sumP: 0, sumO: 0 }));
  let sq = 0;
  for (const s of samples) {
    const b = acc[binIndex(s.p)];
    b.count += 1;
    b.sumP += s.p;
    b.sumO += s.o;
    sq += (s.p - s.o) ** 2;
  }
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const bins: CalibrationBin[] = acc.map((b, i) => ({
    lower: b.lower,
    upper: i === acc.length - 1 ? 1 : BIN_LOWER_BOUNDS[i + 1],
    count: b.count,
    meanForecast: b.count ? r4(b.sumP / b.count) : 0,
    observedRate: b.count ? r4(b.sumO / b.count) : 0,
  }));
  return { brier: samples.length ? r4(sq / samples.length) : null, bins };
}

function parseForecasts(raw: unknown): PersonaForecast[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonaForecast[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const { personaId, recommendation, confidence } = f as Record<string, unknown>;
    if (typeof personaId !== 'string' || typeof recommendation !== 'string' || typeof confidence !== 'number') continue;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    out.push({ personaId, recommendation, confidence });
  }
  return out;
}

/** Pure. Exported for unit tests. */
export function computeCalibration(decisions: CalibrationDecisionInput[], successThreshold = 4): CalibrationReport {
  const userSamples: Sample[] = [];
  const personaSamples = new Map<string, Sample[]>();

  for (const d of decisions) {
    if (d.outcomeRating == null || d.probabilitySuccess == null) continue;
    const o: 0 | 1 = d.outcomeRating >= successThreshold ? 1 : 0;
    userSamples.push({ p: d.probabilitySuccess, o });

    for (const f of parseForecasts(d.personaForecasts)) {
      if (!recommendationMatchesChosenPath(f.recommendation, d.chosenPath)) continue;
      const list = personaSamples.get(f.personaId) ?? [];
      list.push({ p: f.confidence, o });
      personaSamples.set(f.personaId, list);
    }
  }

  const personas: CalibrationReport['personas'] = {};
  for (const id of [...personaSamples.keys()].sort()) {
    const samples = personaSamples.get(id)!;
    personas[id] = { ...summarize(samples), count: samples.length };
  }

  return {
    reviewedDecisions: userSamples.length,
    minimumForSignal: CALIBRATION_MIN_FOR_SIGNAL,
    successThreshold,
    user: summarize(userSamples),
    personas,
  };
}

export async function getCalibrationReport(userId: string, successThreshold: number, prisma: PrismaClient): Promise<CalibrationReport> {
  const rows = await prisma.decision.findMany({
    where: { userId, deletedAt: null, outcomeRating: { not: null }, probabilitySuccess: { not: null } },
    select: { chosenPath: true, probabilitySuccess: true, outcomeRating: true, personaForecasts: true },
  });
  return computeCalibration(rows, successThreshold);
}
