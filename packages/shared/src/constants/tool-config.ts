// Tool configuration constants — Phase 3 (Claude)

import type { ToolName } from '../types/tool.types';
import type { PersonaId } from '../types/persona.types';

/**
 * Persona permissions per REGISTERED tool.
 *
 * Partial on purpose: `document_read` (B-114) is a stub that BoardRoom no
 * longer registers, so it has no entry here — a tool absent from this map is
 * never advertised to any persona (tool-registry.ts treats `undefined` as
 * "not allowed"). The literal stays in `ToolName` so the stub module and its
 * tests still compile; add the entry back when the tool is real.
 */
export const TOOL_PERMISSIONS: Readonly<Partial<Record<ToolName, readonly PersonaId[]>>> = {
  web_search: ['alternate', 'technician', 'ceo'],
  calculator: ['technician', 'critic', 'ceo'],
} as const;

export const TOOL_LIMITS = {
  maxInvocationsPerPersona: 3,
  maxInvocationsPerSession: 10,
  searchResultsLimit: 5,
  documentMaxChars: 10000,
} as const;
