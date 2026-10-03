export interface SSEPersonaStart {
  type: 'persona_start';
  personaId: string;
  model: string;
}

export interface SSEPersonaComplete {
  type: 'persona_complete';
  personaId: string;
  response: unknown;
  toolInvocations?: unknown[];
}

export interface SSEPersonaError {
  type: 'persona_error';
  personaId: string;
  error: string;
}

export interface SSEDispatchComplete {
  type: 'dispatch_complete';
  personaCount: number;
  durationMs: number;
  /** Phase 6 — number of successful round-2 rebuttals (0 when DEBATE_ROUND2=false). */
  rebuttalCount?: number;
}

// ── Phase 6 debate protocol (emitted between persona_complete and dispatch_complete) ──

export interface SSERebuttalStart {
  type: 'rebuttal_start';
  personaId: string;
}

export interface SSERebuttalComplete {
  type: 'rebuttal_complete';
  personaId: string;
  stance: 'defend' | 'concede';
  reason: string;
  revisedRecommendation?: string;
  revisedConfidence: number;
}

export interface SSERebuttalError {
  type: 'rebuttal_error';
  personaId: string;
  error: string;
}

export interface SSESynthesisStart {
  type: 'synthesis_start';
  model: string;
}

export interface SSEDelta {
  type: 'delta';
  personaId?: string;
  text: string;
}

export interface SSESynthesisComplete {
  type: 'synthesis_complete';
  report: import('./persona.types').SynthesisReport;
  qualityScore: number;
  /** Phase 6 — the machine-built ledger the CEO was given ([] when none). */
  ledger?: import('./persona.types').DisagreementLedger;
}

export interface SSEDone {
  type: 'done';
}

export interface SSEError {
  type: 'error';
  error: string;
}

export type BoardRoomSSEEvent =
  | SSEPersonaStart
  | SSEPersonaComplete
  | SSEPersonaError
  | SSEDispatchComplete
  | SSERebuttalStart
  | SSERebuttalComplete
  | SSERebuttalError
  | SSESynthesisStart
  | SSEDelta
  | SSESynthesisComplete
  | SSEDone
  | SSEError;
