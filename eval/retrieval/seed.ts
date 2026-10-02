/**
 * Seed the retrieval-eval corpus through the OmniMind HTTP API.
 *
 *   OMNIMIND_API_URL=http://localhost:3333 OMNIMIND_API_KEY=... pnpm eval:retrieval:seed
 *
 * Idempotent by seed key:
 *   - A key→id map is kept in eval/results/.seed-map.json (one entry per
 *     `${archetype}:${key}`). On re-run the existing ids are re-validated with
 *     ONE listing per archetype (GET /memories?tags=eval-ir&limit=200) — not
 *     one GET per memory — because the API allows 20 requests/min/user/method.
 *   - Memories missing from the listing are (re)created.
 *   - Every memory carries tags ['eval-ir', <archetype>] and
 *     metadata { evalKey, archetype, createdAtOffsetDays, explicitDate } so
 *     the listing can be matched by key even if the map file is lost.
 *   - Pairs with `supersedes` get PATCH /memories/:newId { supersedes: oldId }
 *     (Phase 6 contract, lane A2). The old row is then expected to carry
 *     invalidAt/supersededBy; we verify a sample and warn if the server has
 *     not landed the feature yet (the `update` slice then reflects that).
 *
 * One synthetic user per archetype (`${EVAL_IR_USER_PREFIX}-${userIdSuffix}`)
 * so corpora never bleed into each other. Nothing here touches the ministry
 * domain: the "ministry-shaped" archetype lives under domain `community`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OmniClient, envConfig, waitForHealth } from './client';
import { validateSeedFile, type SeedFile, type SeedMemory } from './gold-schema';

export const EVAL_TAG = 'eval-ir';
const RESULTS_DIR = join(__dirname, '..', 'results');
export const SEED_MAP_PATH = join(RESULTS_DIR, '.seed-map.json');

export interface SeedMap {
  generatedAt: string;
  baseUrl: string;
  /** `${archetype}:${key}` → memory id */
  ids: Record<string, string>;
  /** archetype → userId used */
  users: Record<string, string>;
  /** keys whose supersede link was confirmed server-side */
  supersedeConfirmed: string[];
  supersedeUnconfirmed: string[];
}

export function loadSeedFile(): SeedFile {
  const raw = JSON.parse(readFileSync(join(__dirname, 'seed-memories.json'), 'utf-8'));
  const v = validateSeedFile(raw);
  if (!v.ok || !v.value) throw new Error(`seed-memories.json invalid:\n  ${v.errors.join('\n  ')}`);
  return v.value;
}

export function loadSeedMap(): SeedMap | null {
  if (!existsSync(SEED_MAP_PATH)) return null;
  try { return JSON.parse(readFileSync(SEED_MAP_PATH, 'utf-8')) as SeedMap; } catch { return null; }
}

export function userIdFor(prefix: string, seed: SeedFile, archetype: string): string {
  return `${prefix}-${seed.archetypes[archetype].userIdSuffix}`;
}

interface ListedMemory { id: string; title: string; tags?: string[]; metadata?: Record<string, unknown> | null }

async function listExisting(client: OmniClient): Promise<Map<string, string>> {
  // GET /memories supports tags filter + limit ≤ 100; two pages cover a corpus of ≤ 200 per user.
  const byKey = new Map<string, string>();
  for (const offset of [0, 100]) {
    const r = await client.request<{ items?: ListedMemory[]; memories?: ListedMemory[] } | ListedMemory[]>('GET', `/memories?tags=${EVAL_TAG}&limit=100&offset=${offset}`);
    if (r.status !== 200) break;
    const items = Array.isArray(r.body) ? r.body : (r.body.items ?? r.body.memories ?? []);
    for (const m of items) {
      const key = (m.metadata as { evalKey?: string } | null | undefined)?.evalKey;
      if (key) byKey.set(key, m.id);
    }
    if (items.length < 100) break;
  }
  return byKey;
}

function toCreateBody(m: SeedMemory, domain: string) {
  return {
    title: m.title,
    content: m.content,
    domain,
    sourceType: 'MANUAL',
    tags: [EVAL_TAG, m.archetype, ...m.tags],
    memoryClass: m.memoryClass,
    importance: m.importance,
    confidence: m.confidence,
    metadata: {
      evalKey: m.key,
      archetype: m.archetype,
      createdAtOffsetDays: m.createdAtOffsetDays,
      ...(m.explicitDate ? { explicitDate: m.explicitDate } : {}),
      ...(m.supersedes ? { supersedesKey: m.supersedes } : {}),
    },
  };
}

