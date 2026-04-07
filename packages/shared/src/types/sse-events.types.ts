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
}

export interface SSESynthesisStart {
  type: 'synthesis_start';
  model: string;
}

export interface SSEDelta {
  type: 'delta';
  text: string;
}

export interface SSESynthesisComplete {
  type: 'synthesis_complete';
  report: string;
  qualityScore: number;
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
  | SSESynthesisStart
  | SSEDelta
  | SSESynthesisComplete
  | SSEDone
  | SSEError;
