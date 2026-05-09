// Persona configuration constants
// REFERENCE VALUES from: docs/02-reference/MASTER-FRAMEWORK.md §3 Persona System
// Model assignments, token budgets, and prompt file paths for each persona.

import type { BuiltInPersonaId, PersonaConfig } from '../types/persona.types';

/**
 * Configuration for each BoardRoom persona.
 * Maps persona IDs to their model tier, token budget, and system prompt.
 *
 * Source: docs/02-reference/MASTER-FRAMEWORK.md §3 Persona System
 */
export const PERSONA_CONFIGS: Readonly<Record<BuiltInPersonaId, PersonaConfig>> & Readonly<Record<string, PersonaConfig>> = {
  // Bug #4 — persona latency fix:
  // Token budgets used to be 2000/3000 across the board. The prompts themselves
  // only declared 1200-1500 max. The 2000 cap combined with a rigid "3-6
  // paragraphs" rule produced essay-length analyses for one-line prompts.
  // Budgets now match what the prompts actually declare; depth scaling is
  // enforced in the prompt text itself (see docs/prompts/*.system.md).
  optimist: { id: 'optimist', name: 'The Optimist', model: 'haiku', maxOutputTokens: 1200, systemPromptPath: 'docs/prompts/optimist.system.md' },
  critic: { id: 'critic', name: 'The Critic', model: 'haiku', maxOutputTokens: 1200, systemPromptPath: 'docs/prompts/critic.system.md' },
  alternate: { id: 'alternate', name: 'The Alternate', model: 'sonnet', maxOutputTokens: 1500, systemPromptPath: 'docs/prompts/alternate.system.md' },
  technician: { id: 'technician', name: 'The Technician', model: 'haiku', maxOutputTokens: 1200, systemPromptPath: 'docs/prompts/technician.system.md' },
  questionnaire: { id: 'questionnaire', name: 'The Questionnaire', model: 'haiku', maxOutputTokens: 1000, systemPromptPath: 'docs/prompts/questionnaire.system.md' },
  doer: { id: 'doer', name: 'The Doer', model: 'haiku', maxOutputTokens: 1500, systemPromptPath: 'docs/prompts/doer.system.md' },
  ceo: { id: 'ceo', name: 'The CEO', model: 'sonnet', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/ceo.system.md' },
} as const;

/**
 * Maps model tier names to full Anthropic model identifiers.
 */
export const MODEL_MAP = {
  // Bug #3 — `claude-sonnet-4-6-20250514` was a typo that returned 404
  // not_found_error on every Alternate dispatch, silently dropping the
  // persona from the whole flow (surfaced after Bug #2 was fixed).
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

/**
 * Cost per million tokens for each model tier (USD).
 *
 * Source: Anthropic pricing page (April 2026)
 */
export const MODEL_COSTS = {
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  haiku: { inputPerMTok: 1, outputPerMTok: 5 },
} as const;
