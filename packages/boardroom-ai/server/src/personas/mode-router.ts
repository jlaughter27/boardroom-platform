import type { PersonaId } from '@boardroom/shared';
import { MODE_CONFIGS, type UserMode } from '@boardroom/shared';

export function getPersonasForMode(mode: UserMode): PersonaId[] {
  return MODE_CONFIGS[mode].personas as PersonaId[];
}

export function shouldIncludeCEO(mode: UserMode): boolean {
  return MODE_CONFIGS[mode].includesCEO;
}

export function isPreMortemMode(mode: UserMode): boolean {
  return mode === 'stress-test';
}
