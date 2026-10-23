// Journey check (RD-7): the whole vault flow on the live stack —
// import → links → graph → search → idempotent re-run.
//
// Loaded by tests/e2e/live/journey.mjs (checks autoloader, contract in ./README.md):
// default export `{ name, run({ user, api, mcp }) }`. CI runs the same flow without a
// browser or the MCP gateway (`--standalone`, see the bottom of this file and the
// `e2e` job in .github/workflows/ci.yml), because the vault flow is all HTTP: what it
// needs is OmniMind + BoardRoom, not Chromium.
//
// What it does, against tests/fixtures/vault (synthetic; answer key: expected.json):
//   1. Runs the real CLI, `node scripts/vault-import.mjs`, for the signed-in user into
//      josh-business (service key from OMNIMIND_API_KEY, user resolved by e-mail).
//   2. BoardRoom GET /memories?tags=vault: every non-plumbing, non-ministry note is
//      there exactly once, all in josh-business; the ministry note and the plumbing
//      files are absent; the NUL-byte note arrived without U+0000.
//   3. Links: the importer reports the expected number created (POST
//      /memories/links/batch), and BoardRoom GET /graph draws them as memory→memory
//      edges — including the alias-only, [[Target|label]], [[folder/Target]] and
//      [[Target#Heading]] forms — so only the three unlinked notes are orphans.
//   4. Search (BoardRoom POST /memories/search, the UI's hybrid search): a keyword and
//      a natural-language question each rank the right note in the top 3. No embedding
//      key is needed: CI and the sandbox have none, so this is the FTS/trigram path.
//      In the journey, MCP memory_search (josh-business token) finds the keyword too.
//   5. A second importer run writes 0 notes and creates 0 links.
//
// It fails on exactly the regressions the 2026-10-23 real-data run found: an empty
// graph, all-or-nothing search, and a re-run that writes.

import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE = join(REPO, 'tests/fixtures/vault');
const IMPORTER = join(REPO, 'scripts/vault-import.mjs');
export const EXPECTED = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));

class CheckError extends Error {}
function assert(cond, msg) { if (!cond) throw new CheckError(msg); }
const short = v => JSON.stringify(v).slice(0, 300);

/** Run the importer CLI; resolves { code, report, out }. Never echoes the service key. */
export function runImporter({ vault, omnimind, apiKey, email, extraArgs = [], reportPath }) {
  return new Promise((resolve, reject) => {
    const args = [IMPORTER, '--vault', vault, '--api', omnimind, '--user-email', email,
      '--tenant', EXPECTED.tenant, '--report', reportPath, ...extraArgs];
    const env = { ...process.env, OMNIMIND_API_KEY: apiKey };
    delete env.OMNIMIND_USER_ID; delete env.OMNIMIND_AGENT_KEY; delete env.VAULT_IMPORT_USER_EMAIL;
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('close', code => {
      let report = null;
      try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { /* no report */ }
      resolve({ code, report, out });
    });
  });
}

/** Every vault memory of the signed-in user, via BoardRoom (all tenants, so a stray tenant shows up). */
async function listVault(http) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const r = await http.get(`/memories?tags=vault&limit=100&offset=${offset}`);
    assert(r.status === 200, `GET /memories?tags=vault ${r.status} ${short(r.json)}`);
    const page = r.json?.items ?? [];
    items.push(...page);
    if (page.length < 100) break;
  }
  return items;
}

const vaultPath = m => m.metadata?.vault?.path ?? (typeof m.sourceRef === 'string' && m.sourceRef.startsWith('vault:') ? m.sourceRef.slice(6) : null);

