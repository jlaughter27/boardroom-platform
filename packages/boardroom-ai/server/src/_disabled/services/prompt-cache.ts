import { sha256Hash } from '@boardroom/shared';
import type { PersonaResponse } from '@boardroom/shared';

interface CacheEntry {
  response: PersonaResponse;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

// Clean expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > TTL_MS) cache.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Generate cache key from prompt inputs.
 */
export function generateCacheKey(systemPrompt: string, context: string, question: string): string {
  return sha256Hash(`${systemPrompt}|${context}|${question}`);
}

/**
 * Get cached response if available and not expired.
 */
export function getCached(key: string): PersonaResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.response;
}

/**
 * Store response in cache.
 */
export function setCached(key: string, response: PersonaResponse): void {
  cache.set(key, { response, cachedAt: Date.now() });
}

/**
 * Get cache stats for monitoring.
 */
export function getCacheStats(): { size: number; hitRate: string } {
  return { size: cache.size, hitRate: 'N/A' };
}
