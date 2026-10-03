import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateGoldFile, validateSeedFile, MIN_QUERIES_PER_ARCHETYPE, MIN_ABSTENTION_PER_ARCHETYPE, MIN_SEED_MEMORIES,
} from '../gold-schema';

const RETRIEVAL_DIR = join(__dirname, '..');
const seedRaw = JSON.parse(readFileSync(join(RETRIEVAL_DIR, 'seed-memories.json'), 'utf-8'));
const goldDir = join(RETRIEVAL_DIR, 'gold');
const goldFiles = readdirSync(goldDir).filter(f => f.endsWith('.json')).sort();

describe('seed-memories.json', () => {
  const v = validateSeedFile(seedRaw);
  it('validates', () => { expect(v.errors).toEqual([]); expect(v.ok).toBe(true); });
  it(`has >= ${MIN_SEED_MEMORIES} memories with unique keys`, () => {
    const keys = seedRaw.memories.map((m: { key: string }) => m.key);
    expect(keys.length).toBeGreaterThanOrEqual(MIN_SEED_MEMORIES);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('has supersede pairs and explicit-date memories in every archetype', () => {
    for (const archetype of Object.keys(seedRaw.archetypes)) {
      const mine = seedRaw.memories.filter((m: { archetype: string }) => m.archetype === archetype);
      expect(mine.filter((m: { supersedes?: string }) => m.supersedes).length, `${archetype} supersedes`).toBeGreaterThanOrEqual(2);
      expect(mine.filter((m: { explicitDate?: string }) => m.explicitDate).length, `${archetype} explicitDate`).toBeGreaterThanOrEqual(5);
    }
  });
  it('never uses the ministry domain (MINISTRY_DEFERRED) and keeps domains lowercase', () => {
    for (const a of Object.values(seedRaw.archetypes) as Array<{ domain: string }>) {
      expect(a.domain).not.toBe('ministry');
      expect(a.domain).toBe(a.domain.toLowerCase().trim());
    }
  });
});

describe('gold sets', () => {
  const seedKeys = new Set<string>(seedRaw.memories.map((m: { key: string }) => m.key));
  const seedArchetypeOf = new Map<string, string>(seedRaw.memories.map((m: { key: string; archetype: string }) => [m.key, m.archetype]));

  it('has one file per archetype', () => {
    const archetypes = goldFiles.map(f => JSON.parse(readFileSync(join(goldDir, f), 'utf-8')).archetype).sort();
    expect(archetypes).toEqual(Object.keys(seedRaw.archetypes).sort());
  });

  for (const file of goldFiles) {
    describe(file, () => {
      const raw = JSON.parse(readFileSync(join(goldDir, file), 'utf-8'));
      const v = validateGoldFile(raw, seedKeys);
      it('validates against the seed corpus', () => { expect(v.errors).toEqual([]); expect(v.ok).toBe(true); });
      it(`has >= ${MIN_QUERIES_PER_ARCHETYPE} queries and >= ${MIN_ABSTENTION_PER_ARCHETYPE} abstention queries`, () => {
        expect(raw.queries.length).toBeGreaterThanOrEqual(MIN_QUERIES_PER_ARCHETYPE);
        expect(raw.queries.filter((q: { slice: string }) => q.slice === 'abstention').length).toBeGreaterThanOrEqual(MIN_ABSTENTION_PER_ARCHETYPE);
      });
      it('covers every slice', () => {
        const slices = new Set(raw.queries.map((q: { slice: string }) => q.slice));
        for (const s of ['temporal', 'update', 'abstention', 'entity', 'general']) expect(slices.has(s), s).toBe(true);
      });
      it('only references memories of its own archetype', () => {
        for (const q of raw.queries) for (const k of q.relevantMemoryKeys) expect(seedArchetypeOf.get(k), `${q.id}:${k}`).toBe(raw.archetype);
      });
      it('update queries point at the superseding (new) memory, not the stale one', () => {
        const superseded = new Set(seedRaw.memories.filter((m: { supersedes?: string }) => m.supersedes).map((m: { supersedes: string }) => m.supersedes));
        for (const q of raw.queries.filter((q: { slice: string }) => q.slice === 'update')) {
          for (const k of q.relevantMemoryKeys) expect(superseded.has(k), `${q.id} lists stale key ${k}`).toBe(false);
        }
      });
    });
  }

  it('rejects a gold file referencing an unknown key', () => {
    const v = validateGoldFile({ archetype: 'x', queries: [{ id: 'a', query: 'hello world', persona: 'ceo', relevantMemoryKeys: ['nope'], slice: 'general' }] }, seedKeys);
    expect(v.ok).toBe(false);
    expect(v.errors.some(e => e.includes("unknown seed key 'nope'"))).toBe(true);
  });
});