/** Wikilink edges between the user's vault memories as drawn by GET /graph: Set of "fromPath → toPath". */
async function graphWikilinks(http, idToPath) {
  const r = await http.get('/graph?memoryLimit=500');
  assert(r.status === 200, `GET /graph ${r.status} ${short(r.json)}`);
  const edges = r.json?.edges ?? [];
  const pairs = new Set();
  for (const e of edges) {
    if (!String(e.source).startsWith('memory:') || !String(e.target).startsWith('memory:')) continue;
    const from = idToPath.get(String(e.source).slice(7));
    const to = idToPath.get(String(e.target).slice(7));
    if (from && to && (e.label === 'wikilink' || e.label == null)) pairs.add(`${from} → ${to}`);
  }
  return { pairs, nodes: r.json?.nodes?.length ?? 0, edges: edges.length, memoryLimitHit: Boolean(r.json?.stats?.memoryLimitHit) };
}

/**
 * The flow. `http` is { get(path), post(path, body) } against BoardRoom as the signed-in
 * user, resolving { status, json }. `step(label, fn)` records one sub-step.
 */
export async function vaultFlow({ http, omnimind, apiKey, user, mcp = null, step = (_l, fn) => fn(), workDir }) {
  assert(apiKey, 'OMNIMIND_API_KEY is not set (the importer authenticates to OmniMind with the service key)');
  assert(user?.email, 'no signed-in user e-mail');
  const vault = join(workDir, 'vault');
  cpSync(FIXTURE, vault, { recursive: true });
  const summary = {};

  const first = await step('import the synthetic vault (scripts/vault-import.mjs)', async () => {
    const r = await runImporter({ vault, omnimind, apiKey, email: user.email, reportPath: join(workDir, 'run1.json') });
    assert(r.code === 0, `importer exit ${r.code}\n${r.out.slice(-1500)}`);
    const res = r.report?.result;
    assert(res, `no report written\n${r.out.slice(-800)}`);
    assert(res.created.length === EXPECTED.imported.length && res.failed.length === 0,
      `created ${res.created.length}/${EXPECTED.imported.length}, failed ${short(res.failed)}`);
    assert(short(r.report.ministryHeldBack) === short(EXPECTED.ministry), `ministry held back ${short(r.report.ministryHeldBack)}`);
    assert(r.report.links?.created === EXPECTED.links.count, `links created ${r.report.links?.created}, expected ${EXPECTED.links.count} (${short(r.report.links)})`);
    assert(r.report.links.unresolved === EXPECTED.links.unresolved, `unresolved targets ${r.report.links.unresolved}, expected ${EXPECTED.links.unresolved}`);
    return { created: res.created.length, links: r.report.links.created };
  });
  summary.created = first.created;

  const rows = await step('every importable note is in josh-business exactly once; ministry + plumbing absent', async () => {
    const items = await listVault(http);
    const byPath = new Map();
    for (const m of items) { const p = vaultPath(m); byPath.set(p, [...(byPath.get(p) ?? []), m]); }
    const missing = EXPECTED.imported.filter(p => !byPath.has(p));
    const dupes = [...byPath].filter(([, ms]) => ms.length > 1).map(([p]) => p);
    const extra = [...byPath.keys()].filter(p => !EXPECTED.imported.includes(p));
    assert(missing.length === 0, `missing: ${short(missing)}`);
    assert(dupes.length === 0, `imported more than once: ${short(dupes)}`);
    assert(extra.length === 0, `unexpected vault rows (ministry/plumbing leaked?): ${short(extra)}`);
    const wrongTenant = items.filter(m => m.tenantId !== EXPECTED.tenant).map(vaultPath);
    assert(wrongTenant.length === 0, `not in ${EXPECTED.tenant}: ${short(wrongTenant)}`);
    const nul = byPath.get(EXPECTED.nulNote)[0];
    assert(!String(nul.content).includes('\u0000') && !String(nul.title).includes('\u0000'), 'the NUL-byte note kept a U+0000');
    const ministry = await http.post('/memories/search', { query: EXPECTED.ministryTitle, limit: 20 });
    assert(ministry.status === 200, `POST /memories/search ${ministry.status}`);
    const leaked = (ministry.json?.items ?? []).filter(m => m.title === EXPECTED.ministryTitle || EXPECTED.ministry.includes(vaultPath(m)));
    assert(leaked.length === 0, `ministry note is searchable: ${short(leaked.map(m => m.id))}`);
    return { rows: items.length, items };
  });
  const idToPath = new Map(rows.items.map(m => [m.id, vaultPath(m)]));
  const pathToId = new Map(rows.items.map(m => [vaultPath(m), m.id]));
  summary.rows = rows.rows;

  await step('GET /graph draws the wikilinks as memory→memory edges; only unlinked notes are orphans', async () => {
    const g = await graphWikilinks(http, idToPath);
    assert(!g.memoryLimitHit, 'graph hit its memory limit — the check would not see every note');
    assert(g.pairs.size === EXPECTED.links.count, `graph has ${g.pairs.size} vault wikilink edges, expected ${EXPECTED.links.count} (edges total ${g.edges})`);
    for (const l of EXPECTED.links.mustInclude) assert(g.pairs.has(`${l.from} → ${l.to}`), `missing edge (${l.why}): ${l.from} → ${l.to}`);
    const linked = new Set([...g.pairs].flatMap(p => p.split(' → ')));
    const orphans = EXPECTED.imported.filter(p => !linked.has(p)).sort();
    assert(short(orphans) === short([...EXPECTED.links.orphans].sort()), `orphans ${short(orphans)}, expected ${short(EXPECTED.links.orphans)}`);
    const links = await http.get(`/memories/${pathToId.get(EXPECTED.links.mustInclude[0].from)}/links`);
    assert(links.status === 200 && Array.isArray(links.json) && links.json.some(l => l.linkType === 'wikilink' && l.entityType === 'memory'),
      `GET /memories/:id/links has no wikilink rows: ${links.status} ${short(links.json)}`);
    summary.edges = g.pairs.size;
    return { vaultEdges: g.pairs.size, graphNodes: g.nodes, orphans: orphans.length };
  });

  await step('search: keyword and natural-language question rank the right note in the top 3', async () => {
    const out = {};
    for (const s of EXPECTED.search) {
      const r = await http.post('/memories/search', { query: s.query, limit: 10 });
      assert(r.status === 200, `POST /memories/search "${s.query}" ${r.status} ${short(r.json)}`);
      const top = (r.json?.items ?? []).slice(0, 3).map(vaultPath);
      assert(top.includes(s.expect), `${s.kind} "${s.query}": top 3 ${short(top)} does not include ${s.expect}`);
      out[s.kind] = top.indexOf(s.expect) + 1;
    }
    if (mcp) {
      const kw = EXPECTED.search.find(s => s.kind === 'keyword');
      const r = await mcp.call('tools/call', { name: 'memory_search', arguments: { query: kw.query, limit: 5 } }, { id: 7101 });
      const text = JSON.stringify(r.body?.result ?? {});
      assert(r.status === 200 && !r.body?.result?.isError, `MCP memory_search ${r.status} ${text.slice(0, 200)}`);
      assert(text.includes(kw.expect.split('/').pop().replace(/\.md$/, '')), `MCP memory_search "${kw.query}" does not return ${kw.expect}: ${text.slice(0, 300)}`);
      out.mcp = 'found';
    }
    summary.searchRank = out;
    return out;
  });

  await step('a second run writes 0 notes and creates 0 links', async () => {
    const r = await runImporter({ vault, omnimind, apiKey, email: user.email, reportPath: join(workDir, 'run2.json') });
    assert(r.code === 0, `importer exit ${r.code}\n${r.out.slice(-1500)}`);
    const res = r.report.result;
    assert(res.created.length === 0 && res.updated.length === 0 && res.failed.length === 0,
      `re-run wrote: created ${res.created.length}, updated ${res.updated.length}, failed ${res.failed.length}`);
    assert(res.unchanged.length === EXPECTED.imported.length, `unchanged ${res.unchanged.length}, expected ${EXPECTED.imported.length}`);
    assert(r.report.links.created === 0 && r.report.links.existing === EXPECTED.links.count,
      `re-run links: created ${r.report.links.created}, existing ${r.report.links.existing}`);
    const after = await listVault(http);
    assert(after.length === EXPECTED.imported.length, `vault rows after re-run ${after.length}`);
    return { unchanged: res.unchanged.length, linksExisting: r.report.links.existing };
  });

  return summary;
}

