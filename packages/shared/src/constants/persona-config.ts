// Persona configuration constants
// REFERENCE VALUES from: docs/02-reference/MASTER-FRAMEWORK.md §3 Persona System
// Model assignments, token budgets, and prompt file paths for each persona.

import type { BuiltInPersonaId, PersonaConfig } from '../types/persona.types';
import { MODEL_IDS } from './model-config';

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
 *
 * Phase 6 (2026-10-02): resolves through `MODEL_IDS` in `constants/model-config.ts`
 * — the single source of truth. The dated pins that used to live here are gone;
 * prefer importing `MODEL_IDS` directly in new code.
 */
export const MODEL_MAP: typeof MODEL_IDS = MODEL_IDS;

/**
 * Cost per million tokens for each model tier (USD).
 *
 * @deprecated Phase 6 — use `MODEL_PRICING_USD_PER_MTOK` / `estimateCostUsd()`
 * from `constants/model-config.ts` (current Sonnet 5.5 / Haiku 4.5 prices incl. cache).
 */
export const MODEL_COSTS = {
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  haiku: { inputPerMTok: 1, outputPerMTok: 5 },
} as const;
