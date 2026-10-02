// Phase 6 client-side types. Canonical wire types live in `@boardroom/shared`
// (lane B: debate protocol + `premortem` mode; lane A1: context/changes/
// nudges/memo-item/usage) and are re-exported here so client code has one
// import path. The client-local additions are: the SSE envelopes for the
// debate events (not part of shared `BoardRoomSSEEvent`), the decide request
// body, memo section helpers, and the shapes of three A2 endpoints that have
// no shared type (people duplicates, graph backlinks, unlinked mentions).

import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  ModeConfig,
  Person,
  Rebuttal as SharedRebuttal,
  SynthesisReport,
  UserMode,
  WeeklyMemo,
  MemoItemState,
} from '@boardroom/shared';
import { MODE_CONFIGS } from '@boardroom/shared';

// ---------------------------------------------------------------------------
// Re-exports (one import path for Phase 6 shapes)
// ---------------------------------------------------------------------------

export type {
  Rebuttal,
  RebuttalStance,
  DisagreementLedgerEntry,
  LedgerResolution,
  CoreContextResponse,
  CommitmentNudgesResponse,
  MemoItemState,
  MemoItemStateValue,
  MemoItemStateRequest,
  LlmUsageSummary,
  ReflectedContextCapsule,
  CapsulesResponse,
} from '@boardroom/shared';

/** `GET /decisions/changes` response (shared name: `EntityChangesResponse`). */
export type { EntityChangesResponse as DecisionChangesResponse } from '@boardroom/shared';

/** `SynthesisReport` already carries `ledgerResolutions` / `droppedConsiderations` (optional). */
export type ExtendedSynthesisReport = SynthesisReport;

// ---------------------------------------------------------------------------
// Debate protocol SSE envelopes (`rebuttal_start` / `rebuttal_complete` / `rebuttal_error`)
// ---------------------------------------------------------------------------

export interface SSERebuttalStart {
  type: 'rebuttal_start';
  personaId: string;
}

export interface SSERebuttalComplete extends SharedRebuttal {
  type: 'rebuttal_complete';
}

/** Emitted by the orchestrator when a round-2 call fails; the persona keeps its round-1 position. */
export interface SSERebuttalError {
  type: 'rebuttal_error';
  personaId: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Pre-mortem mode
// ---------------------------------------------------------------------------

/** `UserMode` widened with `'premortem'` (already present in shared; kept as the client's name for it). */
export type ClientUserMode = UserMode | 'premortem';

export interface ClientModeConfig extends Omit<ModeConfig, 'id'> {
  id: ClientUserMode;
}

const PREMORTEM_FALLBACK: ClientModeConfig = {
  id: 'premortem',
  label: 'Pre-mortem',
  description: 'Assume it failed. Find out why.',
  personas: ['critic', 'technician', 'questionnaire'],
  includesCEO: true,
};

/** Mode configs as the client renders them; falls back to a local pre-mortem entry if shared lacks it. */
export const CLIENT_MODE_CONFIGS: Record<ClientUserMode, ClientModeConfig> = {
  ...(MODE_CONFIGS as Record<string, ClientModeConfig>),
  premortem: (MODE_CONFIGS as Record<string, ClientModeConfig | undefined>).premortem ?? PREMORTEM_FALLBACK,
} as Record<ClientUserMode, ClientModeConfig>;

export const CLIENT_MODE_LIST: ClientModeConfig[] = Object.values(CLIENT_MODE_CONFIGS);

// ---------------------------------------------------------------------------
// Decision commit (POST /sessions/:id/decide) — mirrors server DecideBodySchema
// ---------------------------------------------------------------------------

export interface DecideSessionRequest {
  chosenPath: string;
  rationale?: string;
  expectedOutcome: string;
  /** 0..1 */
  probabilitySuccess: number;
  /** ISO date (server `z.coerce.date()`); defaults to +30 d when omitted */
  reviewAt?: string;
}

// ---------------------------------------------------------------------------
// Interactive weekly memo — item keys
// ---------------------------------------------------------------------------

/** Memo sections that carry per-item controls. Keys match `WeeklyMemo` field names. */
export type MemoSection = 'patternsNoticed' | 'activeContradictions' | 'upcomingPressurePoints' | 'recommendedFocus';

export const MEMO_SECTIONS: MemoSection[] = ['patternsNoticed', 'activeContradictions', 'upcomingPressurePoints', 'recommendedFocus'];

export const MEMO_SECTION_LABEL: Record<MemoSection, string> = {
  patternsNoticed: 'Patterns noticed',
  activeContradictions: 'Active contradictions',
  upcomingPressurePoints: 'Upcoming pressure points',
  recommendedFocus: 'Recommended focus',
};

/** `${section}:${index}` — the `itemKey` path segment of `PATCH /cortex/memo/:id/items/:itemKey`. */
export function memoItemKey(section: MemoSection, index: number): string {
  return `${section}:${index}`;
}

export interface InteractiveWeeklyMemo extends WeeklyMemo {
  itemStates?: Record<string, MemoItemState>;
  decisionsAwaitingReview?: string[];
}

// ---------------------------------------------------------------------------
// People duplicates (GET /people/duplicates)
// ---------------------------------------------------------------------------

export interface PersonDuplicatePair {
  a: Person;
  b: Person;
  /** 0..1 pg_trgm similarity */
  similarity: number;
}

// ---------------------------------------------------------------------------
// Graph extras
// ---------------------------------------------------------------------------

export interface GraphBacklinksResponse {
  node: KnowledgeGraphNode;
  backlinks: Array<{ node: KnowledgeGraphNode; edge: KnowledgeGraphEdge }>;
}

export interface UnlinkedMention {
  memoryId: string;
  memoryTitle: string;
  entityType: 'person' | 'project' | 'goal';
  entityId: string;
  entityLabel: string;
  snippet: string;
}

export interface UnlinkedMentionsResponse {
  items: UnlinkedMention[];
}
