#!/usr/bin/env node
// Load an Obsidian vault into OmniMind as memories — one memory per note, keyed
// by vault path, so re-running it syncs (new → create, edited → update,
// unchanged → skip) instead of duplicating.
//
//   node scripts/vault-import.mjs --vault <path-to-vault> --dry-run
//   node scripts/vault-import.mjs --vault <path-to-vault> --user-email you@example.com
//   pnpm import:vault -- --vault … [--tenant josh-business] [--report out.json]
//
// What goes in: every *.md under wiki/ and .raw/. What stays out:
//   * vault plumbing — wiki/log.md, wiki/hot.md, Obsidian Bases (*.base.md),
//     generated catalogs (index.md, _index.md, *-index.md), lint/tiling
//     reports, dashboards, alias stubs;
//   * ministry content (tags ministry/tgfc, a ministry/ folder, "tgfc" in the
//     path). Ministry writes need local embeddings and OmniMind answers 503
//     MINISTRY_DEFERRED until that path is live; this script never re-labels
//     them to get around the rule. They are listed as held back.
//
// Domain (drives OmniMind's per-domain budget): personal (identity, personal
// tags/folders), learning (course modules + glossary), ai-systems, business.
//
// Writes go through POST /memories — the validation pipeline — as the agent
// `vault-import` in one tenant (default josh-business, where MCP clients read;
// MCP reads are tenant-scoped, so a memory written without a tenant would be
// invisible to them). Creates send `dedup: false`: the importer keys rows by
// path itself, and the near-duplicate auto-supersede would otherwise let one
// note overwrite another. Writes are paced under the 20/min per-user write
// limit and honour Retry-After on 429.
//
// Env: OMNIMIND_API_URL, OMNIMIND_API_KEY (service key), OMNIMIND_USER_ID or
//      VAULT_IMPORT_USER_EMAIL, optional OMNIMIND_AGENT_KEY (omk_ key of an
//      agent in the target tenant; required when OMNIMIND_REQUIRE_AGENT_KEY=true).
// Exit: 0 done (or dry run) · 1 a write failed · 2 usage / config / preflight.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_ID = 'vault-import';
export const VAULT_TAG = 'vault';
export const DOMAIN_BUDGETS = { business: 400, personal: 200, 'ai-systems': 300, learning: 250 };
const IMPORTANCE_BY_STATUS = { evergreen: 0.7, hot: 0.7, populated: 0.6, developing: 0.5, 'partial-confirmation': 0.5, stub: 0.3, archive: 0.2 };
const MAX_TAGS = 24;

// ── Parsing ──────────────────────────────────────────────────────────────────

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function scalar(v) {
  const t = v.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1).split(',').map(s => unquote(s)).filter(s => s.length > 0);
  }
  return unquote(t);
}

/** Split a note into its YAML frontmatter (the flat subset Obsidian notes use) and body. */
export function parseNote(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src);
  if (!m) return { frontmatter: {}, body: src.trim() };
  const fm = {};
  let listKey = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      if (!Array.isArray(fm[listKey])) fm[listKey] = [];
      fm[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_][\w.-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest === undefined || rest.trim() === '') { fm[key] = []; listKey = key; continue; }
    fm[key] = scalar(rest);
    listKey = null;
  }
  for (const k of Object.keys(fm)) if (Array.isArray(fm[k]) && fm[k].length === 0) fm[k] = null;
  return { frontmatter: fm, body: src.slice(m[0].length).trim() };
}

export function wikilinks(body) {
  const out = new Set();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}

// ── Classification ───────────────────────────────────────────────────────────

