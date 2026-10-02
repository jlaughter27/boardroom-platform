/**
 * Retrieval IR evaluation — labeled gold sets, recall@k / MRR / nDCG@10.
 *
 *   pnpm eval:retrieval:ir            # seeds (idempotent) then evaluates
 *   EVAL_IR_SKIP_SEED=1 ...           # reuse eval/results/.seed-map.json
 *   EVAL_IR_SKIP_MEMORY_SEARCH=1 ...  # only the /context/for-persona leg
 *   EVAL_IR_ARCHETYPES=business ...   # subset
 *
 * Two legs per gold query:
 *   forPersona   POST /context/for-persona { query, persona }  → items[] (type, id, relevanceScore)
 *   memorySearch POST /memories/search    { query, limit: 10 } → items[] (id, score) — Phase 6 (A2);
 *                skipped automatically when the route answers 404.
 *
 * Scoring (eval/retrieval/metrics.ts): recall@5, recall@10, MRR, nDCG@10
 * overall, per slice and per tenant archetype. Abstention queries score 1 when
 * nothing at/above thresholds.abstentionScoreThreshold is returned. Update-slice
 * queries also report staleHitRate (superseded row surfaced in top-10).
 *
 * Output: eval/results/retrieval-ir-<YYYY-MM-DD>.json and .md. Exit code 1
 * when the `gateOn` leg misses any gate in eval/retrieval/thresholds.json.
 *
 * Needs only OmniMind (no BoardRoom, no LLM key). In CI the embedder is
 * EMBEDDING_PROVIDER=mock, so the semantic layer is deterministic noise and
 * FTS/trigram/structured carry the signal — thresholds are set accordingly.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OmniClient, envConfig, waitForHealth } from '../retrieval/client';
import { validateGoldFile, type GoldFile, type GoldQuery } from '../retrieval/gold-schema';
import { loadSeedFile, loadSeedMap, seedAll, userIdFor, type SeedMap } from '../retrieval/seed';
import { scoreQuery, summarize, groupBy, evaluateGates, round, type QueryMetrics, type MetricSummary } from '../retrieval/metrics';

const RETRIEVAL_DIR = join(__dirname, '..', 'retrieval');
const RESULTS_DIR = join(__dirname, '..', 'results');

interface Thresholds {
  version: number;
  gateOn: 'forPersona' | 'memorySearch';
  gates: Record<string, number>;
  informational?: Record<string, number>;
  abstentionScoreThreshold: number;
}

interface LegResult {
  rankedKeys: string[];
  scores: number[];
  rawCount: number;
  status: number;
  degraded?: boolean;
}

interface QueryRow {
  id: string;
  archetype: string;
  slice: GoldQuery['slice'];
  persona: string;
  query: string;
  relevant: string[];
  forPersona: { leg: LegResult; metrics: QueryMetrics } | null;
  memorySearch: { leg: LegResult; metrics: QueryMetrics } | null;
}

function loadGold(): GoldFile[] {
  const seedKeys = new Set(loadSeedFile().memories.map(m => m.key));
  const dir = join(RETRIEVAL_DIR, 'gold');
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    const v = validateGoldFile(JSON.parse(readFileSync(join(dir, f), 'utf-8')), seedKeys);
    if (!v.ok || !v.value) throw new Error(`${f} invalid:\n  ${v.errors.join('\n  ')}`);
    return v.value;
  });
}

function loadThresholds(): Thresholds {
  return JSON.parse(readFileSync(join(RETRIEVAL_DIR, 'thresholds.json'), 'utf-8')) as Thresholds;
}

function invert(map: SeedMap, archetype: string): Map<string, string> {
  const idToKey = new Map<string, string>();
  const prefix = `${archetype}:`;
  for (const [k, id] of Object.entries(map.ids)) if (k.startsWith(prefix)) idToKey.set(id, k.slice(prefix.length));
  return idToKey;
}

async function legForPersona(client: OmniClient, q: GoldQuery, idToKey: Map<string, string>): Promise<LegResult> {
  const r = await client.request<{ items?: Array<{ type: string; id: string; relevanceScore: number }>; retrievalMetadata?: { degraded?: boolean } }>(
    'POST', '/context/for-persona', { query: q.query, persona: q.persona });
  if (r.status !== 200) return { rankedKeys: [], scores: [], rawCount: 0, status: r.status };
  const items = (r.body.items ?? []).filter(i => i.type === 'memory');
  return {
    rankedKeys: items.map(i => idToKey.get(i.id) ?? `?${i.id}`),
    scores: items.map(i => Number(i.relevanceScore) || 0),
    rawCount: items.length,
    status: r.status,
    degraded: r.body.retrievalMetadata?.degraded,
  };
}

async function legMemorySearch(client: OmniClient, q: GoldQuery, idToKey: Map<string, string>): Promise<LegResult> {
  const r = await client.request<{ items?: Array<{ id: string; score?: number }> }>('POST', '/memories/search', { query: q.query, limit: 10 });
  if (r.status !== 200) return { rankedKeys: [], scores: [], rawCount: 0, status: r.status };
  const items = r.body.items ?? [];
  return {
    rankedKeys: items.map(i => idToKey.get(i.id) ?? `?${i.id}`),
    scores: items.map(i => Number(i.score) || 0),
    rawCount: items.length,
    status: r.status,
  };
}

function staleKeysFor(q: GoldQuery, supersededBy: Map<string, string>): string[] {
  // For update queries: the keys that the gold keys supersede (the stale versions).
  const stale: string[] = [];
  for (const [oldKey, newKey] of supersededBy) if (q.relevantMemoryKeys.includes(newKey)) stale.push(oldKey);
  return stale;
}

function table(rows: Array<[string, MetricSummary]>): string {
  const h = '| group | n | recall@5 | recall@10 | MRR | nDCG@10 | abstention acc | stale-hit rate |\n|---|---:|---:|---:|---:|---:|---:|---:|';
  const f = (x: number | null) => (x === null ? '—' : x.toFixed(3));
  return [h, ...rows.map(([g, s]) => `| ${g} | ${s.count} | ${f(s.recallAt5)} | ${f(s.recallAt10)} | ${f(s.mrr)} | ${f(s.ndcgAt10)} | ${f(s.abstentionAccuracy)} | ${f(s.staleHitRate)} |`)].join('\n');
}

export async function runIrEval(): Promise<number> {
  const cfg = envConfig();
  const thresholds = loadThresholds();
  const gold = loadGold();
  const seed = loadSeedFile();
  const only = process.env.EVAL_IR_ARCHETYPES?.split(',').map(s => s.trim()).filter(Boolean);
  const archetypes = (only && only.length > 0 ? only : Object.keys(seed.archetypes));
  const log = (s: string) => console.log(s);

  await waitForHealth(cfg.baseUrl);
  const seedMap = process.env.EVAL_IR_SKIP_SEED === '1' ? loadSeedMap() : await seedAll({ archetypes, log });
  if (!seedMap) throw new Error('No seed map; run without EVAL_IR_SKIP_SEED=1 first');

  const supersededBy = new Map<string, string>();
  for (const m of seed.memories) if (m.supersedes) supersededBy.set(m.supersedes, m.key);

  let memorySearchAvailable = process.env.EVAL_IR_SKIP_MEMORY_SEARCH !== '1';
  const rows: QueryRow[] = [];

  await Promise.all(gold.filter(g => archetypes.includes(g.archetype)).map(async g => {
    const userId = seedMap.users[g.archetype] ?? userIdFor(cfg.userPrefix, seed, g.archetype);
    const client = new OmniClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userId, log });
    const idToKey = invert(seedMap, g.archetype);
    for (const q of g.queries) {
      const stale = q.slice === 'update' ? staleKeysFor(q, supersededBy) : [];
      const fp = await legForPersona(client, q, idToKey);
      const row: QueryRow = {
        id: q.id, archetype: g.archetype, slice: q.slice, persona: q.persona, query: q.query, relevant: q.relevantMemoryKeys,
        forPersona: { leg: fp, metrics: scoreQuery(fp.rankedKeys, fp.scores, q.relevantMemoryKeys, { abstentionThreshold: thresholds.abstentionScoreThreshold, staleKeys: stale }) },
        memorySearch: null,
      };
      if (memorySearchAvailable) {
        const ms = await legMemorySearch(client, q, idToKey);
        if (ms.status === 404) {
          memorySearchAvailable = false;
          log('POST /memories/search answered 404 — hybrid search leg skipped (not deployed yet)');
        } else {
          row.memorySearch = { leg: ms, metrics: scoreQuery(ms.rankedKeys, ms.scores, q.relevantMemoryKeys, { abstentionThreshold: thresholds.abstentionScoreThreshold, staleKeys: stale }) };
        }
      }
      rows.push(row);
      const m = row.forPersona!.metrics;
      log(`${g.archetype.padEnd(16)} ${q.id.padEnd(8)} ${q.slice.padEnd(10)} r@10=${m.recallAt10.toFixed(2)} mrr=${m.mrr.toFixed(2)} items=${fp.rawCount}${fp.degraded ? ' DEGRADED' : ''}${fp.status !== 200 ? ` HTTP ${fp.status}` : ''}`);
    }
  }));

  rows.sort((a, b) => a.id.localeCompare(b.id));

  const legs: Array<'forPersona' | 'memorySearch'> = ['forPersona', ...(rows.some(r => r.memorySearch) ? ['memorySearch' as const] : [])];
  const summaryFor = (leg: 'forPersona' | 'memorySearch') => {
    const pick = (rs: QueryRow[]) => rs.map(r => r[leg]?.metrics).filter((m): m is QueryMetrics => !!m);
    return {
      overall: summarize(pick(rows)),
      bySlice: Object.fromEntries(Object.entries(groupBy(rows, r => r.slice)).map(([k, v]) => [k, summarize(pick(v))])),
      byArchetype: Object.fromEntries(Object.entries(groupBy(rows, r => r.archetype)).map(([k, v]) => [k, summarize(pick(v))])),
    };
  };
  const summaries = Object.fromEntries(legs.map(l => [l, summaryFor(l)])) as Record<'forPersona' | 'memorySearch', ReturnType<typeof summaryFor>>;

  const gateLeg = legs.includes(thresholds.gateOn) ? thresholds.gateOn : 'forPersona';
  const gate = evaluateGates(summaries[gateLeg].overall, thresholds.gates);
  const degradedCount = rows.filter(r => r.forPersona?.leg.degraded).length;
  const httpErrors = rows.filter(r => r.forPersona && r.forPersona.leg.status !== 200).length;

  const date = process.env.EVAL_IR_DATE ?? new Date().toISOString().slice(0, 10);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = join(RESULTS_DIR, `retrieval-ir-${date}.json`);
  const mdPath = join(RESULTS_DIR, `retrieval-ir-${date}.md`);
  const output = {
    timestamp: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'unknown (server-side)',
    thresholds,
    gateLeg,
    gate,
    seed: { users: seedMap.users, supersedeConfirmed: seedMap.supersedeConfirmed, supersedeUnconfirmed: seedMap.supersedeUnconfirmed },
    counts: { queries: rows.length, degradedResponses: degradedCount, httpErrors },
    summaries,
    queries: rows,
  };
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));

  const md: string[] = [];
  md.push(`# Retrieval IR eval — ${date}`, '');
  md.push(`- OmniMind: \`${cfg.baseUrl}\``);
  md.push(`- Queries: ${rows.length} across ${archetypes.join(', ')}; degraded responses: ${degradedCount}; HTTP errors: ${httpErrors}`);
  md.push(`- Supersede links confirmed: ${seedMap.supersedeConfirmed.length}, unconfirmed: ${seedMap.supersedeUnconfirmed.length}`);
  md.push(`- Gate (${gateLeg}): **${gate.pass ? 'PASS' : 'FAIL'}**${gate.failures.length ? ' — ' + gate.failures.map(f => `${f.metric} ${f.observed.toFixed(3)} < ${f.threshold}`).join(', ') : ''}`, '');
  for (const leg of legs) {
    const s = summaries[leg];
    md.push(`## ${leg === 'forPersona' ? 'POST /context/for-persona' : 'POST /memories/search'}`, '');
    md.push(table([['overall', s.overall], ...Object.entries(s.bySlice).map(([k, v]) => [`slice: ${k}`, v] as [string, MetricSummary]), ...Object.entries(s.byArchetype).map(([k, v]) => [`archetype: ${k}`, v] as [string, MetricSummary])]), '');
  }
  const worst = rows.filter(r => r.forPersona && r.slice !== 'abstention').sort((a, b) => a.forPersona!.metrics.recallAt10 - b.forPersona!.metrics.recallAt10).slice(0, 10);
  md.push('## Lowest recall@10 (for-persona)', '', '| id | slice | recall@10 | MRR | returned keys |', '|---|---|---:|---:|---|');
  for (const r of worst) md.push(`| ${r.id} | ${r.slice} | ${r.forPersona!.metrics.recallAt10.toFixed(2)} | ${r.forPersona!.metrics.mrr.toFixed(2)} | ${r.forPersona!.leg.rankedKeys.slice(0, 5).join(', ') || '(none)'} |`);
  md.push('', `Thresholds ratchet upward only — see docs/runbooks/retrieval-eval.md.`);
  writeFileSync(mdPath, md.join('\n') + '\n');

  console.log('\n' + md.join('\n'));
  console.log(`\nResults: ${jsonPath}\n         ${mdPath}`);
  return gate.pass ? 0 : 1;
}

if (require.main === module) {
  runIrEval()
    .then(code => process.exit(code))
    .catch(err => {
      console.error('[eval-retrieval-ir] failed:', err instanceof Error ? err.stack ?? err.message : err);
      process.exit(2);
    });
}

export { round };
