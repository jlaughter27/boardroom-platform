#!/usr/bin/env node
// Visual harness: serve the built BoardRoom client against the mock API, open
// pages in headless Chromium in both themes, and save PNGs (+ frame-time
// numbers) per round so visual changes can be compared side by side.
//
//   pnpm --filter @boardroom/boardroom-ai visual:preview -- --round round-1
//   node tools/visual-preview/shoot.mjs --round round-1 --out /path/to/visual
//   node tools/visual-preview/shoot.mjs --pages my-pages.json --only graph-global --theme dark
//
// Another script can reuse the pieces without editing this file:
//
//   import { shootPages, DEFAULT_PAGES } from '../../tools/visual-preview/shoot.mjs';
//   await shootPages([...DEFAULT_PAGES, myPage], outDir);
//
// A page is plain data: `{ name, path, storage?, actions?, measure?, themes? }`
// where `actions` is a list of steps run before the screenshot:
//   { wait: selector } · { waitGone: selector } · { click: selector } · { type: { selector, text } }
//   { press: key } · { sleep: ms } · { settle: true } (force layout at rest) · { evaluate: 'js source' }
//
// Chromium + Playwright are expected to be preinstalled (PLAYWRIGHT_BROWSERS_PATH);
// the script never installs browsers.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockApi } from './mock-api.mjs';
import { measureTextContrast } from './contrast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const CLIENT_DIST = join(REPO_ROOT, 'packages', 'boardroom-ai', 'client', 'dist');
export const DEFAULT_OUT = join(here, 'out');

const SCRATCH_FILTERS = (depth) => JSON.stringify({
  types: ['goal', 'project', 'task', 'person', 'decision', 'commitment', 'memory'],
  edgeTypes: ['goal_hierarchy', 'goal_project', 'project_task', 'project_person', 'decision_project', 'task_dependency', 'commitment_person', 'commitment_project', 'commitment_entity', 'memory_entity'],
  domain: 'all', showOrphans: false, showLabels: true, depth,
});

/** The founder's five views, in both themes. */
export const DEFAULT_PAGES = [
  {
    name: 'graph-global',
    path: '/graph',
    storage: { session: { 'boardroom.graph.filters.v2': SCRATCH_FILTERS(0) } },
    actions: [{ wait: '[data-testid="knowledge-graph-view"]' }, { settle: true }],
    measure: true,
  },
  {
    name: 'graph-local',
    path: '/graph?focus=project:p-product-2',
    storage: { session: { 'boardroom.graph.filters.v2': SCRATCH_FILTERS(2) } },
    actions: [{ wait: '[data-testid="knowledge-graph-view"]' }, { settle: true }, { sleep: 600 }],
  },
  {
    name: 'graph-spotlight',
    path: '/graph',
    storage: { session: { 'boardroom.graph.filters.v2': SCRATCH_FILTERS(0) } },
    actions: [
      { wait: '[data-testid="knowledge-graph-view"]' }, { settle: true },
      { press: '/' }, { wait: 'input[placeholder^="Search memory"]' },
      { type: { selector: 'input[placeholder^="Search memory"]', text: 'founders churn first session' } },
      { wait: '[data-testid="memory-hit"]' }, { sleep: 300 }, { press: 'Control+k' }, { sleep: 1400 },
    ],
  },
  {
    name: 'graph-timeline',
    path: '/graph',
    storage: { session: { 'boardroom.graph.filters.v2': SCRATCH_FILTERS(0) } },
    actions: [
      { wait: '[data-testid="knowledge-graph-view"]' }, { settle: true },
      { click: '[aria-label="Play timeline"]' }, { sleep: 2600 }, { click: '[aria-label="Pause timeline"]' }, { sleep: 300 },
    ],
  },
  {
    name: 'memory-explorer',
    path: '/memory',
    actions: [
      { wait: '[aria-label="Search memories"]' },
      { type: { selector: '[aria-label="Search memories"]', text: 'founders churn session' } },
      { wait: '[data-testid="memory-score"]' }, { sleep: 500 },
    ],
  },
];

// ── Playwright resolution (repo first, then the preinstalled global copy) ────
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core'];
  const paths = [REPO_ROOT, '/opt/node-tools/node_modules', ...(process.env.PLAYWRIGHT_MODULE_PATH ? [process.env.PLAYWRIGHT_MODULE_PATH] : [])];
  for (const name of candidates) {
    try { return require(require.resolve(name, { paths })); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_MODULE_PATH to a directory containing node_modules/playwright(-core).');
}

export async function launchChromium(pw) {
  try { return await pw.chromium.launch({ headless: true }); }
  catch (e) {
    const fallback = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    if (!existsSync(fallback)) throw e;
    return pw.chromium.launch({ headless: true, executablePath: fallback });
  }
}

// ── Static server: dist + SPA fallback + /api → mock ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

export async function startServer({ dist = CLIENT_DIST, port = 0, mock } = {}) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`No client build at ${dist} — run \`vite build --config client/vite.config.ts\` in packages/boardroom-ai first.`);
  const api = mock ?? await createMockApi();
  const index = readFileSync(join(dist, 'index.html'));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const hit = await api.handle(req, res);
      if (!hit) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: `No mock route for ${req.method} ${url.pathname}` })); }
      return;
    }
    const file = join(dist, decodeURIComponent(url.pathname));
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(index);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, api, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

