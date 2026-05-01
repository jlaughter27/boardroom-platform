// User-facing modes — TASK-004 (DeepSeek)
// Implement from: docs/02-reference/MASTER-FRAMEWORK.md §3 User-Facing Modes

import type { PersonaId } from './persona.types';

export type UserMode = 'decide' | 'stress-test' | 'plan' | 'clarify' | 'review' | 'quick-take';

export interface ModeConfig {
  id: UserMode;
  label: string;
  description: string;
  personas: PersonaId[];
  includesCEO: boolean;
}

export const MODE_CONFIGS: Record<UserMode, ModeConfig> = {
  'decide': {
    id: 'decide',
    label: 'Decide',
    description: 'Full multi-perspective analysis + synthesis',
    personas: ['optimist', 'critic', 'alternate', 'technician'],
    includesCEO: true,
  },
  'stress-test': {
    id: 'stress-test',
    label: 'Stress Test',
    description: 'Adversarial pressure testing (pre-mortem framing)',
    personas: ['critic', 'alternate', 'technician'],
    includesCEO: true,
  },
  'plan': {
    id: 'plan',
    label: 'Plan',
    description: 'Action-oriented breakdown',
    personas: ['technician', 'doer'],
    includesCEO: true,
  },
  'clarify': {
    id: 'clarify',
    label: 'Clarify',
    description: 'Deep thinking before analysis',
    personas: ['questionnaire'],
    includesCEO: false,
  },
  'review': {
    id: 'review',
    label: 'Review',
    description: 'Check progress against past decisions',
    personas: ['critic'],
    includesCEO: true,
  },
  'quick-take': {
    id: 'quick-take',
    label: 'Quick Take',
    description: 'Single unified analysis (fast, cheap)',
    personas: [],
    includesCEO: true,
  },
};
