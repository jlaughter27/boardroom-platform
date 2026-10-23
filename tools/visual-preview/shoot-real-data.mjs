#!/usr/bin/env node
// Real-data lane visual harness (Phase 8 RD-6 / RD-9): the graph with a vault
// bigger than its first page ("Showing 200 of N — Show more"), the decision
// session reloaded with rebuttals, the mobile error cards, the settings
// snippets at 390 px and the profile-unavailable banner — light + dark,
// desktop (1440×900) + phone (390×844).
//
//   pnpm --filter @boardroom/shared build && pnpm --filter @boardroom/boardroom-ai build
//   node tools/visual-preview/shoot-real-data.mjs --round rd6-round-1 [--only graph-cap,...] [--theme dark] [--out dir]
//
// Synthetic data only: the graph is fixtures/graph-data.mjs grown to
// VISUAL_PREVIEW_MEMORIES (default here 640) — never a real vault.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VISUAL_PREVIEW_MEMORIES ??= '640';
const { shootPages, startServer } = await import('./shoot.mjs');
const { pagesMock, PAGES_OUT } = await import('./shoot-pages.mjs');

const GLOBAL_FILTERS = JSON.stringify({
  types: ['goal', 'project', 'task', 'person', 'decision', 'commitment', 'memory'],
  edgeTypes: ['goal_hierarchy', 'goal_project', 'project_task', 'project_person', 'decision_project', 'task_dependency', 'commitment_person', 'commitment_project', 'commitment_entity', 'memory_entity'],
  domain: 'all', showOrphans: false, showLabels: true, depth: 0,
});
const graphStorage = { session: { 'boardroom.graph.filters.v2': GLOBAL_FILTERS } };
const settledGraph = [{ wait: '[data-testid="knowledge-graph-view"]' }, { settle: true, timeout: 20000 }, { sleep: 800 }];
const capSays = (text) => ({ assert: `document.querySelector('[data-testid="graph-memory-cap"]')?.textContent.includes(${JSON.stringify(text)})`, message: `memory cap does not say "${text}"` });

/** Wait for the view to relayout (flag cleared) and settle again after a click. */
const showMore = [
  { evaluate: 'window.__settledBefore = document.querySelector("[data-testid=knowledge-graph-view]").getAttribute("data-settled")' },
  { click: '[data-testid="graph-show-more"]' },
  { waitGone: '[data-testid="knowledge-graph-view"][data-settled="true"]', timeout: 10000 },
  { settle: true, timeout: 20000 },
  { sleep: 800 },
];

// Long MCP URL token reveal (fixtures/pages.mjs) — the snippet <pre> must stack over its Copy button at 390 px.
const TOKEN_PANEL = '[data-testid="connected-tools-panel"]';
const tokenCreated = [
  { wait: `${TOKEN_PANEL} button:has-text("New token"):not([disabled])` },
  { click: `${TOKEN_PANEL} button:has-text("New token")` },
  { wait: '[data-testid="mcp-token-form"]' },
  { click: '[data-testid="mcp-token-form"] button[type="submit"]' },
  { wait: '[data-testid="mcp-snippet"]' },
  { evaluate: 'document.querySelector("[data-testid=mcp-snippet]").scrollIntoView({ block: "start" })' },
  { sleep: 400 },
  { noOverflowX: ['#main-content'] },
];
const SNIPPET_STACKED = `[...document.querySelectorAll('[data-testid="mcp-snippet"] pre')].every((pre) => {
  const row = pre.closest('[data-copy-row]'); const btn = row && row.querySelector('button[aria-label^="Copy"]');
  if (!btn) return false;
  const p = pre.getBoundingClientRect(); const b = btn.getBoundingClientRect();
  return b.top >= p.bottom - 1 && p.width >= row.getBoundingClientRect().width - 2;
})`;