// ── Steps ────────────────────────────────────────────────────────────────────
const SETTLED = '[data-testid="knowledge-graph-view"][data-settled="true"]';

async function runAction(page, step, log) {
  if (step.wait) return page.waitForSelector(step.wait, { timeout: step.timeout ?? 15000 });
  if (step.waitGone) return page.waitForSelector(step.waitGone, { state: 'detached', timeout: step.timeout ?? 15000 });
  if (step.click) {
    // `optional: true` skips a control that an older build does not have (round-0 "before" shots).
    if (step.optional && !(await page.$(step.click))) { log(`  (optional click skipped — ${step.click} not present)`); return undefined; }
    return page.click(step.click, { timeout: step.timeout ?? 10000 });
  }
  if (step.type) { await page.click(step.type.selector); return page.type(step.type.selector, step.type.text, { delay: 15 }); }
  if (step.press) return page.keyboard.press(step.press);
  if (step.sleep) return page.waitForTimeout(step.sleep);
  if (step.evaluate) return page.evaluate(step.evaluate);
  // { scroll: { selector, top } } — scroll a container (the page's `main`) without a wheel gesture.
  if (step.scroll) return page.$eval(step.scroll.selector, (el, top) => { el.scrollTo({ top, behavior: 'instant' }); }, step.scroll.top ?? 0);
  // { style: 'css' } — inject a stylesheet (e.g. slow a View Transition down so a frame can be captured mid-way).
  if (step.style) return page.addStyleTag({ content: step.style });
  // { hoverCanvas: { selector, until } } — sweep the real pointer over a canvas until `until` appears (a node hover card).
  if (step.hoverCanvas) {
    const box = await page.$eval(step.hoverCanvas.selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const points = [];
    for (const fy of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) for (const fx of [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8]) points.push([fx, fy]);
    for (const [fx, fy] of points) {
      await page.mouse.move(box.x + box.w * fx, box.y + box.h * fy, { steps: 3 });
      await page.waitForTimeout(70);
      if (await page.$(step.hoverCanvas.until)) return undefined;
    }
    log(`  (no ${step.hoverCanvas.until} after ${points.length} hover points)`);
    return undefined;
  }
  // { assert: 'js expression', message } — fail the shot when the expression is falsy (the DOM / CSS wiring checks).
  if (step.assert) {
    const ok = await page.evaluate(step.assert);
    if (!ok) throw new Error(`assert failed: ${step.message ?? step.assert}`);
    return undefined;
  }
  if (step.settle) {
    // Prefer the view's own settled flag; fall back to a fixed wait for builds that do not expose it.
    try { await page.waitForSelector(SETTLED, { timeout: step.timeout ?? 9000 }); await page.waitForTimeout(250); }
    catch { log('  (no data-settled flag — waiting 4 s)'); await page.waitForTimeout(4000); }
    return undefined;
  }
  throw new Error(`Unknown step ${JSON.stringify(step)}`);
}

/** Frame-time sample: rAF deltas over `ms` while the canvas is nudged (pan + zoom wheel events). */
async function measureFrames(page, ms = 2500) {
  return page.evaluate(async (duration) => {
    const canvas = document.querySelector('[data-testid="knowledge-graph-view"] canvas');
    const deltas = [];
    let last = performance.now();
    let running = true;
    const tick = (t) => { deltas.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const start = performance.now();
    let i = 0;
    while (performance.now() - start < duration) {
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        const ev = new WheelEvent('wheel', { clientX: r.left + r.width / 2 + (i % 7) * 20, clientY: r.top + r.height / 2, deltaY: i % 10 < 5 ? -40 : 40, bubbles: true, cancelable: true });
        canvas.dispatchEvent(ev);
      }
      i += 1;
      await new Promise((r) => setTimeout(r, 90));
    }
    running = false;
    const sorted = [...deltas].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
    return { frames: deltas.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +(sorted[sorted.length - 1] ?? 0).toFixed(2), fps: +(1000 / avg).toFixed(1) };
  }, ms);
}

// ── The reusable entry point ─────────────────────────────────────────────────
/**
 * Shoot `pages` into `outDir` as `<name>-<theme>.png`. Options: `themes`
 * (default both), `baseUrl` (skip the built-in server and shoot a running app),
 * `viewport`, `log`, `mock` (a prepared mock api), `onlyNames`.
 * Returns `[{ name, theme, file, perf? }]`.
 */
export async function shootPages(pages, outDir = DEFAULT_OUT, options = {}) {
  const log = options.log ?? ((m) => console.log(m));
  const themes = options.themes ?? ['light', 'dark'];
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  mkdirSync(outDir, { recursive: true });
  const pw = loadPlaywright();
  const own = options.baseUrl ? null : await startServer({ mock: options.mock });
  const baseUrl = options.baseUrl ?? own.baseUrl;
  const browser = await launchChromium(pw);
  const results = [];
  try {
    for (const spec of pages) {
      if (options.onlyNames && !options.onlyNames.includes(spec.name)) continue;
      for (const theme of spec.themes ?? themes) {
        // `reducedMotion` emulates prefers-reduced-motion; `initScript` runs before the app
        // (the harness uses it to toggle the `.reduce-transparency` class and to record
        // View Transition types); `suffix` keeps variant shots apart on disk.
        const context = await browser.newContext({ viewport, colorScheme: theme, reducedMotion: options.reducedMotion ?? 'no-preference', deviceScaleFactor: 1, ignoreHTTPSErrors: true });
        const storage = { local: { theme, ...(spec.storage?.local ?? {}) }, session: spec.storage?.session ?? {} };
        await context.addInitScript((s) => {
          for (const [k, v] of Object.entries(s.local)) localStorage.setItem(k, v);
          for (const [k, v] of Object.entries(s.session)) sessionStorage.setItem(k, v);
        }, storage);
        if (options.initScript) await context.addInitScript(options.initScript);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        const shotName = `${spec.name}${options.suffix ?? ''}`;
        const file = join(outDir, `${shotName}-${theme}.png`);
        log(`▸ ${shotName} [${theme}]`);
        try {
          await page.goto(baseUrl + spec.path, { waitUntil: 'networkidle', timeout: 30000 });
          for (const step of spec.actions ?? []) await runAction(page, step, log);
          await page.screenshot({ path: file, fullPage: false });
          const result = { name: shotName, theme, file };
          // Contrast-on-glass: `spec.contrast = [{ selector, label }]`, measured on the live page after the shot.
          if (spec.contrast?.length) {
            result.contrast = [];
            for (const target of spec.contrast) {
              const row = await measureTextContrast(page, target.selector, target.label ?? target.selector);
              result.contrast.push(row);
              log(`  contrast ${row.label}: ${row.error ? `skipped (${row.error})` : `${row.ratio}:1 ${row.pass ? '✓' : '✗ below 4.5'}`}`);
            }
          }
          if (spec.measure) {
            result.perf = await measureFrames(page, options.measureMs ?? 2500);
            writeFileSync(join(outDir, `${spec.name}-${theme}.perf.json`), JSON.stringify(result.perf, null, 2));
            log(`  frames: p50 ${result.perf.p50} ms · p95 ${result.perf.p95} ms · ${result.perf.fps} fps (${result.perf.frames} frames)`);
          }
          if (errors.length) { result.errors = errors.slice(0, 5); log(`  console errors: ${errors.length} (first: ${errors[0].slice(0, 160)})`); }
          results.push(result);
          log(`  → ${file}`);
        } catch (e) {
          log(`  ✗ ${spec.name} [${theme}]: ${e.message.split('\n')[0]}`);
          try { await page.screenshot({ path: file.replace(/\.png$/, '.failed.png') }); } catch { /* ignore */ }
          results.push({ name: spec.name, theme, file: null, error: e.message });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    if (own) own.server.close();
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ shotAt: new Date().toISOString(), results }, null, 2));
  return results;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const round = arg('--round', 'round-0');
  const outRoot = arg('--out', process.env.VISUAL_PREVIEW_OUT ?? DEFAULT_OUT);
  const outDir = join(outRoot, round);
  const pagesFile = arg('--pages', null);
  const pages = pagesFile ? JSON.parse(readFileSync(resolve(pagesFile), 'utf8')) : DEFAULT_PAGES;
  const only = arg('--only', null)?.split(',');
  const theme = arg('--theme', null);
  const baseUrl = arg('--base', null);
  const results = await shootPages(pages, outDir, { onlyNames: only ?? undefined, themes: theme ? [theme] : undefined, baseUrl: baseUrl ?? undefined });
  const failed = results.filter((r) => r.error);
  console.log(`\n${results.length - failed.length}/${results.length} shots saved under ${outDir}`);
  if (failed.length) process.exitCode = 1;
}
