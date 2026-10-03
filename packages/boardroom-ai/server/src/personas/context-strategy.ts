import type { PersonaId } from '@boardroom/shared';
import { RETRIEVAL_CONFIG } from '@boardroom/shared';

/**
 * Phase 6 — persona-specific query rewriting. Different evidence is the
 * cheapest way to keep stances different (IMPROVEMENT-RESEARCH §4).
 * Deterministic: same (persona, question) → same string.
 */
export function rewriteQuery(persona: PersonaId, question: string): string {
  const q = question.trim();
  switch (persona) {
    case 'critic':
      return `risks, failures, past mistakes, what went wrong about: ${q}`;
    case 'doer':
      return `tasks, deadlines, commitments, owners about: ${q}`;
    case 'technician':
      return `implementation, constraints, dependencies about: ${q}`;
    case 'optimist':
      return `opportunities, wins, momentum about: ${q}`;
    default:
      return question;
  }
}

export interface ContextRequestOptions {
  /** Phase 6 — temporal validity; forwarded as `asOf` when the session carries one. */
  asOf?: string;
}

export interface PersonaContextRequest {
  query: string;
  persona: PersonaId;
  userId: string;
  maxItems: number;
  includeEntities: string[];
  includeArchived?: boolean;
  memoryClass?: string;
  asOf?: string;
}

export function getContextRequest(
  personaId: PersonaId,
  question: string,
  userId: string,
  options: ContextRequestOptions = {},
): PersonaContextRequest {
  const base = { query: rewriteQuery(personaId, question), persona: personaId, userId };
  const temporal = options.asOf ? { asOf: options.asOf } : {};

  // CEO gets more items
  if (personaId === 'ceo') {
    return { ...base, maxItems: RETRIEVAL_CONFIG.maxItemsCEO, includeEntities: ['memories', 'people', 'goals', 'projects', 'decisions'], ...temporal };
  }

  // Persona-specific entity focus
  const entityMap: Record<string, string[]> = {
    optimist: ['memories', 'goals', 'projects'],
    critic: ['memories', 'decisions', 'commitments'],
    alternate: ['memories', 'decisions', 'projects'],
    technician: ['memories', 'projects', 'tasks'],
    questionnaire: ['memories', 'goals'],
    doer: ['memories', 'projects', 'tasks'],
  };

  // Phase 6 — the Critic also reads archived/superseded memories and
  // DECISION-class memories (poor outcomes are its evidence).
  const criticExtras = personaId === 'critic' ? { includeArchived: true, memoryClass: 'DECISION' } : {};

  return {
    ...base,
    maxItems: RETRIEVAL_CONFIG.maxItemsPerPersona,
    includeEntities: entityMap[personaId] ?? ['memories'],
    ...criticExtras,
    ...temporal,
  };
}
