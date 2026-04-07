import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const PROMPTS_DIR = process.env.PROMPTS_DIR ?? resolve(__dirname, '../../../../docs/prompts');
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
