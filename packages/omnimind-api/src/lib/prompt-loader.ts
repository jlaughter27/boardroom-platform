import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';

/**
 * Walk up from __dirname looking for a `docs/prompts` folder. Works in dev
 * and production Docker. See packages/boardroom-ai/server/src/lib/prompt-loader.ts
 * for the full rationale (Bug #2 fix).
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
  return resolve(__dirname, '../../../../docs/prompts');
}

const PROMPTS_DIR = resolvePromptsDir();
const cache = new Map<string, string>();

/**
 * Load a system prompt by filename (without .system.md extension).
 */
export function loadSystemPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = join(PROMPTS_DIR, `${name}.system.md`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(name, content);
  return content;
}
