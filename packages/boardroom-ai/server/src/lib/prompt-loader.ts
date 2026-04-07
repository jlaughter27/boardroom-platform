import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { PersonaId } from '@boardroom/shared';

const PROMPTS_DIR = process.env.PROMPTS_DIR ?? resolve(__dirname, '../../../../docs/prompts');
const cache = new Map<string, string>();

export function loadPrompt(personaId: PersonaId): string {
  const cached = cache.get(personaId);
  if (cached) return cached;

  const filePath = join(PROMPTS_DIR, `${personaId}.system.md`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(personaId, content);
  return content;
}

export function reloadPrompts(): void {
  cache.clear();
}