const lower = v => String(v ?? '').toLowerCase();
const tagList = fm => (Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : []).map(t => lower(t).replace(/^#/, ''));

/** Why a note is not imported, or null when it is. */
export function skipReason(path, fm) {
  const p = path.split(sep).join('/');
  const name = basename(p);
  if (p === 'wiki/log.md' || p === 'wiki/hot.md') return 'vault plumbing (log / hot cache)';
  if (name.endsWith('.base.md')) return 'Obsidian Base (query definition)';
  if (name === 'index.md' || name === '_index.md' || /-index\.md$/.test(name)) return 'generated catalog';
  if (/^(lint-report|tiling-report)-/.test(name) || name === 'dashboard.md') return 'vault maintenance report';
  if (lower(fm.type) === 'alias') return 'alias stub';
  return null;
}

export function isMinistry(path, fm) {
  const p = lower(path.split(sep).join('/'));
  const tags = tagList(fm);
  return tags.includes('ministry') || tags.includes('tgfc') || /(^|\/)ministry\//.test(p) || p.includes('tgfc');
}

export function classifyDomain(path, fm) {
  const p = lower(path.split(sep).join('/'));
  const tags = tagList(fm);
  const type = lower(fm.type);
  if (p.startsWith('.raw/identity/') || tags.includes('personal') || /(^|\/)personal\//.test(p)) return 'personal';
  if (tags.some(t => t.startsWith('course/')) || ['course-module', 'course-moc', 'glossary-term', 'glossary-index'].includes(type)) return 'learning';
  if (tags.includes('ai-systems') || tags.includes('knowledge-management') || /(^|\/)ai-systems\//.test(p)) return 'ai-systems';
  return 'business';
}

function sanitizeTag(t) {
  return lower(t).replace(/^#/, '').replace(/[^a-z0-9/_:.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** The POST /memories body for one note (minus dedup), plus its sync key. */
export function toMemory(path, text) {
  const { frontmatter: fm, body } = parseNote(text);
  const relPath = path.split(sep).join('/');
  const sha256 = createHash('sha256').update(text).digest('hex');
  const title = (typeof fm.title === 'string' && fm.title.trim()) || basename(relPath, '.md');
  const type = typeof fm.type === 'string' ? fm.type : null;
  const status = typeof fm.status === 'string' ? fm.status : null;
  const tags = [VAULT_TAG, ...(type ? [`vault:${sanitizeTag(type)}`] : []), ...tagList(fm).map(sanitizeTag)]
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .slice(0, MAX_TAGS);
  return {
    path: relPath,
    sha256,
    body: {
      title: title.slice(0, 300),
      content: body.length > 0 ? body : title,
      domain: classifyDomain(relPath, fm),
      sourceType: 'API_IMPORT',
      tags,
      importance: IMPORTANCE_BY_STATUS[lower(status)] ?? 0.5,
      sourceRef: `vault:${relPath}`,
      metadata: {
        vault: {
          path: relPath,
          sha256,
          type,
          status,
          created: fm.created ?? null,
          updated: fm.updated ?? null,
          aliases: Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : [],
          links: wikilinks(body).slice(0, 200),
        },
      },
    },
  };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Read the vault and split it into memories to import, held-back ministry notes and skipped plumbing. */
export function planVault(vaultDir) {
  const roots = ['wiki', '.raw'].map(r => join(vaultDir, r)).filter(r => { try { return statSync(r).isDirectory(); } catch { return false; } });
  if (roots.length === 0) throw new Error(`no wiki/ or .raw/ folder under ${vaultDir} — is this an Obsidian vault?`);
  const plan = { memories: [], ministry: [], skipped: [] };
  for (const file of roots.flatMap(r => walk(r)).sort()) {
    const path = relative(vaultDir, file);
    const text = readFileSync(file, 'utf8');
    const { frontmatter } = parseNote(text);
    const reason = skipReason(path, frontmatter);
    if (reason) { plan.skipped.push({ path: path.split(sep).join('/'), reason }); continue; }
    if (isMinistry(path, frontmatter)) { plan.ministry.push(path.split(sep).join('/')); continue; }
    plan.memories.push(toMemory(path, text));
  }
  return plan;
}

export function countByDomain(memories) {
  const c = {};
  for (const m of memories) c[m.body.domain] = (c[m.body.domain] ?? 0) + 1;
  return c;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function makeClient({ apiUrl, apiKey, userId, tenant, agentKey, fetchImpl = fetch, minWriteGapMs, log = () => {} }) {
  const base = apiUrl.replace(/\/+$/, '');
  let lastWrite = 0;
  const headers = (agent, extra = {}) => ({
    'content-type': 'application/json',
    'x-api-key': apiKey,
    ...(userId ? { 'x-user-id': userId } : {}),
    ...(agent ? (agentKey
      ? { 'x-agent-key': agentKey }
      : { 'x-agent-id': AGENT_ID, 'x-tenant-id': tenant, 'x-source-weight': '1.0' }) : {}),
    ...extra,
  });
  async function request(method, path, { body, agent = true, extra, write = method !== 'GET' } = {}) {
    for (let attempt = 1; ; attempt++) {
      if (write) {
        const wait = lastWrite + minWriteGapMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastWrite = Date.now();
      }
      const res = await fetchImpl(`${base}${path}`, { method, headers: headers(agent, extra), body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
      if (res.status === 429 && attempt < 6) {
        const ra = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000;
        log(`  rate limited on ${method} ${path} — waiting ${Math.round(waitMs / 1000)} s`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500 && res.status !== 503 && attempt < 3) { await sleep(2000 * attempt); continue; }
      return { status: res.status, json };
    }
  }
  return { request };
}

export async function resolveUserId(client, email) {
  const r = await client.request('POST', '/auth/login', { body: { email }, agent: false, write: false });
  if (r.status !== 200 || !r.json?.id) throw new Error(`could not resolve ${email} to a user id (POST /auth/login → ${r.status})`);
  return r.json.id;
}

/** Existing vault rows in the tenant: path → { id, sha256 }. */
export async function existingVaultRows(client) {
  const rows = new Map();
  for (let offset = 0; ; offset += 100) {
    const r = await client.request('GET', `/memories?tags=${VAULT_TAG}&limit=100&offset=${offset}&includeInvalidated=false`);
    if (r.status !== 200) throw new Error(`GET /memories (existing vault rows) → ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    const items = r.json?.items ?? [];
    for (const m of items) {
      const v = m.metadata?.vault;
      const path = v?.path ?? (typeof m.sourceRef === 'string' && m.sourceRef.startsWith('vault:') ? m.sourceRef.slice(6) : null);
      if (path && !rows.has(path)) rows.set(path, { id: m.id, sha256: v?.sha256 ?? null });
    }
    if (items.length < 100 || offset + 100 >= (r.json?.total ?? 0)) break;
  }
  return rows;
}

/** Live memories per domain for the user across tenants (what the budget counts). */
export async function domainCounts(client, domains) {
  const out = {};
  for (const d of domains) {
    const r = await client.request('GET', `/memories?domain=${encodeURIComponent(d)}&limit=1`, { agent: false });
    out[d] = r.status === 200 ? (r.json?.total ?? 0) : null;
  }
  return out;
}

export async function runImport({ plan, client, existing, dryRun, log = () => {} }) {
  const result = { created: [], updated: [], unchanged: [], failed: [] };
  const todo = plan.memories.map(m => {
    const prev = existing.get(m.path);
    return { m, prev, action: !prev ? 'create' : prev.sha256 === m.sha256 ? 'skip' : 'update' };
  });
  for (const { m, prev, action } of todo) {
    if (action === 'skip') { result.unchanged.push(m.path); continue; }
    if (dryRun) { (action === 'create' ? result.created : result.updated).push(m.path); continue; }
    const r = action === 'create'
      ? await client.request('POST', '/memories', {
          body: { ...m.body, dedup: false },
          extra: { 'idempotency-key': `vault-${createHash('sha256').update(`${m.path}\n${m.sha256}`).digest('hex').slice(0, 48)}` },
        })
      : await client.request('PATCH', `/memories/${prev.id}`, {
          body: { title: m.body.title, content: m.body.content, tags: m.body.tags, importance: m.body.importance, metadata: m.body.metadata },
        });
    const ok = action === 'create' ? r.status === 201 || r.status === 200 : r.status === 200;
    if (ok) {
      (action === 'create' ? result.created : result.updated).push(m.path);
      log(`  ${action === 'create' ? '+' : '~'} [${m.body.domain}] ${m.path}`);
    } else {
      const detail = r.json?.details?.[0]?.message ?? r.json?.message ?? r.json?.error ?? JSON.stringify(r.json).slice(0, 200);
      result.failed.push({ path: m.path, action, status: r.status, detail });
      log(`  × ${action} ${m.path} → ${r.status} ${detail}`);
    }
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return `usage: node scripts/vault-import.mjs --vault <dir> [--dry-run] [--plan-only]
                 [--api <url>] [--user-id <id> | --user-email <email>] [--tenant <id>]
                 [--rate <writes/min>] [--report <file.json>]
  --plan-only  read the vault and print the plan; no network at all
  --dry-run    also reads OmniMind (existing rows, budgets) but writes nothing
env: OMNIMIND_API_URL, OMNIMIND_API_KEY, OMNIMIND_USER_ID | VAULT_IMPORT_USER_EMAIL, OMNIMIND_AGENT_KEY (optional)`;
}

function parseArgs(argv) {
  const a = { vault: null, dryRun: false, planOnly: false, api: process.env.OMNIMIND_API_URL ?? null, userId: process.env.OMNIMIND_USER_ID ?? null,
    userEmail: process.env.VAULT_IMPORT_USER_EMAIL ?? null, tenant: 'josh-business', rate: 18, report: null };
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = () => { const x = args[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--vault') a.vault = v();
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--plan-only') a.planOnly = true;
    else if (k === '--api') a.api = v();
    else if (k === '--user-id') a.userId = v();
    else if (k === '--user-email') a.userEmail = v();
    else if (k === '--tenant') a.tenant = v();
    else if (k === '--rate') a.rate = Number(v());
    else if (k === '--report') a.report = v();
    else if (k === '-h' || k === '--help') { console.log(usage()); process.exit(0); }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.vault) throw new Error('--vault <dir> is required');
  if (!(a.rate > 0 && a.rate <= 60)) throw new Error('--rate must be between 1 and 60 writes per minute');
  return a;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`vault-import: ${e.message}\n${usage()}`); process.exit(2); }

  const plan = planVault(args.vault);
  const byDomain = countByDomain(plan.memories);
  console.log(`vault: ${args.vault}`);
  console.log(`notes to import: ${plan.memories.length} ${JSON.stringify(byDomain)}`);
  console.log(`ministry held back: ${plan.ministry.length} (OmniMind refuses ministry writes until local embeddings are live)`);
  console.log(`skipped plumbing: ${plan.skipped.length}`);
  const report = { vault: args.vault, tenant: args.tenant, byDomain, ministryHeldBack: plan.ministry, skipped: plan.skipped };
  if (args.planOnly) {
    if (args.report) writeFileSync(args.report, JSON.stringify({ ...report, plan: plan.memories.map(m => ({ path: m.path, domain: m.body.domain, title: m.body.title })) }, null, 2));
    return 0;
  }

  const apiKey = process.env.OMNIMIND_API_KEY;
  if (!args.api || !apiKey) { console.error('vault-import: OMNIMIND_API_URL (or --api) and OMNIMIND_API_KEY are required'); return 2; }
  const log = s => console.log(s);
  const client0 = makeClient({ apiUrl: args.api, apiKey, tenant: args.tenant, agentKey: process.env.OMNIMIND_AGENT_KEY, minWriteGapMs: 0, log });
  let userId = args.userId;
  if (!userId) {
    if (!args.userEmail) { console.error('vault-import: pass --user-id / OMNIMIND_USER_ID or --user-email / VAULT_IMPORT_USER_EMAIL'); return 2; }
    try { userId = await resolveUserId(client0, args.userEmail); } catch (e) { console.error(`vault-import: ${e.message}`); return 2; }
  }
  const client = makeClient({ apiUrl: args.api, apiKey, userId, tenant: args.tenant, agentKey: process.env.OMNIMIND_AGENT_KEY,
    minWriteGapMs: Math.ceil(60_000 / args.rate), log });

  let existing;
  try { existing = await existingVaultRows(client); } catch (e) { console.error(`vault-import: ${e.message}`); return 2; }
  const newPerDomain = {};
  for (const m of plan.memories) if (!existing.has(m.path)) newPerDomain[m.body.domain] = (newPerDomain[m.body.domain] ?? 0) + 1;
  const counts = await domainCounts(client, Object.keys(newPerDomain));
  const over = Object.entries(newPerDomain).filter(([d, n]) => counts[d] !== null && counts[d] + n > (DOMAIN_BUDGETS[d] ?? 250));
  console.log(`tenant ${args.tenant}: ${existing.size} vault rows already present; new per domain ${JSON.stringify(newPerDomain)}; current per domain ${JSON.stringify(counts)}`);
  if (over.length > 0) {
    console.error(`vault-import: domain budget would be exceeded — ${over.map(([d, n]) => `${d}: ${counts[d]} + ${n} > ${DOMAIN_BUDGETS[d] ?? 250}`).join('; ')}. Archive memories in that domain first; nothing was written.`);
    return 2;
  }
  const writes = plan.memories.filter(m => !existing.has(m.path) || existing.get(m.path).sha256 !== m.sha256).length;
  console.log(`${args.dryRun ? 'dry run — would write' : 'writing'} ${writes} (≈ ${Math.ceil(writes / args.rate)} min at ${args.rate}/min)`);

  const result = await runImport({ plan, client, existing, dryRun: args.dryRun, log });
  console.log(`${args.dryRun ? 'would create' : 'created'} ${result.created.length}, ${args.dryRun ? 'would update' : 'updated'} ${result.updated.length}, unchanged ${result.unchanged.length}, failed ${result.failed.length}`);
  if (args.report) writeFileSync(args.report, JSON.stringify({ ...report, userId, dryRun: args.dryRun, result }, null, 2));
  return result.failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(code => process.exit(code), err => { console.error(`vault-import: ${err?.stack ?? err}`); process.exit(1); });
}
