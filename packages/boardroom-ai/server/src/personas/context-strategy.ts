import type { PersonaId } from '@boardroom/shared';
import { RETRIEVAL_CONFIG } from '@boardroom/shared';

export function getContextRequest(personaId: PersonaId, question: string, userId: string) {
  const base = { query: question, persona: personaId, userId };

  // CEO gets more items
  if (personaId === 'ceo') {
    return { ...base, maxItems: RETRIEVAL_CONFIG.maxItemsCEO, includeEntities: ['memories', 'people', 'goals', 'projects', 'decisions'] };
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

  return {
    ...base,
    maxItems: RETRIEVAL_CONFIG.maxItemsPerPersona,
    includeEntities: entityMap[personaId] ?? ['memories'],
  };
}
