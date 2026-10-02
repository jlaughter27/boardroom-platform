/**
 * Hand-rolled validators for the gold sets and the seed corpus. Kept free of
 * zod so the eval tree needs nothing beyond what the root install provides.
 */

export const SLICES = ['temporal', 'update', 'abstention', 'entity', 'general'] as const;
export type Slice = (typeof SLICES)[number];

export const PERSONAS = ['optimist', 'critic', 'alternate', 'technician', 'questionnaire', 'doer', 'ceo'] as const;

export interface GoldQuery {
  id: string;
  query: string;
  persona: string;
  relevantMemoryKeys: string[];
  slice: Slice;
}

export interface GoldFile {
  archetype: string;
  description?: string;
  queries: GoldQuery[];
}

export interface SeedMemory {
  key: string;
  archetype: string;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  memoryClass: 'WORKING' | 'EPISODIC' | 'SEMANTIC' | 'DECISION';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  createdAtOffsetDays: number;
  explicitDate?: string;
  supersedes?: string;
}

export interface SeedFile {
  description?: string;
  archetypes: Record<string, { userIdSuffix: string; domain: string }>;
  memories: SeedMemory[];
}

export const MIN_QUERIES_PER_ARCHETYPE = 35;
export const MIN_ABSTENTION_PER_ARCHETYPE = 5;
export const MIN_SEED_MEMORIES = 120;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

export function validateSeedFile(raw: unknown): { ok: boolean; errors: string[]; value: SeedFile | null } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['seed file is not an object'], value: null };
  if (!isObj(raw.archetypes)) errors.push('archetypes missing');
  if (!Array.isArray(raw.memories)) return { ok: false, errors: [...errors, 'memories is not an array'], value: null };
  const keys = new Set<string>();
  raw.memories.forEach((m, i) => {
    const at = `memories[${i}]`;
    if (!isObj(m)) { errors.push(`${at} not an object`); return; }
    for (const f of ['key', 'archetype', 'title', 'content'] as const) {
      if (typeof m[f] !== 'string' || (m[f] as string).length === 0) errors.push(`${at}.${f} must be a non-empty string`);
    }
    if (typeof m.key === 'string') {
      if (keys.has(m.key)) errors.push(`${at}.key duplicate: ${m.key}`);
      keys.add(m.key);
    }
    if (!isStrArr(m.tags)) errors.push(`${at}.tags must be string[]`);
    if (typeof m.importance !== 'number' || m.importance < 0 || m.importance > 1) errors.push(`${at}.importance must be 0..1`);
    if (!['WORKING', 'EPISODIC', 'SEMANTIC', 'DECISION'].includes(m.memoryClass as string)) errors.push(`${at}.memoryClass invalid`);
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(m.confidence as string)) errors.push(`${at}.confidence invalid`);
    if (typeof m.createdAtOffsetDays !== 'number' || m.createdAtOffsetDays > 0) errors.push(`${at}.createdAtOffsetDays must be a number <= 0`);
    if (m.explicitDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(m.explicitDate))) errors.push(`${at}.explicitDate must be YYYY-MM-DD`);
    if (m.supersedes !== undefined && typeof m.supersedes !== 'string') errors.push(`${at}.supersedes must be a string`);
    if (isObj(raw.archetypes) && typeof m.archetype === 'string' && !(m.archetype in raw.archetypes)) errors.push(`${at}.archetype '${m.archetype}' not declared`);
  });
  // supersedes must reference an existing key in the same archetype
  raw.memories.forEach((m, i) => {
    if (!isObj(m) || typeof m.supersedes !== 'string') return;
    if (!keys.has(m.supersedes)) { errors.push(`memories[${i}].supersedes '${m.supersedes}' not found`); return; }
    const target = (raw.memories as unknown[]).find(x => isObj(x) && x.key === m.supersedes) as Record<string, unknown> | undefined;
    if (target && target.archetype !== m.archetype) errors.push(`memories[${i}].supersedes crosses archetypes`);
    if (m.supersedes === m.key) errors.push(`memories[${i}] supersedes itself`);
  });
  if (raw.memories.length < MIN_SEED_MEMORIES) errors.push(`need >= ${MIN_SEED_MEMORIES} memories, have ${raw.memories.length}`);
  return { ok: errors.length === 0, errors, value: errors.length === 0 ? (raw as unknown as SeedFile) : null };
}

export function validateGoldFile(raw: unknown, seedKeys: ReadonlySet<string>): { ok: boolean; errors: string[]; value: GoldFile | null } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['gold file is not an object'], value: null };
  if (typeof raw.archetype !== 'string') errors.push('archetype missing');
  if (!Array.isArray(raw.queries)) return { ok: false, errors: [...errors, 'queries is not an array'], value: null };
  const ids = new Set<string>();
  let abstention = 0;
  raw.queries.forEach((q, i) => {
    const at = `queries[${i}]`;
    if (!isObj(q)) { errors.push(`${at} not an object`); return; }
    if (typeof q.id !== 'string' || !q.id) errors.push(`${at}.id missing`);
    else { if (ids.has(q.id)) errors.push(`${at}.id duplicate ${q.id}`); ids.add(q.id); }
    if (typeof q.query !== 'string' || q.query.trim().length < 5) errors.push(`${at}.query too short`);
    if (!PERSONAS.includes(q.persona as (typeof PERSONAS)[number])) errors.push(`${at}.persona '${String(q.persona)}' not a built-in persona`);
    if (!SLICES.includes(q.slice as Slice)) errors.push(`${at}.slice invalid`);
    if (!isStrArr(q.relevantMemoryKeys)) { errors.push(`${at}.relevantMemoryKeys must be string[]`); return; }
    for (const k of q.relevantMemoryKeys) if (!seedKeys.has(k)) errors.push(`${at} references unknown seed key '${k}'`);
    if (new Set(q.relevantMemoryKeys).size !== q.relevantMemoryKeys.length) errors.push(`${at}.relevantMemoryKeys has duplicates`);
    if (q.slice === 'abstention') {
      abstention++;
      if (q.relevantMemoryKeys.length !== 0) errors.push(`${at} abstention query must have an empty gold set`);
    } else if (q.relevantMemoryKeys.length === 0) {
      errors.push(`${at} non-abstention query must list >= 1 relevant key`);
    }
  });
  if (raw.queries.length < MIN_QUERIES_PER_ARCHETYPE) errors.push(`need >= ${MIN_QUERIES_PER_ARCHETYPE} queries, have ${raw.queries.length}`);
  if (abstention < MIN_ABSTENTION_PER_ARCHETYPE) errors.push(`need >= ${MIN_ABSTENTION_PER_ARCHETYPE} abstention queries, have ${abstention}`);
  return { ok: errors.length === 0, errors, value: errors.length === 0 ? (raw as unknown as GoldFile) : null };
}
