// Phase 6 — POST /sessions/:id/decide. Pure builder (unit-tested) + thin
// committer that talks to OmniMind. The Decision row is OmniMind's; BoardRoom
// only assembles the payload from session state (RD-17: and links it to the
// persisted Decision Lab session via `decisionSessionId`).

import { z } from 'zod';
import type { Assumption, PersonaForecast, PersonaId } from '@boardroom/shared';
import type { SessionState } from '../agents/orchestrator';
import type { OmniMindClient } from './omnimind-client';
import { logger } from '../lib/logger';

export const DEFAULT_REVIEW_DAYS = 30;

/** Contract body — `probabilitySuccess` and `expectedOutcome` are REQUIRED. */
export const DecideBodySchema = z.object({
  chosenPath: z.string().min(1).max(2000),
  rationale: z.string().max(5000).optional(),
  expectedOutcome: z.string().min(1).max(2000),
  probabilitySuccess: z.number().min(0).max(1),
  reviewAt: z.coerce.date().optional(),
});

export type DecideBody = z.infer<typeof DecideBodySchema>;

export interface DecisionCreateInput {
  title: string;
  question: string;
  options: Array<{ path: string; pros: string[]; cons: string[] }>;
  chosenPath: string;
  rationale: string | null;
  assumptions: Assumption[];
  constraints: string[];
  status: 'DECIDED';
  reviewAt: Date;
  /**
   * Always null: `decisions.session_id` is the legacy FK to OmniMind's meeting
   * `sessions` table (Room → Session), which Decision Lab sessions are not.
   */
  sessionId: null;
  /**
   * RD-17 — the Decision Lab session (`decision_sessions`) the decision comes
   * from: the session id when it is persisted in OmniMind, else null (a
   * memory-only session's local id would fail the FK). Never an id OmniMind
   * does not know.
   */
  decisionSessionId: string | null;
  probabilitySuccess: number;
  expectedOutcome: string;
  personaForecasts: PersonaForecast[];
  decidedAt: Date;
  mode: string;
}

function titleFromQuestion(question: string): string {
  const firstLine = question.split('\n').map(l => l.trim()).find(Boolean) ?? 'Decision';
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 117).trimEnd()}…`;
}

/**
 * Persona forecasts: one per round-1 response, using the revised
 * recommendation / confidence when that persona rebutted in round 2.
 */
export function buildPersonaForecasts(session: Pick<SessionState, 'personaResponses' | 'rebuttals'>): PersonaForecast[] {
  const out: PersonaForecast[] = [];
  const ids = Array.from(session.personaResponses.keys()).sort() as PersonaId[];
  for (const personaId of ids) {
    const response = session.personaResponses.get(personaId)!;
    const rebuttal = session.rebuttals?.get(personaId);
    out.push({
      personaId,
      recommendation: rebuttal?.revisedRecommendation?.trim() || response.recommendation,
      confidence: rebuttal?.revisedConfidence ?? response.confidence,
    });
  }
  return out;
}

/** Assumptions from the CEO report (`assumptionsToMonitor`), DecisionAssumption-shaped. */
export function buildAssumptions(session: Pick<SessionState, 'synthesis'>): Assumption[] {
  return (session.synthesis?.assumptionsToMonitor ?? []).map(a => ({
    text: a.assumption,
    confidence: a.confidence ?? 'MEDIUM',
    reviewAt: a.reviewAt instanceof Date ? a.reviewAt : a.reviewAt ? new Date(a.reviewAt) : null,
    status: 'ACTIVE' as const,
  }));
}

export function buildDecisionInput(session: SessionState, body: DecideBody, now: Date = new Date()): DecisionCreateInput {
  const reviewAt = body.reviewAt ?? new Date(now.getTime() + DEFAULT_REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const forecasts = buildPersonaForecasts(session);
  const optionPaths = new Set<string>([body.chosenPath]);
  if (session.synthesis?.recommendation) optionPaths.add(session.synthesis.recommendation);
  for (const f of forecasts) optionPaths.add(f.recommendation);

  return {
    title: titleFromQuestion(session.question),
    question: session.question,
    options: Array.from(optionPaths).slice(0, 8).map(path => ({ path, pros: [], cons: [] })),
    chosenPath: body.chosenPath,
    rationale: body.rationale ?? session.synthesis?.decisiveTradeoff ?? null,
    assumptions: buildAssumptions(session),
    constraints: [],
    status: 'DECIDED',
    reviewAt,
    sessionId: null,
    decisionSessionId: session.persisted ? session.id : null,
    probabilitySuccess: body.probabilitySuccess,
    expectedOutcome: body.expectedOutcome,
    personaForecasts: forecasts,
    decidedAt: now,
    mode: session.mode,
  };
}

export interface CommittedDecision { id: string; [k: string]: unknown }

/** OmniMind 422 `invalid_reference` (an unknown / foreign / archived link target). */
function isInvalidReference(err: unknown): boolean {
  const e = err as { status?: unknown; upstream?: { error?: unknown } } | null;
  return e?.status === 422 && e.upstream?.error === 'invalid_reference';
}

/**
 * Create the Decision in OmniMind, link it to the projects the session's
 * retrieval surfaced (best-effort), remember the id on the session.
 */
export async function commitDecision(
  session: SessionState,
  body: DecideBody,
  omnimind: Pick<OmniMindClient, 'createDecision' | 'linkProjectDecision'>,
  now: Date = new Date(),
): Promise<CommittedDecision> {
  const input = buildDecisionInput(session, body, now);
  let decision: CommittedDecision;
  try {
    decision = await omnimind.createDecision(session.userId, input) as CommittedDecision;
  } catch (err) {
    // RD-17: OmniMind refused the session link (e.g. the session was archived
    // meanwhile). The decision matters more than the link: commit once without it.
    if (!input.decisionSessionId || !isInvalidReference(err)) throw err;
    logger.warn('[Decide] session link refused — committing without it', {
      sessionId: session.id, message: err instanceof Error ? err.message : String(err),
    });
    decision = await omnimind.createDecision(session.userId, { ...input, decisionSessionId: null }) as CommittedDecision;
  }
  session.decisionId = decision.id;

  for (const projectId of session.projectIds ?? []) {
    try {
      await omnimind.linkProjectDecision(session.userId, projectId, decision.id);
    } catch (err) {
      logger.warn('[Decide] project link failed', {
        sessionId: session.id, projectId, decisionId: decision.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return decision;
}
