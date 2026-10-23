// node --test scripts/tests/vault-import.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNote, wikilinks, skipReason, isMinistry, classifyDomain, toMemory, planVault,
  makeClient, existingVaultRows, runImport, resolveUserId, domainCounts,
  resolveWikilinks, writeLinks, LINK_BATCH,
  syncVault, rowsToArchive, massPruneRefusal,
} from '../vault-import.mjs';

function fixtureVault(files) {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}

const note = (fm, body) => `---\n${fm}\n---\n\n${body}\n`;

test('parseNote reads the flat YAML subset: scalars, quoted strings, inline and block lists', () => {
  const { frontmatter, body } = parseNote(note(
    "type: entity\nstatus: evergreen\ncreated: '2026-05-23'\ntitle: \"Acme Widgets\"\ntags:\n- entity\n- ventures\naliases: [Acme, 'Acme-W']\nempty:",
    '# Acme Widgets\n\nSee [[Payments Vendor]] and [[entities/CRM|CRM]].'));
  assert.equal(frontmatter.type, 'entity');
  assert.equal(frontmatter.created, '2026-05-23');
  assert.equal(frontmatter.title, 'Acme Widgets');
  assert.deepEqual(frontmatter.tags, ['entity', 'ventures']);
  assert.deepEqual(frontmatter.aliases, ['Acme', 'Acme-W']);
  assert.equal(frontmatter.empty, null);
  assert.ok(body.startsWith('# Acme Widgets'));
  assert.deepEqual(wikilinks(body), ['Payments Vendor', 'entities/CRM']);
});

test('parseNote without frontmatter returns the whole text as body', () => {
  assert.deepEqual(parseNote('just text\n'), { frontmatter: {}, body: 'just text' });
});

test('skipReason drops vault plumbing only', () => {
  assert.match(skipReason('wiki/log.md', {}), /plumbing/);
  assert.match(skipReason('wiki/hot.md', {}), /plumbing/);
  assert.match(skipReason('wiki/meta/stale-pages.base.md', {}), /Base/);
  assert.match(skipReason('wiki/domains/ventures/_index.md', {}), /catalog/);
  assert.match(skipReason('wiki/domains/personal/concepts-index.md', {}), /catalog/);
  assert.match(skipReason('wiki/meta/lint-report-2026-05-23.md', {}), /maintenance/);
  assert.match(skipReason('wiki/concepts/Old Name.md', { type: 'alias' }), /alias/);
  assert.equal(skipReason('wiki/meta/Owner Profile.md', { type: 'meta' }), null);
  assert.equal(skipReason('wiki/concepts/Pattern A.md', { type: 'concept' }), null);
});

test('ministry is detected by tag, folder or tgfc path — and never relabelled', () => {
  assert.equal(isMinistry('wiki/concepts/Church Goal.md', { tags: ['ministry'] }), true);
  assert.equal(isMinistry('wiki/concepts/X.md', { tags: ['TGFC'] }), true);
  assert.equal(isMinistry('wiki/domains/ministry/Notes.md', {}), true);
  assert.equal(isMinistry('.raw/audits/tgfc-audit.md', {}), true);
  assert.equal(isMinistry('wiki/entities/Acme Widgets.md', { tags: ['ventures'] }), false);
});

test('classifyDomain: personal > learning > ai-systems > business', () => {
  assert.equal(classifyDomain('.raw/identity/owner.md', { tags: ['ventures'] }), 'personal');
  assert.equal(classifyDomain('wiki/concepts/Values.md', { tags: ['personal'] }), 'personal');
  assert.equal(classifyDomain('wiki/domains/ventures/Some Course/M1.md', { tags: ['course/some-course'] }), 'learning');
  assert.equal(classifyDomain('wiki/x/Glossary - Term.md', { type: 'glossary-term' }), 'learning');
  assert.equal(classifyDomain('wiki/concepts/Pattern A.md', { tags: ['ai-systems'] }), 'ai-systems');
  assert.equal(classifyDomain('wiki/entities/Acme Widgets.md', { tags: ['ventures'] }), 'business');
});

