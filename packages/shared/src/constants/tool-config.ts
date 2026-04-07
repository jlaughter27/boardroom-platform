// Tool configuration constants — Phase 3 (Claude)

import type { ToolName } from '../types/tool.types';
import type { PersonaId } from '../types/persona.types';

export const TOOL_PERMISSIONS: Readonly<Record<ToolName, readonly PersonaId[]>> = {
  web_search: ['alternate', 'technician', 'ceo'],
  calculator: ['technician', 'critic', 'ceo'],
  document_read: ['technician', 'alternate', 'critic', 'ceo'],
} as const;

export const TOOL_LIMITS = {
  maxInvocationsPerPersona: 3,
  maxInvocationsPerSession: 10,
  searchResultsLimit: 5,
  documentMaxChars: 10000,
} as const;
