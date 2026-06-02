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

const MAX_INCLUDE_DEPTH = 4;
const INCLUDE_PATTERN = /\{\{include:([a-zA-Z0-9_\-./]+)\}\}/g;

/**
 * Resolve `{{include:path}}` tokens in a prompt body. The path is relative to
 * the prompts directory and may omit the `.md` extension. Included files may
 * themselves contain include tokens up to MAX_INCLUDE_DEPTH levels deep.
 */
function resolveIncludes(body: string, depth: number, stack: string[]): string {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new Error(
      `prompt-loader: include depth exceeded ${MAX_INCLUDE_DEPTH} (stack: ${stack.join(' -> ')})`
    );
  }
  return body.replace(INCLUDE_PATTERN, (_match, rawPath: string) => {
    if (stack.includes(rawPath)) {
      throw new Error(`prompt-loader: include cycle detected (${[...stack, rawPath].join(' -> ')})`);
    }
    const withExt = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
    const filePath = join(PROMPTS_DIR, withExt);
    const content = readFileSync(filePath, 'utf-8');
    return resolveIncludes(content, depth + 1, [...stack, rawPath]);
  });
}

export function loadPrompt(personaId: PersonaId): string {
  const cached = cache.get(personaId);
  if (cached) return cached;

  const filePath = join(PROMPTS_DIR, `${personaId}.system.md`);
  const raw = readFileSync(filePath, 'utf-8');
  const assembled = resolveIncludes(raw, 0, [personaId]);
  cache.set(personaId, assembled);
  return assembled;
}

/**
 * Load any system prompt by filename (without .system.md extension).
 * Also supports `{{include:...}}` token resolution.
 */
export function loadSystemPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = join(PROMPTS_DIR, `${name}.system.md`);
  const raw = readFileSync(filePath, 'utf-8');
  const assembled = resolveIncludes(raw, 0, [name]);
  cache.set(name, assembled);
  return assembled;
}

export function reloadPrompts(): void {
  cache.clear();
}