export async function seedArchetype(
  client: OmniClient,
  seed: SeedFile,
  archetype: string,
  log: (s: string) => void,
): Promise<{ ids: Record<string, string>; confirmed: string[]; unconfirmed: string[] }> {
  const domain = seed.archetypes[archetype].domain;
  const memories = seed.memories.filter(m => m.archetype === archetype);
  const existing = await listExisting(client);
  const ids: Record<string, string> = {};
  let created = 0;
  for (const m of memories) {
    const have = existing.get(m.key);
    if (have) { ids[m.key] = have; continue; }
    const body = await client.expect<{ id: string }>('POST', '/memories', toCreateBody(m, domain), [201, 200]);
    ids[m.key] = body.id;
    created++;
  }
  log(`[${archetype}] ${memories.length} memories (${created} created, ${memories.length - created} reused) as user ${client.userId}`);

  // Supersede links (PATCH bucket is separate from POST, 20/min is plenty).
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  for (const m of memories.filter(x => x.supersedes)) {
    const newId = ids[m.key];
    const oldId = ids[m.supersedes as string];
    if (!newId || !oldId) { unconfirmed.push(m.key); continue; }
    const r = await client.request<Record<string, unknown>>('PATCH', `/memories/${newId}`, { supersedes: oldId });
    if (r.status !== 200) { log(`[${archetype}] PATCH supersedes for ${m.key} -> ${r.status}`); unconfirmed.push(m.key); continue; }
    const consolidatedFrom = r.body?.consolidatedFrom;
    if (Array.isArray(consolidatedFrom) && consolidatedFrom.includes(oldId)) { confirmed.push(m.key); continue; }
    // Fall back to inspecting the old row (GET bucket: ≤ 10 per archetype).
    const old = await client.request<{ invalidAt?: string | null; supersededBy?: string | null }>('GET', `/memories/${oldId}`);
    if (old.status === 200 && (old.body?.supersededBy === newId || old.body?.invalidAt)) confirmed.push(m.key);
    else unconfirmed.push(m.key);
  }
  if (unconfirmed.length > 0) {
    log(`[${archetype}] WARNING: supersede link not confirmed for ${unconfirmed.join(', ')} — PATCH /memories/:id { supersedes } may not be deployed; update-slice scores will include stale rows.`);
  }
  return { ids, confirmed, unconfirmed };
}

export async function seedAll(opts: { archetypes?: string[]; log?: (s: string) => void } = {}): Promise<SeedMap> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const cfg = envConfig();
  const seed = loadSeedFile();
  const archetypes = opts.archetypes ?? Object.keys(seed.archetypes);
  await waitForHealth(cfg.baseUrl);

  const previous = loadSeedMap();
  const map: SeedMap = {
    generatedAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    ids: previous && previous.baseUrl === cfg.baseUrl ? { ...previous.ids } : {},
    users: {},
    supersedeConfirmed: [],
    supersedeUnconfirmed: [],
  };

  // Archetypes run concurrently: each has its own user → own rate-limit bucket.
  await Promise.all(archetypes.map(async archetype => {
    const userId = userIdFor(cfg.userPrefix, seed, archetype);
    const client = new OmniClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userId, log });
    const r = await seedArchetype(client, seed, archetype, log);
    for (const [k, id] of Object.entries(r.ids)) map.ids[`${archetype}:${k}`] = id;
    map.users[archetype] = userId;
    map.supersedeConfirmed.push(...r.confirmed);
    map.supersedeUnconfirmed.push(...r.unconfirmed);
  }));

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(SEED_MAP_PATH, JSON.stringify(map, null, 2));
  log(`seed map written to ${SEED_MAP_PATH} (${Object.keys(map.ids).length} ids)`);
  return map;
}

if (require.main === module) {
  const only = process.env.EVAL_IR_ARCHETYPES?.split(',').map(s => s.trim()).filter(Boolean);
  seedAll({ archetypes: only && only.length > 0 ? only : undefined }).catch(err => {
    console.error('[seed] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
