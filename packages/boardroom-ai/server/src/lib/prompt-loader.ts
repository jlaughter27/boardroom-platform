import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import type { PersonaId } from '@boardroom/shared';

/**
 * Walk up from __dirname looking for a `docs/prompts` folder. This works in
 * BOTH dev (where __dirname is packages/boardroom-ai/server/src/lib) AND
 * production Docker builds (where __dirname is /app/dist/server/lib). The
 * previous `resolve(__dirname, '../../../../docs/prompts')` was wrong in both
 * environments and caused every loadPrompt() call to throw ENOENT, which was
 * silently swallowed by Promise.allSettled in the orchestrator (Bug #2).
 *
 * Override with PROMPTS_DIR env var if needed.
 */
function resolvePromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'docs', 'prompts');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Final fallback — old behavior, kept so the error message still points
  // somewhere meaningful if the walk-up fails entirely.
  return resolve(__dirname, '../../../../docs/prompts');
}

const PROMPTS_DIR = resolvePromptsDir();
const cache = new Map<string, string>();

export function loadPrompt(personaId: PersonaId): string {
  const cached = cache.get(personaId);
  if (cached) return cached;

  const filePath = join(PROMPTS_DIR, `${personaId}.system.md`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(personaId, content);
  return content;
}

/**
 * Load any system prompt by filename (without .system.md extension).
 */
export function loadSystemPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = join(PROMPTS_DIR, `${name}.system.md`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(name, content);
  return content;
}

export function reloadPrompts(): void {
  cache.clear();
}
