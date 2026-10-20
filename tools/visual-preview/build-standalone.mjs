#!/usr/bin/env node
// Builds the self-contained Obsidian-style preview of the knowledge graph:
// the same seeded fixture as the harness, Louvain communities precomputed
// here (graphology, from the boardroom-ai workspace) and embedded as data,
// rendered by vanilla JS + d3 (cdnjs) with the in-app visual language —
// community hulls + labels, semantic zoom, focus glow, gradient focus edges,
// hover card, legend-as-filter, minimap, dark default with a theme toggle.
//
//   node tools/visual-preview/build-standalone.mjs [out.html]

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph } from './fixtures/graph-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '..', '..', 'packages', 'boardroom-ai', 'package.json'));
const Graph = require('graphology');
const louvain = require('graphology-communities-louvain');

const out = process.argv[2] ?? resolve(here, 'out', 'boardroom-knowledge-graph.html');
const { graph } = buildGraph(Number(process.env.VISUAL_PREVIEW_SEED ?? 7));

// ── Communities (same weights / ordering rules as graph-communities.ts) ────
const W = { goal_hierarchy: 2.5, goal_project: 2, project_task: 1.6, project_person: 1.4, decision_project: 1.4, task_dependency: 1.2, commitment_person: 1, commitment_project: 1, commitment_entity: 1, memory_entity: 0.7 };
const HUBW = { goal: 1.6, project: 1.5, person: 1.1, decision: 0.9, task: 0.7, commitment: 0.7, memory: 0.3 };
const g = new Graph({ type: 'undirected' });
for (const n of [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))) g.addNode(n.id);
const degree = new Map();
for (const e of [...graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
  degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  if (g.hasEdge(e.source, e.target)) g.setEdgeAttribute(e.source, e.target, 'weight', g.getEdgeAttribute(e.source, e.target, 'weight') + W[e.type]);
  else g.addEdge(e.source, e.target, { weight: W[e.type] });
}
let seed = 7 >>> 0;
const rng = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const raw = louvain(g, { rng, getEdgeWeight: 'weight' });
const groups = new Map();
for (const id of Object.keys(raw).sort()) { if (!groups.has(raw[id])) groups.set(raw[id], []); groups.get(raw[id]).push(id); }
const ordered = [...groups.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const communities = ordered.map((members, id) => {
  const hubs = members.map((m) => ({ m, s: (degree.get(m) ?? 0) * HUBW[byId.get(m).type] })).sort((a, b) => b.s - a.s || a.m.localeCompare(b.m));
  const short = (s) => (s.length > 28 ? `${s.slice(0, 26)}…` : s);
  const first = hubs[0]; const second = hubs.find((h) => h !== first && byId.get(h.m).type !== 'memory' && h.s >= first.s * 0.75);
  return { id, size: members.length, label: second ? `${short(byId.get(first.m).label)} · ${short(byId.get(second.m).label)}` : short(byId.get(first.m).label) };
});
const communityOf = {};
ordered.forEach((members, id) => { for (const m of members) communityOf[m] = id; });

const data = { nodes: graph.nodes, edges: graph.edges, communities, communityOf, generatedAt: graph.generatedAt };

const html = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>BoardRoom Knowledge Graph</title>
<meta name="description" content="Standalone preview of the BoardRoom knowledge graph: communities, semantic zoom, focus glow, timeline-free.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>
  /* Tokens mirror packages/boardroom-ai/client/src/styles/tokens.css (graph section). Dark is the default; the toggle flips data-theme. */
  :root, :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #111110; --fg: #e8e8e2; --card: #1a1a18; --muted: #222220; --muted-fg: #9a9890; --border: #2e2e2a;
    --primary: #d4a31a; --primary-fg: #111110; --ring: rgba(212,163,26,.35);
    --e-goal: #c98500; --e-project: #2f7fd9; --e-task: #199e70; --e-person: #d55181; --e-decision: #f0f0f0; --e-commitment: #b48cff; --e-memory: #6f6e66;
    --edge: rgba(232,232,226,.12); --edge-strong: rgba(232,232,226,.6); --label: #e8e8e2; --halo: rgba(17,17,16,.85);
    --grid: rgba(232,232,226,.045); --vignette: rgba(0,0,0,.55);
    --c1: #d95926; --c2: #3987e5; --c3: #c98500; --c4: #008300; --c5: #9085e9; --c6: #e66767; --c-neutral: #898781;
    --hull-fill: .15; --hull-stroke: .5; --shadow: rgba(0,0,0,.55);
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #fafaf6; --fg: #1a1a16; --card: #ffffff; --muted: #f3f2ed; --muted-fg: #6b6960; --border: #e6e4db;
    --primary: #b5890a; --primary-fg: #ffffff; --ring: rgba(181,137,10,.3);
    --e-goal: #b5890a; --e-project: #2a78d6; --e-task: #1baf7a; --e-person: #c9407a; --e-decision: #111111; --e-commitment: #4a3aa7; --e-memory: #8a887e;
    --edge: rgba(26,26,22,.14); --edge-strong: rgba(26,26,22,.55); --label: #1a1a16; --halo: rgba(250,250,246,.85);
    --grid: rgba(26,26,22,.05); --vignette: rgba(26,26,22,.07);
    --c1: #eb6834; --c2: #2a78d6; --c3: #eda100; --c4: #008300; --c5: #6250d6; --c6: #e34948; --c-neutral: #898781;
    --hull-fill: .11; --hull-stroke: .42; --shadow: rgba(26,26,22,.22);
  }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 var(--font); }
  .app { height: 100%; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; padding-bottom: max(12px, env(safe-area-inset-bottom)); box-sizing: border-box; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: var(--muted-fg); font-size: 13px; font-variant-numeric: tabular-nums; }
  .sub b { color: var(--fg); font-weight: 500; }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .search { position: relative; flex: 1 1 180px; max-width: 340px; min-width: 0; }
  .search input, select { height: 36px; width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--fg); font: inherit; font-size: 13px; padding: 0 10px 0 32px; }
  select { padding: 0 8px; width: auto; }
  .search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--muted-fg); pointer-events: none; }
  input:focus-visible, select:focus-visible, button:focus-visible, canvas:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .results { position: absolute; z-index: 5; left: 0; right: 0; top: 40px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.18); margin: 0; padding: 0; list-style: none; }
  .results li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 13px; cursor: pointer; }
  .results li[aria-selected="true"] { background: var(--muted); }
  .results .t { margin-left: auto; color: var(--muted-fg); font-size: 11px; }
  .btn { height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--muted-fg); font: inherit; font-size: 13px; padding: 0 12px; cursor: pointer; transition: background-color 150ms cubic-bezier(.23,1,.32,1), color 150ms cubic-bezier(.23,1,.32,1); }
  .btn[aria-pressed="true"] { color: var(--fg); border-color: color-mix(in srgb, var(--primary) 50%, var(--border)); background: color-mix(in srgb, var(--primary) 12%, var(--card)); }
  .seg { display: flex; height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); overflow: hidden; font-size: 12px; }
  .seg button { border: 0; background: transparent; color: var(--muted-fg); font: inherit; padding: 0 10px; cursor: pointer; }
  .seg button[aria-pressed="true"] { color: var(--fg); background: color-mix(in srgb, var(--primary) 12%, var(--card)); }
  .seg label { display: flex; align-items: center; gap: 6px; border-left: 1px solid var(--border); padding: 0 8px; color: var(--muted-fg); }
  .seg input { width: 56px; accent-color: var(--primary); }
  .seg output { width: 22px; color: var(--fg); font-variant-numeric: tabular-nums; }
  .stage { position: relative; flex: 1 1 auto; min-height: 320px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; display: flex; background: var(--bg); }
  canvas#c { display: block; flex: 1 1 auto; min-width: 0; touch-action: none; cursor: grab; }
  canvas#c.grabbing { cursor: grabbing; }
  .glass { background: var(--card); border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); box-shadow: 0 4px 12px rgba(0,0,0,.18); border-radius: 10px; }
  @supports (backdrop-filter: blur(1px)) { .glass { background: color-mix(in srgb, var(--card) 80%, transparent); backdrop-filter: blur(10px); } }
  @media (prefers-reduced-transparency: reduce) { .glass { background: var(--card); backdrop-filter: none; } }
  .legend { position: absolute; left: 12px; bottom: 12px; z-index: 3; display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; max-width: calc(100% - 200px); }
  .legend button { display: flex; align-items: center; gap: 6px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--fg); font: inherit; font-size: 11px; padding: 0 6px; cursor: pointer; }
  .legend button:hover { background: var(--muted); }
  .legend button[aria-pressed="false"] { color: var(--muted-fg); text-decoration: line-through; }
  .legend button[aria-pressed="false"] .glyph { opacity: .4; }
  .legend .n { color: var(--muted-fg); font-variant-numeric: tabular-nums; }
  .minimap { position: absolute; right: 12px; bottom: 12px; z-index: 3; padding: 4px; }
  .minimap canvas { display: block; width: 150px; height: 100px; border-radius: 6px; cursor: crosshair; }
  .tip { position: absolute; left: 0; top: 0; z-index: 4; width: 250px; padding: 10px; pointer-events: none; font-size: 12px; opacity: 0; transition: opacity 160ms cubic-bezier(.23,1,.32,1), scale 160ms cubic-bezier(.23,1,.32,1); scale: .97; }
  .tip[data-show="true"] { opacity: 1; scale: 1; }
  .tip .meta { display: flex; align-items: center; gap: 6px; color: var(--muted-fg); font-size: 11px; }
  .tip .chip { border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .tip .date { margin-left: auto; font-variant-numeric: tabular-nums; }
  .tip .title { margin-top: 4px; font-weight: 500; font-size: 13px; line-height: 1.35; color: var(--fg); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tip .more { margin-top: 4px; color: var(--muted-fg); font-size: 11px; }
  .hint { position: absolute; left: 12px; top: 10px; font-size: 11px; color: var(--muted-fg); pointer-events: none; z-index: 2; }
  .inspector { width: 320px; max-width: 100%; flex: 0 0 auto; border-left: 1px solid var(--border); background: var(--card); display: flex; flex-direction: column; min-height: 0; z-index: 2; }
  .inspector[hidden] { display: none; }
  .ins-head { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .ins-head .kind { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-fg); }
  .ins-head h2 { margin: 2px 0 0; font-size: 15px; font-weight: 600; line-height: 1.3; }
  .ins-head .x { margin-left: auto; border: 0; background: transparent; color: var(--muted-fg); font-size: 18px; cursor: pointer; line-height: 1; }
  .ins-body { padding: 10px 14px; overflow: auto; font-size: 13px; }
  .ins-body dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0 0 10px; color: var(--muted-fg); }
  .ins-body dd { margin: 0; color: var(--fg); }
  .ins-body h3 { margin: 12px 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-fg); }
  .ins-body ul { list-style: none; margin: 0; padding: 0; }
  .ins-body li { display: flex; align-items: center; gap: 8px; padding: 5px 0; cursor: pointer; }
  .ins-body li:hover { color: var(--primary); }
  .ins-body .via { margin-left: auto; color: var(--muted-fg); font-size: 11px; }
  .ins-actions { display: flex; gap: 6px; margin: 8px 0; }
  .ins-actions .btn { height: 30px; font-size: 12px; }
  .ins-actions .btn.primary { background: var(--primary); color: var(--primary-fg); border-color: transparent; }
  .glyph { flex: 0 0 auto; }
  @media (max-width: 760px) {
    .app { padding: 8px 10px; gap: 8px; }
    .stage { flex-direction: column; }
    .inspector { width: 100%; max-height: 48%; border-left: 0; border-top: 1px solid var(--border); }
    .legend { max-width: calc(100% - 24px); bottom: auto; top: 10px; }
    .hint, .minimap { display: none; }
    .tip { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .tip { transition: none; } .btn { transition: none; } }
</style>
</head>
<body>
<div class="app">
  <div class="head">
    <div>
      <h1>Knowledge Graph</h1>
      <div class="sub" id="status">Loading…</div>
    </div>
    <div class="controls">
      <button class="btn" id="theme" title="Toggle light / dark">☾ Dark</button>
    </div>
  </div>
  <div class="controls">
    <div class="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/></svg>
      <input id="q" type="search" placeholder="Find a node…  ( / )" autocomplete="off" aria-label="Search graph nodes" aria-controls="results" aria-expanded="false">
      <ul id="results" class="results" role="listbox" hidden></ul>
    </div>
    <select id="domain" aria-label="Filter by domain"><option value="all">All domains</option></select>
    <div class="seg" role="group" aria-label="Graph scope">
      <button id="local" aria-pressed="false" title="Local graph around the focused node">Local</button>
      <button id="global" aria-pressed="true" title="Whole graph">Global</button>
      <label><input id="depth" type="range" min="1" max="3" step="1" value="2" aria-label="Local graph depth"><output id="depthOut" for="depth">—</output></label>
    </div>
    <button class="btn" id="labels" aria-pressed="true">Labels</button>
    <button class="btn" id="hulls" aria-pressed="true" title="Community hulls and labels">Communities</button>
    <button class="btn" id="fit" title="Fit graph to view (0)">Fit</button>
  </div>
  <div class="stage">
    <canvas id="c" tabindex="0" aria-label="Force-directed knowledge graph. Plus and minus zoom, arrows pan, 0 fits." role="application"></canvas>
    <div class="hint">hover · click selects · double-click focuses · drag moves · wheel zooms</div>
    <div class="legend glass" id="chips" role="group" aria-label="Legend and type filter"></div>
    <div class="minimap glass"><canvas id="mini" width="300" height="200" aria-label="Graph overview — click to pan" role="img"></canvas></div>
    <div class="tip glass" id="tip" role="tooltip" data-show="false"></div>
    <aside class="inspector" id="inspector" hidden aria-label="Node details"></aside>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
(() => {
  const DATA = __DATA__;
  const TYPES = ['goal','project','task','person','decision','commitment','memory'];
  const LABEL = { goal:'Goals', project:'Projects', task:'Tasks', person:'People', decision:'Decisions', commitment:'Commitments', memory:'Memories' };
  const ONE = { goal:'Goal', project:'Project', task:'Task', person:'Person', decision:'Decision', commitment:'Commitment', memory:'Memory' };
  const SHAPE = { goal:'diamond', project:'square', task:'triangle', person:'circle', decision:'ring', commitment:'hexagon', memory:'dot' };
  const BASE_R = { goal:7, project:6, task:4.5, person:5.5, decision:5.5, commitment:4.5, memory:2.6 };
  const VERB = { goal_hierarchy:'sub-goal', goal_project:'project', project_task:'task', project_person:'person', decision_project:'decision', task_dependency:'depends on', commitment_person:'to', commitment_project:'about', commitment_entity:'about', memory_entity:'memory' };
  const TYPE_W = { goal:60, project:50, person:40, decision:30, task:20, commitment:20, memory:0 };
  const N = DATA.nodes, E = DATA.edges, COMM = DATA.communityOf, COMMS = DATA.communities;
  const byId = new Map(N.map(n => [n.id, n]));
  const adj = new Map();
  for (const e of E) { if (!adj.has(e.source)) adj.set(e.source, new Set()); if (!adj.has(e.target)) adj.set(e.target, new Set()); adj.get(e.source).add(e.target); adj.get(e.target).add(e.source); }
  const degree = id => (adj.get(id)?.size ?? 0);
  const degs = N.map(n => degree(n.id)).sort((a, b) => b - a);
  const hubDegree = Math.max(2, degs[Math.max(0, Math.round(degs.length * 0.08) - 1)] ?? 2);
  const state = { types: new Set(TYPES), domain: 'all', labels: true, hulls: true, orphans: false, local: false, depth: 2, focus: null, selected: null, hover: null };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = ms => { const d = new Date(ms); return d.getUTCDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

  // ── Palette from CSS tokens ─────────────────────────────────────────────
  let pal;
  function readPal() {
    const cs = getComputedStyle(document.documentElement); const v = n => cs.getPropertyValue(n).trim();
    pal = { type: Object.fromEntries(TYPES.map(t => [t, v('--e-' + t)])), bg: v('--bg'), edge: v('--edge'), edgeStrong: v('--edge-strong'), label: v('--label'), halo: v('--halo'), grid: v('--grid'), vignette: v('--vignette'),
      community: [1,2,3,4,5,6].map(i => v('--c' + i)), neutral: v('--c-neutral'), hullFill: +v('--hull-fill'), hullStroke: +v('--hull-stroke'), shadow: v('--shadow'), font: v('--font'), dark: document.documentElement.dataset.theme !== 'light' };
  }
  const withAlpha = (hex, a) => { const h = hex.replace('#',''); const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h; return 'rgba(' + parseInt(f.slice(0,2),16) + ',' + parseInt(f.slice(2,4),16) + ',' + parseInt(f.slice(4,6),16) + ',' + a + ')'; };
  const commColor = id => (id >= 0 && id < 6 ? pal.community[id] : pal.neutral);

  // ── Theme toggle (dark default) ─────────────────────────────────────────
  const themeBtn = document.getElementById('theme');
  const stored = localStorage.getItem('bkg-theme');
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  const syncTheme = () => { const dark = document.documentElement.dataset.theme !== 'light'; themeBtn.textContent = dark ? '☾ Dark' : '☀ Light'; readPal(); draw(); };
  themeBtn.addEventListener('click', () => { const dark = document.documentElement.dataset.theme !== 'light'; document.documentElement.dataset.theme = dark ? 'light' : 'dark'; localStorage.setItem('bkg-theme', document.documentElement.dataset.theme); syncTheme(); });

  // ── Visible subgraph ────────────────────────────────────────────────────
  let vis = { nodes: [], edges: [], depth: null };
  function compute() {
    let keep = new Set(N.filter(n => state.types.has(n.type) && (state.domain === 'all' || n.domain === null || n.domain === state.domain)).map(n => n.id));
    if (state.domain !== 'all') { const anchored = new Set([...keep].filter(id => byId.get(id).domain === state.domain)); for (const id of keep) if (!anchored.has(id) && [...(adj.get(id) ?? [])].some(nb => anchored.has(nb))) anchored.add(id); keep = anchored; }
    let depth = null;
    if (state.local && state.focus && keep.has(state.focus)) {
      depth = new Map([[state.focus, 0]]); let frontier = [state.focus];
      for (let d = 1; d <= state.depth && frontier.length; d++) { const next = []; for (const id of frontier) for (const nb of adj.get(id) ?? []) if (keep.has(nb) && !depth.has(nb)) { depth.set(nb, d); next.push(nb); } frontier = next; }
      keep = new Set(depth.keys());
    }
    const edges = E.filter(e => keep.has(e.source) && keep.has(e.target));
    if (!state.orphans) { const linked = new Set(); for (const e of edges) { linked.add(e.source); linked.add(e.target); } if (state.focus) linked.add(state.focus); keep = new Set([...keep].filter(id => linked.has(id))); }
    vis = { nodes: N.filter(n => keep.has(n.id)), edges: edges.filter(e => keep.has(e.source) && keep.has(e.target)), depth };
  }

  // ── Simulation (positions persist across filter changes) ───────────────
  const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
  const pos = new Map(); let simNodes = [], simLinks = [], sim = null, settled = false;
  function clusterForce(strength) {
    let nodes = [];
    const f = alpha => { const cents = new Map(); for (const n of nodes) { const c = COMM[n.id]; if (c === undefined) continue; const a = cents.get(c) ?? { x: 0, y: 0, n: 0 }; a.x += n.x; a.y += n.y; a.n++; cents.set(c, a); } for (const a of cents.values()) { a.x /= a.n; a.y /= a.n; } const k = strength * alpha; for (const n of nodes) { const a = cents.get(COMM[n.id]); if (!a || a.n < 2) continue; n.vx += (a.x - n.x) * k; n.vy += (a.y - n.y) * k; } };
    f.initialize = ns => { nodes = ns; }; return f;
  }
  function rebuild(fit = false) {
    compute();
    simNodes = vis.nodes.map(n => { const p = pos.get(n.id) || { x: (Math.random() - .5) * 320, y: (Math.random() - .5) * 320 }; const o = { id: n.id, data: n, x: p.x, y: p.y, vx: 0, vy: 0 }; pos.set(n.id, o); return o; });
    const idx = new Map(simNodes.map(n => [n.id, n]));
    simLinks = vis.edges.map(e => ({ id: e.id, data: e, source: idx.get(e.source), target: idx.get(e.target) }));
    const n = simNodes.length;
    const pairs = new Map(); for (const l of simLinks) { const k = l.source.id < l.target.id ? l.source.id + '|' + l.target.id : l.target.id + '|' + l.source.id; (pairs.get(k) || pairs.set(k, []).get(k)).push(l); }
    for (const list of pairs.values()) if (list.length > 1) list.forEach((l, i) => { l.curve = (l.source.id < l.target.id ? 1 : -1) * (i - (list.length - 1) / 2) * 0.28; });
    const crosses = l => n > 20 && COMM[l.source.id] !== COMM[l.target.id];
    sim && sim.stop();
    sim = d3.forceSimulation(simNodes)
      .force('charge', d3.forceManyBody().strength(n > 600 ? -45 : n > 200 ? -85 : -130).distanceMax(420))
      .force('link', d3.forceLink(simLinks).id(d => d.id).distance(l => (l.data.type === 'memory_entity' ? 28 : l.data.type === 'goal_hierarchy' ? 70 : 48) * (crosses(l) ? 2.4 : 1)).strength(l => (l.data.type === 'memory_entity' ? .6 : .9) * (crosses(l) ? .25 : 1)))
      .force('center', d3.forceCenter(0, 0).strength(.05))
      .force('cluster', n > 20 ? clusterForce(n > 400 ? .1 : .16) : null)
      .alphaDecay(.03).velocityDecay(.32);
    settled = false;
    if (reduced) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); settled = true; if (fit) fitAll(0); draw(); }
    else { sim.on('tick', draw).on('end', () => { settled = true; if (fit) fitAll(); }); }
    status();
    renderChips();
  }
  const radiusOf = d => BASE_R[d.data.type] + Math.min(10, Math.sqrt(degree(d.id)) * 1.6);

  // ── Canvas sizing + zoom ────────────────────────────────────────────────
  let W = 800, H = 600, dpr = 1; let transform = d3.zoomIdentity;
  let userZoomed = false;
  function resize() { const r = canvas.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); if (!userZoomed && settled) fitAll(0); else draw(); }
  new ResizeObserver(resize).observe(canvas);
  const zoom = d3.zoom().scaleExtent([0.15, 8]).filter(ev => !ev.button && !(ev.type === 'mousedown' && hit(ev)) && !(ev.type === 'touchstart' && ev.touches.length === 1 && hitTouch(ev))).on('zoom', ev => { if (ev.sourceEvent) userZoomed = true; transform = ev.transform; draw(); });
  d3.select(canvas).call(zoom).on('dblclick.zoom', null);
  // Asymmetric insets: 72px top clears the first row of community labels, 32px elsewhere → hulls + labels use ~85% of the canvas.
  function fitAll(ms = 500) { if (!simNodes.length) return; const pad = 16, top = 72, side = 32; const xs = simNodes.map(n => n.x), ys = simNodes.map(n => n.y); const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad; const aw = W - side * 2, ah = H - top - side; const k = Math.max(.15, Math.min(8, Math.min(aw / (x1 - x0), ah / (y1 - y0)))); const t = d3.zoomIdentity.translate(side + aw / 2 - k * (x0 + x1) / 2, top + ah / 2 - k * (y0 + y1) / 2).scale(k); d3.select(canvas).transition().duration(reduced ? 0 : ms).ease(d3.easeCubicOut).call(zoom.transform, t); }
  function centerOn(x, y, k = transform.k, ms = 400) { const t = d3.zoomIdentity.translate(W / 2 - k * x, H / 2 - k * y).scale(k); d3.select(canvas).transition().duration(reduced ? 0 : ms).ease(d3.easeCubicOut).call(zoom.transform, t); }

  // ── Geometry helpers (hulls, labels) ────────────────────────────────────
  function hull(points) { const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y); if (pts.length < 3) return pts; const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); const lo = []; for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } const up = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } lo.pop(); up.pop(); return lo.concat(up); }
  function padPoly(poly, pad) { const n = poly.length; const c = { x: d3.mean(poly, p => p.x), y: d3.mean(poly, p => p.y) }; if (n < 3) return poly.map(p => { const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * pad, y: p.y + dy / l * pad }; }); const normal = (a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = Math.hypot(ex, ey) || 1; let nx = ey / l, ny = -ex / l; const mx = (a.x + b.x) / 2 - c.x, my = (a.y + b.y) / 2 - c.y; if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } return { x: nx, y: ny }; }; const out = []; for (let i = 0; i < n; i++) { const n1 = normal(poly[(i - 1 + n) % n], poly[i]), n2 = normal(poly[i], poly[(i + 1) % n]); let bx = n1.x + n2.x, by = n1.y + n2.y; const bl = Math.hypot(bx, by); if (bl < 1e-6) { bx = n1.x; by = n1.y; } else { bx /= bl; by /= bl; } const d = pad / Math.max(.5, bx * n1.x + by * n1.y); out.push({ x: poly[i].x + bx * d, y: poly[i].y + by * d }); } return out; }
  function outlineOf(pts, pad) { if (pts.length === 1) return { circle: true, cx: pts[0].x, cy: pts[0].y, r: pad }; let base; if (pts.length === 2) { const ring = []; for (const p of pts) for (let i = 0; i < 10; i++) { const a = Math.PI * 2 * i / 10; ring.push({ x: p.x + Math.cos(a) * pad, y: p.y + Math.sin(a) * pad }); } base = hull(ring); } else { const h = hull(pts); if (h.length < 3) return outlineOf(h, pad); base = padPoly(h, pad); } return { poly: base }; }
  function traceOutline(o) { ctx.beginPath(); if (o.circle) { ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2); return; } const p = o.poly, n = p.length; const mid = i => ({ x: (p[i % n].x + p[(i + 1) % n].x) / 2, y: (p[i % n].y + p[(i + 1) % n].y) / 2 }); const s = mid(0); ctx.moveTo(s.x, s.y); for (let i = 1; i <= n; i++) { const v = p[i % n], m = mid(i); ctx.quadraticCurveTo(v.x, v.y, m.x, m.y); } ctx.closePath(); }
  // Anchor on the RENDERED curve (sampled), not the control polygon: x = centroid, y = visible top edge.
  const anchorOf = o => { if (o.circle) return { x: o.cx, y: o.cy - o.r }; const p = o.poly, n = p.length; const mid = i => ({ x: (p[i % n].x + p[(i + 1) % n].x) / 2, y: (p[i % n].y + p[(i + 1) % n].y) / 2 }); let prev = mid(0), minY = Infinity, sx = 0, cnt = 0; for (let i = 1; i <= n; i++) { const v = p[i % n], m = mid(i); for (let s = 1; s <= 4; s++) { const t = s / 4, u = 1 - t; const x = u * u * prev.x + 2 * u * t * v.x + t * t * m.x, y = u * u * prev.y + 2 * u * t * v.y + t * t * m.y; if (y < minY) minY = y; sx += x; cnt++; } prev = m; } return { x: sx / cnt, y: minY }; };
  function placeAnchored(labels, step = 24) { labels.sort((a, b) => b.priority - a.priority); const placed = [], out = new Map(); for (const l of labels) { const shifts = [0]; for (let d = step; d <= Math.max(l.w * 1.5, 96); d += step) shifts.push(d, -d); let chosen = null; rows: for (const dy of [0, l.h + 3]) for (const dx of shifts) { const x = Math.max(8, Math.min(W - l.w - 8, l.x + dx)); const box = { x, y: l.y + dy, w: l.w, h: l.h }; if (placed.some(o => box.x - 3 < o.x + o.w && box.x + box.w + 3 > o.x && box.y - 3 < o.y + o.h && box.y + box.h + 3 > o.y)) continue; chosen = box; break rows; } if (!chosen) continue; placed.push(chosen); out.set(l.id, chosen); } return out; }
  const smooth = t => t * t * (3 - 2 * t);
  const commLabelAlpha = k => k <= .9 ? 1 : k >= 1.9 ? 0 : 1 - smooth((k - .9) / 1);
  const hullFactor = k => k <= 1.3 ? 1 : k >= 2.6 ? .3 : 1 - .7 * smooth((k - 1.3) / 1.3);
  const tier = k => k < 1.05 ? 'far' : k < 2.1 ? 'mid' : 'near';
  function place(boxes, pad = 3) { boxes.sort((a, b) => (b.forced | 0) - (a.forced | 0) || b.priority - a.priority); const kept = new Set(), placed = []; for (const b of boxes) { if (!b.forced && placed.some(o => b.x - pad < o.x + o.w && b.x + b.w + pad > o.x && b.y - pad < o.y + o.h && b.y + b.h + pad > o.y)) continue; kept.add(b.id); placed.push(b); } return kept; }

  // ── Shapes ──────────────────────────────────────────────────────────────
  function path(kind, r) { ctx.beginPath(); switch (kind) { case 'diamond': ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 1.1, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 1.1, 0); ctx.closePath(); break; case 'square': { const s = r * .95, k = Math.min(2, s * .35); ctx.moveTo(-s + k, -s); ctx.lineTo(s - k, -s); ctx.quadraticCurveTo(s, -s, s, -s + k); ctx.lineTo(s, s - k); ctx.quadraticCurveTo(s, s, s - k, s); ctx.lineTo(-s + k, s); ctx.quadraticCurveTo(-s, s, -s, s - k); ctx.lineTo(-s, -s + k); ctx.quadraticCurveTo(-s, -s, -s + k, -s); ctx.closePath(); break; } case 'triangle': ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * 1.1, r * .85); ctx.lineTo(-r * 1.1, r * .85); ctx.closePath(); break; case 'hexagon': for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 6; const x = Math.cos(a) * r * 1.1, y = Math.sin(a) * r * 1.1; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); break; default: ctx.arc(0, 0, r, 0, Math.PI * 2); } }
  function shape(kind, r, fill, hollow) { path(kind, r); if (kind === 'ring') { ctx.lineWidth = Math.max(1.4, r * .38); ctx.strokeStyle = fill; ctx.stroke(); return; } if (hollow) { ctx.lineWidth = Math.max(1.2, r * .3); ctx.strokeStyle = fill; ctx.stroke(); return; } ctx.fillStyle = fill; ctx.fill(); }

  // ── Draw ────────────────────────────────────────────────────────────────
  let frameHulls = [];
  function draw() {
    if (!pal) readPal();
    const k = transform.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, pal.vignette); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.translate(transform.x, transform.y); ctx.scale(k, k);
    // grid
    const raw = 90 / k, pow = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / pow, step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
    const gx0 = Math.floor((-transform.x / k) / step) * step, gx1 = (W - transform.x) / k, gy0 = Math.floor((-transform.y / k) / step) * step, gy1 = (H - transform.y) / k;
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1 / k; ctx.beginPath(); for (let x = gx0; x <= gx1; x += step) { ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); } for (let y = gy0; y <= gy1; y += step) { ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); } ctx.stroke();

    const focus = state.hover ?? state.selected;
    const emph = focus ? new Set([focus, ...(adj.get(focus) ?? [])]) : null;
    const focusComm = focus !== null && focus !== undefined ? COMM[focus] : undefined;
    const alphaOf = d => { if (emph) return emph.has(d.id) ? 1 : .12; if (vis.depth) { const dd = vis.depth.get(d.id); return dd === 0 ? 1 : dd === 1 ? .9 : .55; } return d.data.type === 'memory' ? .75 : 1; };

    // hulls
    frameHulls = [];
    if (state.hulls) {
      const members = new Map(); for (const d of simNodes) { const c = COMM[d.id]; if (c === undefined) continue; (members.get(c) || members.set(c, []).get(c)).push({ x: d.x, y: d.y }); }
      const pad = 9 + 6 / Math.max(.4, k), zf = hullFactor(k) * (vis.depth ? .55 : 1);
      for (const [id, pts] of [...members.entries()].sort((a, b) => b[1].length - a[1].length)) {
        if (pts.length < 2) continue; const o = outlineOf(pts, pad); const color = commColor(id); const em = focusComm === id; const anyF = focusComm !== undefined;
        traceOutline(o); ctx.fillStyle = withAlpha(color, pal.hullFill * zf * (anyF ? (em ? 1.15 : .5) : 1)); ctx.fill();
        ctx.lineWidth = 1.2 / k; ctx.setLineDash(em ? [] : [6 / k, 4 / k]); ctx.strokeStyle = withAlpha(color, pal.hullStroke * zf * (anyF ? (em ? 1 : .45) : 1)); ctx.stroke(); ctx.setLineDash([]);
        frameHulls.push({ id, o, color, members: pts.length, em });
      }
    }
    // links
    for (const l of simLinks) {
      const on = focus && (l.source.id === focus || l.target.id === focus);
      if (emph && !on) continue;
      ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y);
      let cp = null; if (l.curve) { const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y, len = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx), d = len * l.curve; cp = [(l.source.x + l.target.x) / 2 + d * Math.cos(a - Math.PI / 2), (l.source.y + l.target.y) / 2 + d * Math.sin(a - Math.PI / 2)]; ctx.quadraticCurveTo(cp[0], cp[1], l.target.x, l.target.y); } else ctx.lineTo(l.target.x, l.target.y);
      const t = l.data.type;
      if (on) { const gr = ctx.createLinearGradient(l.source.x, l.source.y, l.target.x, l.target.y); gr.addColorStop(0, withAlpha(pal.type[l.source.data.type], .95)); gr.addColorStop(1, withAlpha(pal.type[l.target.data.type], .95)); ctx.strokeStyle = gr; ctx.lineWidth = 1.8 / k; }
      else { ctx.strokeStyle = (t === 'goal_hierarchy' || t === 'goal_project') ? withAlpha(pal.type.goal, pal.dark ? .45 : .4) : pal.edge; ctx.lineWidth = (t === 'goal_hierarchy' ? 1.8 : t === 'goal_project' ? 1.4 : t === 'memory_entity' ? .6 : 1) / k; }
      ctx.setLineDash(t === 'goal_hierarchy' ? [5 / k, 4 / k] : t === 'task_dependency' ? [2 / k, 3 / k] : []);
      ctx.stroke(); ctx.setLineDash([]);
    }
    // nodes
    const crisp = k > 2.2;
    for (const d of simNodes) {
      const r = radiusOf(d), color = pal.type[d.data.type], a = alphaOf(d); const isF = d.id === focus, isS = d.id === state.selected, isRoot = vis.depth && vis.depth.get(d.id) === 0; const inv = 1 / Math.max(.5, k);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(d.x, d.y);
      if (isF) { const outer = r * 2.6 + 10 * inv; const g = ctx.createRadialGradient(0, 0, r * .6, 0, 0, outer); g.addColorStop(0, withAlpha(color, .5)); g.addColorStop(.55, withAlpha(color, .16)); g.addColorStop(1, withAlpha(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, r + 3.5 * inv, 0, Math.PI * 2); ctx.lineWidth = 1.6 * inv; ctx.strokeStyle = color; ctx.stroke(); }
      if (isS) { ctx.beginPath(); ctx.arc(0, 0, r + (isF ? 6.5 : 3.5) * inv, 0, Math.PI * 2); ctx.lineWidth = 1.3 * inv; ctx.strokeStyle = pal.label; ctx.globalAlpha = a * .85; ctx.stroke(); ctx.globalAlpha = a; }
      if (isRoot && !isF && !isS) { ctx.beginPath(); ctx.arc(0, 0, r + 4 * inv, 0, Math.PI * 2); ctx.setLineDash([3 * inv, 3 * inv]); ctx.lineWidth = inv; ctx.strokeStyle = withAlpha(color, .9); ctx.stroke(); ctx.setLineDash([]); }
      if (crisp) { ctx.shadowColor = pal.shadow; ctx.shadowBlur = 7; ctx.shadowOffsetY = 1.5; }
      const hollow = d.data.type === 'memory' && (d.data.status === 'SUPERSEDED' || d.data.status === 'ARCHIVED');
      shape(SHAPE[d.data.type], r, color, hollow);
      if (crisp && !hollow && SHAPE[d.data.type] !== 'ring') { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; path(SHAPE[d.data.type], r); ctx.lineWidth = 1 / k; ctx.strokeStyle = withAlpha(pal.bg, .7); ctx.stroke(); }
      ctx.restore();
    }
    // labels: communities (collision-placed, fade with zoom) + nodes by tier
    const tr = tier(k), boxes = [], cdraw = new Map(), info = new Map();
    const cA = commLabelAlpha(k) * (emph ? .6 : 1);
    const anchored = [];
    if (state.hulls && cA > .02) for (const h of frameHulls) { if (h.members < 4) continue; const lab = COMMS[h.id]?.label; if (!lab) continue; const an = anchorOf(h.o); let text = lab.toUpperCase(); let w = (text.length * 11 * .6 + 8) * 1.25; if (w > W - 16) { text = text.split(' · ')[0]; w = (text.length * 11 * .6 + 8) * 1.25; if (w > W - 16) continue; } const id = 'c:' + h.id; const bottom = an.y * k + transform.y - 10; anchored.push({ id, x: an.x * k + transform.x - w / 2, y: bottom - 14.3, w, h: 14.3, priority: 10000 + h.members }); cdraw.set(id, { h, text }); }
    const cplaced = placeAnchored(anchored);
    for (const l of anchored) { const b = cplaced.get(l.id); if (b) boxes.push({ id: l.id, x: b.x, y: b.y, w: l.w, h: l.h, forced: true, priority: l.priority }); }
    for (const d of simNodes) {
      const a = alphaOf(d); const inRing = !!(emph && emph.has(d.id)); const forced = d.id === focus || d.id === state.selected; const deg = degree(d.id); const hub = deg >= hubDegree;
      if (a < .3 && d.id !== state.selected) continue;
      const want = forced || inRing || (state.labels && (tr === 'far' ? hub : tr === 'mid' ? (hub || d.data.type !== 'memory') : true));
      if (!want) continue;
      const fpx = Math.max(10, Math.min(13.5, 10.5 + deg * .18)) + (forced || inRing ? .5 : 0); const text = d.data.label.length > 42 ? d.data.label.slice(0, 40) + '…' : d.data.label; const yG = d.y + radiusOf(d) + 3 / k; const w = text.length * fpx * .6 + 8;
      boxes.push({ id: d.id, x: d.x * k + transform.x - w / 2, y: yG * k + transform.y, w, h: fpx * 1.3, forced, priority: TYPE_W[d.data.type] + Math.min(200, deg * 4) + (forced || inRing ? 1000 : 0) + (d.id === focus ? 4000 : 0) });
      info.set(d.id, { d, a, forced: forced || inRing, fpx, text, y: yG });
    }
    const kept = place(boxes);
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.textBaseline = 'bottom'; if ('letterSpacing' in ctx) ctx.letterSpacing = (0.88 / k) + 'px';
    for (const l of anchored) { const b = cplaced.get(l.id), c = cdraw.get(l.id); if (!b || !c) continue; const gx = (b.x + l.w / 2 - transform.x) / k, gy = (b.y + l.h - transform.y) / k; ctx.font = '600 ' + (11 / k) + 'px ' + pal.font; ctx.globalAlpha = Math.min(.9, cA) * (c.h.em || focusComm === undefined ? 1 : .55); ctx.lineWidth = 3.5 / k; ctx.strokeStyle = pal.halo; ctx.strokeText(c.text, gx, gy); ctx.fillStyle = c.h.color; ctx.fillText(c.text, gx, gy); }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textBaseline = 'top';
    for (const id of kept) { const it = info.get(id); if (!it) continue; ctx.globalAlpha = it.forced ? 1 : Math.min(1, it.a + .1); ctx.font = (it.d.id === focus ? 600 : 500) + ' ' + (it.fpx / k) + 'px ' + pal.font; ctx.lineWidth = 3 / k; ctx.strokeStyle = pal.halo; ctx.strokeText(it.text, it.d.x, it.y); ctx.fillStyle = it.d.data.type === 'memory' && !it.forced ? withAlpha(pal.label, .75) : pal.label; ctx.fillText(it.text, it.d.x, it.y); }
    ctx.globalAlpha = 1;
    drawMini();
  }

  // ── Minimap ─────────────────────────────────────────────────────────────
  const mini = document.getElementById('mini'), mctx = mini.getContext('2d'); let miniT = null;
  function drawMini() {
    if (!simNodes.length) return; const mw = 150, mh = 100, sc = 2; mctx.setTransform(sc, 0, 0, sc, 0, 0); mctx.clearRect(0, 0, mw, mh);
    const vx = -transform.x / transform.k, vy = -transform.y / transform.k, vw = W / transform.k, vh = H / transform.k;
    const xs = simNodes.map(n => n.x), ys = simNodes.map(n => n.y); const x0 = Math.min(...xs, vx), x1 = Math.max(...xs, vx + vw), y0 = Math.min(...ys, vy), y1 = Math.max(...ys, vy + vh);
    const k = Math.min((mw - 16) / Math.max(1, x1 - x0), (mh - 16) / Math.max(1, y1 - y0)); const tx = (mw - (x1 - x0) * k) / 2 - x0 * k, ty = (mh - (y1 - y0) * k) / 2 - y0 * k; miniT = { k, tx, ty };
    for (const n of simNodes) { mctx.fillStyle = pal.type[n.data.type]; mctx.globalAlpha = n.data.type === 'memory' ? .6 : 1; mctx.beginPath(); mctx.arc(n.x * k + tx, n.y * k + ty, n.data.type === 'memory' ? .9 : 1.6, 0, Math.PI * 2); mctx.fill(); }
    mctx.globalAlpha = .45; mctx.fillStyle = pal.bg; mctx.beginPath(); mctx.rect(0, 0, mw, mh); mctx.rect(vx * k + tx, vy * k + ty, vw * k, vh * k); mctx.fill('evenodd'); mctx.globalAlpha = 1; mctx.strokeStyle = pal.label; mctx.lineWidth = 1; mctx.strokeRect(Math.round(vx * k + tx) + .5, Math.round(vy * k + ty) + .5, Math.max(4, Math.round(vw * k)), Math.max(4, Math.round(vh * k)));
  }
  mini.addEventListener('pointerdown', ev => { if (!miniT) return; const r = mini.getBoundingClientRect(); const px = (ev.clientX - r.left), py = (ev.clientY - r.top); centerOn((px - miniT.tx) / miniT.k, (py - miniT.ty) / miniT.k, transform.k, 300); });

  // ── Pointer interaction ─────────────────────────────────────────────────
  function toGraph(x, y) { const r = canvas.getBoundingClientRect(); return [(x - r.left - transform.x) / transform.k, (y - r.top - transform.y) / transform.k]; }
  function hitAt(cx, cy) { const [gx, gy] = toGraph(cx, cy); let best = null, bd = Infinity; for (const d of simNodes) { const rr = radiusOf(d) + 4 / transform.k + 2; const dx = d.x - gx, dy = d.y - gy, dd = dx * dx + dy * dy; if (dd < rr * rr && dd < bd) { bd = dd; best = d; } } return best; }
  const hit = ev => hitAt(ev.clientX, ev.clientY);
  const hitTouch = ev => hitAt(ev.touches[0].clientX, ev.touches[0].clientY);
  const tip = document.getElementById('tip');
  function showTip(d, cx, cy) {
    const n = d.data; const r = canvas.getBoundingClientRect(); const x = cx - r.left, y = cy - r.top; const w = 250, h = tip.offsetHeight || 90; const right = x + 18 + w <= W, below = y + 18 + h <= H;
    tip.style.transform = 'translate(' + Math.round(right ? x + 18 : Math.max(8, x - 18 - w)) + 'px,' + Math.round(below ? y + 18 : Math.max(8, y - 18 - h)) + 'px)'; tip.style.transformOrigin = (right ? 'left' : 'right') + ' ' + (below ? 'top' : 'bottom');
    const meta = []; if (n.meta?.memoryClass) meta.push(String(n.meta.memoryClass).toLowerCase()); if (n.status) meta.push(String(n.status).replace(/_/g, ' ').toLowerCase()); if (n.meta?.role) meta.push(n.meta.role); if (typeof n.importance === 'number') meta.push('importance ' + Math.round(n.importance * 100) + '%');
    const comm = COMMS[COMM[n.id]]?.label;
    tip.innerHTML = '<div class="meta">' + glyph(n.type, 10) + '<span class="chip">' + ONE[n.type] + '</span>' + (n.domain ? '<span>' + esc(n.domain) + '</span>' : '') + '<span class="date">' + fmt(Date.parse(n.createdAt)) + '</span></div><div class="title">' + esc(n.label) + '</div><div class="more">' + esc(meta.slice(0, 3).join(' · ')) + (comm ? (meta.length ? ' · ' : '') + 'in <b>' + esc(comm) + '</b>' : '') + '<br>' + degree(n.id) + ' links · click to inspect · double-click to focus</div>';
    tip.dataset.show = 'true';
  }
  canvas.addEventListener('pointermove', ev => { if (ev.pointerType === 'touch') return; const h = hit(ev); const id = h ? h.id : null; if (id !== state.hover) { state.hover = id; canvas.style.cursor = id ? 'pointer' : ''; draw(); } if (h) showTip(h, ev.clientX, ev.clientY); else tip.dataset.show = 'false'; });
  canvas.addEventListener('pointerleave', () => { if (state.hover) { state.hover = null; draw(); } tip.dataset.show = 'false'; });
  let downAt = null, dragNode = null;
  canvas.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY]; const h = hit(ev); if (h && ev.button === 0) { dragNode = h; h.fx = h.x; h.fy = h.y; canvas.setPointerCapture(ev.pointerId); sim.alphaTarget(.3).restart(); } });
  canvas.addEventListener('pointermove', ev => { if (!dragNode) return; const [gx, gy] = toGraph(ev.clientX, ev.clientY); dragNode.fx = gx; dragNode.fy = gy; });
  canvas.addEventListener('pointerup', ev => { if (dragNode) { dragNode.fx = dragNode.fy = null; dragNode = null; sim.alphaTarget(0); try { canvas.releasePointerCapture(ev.pointerId); } catch {} } });
  canvas.addEventListener('click', ev => { if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return; const h = hit(ev); select(h ? (h.id === state.selected ? null : h.id) : null); });
  canvas.addEventListener('dblclick', ev => { const h = hit(ev); if (h) focusOn(h.id); });
  canvas.addEventListener('keydown', ev => { const k = transform.k; const c = { x: (W / 2 - transform.x) / k, y: (H / 2 - transform.y) / k }; const pan = 48 / k; const map = { '+': () => zoomTo(k * 1.25), '=': () => zoomTo(k * 1.25), '-': () => zoomTo(k / 1.25), '0': () => fitAll(), ArrowLeft: () => centerOn(c.x - pan, c.y, k, 160), ArrowRight: () => centerOn(c.x + pan, c.y, k, 160), ArrowUp: () => centerOn(c.x, c.y - pan, k, 160), ArrowDown: () => centerOn(c.x, c.y + pan, k, 160) }; if (map[ev.key]) { ev.preventDefault(); map[ev.key](); } });
  const zoomTo = k => d3.select(canvas).transition().duration(reduced ? 0 : 160).call(zoom.scaleTo, Math.max(.15, Math.min(8, k)));

  // ── Select / focus / inspector ──────────────────────────────────────────
  const inspector = document.getElementById('inspector');
  function select(id) { state.selected = id; renderInspector(); draw(); }
  function focusOn(id) { state.focus = id; state.selected = id; if (!state.local) { state.local = true; syncScope(); } rebuild(false); const d = pos.get(id); if (d) centerOn(d.x, d.y, 2.2); renderInspector(); }
  function renderInspector() {
    const n = state.selected ? byId.get(state.selected) : null; if (!n) { inspector.hidden = true; return; }
    inspector.hidden = false;
    const nbs = E.filter(e => e.source === n.id || e.target === n.id).map(e => ({ e, o: byId.get(e.source === n.id ? e.target : e.source) })).filter(x => x.o).sort((a, b) => a.o.type.localeCompare(b.o.type) || a.o.label.localeCompare(b.o.label));
    const comm = COMMS[COMM[n.id]];
    inspector.innerHTML = '<div class="ins-head"><div><div class="kind">' + glyph(n.type, 10) + ' ' + ONE[n.type] + '</div><h2>' + esc(n.label) + '</h2></div><button class="x" aria-label="Close" id="ins-close">×</button></div><div class="ins-body"><dl>' + (n.status ? '<dt>Status</dt><dd>' + esc(String(n.status)) + '</dd>' : '') + (n.domain ? '<dt>Domain</dt><dd>' + esc(n.domain) + '</dd>' : '') + '<dt>Created</dt><dd>' + fmt(Date.parse(n.createdAt)) + '</dd>' + (comm ? '<dt>Community</dt><dd style="color:' + commColor(COMM[n.id]) + '">' + esc(comm.label) + '</dd>' : '') + '</dl><div class="ins-actions"><button class="btn primary" id="ins-focus">Focus here</button><button class="btn" id="ins-fit">Fit</button></div><h3>Linked · ' + nbs.length + '</h3><ul>' + nbs.map(x => '<li data-id="' + x.o.id + '">' + glyph(x.o.type, 11) + '<span>' + esc(x.o.label) + '</span><span class="via">' + VERB[x.e.type] + '</span></li>').join('') + '</ul></div>';
    inspector.querySelector('#ins-close').onclick = () => select(null);
    inspector.querySelector('#ins-focus').onclick = () => focusOn(n.id);
    inspector.querySelector('#ins-fit').onclick = () => fitAll();
    inspector.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => focusOn(li.dataset.id));
  }

  // ── Controls ────────────────────────────────────────────────────────────
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function glyph(type, size) { const h = size / 2, c = 'var(--e-' + type + ')'; let el; switch (SHAPE[type]) { case 'diamond': el = '<polygon points="' + h + ',0 ' + size + ',' + h + ' ' + h + ',' + size + ' 0,' + h + '" fill="' + c + '"/>'; break; case 'square': el = '<rect x="1" y="1" width="' + (size - 2) + '" height="' + (size - 2) + '" rx="2" fill="' + c + '"/>'; break; case 'triangle': el = '<polygon points="' + h + ',0.5 ' + size + ',' + (size - 1) + ' 0,' + (size - 1) + '" fill="' + c + '"/>'; break; case 'hexagon': el = '<polygon points="' + Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 6; return (h + Math.cos(a) * h) + ',' + (h + Math.sin(a) * h); }).join(' ') + '" fill="' + c + '"/>'; break; case 'ring': el = '<circle cx="' + h + '" cy="' + h + '" r="' + (h - 1.5) + '" fill="none" stroke="' + c + '" stroke-width="2.2"/>'; break; case 'dot': el = '<circle cx="' + h + '" cy="' + h + '" r="' + (h * .5) + '" fill="' + c + '"/>'; break; default: el = '<circle cx="' + h + '" cy="' + h + '" r="' + (h - 1) + '" fill="' + c + '"/>'; } return '<svg class="glyph" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + el + '</svg>'; }
  const chips = document.getElementById('chips');
  function renderChips() { const counts = Object.fromEntries(TYPES.map(t => [t, N.filter(n => n.type === t && (state.domain === 'all' || n.domain === null || n.domain === state.domain)).length])); chips.innerHTML = TYPES.map(t => '<button type="button" data-type="' + t + '" aria-pressed="' + state.types.has(t) + '" title="Toggle ' + LABEL[t].toLowerCase() + '">' + glyph(t, 10) + '<span>' + LABEL[t] + '</span><span class="n">' + counts[t] + '</span></button>').join(''); chips.querySelectorAll('button').forEach(b => b.onclick = () => { const t = b.dataset.type; if (state.types.has(t)) { if (state.types.size > 1) state.types.delete(t); } else state.types.add(t); rebuild(); }); }
  function status() { document.getElementById('status').innerHTML = '<b>' + vis.nodes.length + '</b> of ' + N.length + ' nodes · ' + vis.edges.length + ' links · ' + COMMS.length + ' communities' + (state.local && state.focus && byId.get(state.focus) ? ' · local ' + state.depth + '° around <b>' + esc(byId.get(state.focus).label) + '</b>' : ''); }
  const domainSel = document.getElementById('domain'); [...new Set(N.map(n => n.domain).filter(Boolean))].sort().forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; domainSel.appendChild(o); }); domainSel.onchange = () => { state.domain = domainSel.value; rebuild(true); };
  const localBtn = document.getElementById('local'), globalBtn = document.getElementById('global'), depthIn = document.getElementById('depth'), depthOut = document.getElementById('depthOut');
  function syncScope() { localBtn.setAttribute('aria-pressed', String(state.local)); globalBtn.setAttribute('aria-pressed', String(!state.local)); depthIn.disabled = !state.local; depthOut.value = state.local ? state.depth + '°' : '—'; }
  localBtn.onclick = () => { state.local = true; syncScope(); rebuild(true); }; globalBtn.onclick = () => { state.local = false; syncScope(); rebuild(true); };
  depthIn.oninput = () => { state.depth = +depthIn.value; syncScope(); rebuild(true); };
  const toggle = (id, key) => { const b = document.getElementById(id); b.onclick = () => { state[key] = !state[key]; b.setAttribute('aria-pressed', String(state[key])); draw(); }; };
  toggle('labels', 'labels'); toggle('hulls', 'hulls');
  document.getElementById('fit').onclick = () => fitAll();
  // search
  const q = document.getElementById('q'), results = document.getElementById('results'); let active = 0, found = [];
  function search() { const s = q.value.trim().toLowerCase(); found = s ? N.map(n => ({ n, i: n.label.toLowerCase().indexOf(s) })).filter(x => x.i >= 0).sort((a, b) => (a.i === 0 ? 0 : 1) - (b.i === 0 ? 0 : 1) || (a.n.type === 'memory') - (b.n.type === 'memory')).slice(0, 8).map(x => x.n) : []; active = 0; results.hidden = found.length === 0; q.setAttribute('aria-expanded', String(found.length > 0)); results.innerHTML = found.map((n, i) => '<li role="option" aria-selected="' + (i === active) + '" data-id="' + n.id + '">' + glyph(n.type, 11) + '<span>' + esc(n.label) + '</span><span class="t">' + ONE[n.type] + '</span></li>').join(''); results.querySelectorAll('li').forEach(li => { li.onmousedown = ev => { ev.preventDefault(); pick(li.dataset.id); }; }); }
  function pick(id) { q.value = ''; results.hidden = true; focusOn(id); }
  q.addEventListener('input', search); q.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 120));
  q.addEventListener('keydown', ev => { if (ev.key === 'ArrowDown') { active = Math.min(active + 1, found.length - 1); search(); ev.preventDefault(); } else if (ev.key === 'ArrowUp') { active = Math.max(active - 1, 0); ev.preventDefault(); } else if (ev.key === 'Enter' && found[active]) { pick(found[active].id); } else if (ev.key === 'Escape') { q.value = ''; results.hidden = true; q.blur(); } });
  window.addEventListener('keydown', ev => { const tag = ev.target.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; if (ev.key === '/') { ev.preventDefault(); q.focus(); } else if (ev.key === 'Escape') select(null); });

  // ── Go ──────────────────────────────────────────────────────────────────
  syncTheme(); syncScope(); resize(); rebuild(true);
})();
</script>
</body>
</html>`;

writeFileSync(out, html.replace('__DATA__', JSON.stringify(data)));
console.log(`wrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB + data, ${graph.nodes.length} nodes / ${graph.edges.length} edges / ${communities.length} communities)`);
