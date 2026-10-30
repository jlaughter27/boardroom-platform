// RD-17 — serialize a Decision Lab session to OmniMind's `/decision-sessions`
// shape and back. Pure functions (unit-tested). Everything that comes back from
// OmniMind is re-validated with the shared Zod schemas before it reaches the
// session (CLAUDE rule 3): an invalid entry is dropped, never trusted.

import {
  DecisionSessionStatus,
  DisagreementLedgerSchema,
  PersonaResponseSchema,
  RebuttalSchema,
  SynthesisReportSchema,
} from '@boardroom/shared';
import type {
  DisagreementLedger,
  PersonaId,
  PersonaResponse,
  Rebuttal,
  SynthesisReport,
  UpdateDecisionSessionRequest,
  UserMode,
} from '@boardroom/shared';
import { z } from 'zod';
import type { SessionState } from '../agents/orchestrator';
import type { DecisionSessionWire } from './omnimind-client';

/** Bump when the `state` layout changes incompatibly; hydrate ignores unknown versions' extras. */
export const SNAPSHOT_VERSION = 1;

/** What `state` holds (everything except question / mode / personaResponses, which have columns). */
export interface SessionSnapshotState {
  v: number;
  synthesis: SynthesisReport | null;
  rebuttals: Record<string, Rebuttal>;
  ledger: DisagreementLedger | null;
  questionnaireAnswers: { question: string; answer: string }[] | null;
  asOf: string | null;
  projectIds: string[];
  lateAdvisors: string[];
  decisionId: string | null;
}

/** A hydrated session plus its creation time (ms). */
export interface HydratedSession extends SessionState {
  createdAt: number;
}

export function statusOf(session: Pick<SessionState, 'decisionId' | 'synthesis' | 'personaResponses'>): DecisionSessionStatus {
  if (session.decisionId) return DecisionSessionStatus.DECIDED;
  if (session.synthesis) return DecisionSessionStatus.SYNTHESIZED;
  if (session.personaResponses.size > 0) return DecisionSessionStatus.DISPATCHED;
  return DecisionSessionStatus.OPEN;
}

/** Full-replace PATCH body for the session (also the POST body, minus status defaults). */
export function toPersistPayload(session: SessionState): UpdateDecisionSessionRequest & { question: string } {
  const state: SessionSnapshotState = {
    v: SNAPSHOT_VERSION,
    synthesis: session.synthesis ?? null,
    rebuttals: Object.fromEntries(session.rebuttals ?? []),
    ledger: session.ledger ?? null,
    questionnaireAnswers: session.questionnaireAnswers ?? null,
    asOf: session.asOf ?? null,
    projectIds: session.projectIds ?? [],
    lateAdvisors: session.lateAdvisors ?? [],
    decisionId: session.decisionId ?? null,
  };
  return {
    question: session.question,
    mode: session.mode ?? null,
    status: statusOf(session),
    personaResponses: Object.fromEntries(session.personaResponses),
    // The column holds the CEO recommendation text; the full report is in state.
    ceoSynthesis: session.synthesis?.recommendation?.slice(0, 20_000) ?? null,
    // JSON round-trip: Dates (assumptionsToMonitor.reviewAt) → ISO, undefined dropped.
    state: JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
  };
}

const StoredRebuttalSchema = RebuttalSchema.extend({ personaId: z.string().min(1) });
const QuestionnaireAnswersSchema = z.array(z.object({ question: z.string(), answer: z.string() }));
const StringArraySchema = z.array(z.string());

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface HydrateReport {
  session: HydratedSession;
  /** Entries that failed validation and were dropped (for a log line). */
  dropped: string[];
}

/** Build an in-memory session from an OmniMind record (re-validating every LLM-derived field). */
export function fromRecord(record: DecisionSessionWire): HydrateReport {
  const dropped: string[] = [];
  const state = asRecord(record.state);

  const personaResponses = new Map<PersonaId, PersonaResponse>();
  for (const [personaId, raw] of Object.entries(asRecord(record.personaResponses))) {
    const parsed = PersonaResponseSchema.safeParse(raw);
    if (parsed.success) personaResponses.set(personaId as PersonaId, parsed.data as PersonaResponse);
    else dropped.push(`personaResponses.${personaId}`);
  }

  let synthesis: SynthesisReport | null = null;
  if (state.synthesis != null) {
    const parsed = SynthesisReportSchema.safeParse(state.synthesis);
    if (parsed.success) synthesis = parsed.data as SynthesisReport;
    else dropped.push('synthesis');
  }

  const rebuttals = new Map<PersonaId, Rebuttal>();
  for (const [personaId, raw] of Object.entries(asRecord(state.rebuttals))) {
    const parsed = StoredRebuttalSchema.safeParse(raw);
    if (parsed.success) rebuttals.set(personaId as PersonaId, parsed.data as Rebuttal);
    else dropped.push(`rebuttals.${personaId}`);
  }

  let ledger: DisagreementLedger | undefined;
  if (state.ledger != null) {
    const parsed = DisagreementLedgerSchema.safeParse(state.ledger);
    if (parsed.success) ledger = parsed.data;
    else dropped.push('ledger');
  }

  const answers = QuestionnaireAnswersSchema.safeParse(state.questionnaireAnswers);
  const projectIds = StringArraySchema.safeParse(state.projectIds);
  const lateAdvisors = StringArraySchema.safeParse(state.lateAdvisors);
  const asOf = typeof state.asOf === 'string' ? state.asOf : undefined;
  // The OmniMind record's decisionId (live linked Decision) is authoritative;
  // the snapshot's covers a decision that could not be linked.
  const decisionId = record.decisionId ?? (typeof state.decisionId === 'string' ? state.decisionId : undefined);
  const createdAt = Date.parse(record.createdAt);

  const session: HydratedSession = {
    id: record.id,
    userId: record.userId,
    question: record.question,
    mode: (record.mode ?? 'decide') as UserMode,
    personaResponses,
    synthesis,
    ...(answers.success ? { questionnaireAnswers: answers.data } : {}),
    ...(asOf ? { asOf } : {}),
    ...(rebuttals.size > 0 || state.rebuttals != null ? { rebuttals } : {}),
    ...(ledger ? { ledger } : {}),
    ...(projectIds.success ? { projectIds: projectIds.data } : {}),
    ...(lateAdvisors.success && lateAdvisors.data.length > 0 ? { lateAdvisors: lateAdvisors.data as PersonaId[] } : {}),
    ...(decisionId ? { decisionId } : {}),
    persisted: true,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
  return { session, dropped };
}