test('toMemory builds a validated-shape body keyed by path + content hash', () => {
  const m = toMemory('wiki/entities/Acme Widgets.md', note('type: entity\nstatus: evergreen\ntags:\n- Ventures\n- Agency Ops', 'Body [[CRM]]'));
  assert.equal(m.path, 'wiki/entities/Acme Widgets.md');
  assert.match(m.sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.body.title, 'Acme Widgets');
  assert.equal(m.body.domain, 'business');
  assert.equal(m.body.sourceType, 'API_IMPORT');
  assert.equal(m.body.sourceRef, 'vault:wiki/entities/Acme Widgets.md');
  assert.equal(m.body.importance, 0.7);
  assert.deepEqual(m.body.tags, ['vault', 'vault:entity', 'ventures', 'agency-ops']);
  assert.equal(m.body.content, 'Body [[CRM]]');
  assert.deepEqual(m.body.metadata.vault.links, ['CRM']);
  assert.equal(m.body.dedup, undefined, 'dedup is added by the writer, not stored on the plan');
});

test('planVault reads only wiki/ and .raw/, holds ministry back, skips plumbing', () => {
  const dir = fixtureVault({
    'wiki/entities/Acme Widgets.md': note('type: entity\ntags:\n- ventures', 'Acme body'),
    'wiki/concepts/Church Goal.md': note('type: concept\ntags:\n- ministry', 'church'),
    'wiki/log.md': '# log',
    'wiki/domains/ventures/_index.md': '# idx',
    '.raw/identity/me.md': '# me',
    'skills/wiki/SKILL.md': '# tooling, not knowledge',
    'README.md': '# readme',
  });
  try {
    const plan = planVault(dir);
    assert.deepEqual(plan.memories.map(m => m.path).sort(), ['.raw/identity/me.md', 'wiki/entities/Acme Widgets.md']);
    assert.deepEqual(plan.ministry, ['wiki/concepts/Church Goal.md']);
    assert.deepEqual(plan.skipped.map(s => s.path).sort(), ['wiki/domains/ventures/_index.md', 'wiki/log.md']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the RD-7 fixture vault (tests/fixtures/vault) plans exactly as its hand-written answer key says', () => {
  const root = fileURLToPath(new URL('../../tests/fixtures/vault/', import.meta.url));
  const expected = JSON.parse(readFileSync(join(root, 'expected.json'), 'utf8'));
  const plan = planVault(root);
  assert.deepEqual(plan.memories.map(m => m.path).sort(), [...expected.imported].sort());
  assert.deepEqual(plan.ministry, expected.ministry);
  assert.deepEqual(plan.skipped.map(s => s.path).sort(), [...expected.plumbing].sort());
  const byDomain = {};
  for (const m of plan.memories) byDomain[m.body.domain] = (byDomain[m.body.domain] ?? 0) + 1;
  assert.deepEqual(byDomain, expected.byDomain);
  assert.ok(readFileSync(join(root, expected.nulNote), 'utf8').includes('\u0000'), 'the fixture really carries a NUL byte');
  const nul = plan.memories.find(m => m.path === expected.nulNote);
  assert.ok(!nul.body.content.includes('\u0000') && !nul.body.title.includes('\u0000'));

  const ids = new Map(plan.memories.map(m => [m.path, `id:${m.path}`]));
  const { links, unresolved } = resolveWikilinks(plan.memories, ids);
  assert.equal(links.length, expected.links.count);
  assert.equal(unresolved, expected.links.unresolved);
  const pairs = new Set(links.map(l => `${l.memoryId.slice(3)} → ${l.entityId.slice(3)}`));
  for (const l of expected.links.mustInclude) assert.ok(pairs.has(`${l.from} → ${l.to}`), `${l.why}: ${l.from} → ${l.to}`);
  const linked = new Set([...pairs].flatMap(p => p.split(' → ')));
  assert.deepEqual(expected.imported.filter(p => !linked.has(p)).sort(), [...expected.links.orphans].sort());
});

// ── Mock OmniMind ────────────────────────────────────────────────────────────

function mockOmniMind({ rateLimitFirstWrite = false } = {}) {
  const rows = new Map(); // id → row (live)
  const archived = new Map(); // id → row (DELETE /memories/:id: soft delete, kept)
  const links = new Map(); // id → link row
  const calls = [];
  let n = 0;
  let limited = !rateLimitFirstWrite;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status, json, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(json)); };
      if (req.headers['x-api-key'] !== 'svc') return send(401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/auth/login') return body?.email === 'owner@example.com' ? send(200, { id: 'user-1' }) : send(404, {});
      if (req.headers['x-user-id'] !== 'user-1') return send(400, { error: 'validation_failed' });
      if (req.method !== 'GET' && !limited) { limited = true; return send(429, { error: 'rate_limited' }, { 'retry-after': '1' }); }
      if (req.method === 'GET' && url.pathname === '/memories') {
        let items = [...rows.values()];
        if (url.searchParams.get('tags')) items = items.filter(r => r.tags.includes(url.searchParams.get('tags')) && r.tenantId === req.headers['x-tenant-id']);
        if (url.searchParams.get('domain')) items = items.filter(r => r.domain === url.searchParams.get('domain'));
        const offset = Number(url.searchParams.get('offset') ?? 0); const limit = Number(url.searchParams.get('limit') ?? 20);
        return send(200, { items: items.slice(offset, offset + limit), total: items.length, offset, limit });
      }
      if (req.method === 'POST' && url.pathname === '/memories') {
        if (body.title === 'over budget') return send(422, { error: 'validation_failed', details: [{ field: 'domain', message: 'Domain budget exceeded (400/400)' }] });
        const id = `mem-${++n}`;
        rows.set(id, { id, ...body, tenantId: req.headers['x-tenant-id'] });
        return send(201, { id, status: 'created' });
      }
      if (req.method === 'POST' && url.pathname === '/memories/links/batch') {
        let created = 0; let existing = 0;
        for (const l of body.links) {
          if (!rows.has(l.memoryId) || !rows.has(l.entityId)) continue;
          const dup = [...links.values()].find(x => x.memoryId === l.memoryId && x.entityId === l.entityId && x.linkType === l.linkType);
          if (dup) { existing++; continue; }
          const id = `link-${++n}`; links.set(id, { id, ...l }); created++;
        }
        return send(200, { created, existing, rejected: [] });
      }
      const linkOne = /^\/memories\/([^/]+)\/links\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'DELETE' && linkOne) {
        const l = links.get(linkOne[2]);
        if (!rows.has(linkOne[1]) || !l || l.memoryId !== linkOne[1]) return send(404, { error: 'not_found' });
        links.delete(linkOne[2]); return send(200, { status: 'deleted' });
      }
      const linksOf = /^\/memories\/([^/]+)\/links$/.exec(url.pathname);
      if (req.method === 'GET' && linksOf) {
        if (!rows.has(linksOf[1])) return send(404, { error: 'not_found' });
        return send(200, [...links.values()].filter(l => l.memoryId === linksOf[1]));
      }
      const patch = /^\/memories\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'PATCH' && patch && rows.has(patch[1])) { Object.assign(rows.get(patch[1]), body); return send(200, rows.get(patch[1])); }
      if (req.method === 'DELETE' && patch && rows.has(patch[1])) { archived.set(patch[1], rows.get(patch[1])); rows.delete(patch[1]); return send(200, { id: patch[1], status: 'archived' }); }
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, rows, archived, links, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test('sync: first run creates with dedup:false + agent triple + idempotency key; re-run skips; an edit patches', async () => {
  const dir = fixtureVault({
    'wiki/entities/Acme Widgets.md': note('type: entity\ntags:\n- ventures', 'v1'),
    'wiki/concepts/Pattern A.md': note('type: concept\ntags:\n- ai-systems', 'wiki'),
  });
  const api = await mockOmniMind();
  try {
    const client = makeClient({ apiUrl: api.url, apiKey: 'svc', userId: await resolveUserId(makeClient({ apiUrl: api.url, apiKey: 'svc', tenant: 'josh-business', minWriteGapMs: 0 }), 'owner@example.com'), tenant: 'josh-business', minWriteGapMs: 0 });

    const r1 = await runImport({ plan: planVault(dir), client, existing: await existingVaultRows(client), dryRun: false });
    assert.equal(r1.created.length, 2);
    const post = api.calls.find(c => c.method === 'POST' && c.url === '/memories');
    assert.equal(post.body.dedup, false);
    assert.equal(post.headers['x-agent-id'], 'vault-import');
    assert.equal(post.headers['x-tenant-id'], 'josh-business');
    assert.equal(post.headers['x-source-weight'], '1.0');
    assert.match(post.headers['idempotency-key'], /^vault-[0-9a-f]{48}$/);
    assert.ok([...api.rows.values()].every(r => r.tenantId === 'josh-business'));

    const r2 = await runImport({ plan: planVault(dir), client, existing: await existingVaultRows(client), dryRun: false });
    assert.deepEqual([r2.created.length, r2.updated.length, r2.unchanged.length], [0, 0, 2]);

    writeFileSync(join(dir, 'wiki/entities/Acme Widgets.md'), note('type: entity\ntags:\n- ventures', 'v2'));
    const before = api.calls.length;
    const r3 = await runImport({ plan: planVault(dir), client, existing: await existingVaultRows(client), dryRun: false });
    assert.deepEqual([r3.created.length, r3.updated.length, r3.unchanged.length], [0, 1, 1]);
    const patch = api.calls.slice(before).find(c => c.method === 'PATCH');
    assert.equal(patch.body.content, 'v2');
    assert.equal(api.rows.size, 2, 'an edit never adds a second row');
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('NUL characters are stripped before writing (Postgres text cannot store U+0000)', () => {
  const m = toMemory('wiki/a/n.md', note('type: concept\ntitle: Bad\u0000Title', 'x\u0000y'));
  assert.equal(m.body.title, 'BadTitle');
  assert.equal(m.body.content, 'xy');
});

test('the per-agent hourly 429 (retryAfter in the JSON body, no header) is waited out, not given up on', async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits++;
      if (hits === 1) { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'agent_rate_limited', message: 'agent:vault-import exceeded 200 write operations per hour.', retryAfter: 1 })); return; }
      res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'mem-1', status: 'created' }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const client = makeClient({ apiUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'svc', userId: 'user-1', tenant: 'josh-business', minWriteGapMs: 0 });
    const t0 = Date.now();
    const r = await client.request('POST', '/memories', { body: {} });
    assert.equal(r.status, 201);
    assert.equal(hits, 2);
    assert.ok(Date.now() - t0 >= 1900, 'waited retryAfter (1 s) + 1 s margin');
  } finally { server.close(); }
});

