import { describe, it, expect } from 'vitest';
import { generateCacheKey, getCached, setCached } from '../../src/services/prompt-cache';
import type { PersonaResponse } from '@boardroom/shared';

const mockResponse: PersonaResponse = {
  personaId: 'optimist',
  perspective: 'Test perspective',
  supportingPoints: ['point1'],
  risks: [],
  confidence: 0.8,
  sourceMemoryIds: [],
};

describe('prompt-cache', () => {
  it('getCached returns null for unknown key', () => {
    expect(getCached('nonexistent-key-12345')).toBeNull();
  });

  it('setCached + getCached returns stored response', () => {
    const key = 'test-key-' + Date.now();
    setCached(key, mockResponse);
    const cached = getCached(key);

    expect(cached).not.toBeNull();
    expect(cached!.personaId).toBe('optimist');
    expect(cached!.perspective).toBe('Test perspective');
  });

  it('same inputs produce same cache key', () => {
    const key1 = generateCacheKey('system', 'context', 'question');
    const key2 = generateCacheKey('system', 'context', 'question');
    expect(key1).toBe(key2);
  });

  it('different inputs produce different cache keys', () => {
    const key1 = generateCacheKey('system', 'context', 'question1');
    const key2 = generateCacheKey('system', 'context', 'question2');
    expect(key1).not.toBe(key2);
  });
});
