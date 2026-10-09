import type { PersonaId } from '@boardroom/shared';
import { MODE_CONFIGS, type UserMode } from '@boardroom/shared';

export function getPersonasForMode(mode: UserMode): PersonaId[] {
  return MODE_CONFIGS[mode].personas as PersonaId[];
}

export function shouldIncludeCEO(mode: UserMode): boolean {
  return MODE_CONFIGS[mode].includesCEO;
}

/**
 * Pre-mortem framing applies to the dedicated Phase 6 `premortem` mode and to
 * the legacy `stress-test` mode (whose prompts already carry a pre-mortem variant).
 * Only `premortem` prepends the premortem.system.md block — see orchestrator.
 */
export function isPreMortemMode(mode: UserMode): boolean {
  return mode === 'stress-test' || mode === 'premortem';
}