test('dry run writes nothing; a 429 is retried after Retry-After; a budget 422 is reported, not fatal', async () => {
  const dir = fixtureVault({
    'wiki/entities/A.md': note('type: entity', 'a'),
    'wiki/entities/B.md': note("type: entity\ntitle: over budget", 'b'),
  });
  const api = await mockOmniMind({ rateLimitFirstWrite: true });
  try {
    const client = makeClient({ apiUrl: api.url, apiKey: 'svc', userId: 'user-1', tenant: 'josh-business', minWriteGapMs: 0 });
    const dry = await runImport({ plan: planVault(dir), client, existing: new Map(), dryRun: true });
    assert.equal(dry.created.length, 2);
    assert.equal(api.calls.length, 0);

    const t0 = Date.now();
    const r = await runImport({ plan: planVault(dir), client, existing: new Map(), dryRun: false });
    assert.ok(Date.now() - t0 >= 900, 'waited for Retry-After');
    assert.deepEqual(r.created, ['wiki/entities/A.md']);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0].status, 422);
    assert.match(r.failed[0].detail, /budget/);
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('writes are paced at the configured gap; domainCounts reads user-wide totals without agent headers', async () => {
  const dir = fixtureVault({ 'wiki/a/1.md': '# 1', 'wiki/a/2.md': '# 2', 'wiki/a/3.md': '# 3' });
  const api = await mockOmniMind();
  try {
    const client = makeClient({ apiUrl: api.url, apiKey: 'svc', userId: 'user-1', tenant: 'josh-business', minWriteGapMs: 250 });
    const t0 = Date.now();
    await runImport({ plan: planVault(dir), client, existing: new Map(), dryRun: false });
    assert.ok(Date.now() - t0 >= 450, 'three writes at a 250 ms gap take ≥ 500 ms minus the first');
    const counts = await domainCounts(client, ['business']);
    assert.deepEqual(counts, { business: 3 });
    const get = api.calls.find(c => c.method === 'GET' && c.url.startsWith('/memories?domain='));
    assert.equal(get.headers['x-agent-id'], undefined);
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('resolveWikilinks: by file name, title, alias and path-style links; skips self, unresolved and held-back targets', () => {
  const mk = (path, fm, body) => toMemory(path, note(fm, body));
  const a = mk('wiki/entities/Acme Widgets.md', 'type: entity\naliases: [Acme]', 'See [[CRM Vendor]], [[entities/Payments]], [[Acme]] and [[Church Goal]] and [[Nowhere]].');
  const b = mk('wiki/entities/CRM.md', 'type: entity\ntitle: CRM Vendor', 'Back to [[Acme Widgets]] twice [[acme widgets]].');
  const c = mk('wiki/entities/Payments.md', 'type: entity', 'No links.');
  const ids = new Map([[a.path, 'id-a'], [b.path, 'id-b'], [c.path, 'id-c']]);
  const { links, unresolved } = resolveWikilinks([a, b, c], ids);
  assert.deepEqual(links, [
    { memoryId: 'id-a', entityType: 'memory', entityId: 'id-b', linkType: 'wikilink' },
    { memoryId: 'id-a', entityType: 'memory', entityId: 'id-c', linkType: 'wikilink' },
    { memoryId: 'id-b', entityType: 'memory', entityId: 'id-a', linkType: 'wikilink' },
  ]);
  assert.equal(unresolved, 2, '[[Church Goal]] (held back) and [[Nowhere]] stay unresolved; [[Acme]] is a self-link');
});

test('writeLinks sends batches of LINK_BATCH to POST /memories/links/batch and sums the results', async () => {
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw); bodies.push({ url: req.url, n: body.links.length });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ created: body.links.length - 1, existing: 1, rejected: [] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const client = makeClient({ apiUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'svc', userId: 'u', tenant: 'josh-business', minWriteGapMs: 0 });
    const links = Array.from({ length: LINK_BATCH + 7 }, (_, i) => ({ memoryId: `m${i}`, entityType: 'memory', entityId: `n${i}`, linkType: 'wikilink' }));
    const out = await writeLinks(client, links);
    assert.deepEqual(bodies, [{ url: '/memories/links/batch', n: LINK_BATCH }, { url: '/memories/links/batch', n: 7 }]);
    assert.deepEqual(out, { created: LINK_BATCH + 5, existing: 2, rejected: 0, failedBatches: 0 });
  } finally { server.close(); }
});

// ── Prune (RD-5) ─────────────────────────────────────────────────────────────

const PRUNE_VAULT = {
  'wiki/entities/Acme Widgets.md': note('type: entity', 'Partners: [[CRM]] and [[Payments]].'),
  'wiki/entities/CRM.md': note('type: entity', 'Back to [[Acme Widgets]].'),
  'wiki/entities/Payments.md': note('type: entity', 'Processor for [[Acme Widgets]].'),
  'wiki/entities/Old Vendor.md': note('type: entity', 'Replaced by [[Payments]].'),
};

async function seeded(api, dir) {
  const client = makeClient({ apiUrl: api.url, apiKey: 'svc', userId: 'user-1', tenant: 'josh-business', minWriteGapMs: 0 });
  const r = await syncVault({ plan: planVault(dir), client, readGapMs: 0 });
  assert.equal(r.code, 0);
  assert.equal(api.rows.size, 4);
  assert.equal(api.links.size, 5);
  return client;
}
const refOf = (api, id) => (api.rows.get(id) ?? api.archived.get(id))?.sourceRef;
const linkPairs = api => [...api.links.values()].map(l => `${refOf(api, l.memoryId)} → ${refOf(api, l.entityId)}`).sort();

test('--prune: a deleted note is archived (soft delete), links to it are removed; without --prune nothing is', async () => {
  const dir = fixtureVault(PRUNE_VAULT);
  const api = await mockOmniMind();
  try {
    const client = await seeded(api, dir);
    unlinkSync(join(dir, 'wiki/entities/Old Vendor.md'));
    unlinkSync(join(dir, 'wiki/entities/Payments.md'));
    writeFileSync(join(dir, 'wiki/entities/Payments2.md'), note('type: entity', 'New processor.'));

    const additive = await syncVault({ plan: planVault(dir), client, readGapMs: 0 });
    assert.equal(additive.prune, null);
    assert.equal(api.archived.size, 0, 'default stays additive');
    assert.equal(api.calls.filter(c => c.method === 'DELETE').length, 0);

    const r = await syncVault({ plan: planVault(dir), client, prune: true, readGapMs: 0 });
    assert.equal(r.code, 0);
    assert.deepEqual(r.prune.archived, ['wiki/entities/Old Vendor.md', 'wiki/entities/Payments.md']);
    assert.deepEqual([...api.archived.values()].map(m => m.sourceRef).sort(), ['vault:wiki/entities/Old Vendor.md', 'vault:wiki/entities/Payments.md']);
    const del = api.calls.filter(c => c.method === 'DELETE' && /^\/memories\/[^/]+$/.test(c.url));
    assert.equal(del.length, 2, 'archived via DELETE /memories/:id (status ARCHIVED + deletedAt; the row is kept)');
    assert.ok(del.every(c => c.headers['x-tenant-id'] === 'josh-business' && c.headers['x-agent-id'] === 'vault-import'));
    // Acme → Payments pointed at a now-archived note: removed. Links ON archived rows are left alone.
    assert.deepEqual(r.prune.unlink, [{ from: 'wiki/entities/Acme Widgets.md', to: 'wiki/entities/Payments.md' }]);
    assert.equal(r.prune.unlinked, 1);
    assert.ok(!linkPairs(api).includes('vault:wiki/entities/Acme Widgets.md → vault:wiki/entities/Payments.md'));
    assert.ok(linkPairs(api).includes('vault:wiki/entities/Old Vendor.md → vault:wiki/entities/Payments.md'), 'an archived row keeps its own links');
    assert.ok(api.calls.some(c => c.method === 'GET' && c.url.endsWith('/links')), 'reads the live rows\' links');

    const again = await syncVault({ plan: planVault(dir), client, prune: true, readGapMs: 0 });
    assert.deepEqual([again.prune.archive.length, again.prune.unlink.length], [0, 0], 'a second prune is a no-op');
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('--prune: a wikilink removed from a note removes that link row only (other link types untouched)', async () => {
  const dir = fixtureVault(PRUNE_VAULT);
  const api = await mockOmniMind();
  try {
    const client = await seeded(api, dir);
    const acme = [...api.rows.values()].find(m => m.sourceRef === 'vault:wiki/entities/Acme Widgets.md');
    const crm = [...api.rows.values()].find(m => m.sourceRef === 'vault:wiki/entities/CRM.md');
    api.links.set('hand-made', { id: 'hand-made', memoryId: acme.id, entityType: 'memory', entityId: crm.id, linkType: 'relates_to' });
    writeFileSync(join(dir, 'wiki/entities/Acme Widgets.md'), note('type: entity', 'Partners: [[Payments]] only.'));

    const r = await syncVault({ plan: planVault(dir), client, prune: true, readGapMs: 0 });
    assert.equal(r.code, 0);
    assert.deepEqual(r.result.updated, ['wiki/entities/Acme Widgets.md']);
    assert.deepEqual(r.prune.archived, []);
    assert.deepEqual(r.prune.unlink, [{ from: 'wiki/entities/Acme Widgets.md', to: 'wiki/entities/CRM.md' }]);
    const linkDel = api.calls.filter(c => c.method === 'DELETE' && c.url.includes('/links/'));
    assert.equal(linkDel.length, 1);
    assert.ok(linkDel[0].url.startsWith(`/memories/${acme.id}/links/link-`));
    assert.ok(api.links.has('hand-made'), 'a non-wikilink link is never pruned');
    assert.ok(linkPairs(api).includes('vault:wiki/entities/Acme Widgets.md → vault:wiki/entities/Payments.md'));
    assert.equal(api.links.size, 5, '5 wikilinks − 1 removed + 1 hand-made');
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('--prune --dry-run lists what it would archive and unlink, and writes nothing', async () => {
  const dir = fixtureVault(PRUNE_VAULT);
  const api = await mockOmniMind();
  try {
    const client = await seeded(api, dir);
    unlinkSync(join(dir, 'wiki/entities/Old Vendor.md'));
    writeFileSync(join(dir, 'wiki/entities/Acme Widgets.md'), note('type: entity', 'Partners: [[Payments]] only.'));
    writeFileSync(join(dir, 'wiki/entities/New.md'), note('type: entity', 'brand new'));
    const before = api.calls.length;
    const lines = [];
    const r = await syncVault({ plan: planVault(dir), client, prune: true, dryRun: true, readGapMs: 0, log: s => lines.push(s) });
    assert.equal(r.code, 0);
    assert.deepEqual(r.prune.archive, ['wiki/entities/Old Vendor.md']);
    assert.deepEqual(r.prune.unlink, [{ from: 'wiki/entities/Acme Widgets.md', to: 'wiki/entities/CRM.md' }]);
    assert.deepEqual([r.prune.archived.length, r.prune.unlinked], [0, 0]);
    assert.deepEqual([r.result.created, r.result.updated], [['wiki/entities/New.md'], ['wiki/entities/Acme Widgets.md']]);
    const writes = api.calls.slice(before).filter(c => c.method !== 'GET');
    assert.deepEqual(writes, [], 'dry run sends only GETs');
    assert.equal(api.rows.size, 4);
    assert.equal(api.links.size, 5);
    assert.ok(lines.some(l => l.includes('would archive wiki/entities/Old Vendor.md')));
    assert.ok(lines.some(l => l.includes('would unlink wiki/entities/Acme Widgets.md → wiki/entities/CRM.md')));
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('--prune refuses to archive most of the vault (mis-mounted vault) unless --allow-mass-prune', async () => {
  const existing = new Map(Array.from({ length: 10 }, (_, i) => [`wiki/n${i}.md`, { id: `m${i}`, sha256: 'x' }]));
  const plan = { memories: [toMemory('wiki/n0.md', '# n0'), toMemory('wiki/n1.md', '# n1')] };
  const archive = rowsToArchive(plan, existing);
  assert.equal(archive.length, 8);
  assert.match(massPruneRefusal(archive, existing, false), /would archive 8 of 10/);
  assert.equal(massPruneRefusal(archive, existing, true), null);
  assert.equal(massPruneRefusal(archive.slice(0, 5), existing, false), null, 'five or fewer always allowed');

  const dir = fixtureVault({ 'wiki/a/only.md': '# only' });
  const api = await mockOmniMind();
  try {
    for (let i = 0; i < 8; i++) api.rows.set(`old-${i}`, { id: `old-${i}`, tags: ['vault'], tenantId: 'josh-business', sourceRef: `vault:wiki/gone-${i}.md`, metadata: { vault: { path: `wiki/gone-${i}.md` } } });
    const client = makeClient({ apiUrl: api.url, apiKey: 'svc', userId: 'user-1', tenant: 'josh-business', minWriteGapMs: 0 });
    const r = await syncVault({ plan: planVault(dir), client, prune: true, readGapMs: 0, logError: () => {} });
    assert.equal(r.code, 2);
    assert.equal(api.calls.filter(c => c.method !== 'GET').length, 0, 'refused before any write');
  } finally { api.server.close(); rmSync(dir, { recursive: true, force: true }); }
});