/** Adapter: Playwright APIRequestContext (journey) → { get, post }. */
function playwrightHttp(request, app) {
  const wrap = async res => {
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status(), json };
  };
  return {
    get: path => request.get(`${app}${path}`).then(wrap),
    post: (path, data) => request.post(`${app}${path}`, { data }).then(wrap),
  };
}

export async function run({ user, api, mcp }) {
  const workDir = mkdtempSync(join(tmpdir(), 'vault-check-'));
  try {
    return await vaultFlow({
      http: playwrightHttp(api.request, api.app),
      omnimind: api.omnimind,
      apiKey: process.env.OMNIMIND_API_KEY,
      user,
      mcp,
      workDir,
    });
  } finally { rmSync(workDir, { recursive: true, force: true }); }
}

export default { name: 'vault import: import → links → graph → search → idempotent re-run', run };

// ── Standalone (CI): OmniMind + BoardRoom, no browser, no MCP ─────────────────
//   BOARDROOM_URL=http://127.0.0.1:3001 OMNIMIND_URL=http://127.0.0.1:3333 \
//   OMNIMIND_API_KEY=<service key> node tests/e2e/live/checks/vault-import.mjs --standalone
// Registers a fresh user through BoardRoom (POST /auth/register), then runs the same flow.

function fetchHttp(app, cookie) {
  const call = async (method, path, body) => {
    const res = await fetch(`${app}${path}`, {
      method,
      headers: { cookie, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
  };
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b) };
}

async function standalone() {
  const app = (process.env.BOARDROOM_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
  const omnimind = (process.env.OMNIMIND_URL ?? 'http://127.0.0.1:3333').replace(/\/+$/, '');
  const t0 = Date.now();
  let failed = 0;
  const step = async (label, fn) => {
    const s = Date.now();
    try {
      const detail = await fn();
      console.log(`✓ ${label} (${((Date.now() - s) / 1000).toFixed(1)} s)${detail === undefined ? '' : ` — ${JSON.stringify(detail, (k, v) => (k === 'items' ? undefined : v))}`}`);
      return detail;
    } catch (err) {
      failed++;
      console.log(`× ${label} — ${err?.message ?? err}`);
      throw err;
    }
  };

  const workDir = mkdtempSync(join(tmpdir(), 'vault-check-'));
  try {
    const email = `vault-check-${Date.now()}@boardroom-e2e.test`;
    let cookie = null; // the session cookie stays out of the log
    const { userId } = await step('register a fresh user through BoardRoom', async () => {
      const r = await fetch(`${app}/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'vault-check-password-1', name: 'Vault Check' }),
      });
      assert(r.status === 201, `POST /auth/register ${r.status} ${await r.text()}`);
      cookie = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? '']).map(c => c.split(';')[0]).find(c => c.startsWith('boardroom_token='));
      assert(cookie, 'no boardroom_token cookie');
      const me = await fetch(`${app}/auth/me`, { headers: { cookie } });
      assert(me.status === 200, `GET /auth/me ${me.status}`);
      return { userId: (await me.json()).userId };
    });
    await vaultFlow({ http: fetchHttp(app, cookie), omnimind, apiKey: process.env.OMNIMIND_API_KEY, user: { id: userId, email }, step, workDir });
  } catch (err) {
    if (!(err instanceof CheckError) && failed === 0) { failed++; console.log(`× ${err?.stack ?? err}`); }
  } finally { rmSync(workDir, { recursive: true, force: true }); }
  console.log(`\nvault-import check: ${failed ? 'FAILED' : 'passed'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--standalone')) {
    console.error('usage: node tests/e2e/live/checks/vault-import.mjs --standalone   (or run it inside pnpm e2e:live)');
    process.exit(2);
  }
  standalone().then(code => process.exit(code));
}
