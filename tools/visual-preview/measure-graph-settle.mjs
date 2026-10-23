#!/usr/bin/env node
// RD-6 — how long the knowledge graph takes to settle as the memory layer grows.
//
//   pnpm --filter @boardroom/shared build && pnpm --filter @boardroom/boardroom-ai build
//   node tools/visual-preview/measure-graph-settle.mjs --memories 500 [--steps 2] [--runs 3] [--out dir] [--shots]
//
// Serves client/dist against the mock API with a synthetic vault of `--memories`
// memories (fixtures/graph-data.mjs, seeded — never real data), opens /graph in
// the GLOBAL view (depth 0, so every loaded memory is on the canvas), then:
//   - cold:  navigation → first `data-settled="true"` on the graph view (200 memories)
//   - step:  "Show 200 more" click → the view settles again with the bigger layer
// "Settled" is the view's own flag: set in onEngineStop, cleared on every
// relayout. Prints one JSON line per run plus a summary; exits 1 when the
// largest step exceeds --budget ms (default 5000).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }
const MEMORIES = Number(arg('--memories', '500'));
const RUNS = Number(arg('--runs', '3'));
const BUDGET = Number(arg('--budget', '5000'));
const OUT = arg('--out', null);
const SHOTS = process.argv.includes('--shots');
const VIEWPORT = { width: Number(arg('--width', '1440')), height: Number(arg('--height', '900')) };
const STEPS = Number(arg('--steps', String(Math.max(0, Math.ceil(Math.min(MEMORIES, 1000) / 200) - 1))));

// Fixtures read the size at import time, so set it before the mock API loads them.
process.env.VISUAL_PREVIEW_MEMORIES = String(MEMORIES);
const { startServer, loadPlaywright, launchChromium } = await import('./shoot.mjs');

const SETTLED = '[data-testid="knowledge-graph-view"][data-settled="true"]';
const GLOBAL_FILTERS = JSON.stringify({
  types: ['goal', 'project', 'task', 'person', 'decision', 'commitment', 'memory'],
  edgeTypes: ['goal_hierarchy', 'goal_project', 'project_task', 'project_person', 'decision_project', 'task_dependency', 'commitment_person', 'commitment_project', 'commitment_entity', 'memory_entity'],
  domain: 'all', showOrphans: false, showLabels: true, depth: 0,
});

const { server, baseUrl } = await startServer();
const pw = loadPlaywright();
const browser = await launchChromium(pw);
const runs = [];
try {
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark', deviceScaleFactor: 1 });
    await context.addInitScript((f) => { sessionStorage.setItem('boardroom.graph.filters.v2', f); localStorage.setItem('theme', 'dark'); }, GLOBAL_FILTERS);
    const page = await context.newPage();
    const t0 = Date.now();
    await page.goto(`${baseUrl}/graph`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(SETTLED, { timeout: 60000 });
    const result = { run: run + 1, memories: MEMORIES, cold: { ms: Date.now() - t0 }, steps: [] };
    result.cold.nodes = await page.evaluate(() => document.querySelector('[data-testid="graph-summary"]')?.textContent ?? '');
    for (let s = 0; s < STEPS; s++) {
      const btn = await page.$('[data-testid="graph-show-more"]');
      if (!btn) break;
      const startedAt = await page.evaluate(() => { window.__t0 = performance.now(); return window.__t0; });
      const settle = page.evaluate((t) => new Promise((resolve) => {
        // the view clears its settled flag on relayout and sets it again in onEngineStop
        let cleared = false;
        const tick = () => {
          const v = document.querySelector('[data-testid="knowledge-graph-view"]');
          const settled = v?.getAttribute('data-settled') === 'true';
          if (!settled) cleared = true;
          if (cleared && settled) { resolve(performance.now() - t); return; }
          requestAnimationFrame(tick);
        };
        tick();
      }), startedAt);
      await btn.click();
      const ms = await Promise.race([settle, new Promise((r) => setTimeout(() => r(Infinity), 60000))]);
      const summary = await page.evaluate(() => document.querySelector('[data-testid="graph-summary"]')?.textContent ?? '');
      result.steps.push({ ms: Math.round(ms), summary });
    }
    if (SHOTS && OUT) { mkdirSync(OUT, { recursive: true }); await page.waitForTimeout(800); /* the post-settle fit animates 500 ms */ await page.screenshot({ path: join(OUT, `settle-${MEMORIES}-run${run + 1}.png`) }); }
    console.log(JSON.stringify(result));
    runs.push(result);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const last = runs.map((r) => r.steps.at(-1)?.ms ?? r.cold.ms).sort((a, b) => a - b);
const median = last[Math.floor(last.length / 2)];
const summary = { memories: MEMORIES, runs: runs.length, coldMs: runs.map((r) => r.cold.ms), finalStepMs: last, medianFinalStepMs: median, budgetMs: BUDGET, pass: median <= BUDGET };
console.log(`\nsummary ${JSON.stringify(summary)}`);
if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `settle-${MEMORIES}.json`), JSON.stringify({ summary, runs }, null, 2)); }
if (!summary.pass) process.exitCode = 1;