// Decision session reloaded (GET /sessions/s-visual carries rebuttals): the Critic's card shows "Defended" + the rebuttal block.
const reloadedWithRebuttals = [
  { wait: '[data-testid="persona-card"][data-state="complete"]' },
  { wait: '[data-testid="rebuttal-block"]' },
  { sleep: 500 },
  { evaluate: 'document.querySelector("[data-testid=rebuttal-block]").scrollIntoView({ block: "center" })' },
  { sleep: 300 },
];
const afterError = [
  { wait: '[data-testid="session-review"]' }, { click: '[data-testid="session-review"] button:has-text("Analyze")' },
  { wait: '[data-testid="persona-card"][data-state="error"]' }, { wait: '[data-testid="session-footer"] button:has-text("Synthesize without Critic")', timeout: 20000 },
  { sleep: 400 },
  { evaluate: 'document.querySelector("[data-testid=persona-card][data-state=error]").scrollIntoView({ block: "center" })' }, { sleep: 300 },
];
const profileUnavailable = [
  { wait: '[data-testid="profile-unavailable-banner"]' }, { wait: '[data-testid="cockpit-row"]' }, { sleep: 600 },
  // Centred on the main pane, not the viewport; below the scroll pane (never over its last row).
  { assert: `(() => { const b = document.querySelector('[data-testid="profile-unavailable-banner"]').getBoundingClientRect(); const m = document.querySelector('#main-content').getBoundingClientRect(); return Math.abs((b.left + b.right) / 2 - (m.left + m.right) / 2) <= 2 && b.top >= m.bottom - 1; })()`, message: 'banner is not centred under the main pane' },
  { scroll: { selector: '#main-content', top: 100000 } }, { sleep: 400 },
];

export function realDataPages() {
  const desktop = [
    { name: 'graph-cap', path: '/graph', storage: graphStorage, actions: [...settledGraph, capSays('Showing 200 of')] },
    { name: 'graph-cap-more', path: '/graph', storage: graphStorage, actions: [...settledGraph, ...showMore, capSays('Showing 400 of')] },
    { name: 'decision-session-reloaded', path: '/decisions/s-visual', actions: reloadedWithRebuttals },
    { name: 'settings-snippet', path: '/settings?state=token-created-long-url', actions: tokenCreated },
    { name: 'profile-unavailable', path: '/?state=profile-unavailable', actions: profileUnavailable },
  ];
  const mobile = [
    { name: 'graph-cap-mobile', path: '/graph', storage: graphStorage, actions: [...settledGraph, capSays('Showing 200 of')] },
    { name: 'graph-cap-more-mobile', path: '/graph', storage: graphStorage, actions: [...settledGraph, ...showMore, capSays('Showing 400 of')] },
    { name: 'decision-session-reloaded-mobile', path: '/decisions/s-visual', actions: reloadedWithRebuttals },
    { name: 'decision-session-error-mobile', path: '/decisions/s-stream-error', actions: afterError },
    { name: 'settings-snippet-mobile', path: '/settings?state=token-created-long-url', actions: [...tokenCreated, { assert: SNIPPET_STACKED, message: 'a snippet <pre> is not stacked over its Copy button at 390 px' }] },
    { name: 'profile-unavailable-mobile', path: '/?state=profile-unavailable', actions: profileUnavailable },
  ];
  return { desktop, mobile };
}

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outDir = join(arg('--out', PAGES_OUT), arg('--round', 'rd6-round-1'));
  const only = arg('--only', null)?.split(',');
  const theme = arg('--theme', null);
  const mock = await pagesMock();
  const { server, baseUrl } = await startServer({ mock });
  const base = { baseUrl, onlyNames: only ?? undefined, themes: theme ? [theme] : undefined };
  const { desktop, mobile } = realDataPages();
  const results = [];
  try {
    results.push(...await shootPages(desktop, outDir, { ...base, viewport: { width: 1440, height: 900 } }));
    results.push(...await shootPages(mobile, outDir, { ...base, viewport: { width: 390, height: 844 } }));
  } finally { server.close(); }
  const failed = results.filter((r) => r.error);
  console.log(`\n${results.length - failed.length}/${results.length} shots saved under ${outDir}`);
  for (const r of results) if (r.errors?.length) console.log(`  ${r.name} [${r.theme}] console errors: ${r.errors.join(' | ').slice(0, 300)}`);
  if (failed.length) process.exitCode = 1;
}
