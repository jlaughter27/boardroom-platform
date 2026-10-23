import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateGoldFile, validateSeedFile, MIN_QUERIES_PER_ARCHETYPE, MIN_ABSTENTION_PER_ARCHETYPE, MIN_SEED_MEMORIES, REQUIRED_SLICES,
} from '../gold-schema';
import { loadRawSeed } from '../seed';
import { buildVaultMemories, VAULT_ARCHETYPE } from '../vault-corpus';

const RETRIEVAL_DIR = join(__dirname, '..');
// seed-memories.json + the generated RD-2 vault archetype (what the seeder writes).
const seedRaw = loadRawSeed() as { archetypes: Record<string, { domain: string; kind?: 'vault' }>; memories: any[] };
const kindOf = (archetype: string): 'legacy' | 'vault' => (seedRaw.archetypes[archetype]?.kind === 'vault' ? 'vault' : 'legacy');
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
  it('has supersede pairs and explicit-date memories in every legacy archetype', () => {
    for (const archetype of Object.keys(seedRaw.archetypes).filter(a => kindOf(a) === 'legacy')) {
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
      it('covers every slice its archetype kind requires', () => {
        const slices = new Set(raw.queries.map((q: { slice: string }) => q.slice));
        for (const s of REQUIRED_SLICES[kindOf(raw.archetype)]) expect(slices.has(s), s).toBe(true);
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

// RD-2: the vault corpus must look like a vault and make keyword queries hard.
describe('vault corpus (RD-2)', () => {
  const vault = buildVaultMemories();
  const gold = JSON.parse(readFileSync(join(goldDir, 'vault.json'), 'utf-8'));

  it('is deterministic (byte-identical on every build)', () => {
    expect(JSON.stringify(buildVaultMemories())).toBe(JSON.stringify(vault));
  });

  it('is long markdown: headings, tables and [[wikilinks]] in most notes', () => {
    expect(vault.length).toBeGreaterThanOrEqual(60);
    const avg = vault.reduce((n, m) => n + m.content.length, 0) / vault.length;
    expect(avg).toBeGreaterThan(700);
    expect(vault.filter(m => /^## /m.test(m.content)).length).toBe(vault.length);
    expect(vault.filter(m => /\n\|.*\|\n\|-/.test(m.content)).length / vault.length).toBeGreaterThan(0.8);
    expect(vault.filter(m => /\[\[[^\]]+\]\]/.test(m.content)).length / vault.length).toBeGreaterThan(0.8);
    for (const tag of ['concept', 'entity', 'source', 'daily', 'meeting', 'moc']) {
      expect(vault.some(m => m.tags.includes(tag)), tag).toBe(true);
    }
  });

  it('every keyword query has exactly one gold note, found by title, and >= 3 other notes mention the keyword', () => {
    for (const q of gold.queries.filter((x: { slice: string }) => x.slice === 'keyword')) {
      expect(q.relevantMemoryKeys).toHaveLength(1);
      const target = vault.find(m => m.key === q.relevantMemoryKeys[0])!;
      expect(target.title.toLowerCase(), q.id).toContain(q.query.toLowerCase());
      const others = vault.filter(m => m.key !== target.key && m.content.toLowerCase().includes(q.query.toLowerCase()));
      expect(others.length, `${q.id} '${q.query}' body mentions`).toBeGreaterThanOrEqual(3);
    }
  });

  it('stays in a non-ministry domain and inside the archetype', () => {
    expect(seedRaw.archetypes[VAULT_ARCHETYPE].domain).not.toBe('ministry');
    expect(vault.every(m => m.archetype === VAULT_ARCHETYPE && m.createdAtOffsetDays <= 0)).toBe(true);
  });
});
