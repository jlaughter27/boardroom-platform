import { describe, it, expect } from 'vitest';
import { packageForPersona } from '../../../src/retrieval/context-packager';

describe('context packager degraded flag (F-204)', () => {
  it('omits the flag when every layer succeeded', () => {
    const pkg = packageForPersona([], 'optimist', 0, ['structured']);
    expect(pkg.retrievalMetadata).toEqual({ totalCandidates: 0, layersUsed: ['structured'] });
  });

  it('surfaces degraded: true + the failing layers', () => {
    const pkg = packageForPersona([], 'optimist', 0, ['structured'], { degradedLayers: ['semantic', 'fts'] });
    expect(pkg.retrievalMetadata.degraded).toBe(true);
    expect(pkg.retrievalMetadata.degradedLayers).toEqual(['semantic', 'fts']);
  });
});
