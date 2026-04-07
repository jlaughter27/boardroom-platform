// Persona configuration constants
// REFERENCE VALUES from: docs/MASTER-FRAMEWORK.md §3 Persona System
// Model assignments, token budgets, and prompt file paths for each persona.

import type { BuiltInPersonaId, PersonaConfig } from '../types/persona.types';

/**
 * Configuration for each BoardRoom persona.
 * Maps persona IDs to their model tier, token budget, and system prompt.
 *
 * Source: docs/MASTER-FRAMEWORK.md §3 Persona System
 */
export const PERSONA_CONFIGS: Readonly<Record<BuiltInPersonaId, PersonaConfig>> & Readonly<Record<string, PersonaConfig>> = {
  optimist: { id: 'optimist', name: 'The Optimist', model: 'haiku', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/optimist.system.md' },
  critic: { id: 'critic', name: 'The Critic', model: 'haiku', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/critic.system.md' },
  alternate: { id: 'alternate', name: 'The Alternate', model: 'sonnet', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/alternate.system.md' },
  technician: { id: 'technician', name: 'The Technician', model: 'haiku', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/technician.system.md' },
  questionnaire: { id: 'questionnaire', name: 'The Questionnaire', model: 'haiku', maxOutputTokens: 1000, systemPromptPath: 'docs/prompts/questionnaire.system.md' },
  doer: { id: 'doer', name: 'The Doer', model: 'haiku', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/doer.system.md' },
  ceo: { id: 'ceo', name: 'The CEO', model: 'sonnet', maxOutputTokens: 3000, systemPromptPath: 'docs/prompts/ceo.system.md' },
} as const;

/**
 * Maps model tier names to full Anthropic model identifiers.
 */
export const MODEL_MAP = {
  sonnet: 'claude-sonnet-4-6-20250514',
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
