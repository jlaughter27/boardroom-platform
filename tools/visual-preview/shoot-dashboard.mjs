#!/usr/bin/env node
// Dashboard visual harness (viz lane): the dashboard cockpit and the Decision
// Lab calibration view, light + dark, desktop (1440×900) + mobile (390×844).
//
//   node tools/visual-preview/shoot-dashboard.mjs --round round-1
//   node tools/visual-preview/shoot-dashboard.mjs --round round-0 --dist packages/boardroom-ai/client-before/dist
//   node tools/visual-preview/shoot-dashboard.mjs --out /some/dir --only dashboard
//
// Reuses shoot.mjs (`shootPages`, `startServer`) and mock-api.mjs unchanged.
// The dashboard fixture is mounted FIRST so its routes win over the shell
// defaults in auth.mjs (which answers `/usage/llm/summary` etc. with empties).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shootPages, startServer, CLIENT_DIST } from './shoot.mjs';
import { createMockApi, loadRoutes } from './mock-api.mjs';
import dashboardFixture from './fixtures/dashboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DASHBOARD_OUT = '/tmp/claude-0/-home-user-boardroom-platform/504cfb7a-9286-5499-939f-f39cadb31197/scratchpad/visual-dashboard';

const settle = [{ sleep: 700 }];
const waitDashboard = [
  { wait: '[data-testid="cockpit-row"]' },
  { wait: '[data-testid="memory-pulse-heatmap"]', timeout: 20000 },
  { wait: '[data-testid="whats-moving-chart"]' },
  { wait: '[data-testid="llm-cost-widget"]' },
];
/** Before the viz lane the dashboard had none of those hooks — wait on the greeting instead. */
const waitLegacyDashboard = [{ wait: 'h1' }, { sleep: 1500 }];

const FOCUS_BUBBLE = `(() => { const g = document.querySelector('g[data-series="user"][data-bin="0.6"]'); if (g) g.focus(); })()`;

export function dashboardPages({ legacy = false } = {}) {
  const dash = legacy ? waitLegacyDashboard : waitDashboard;
  return {
    desktop: [
      { name: 'dashboard', path: '/', actions: [...dash, ...settle] },
      { name: 'decision-lab', path: '/decisions', actions: [{ wait: '[data-testid="calibration-panel"], [data-testid="calibration-gate"]' }, { evaluate: FOCUS_BUBBLE }, ...settle] },
    ],
    tall: [
      { name: 'dashboard-tall', path: '/', actions: [...dash, ...settle] },
    ],
    mobile: [
      { name: 'dashboard-mobile', path: '/', actions: [...dash, ...settle] },
      { name: 'decision-lab-mobile', path: '/decisions', actions: [{ wait: '[data-testid="calibration-panel"], [data-testid="calibration-gate"]' }, ...settle] },
    ],
  };
}

/** Dashboard routes first, then every other fixture (minus a duplicate load of this one). */
export async function dashboardMock() {
  const others = (await loadRoutes()).filter((r) => r.file !== 'dashboard.mjs');
  const mine = dashboardFixture.routes.map((r) => ({ ...r, file: 'dashboard.mjs' }));
  return createMockApi({ routes: [...mine, ...others] });
}

export async function shootDashboard({ round = 'round-1', outRoot = DASHBOARD_OUT, dist = CLIENT_DIST, only, themes, legacy = false, log = console.log } = {}) {
  const outDir = join(outRoot, round);
  mkdirSync(outDir, { recursive: true });
  const mock = await dashboardMock();
  const { server, baseUrl } = await startServer({ dist, mock });
  const pages = dashboardPages({ legacy });
  const opts = { baseUrl, themes, onlyNames: only, log };
  const results = [];
  try {
    results.push(...await shootPages(pages.desktop, outDir, { ...opts, viewport: { width: 1440, height: 900 } }));
    results.push(...await shootPages(pages.tall, outDir, { ...opts, viewport: { width: 1440, height: 2000 } }));
    results.push(...await shootPages(pages.mobile, outDir, { ...opts, viewport: { width: 390, height: 844 } }));
  } finally {
    server.close();
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ shotAt: new Date().toISOString(), round, dist, results }, null, 2));
  return { outDir, results };
}

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const round = arg('--round', 'round-1');
  const distArg = arg('--dist', null);
  const dist = distArg ? resolve(distArg) : CLIENT_DIST;
  if (!existsSync(join(dist, 'index.html'))) { console.error(`No build at ${dist}`); process.exit(1); }
  const only = arg('--only', null)?.split(',');
  const theme = arg('--theme', null);
  const legacy = process.argv.includes('--legacy');
  const { outDir, results } = await shootDashboard({ round, outRoot: arg('--out', DASHBOARD_OUT), dist, only, themes: theme ? [theme] : undefined, legacy });
  const failed = results.filter((r) => r.error);
  console.log(`\n${results.length - failed.length}/${results.length} shots saved under ${outDir}`);
  for (const r of results) if (r.errors?.length) console.log(`  ${r.name} [${r.theme}] console errors: ${r.errors.join(' | ').slice(0, 300)}`);
  if (failed.length) process.exitCode = 1;
  void readFileSync; void here;
}
