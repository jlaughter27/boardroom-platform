// Contrast-on-glass check for the visual harness (UI-FOUNDATION §3, Phase D).
//
// For a text element, read its computed colour, screenshot the tight box
// around its glyphs, and compare the text colour against the *composited*
// background pixels behind it — whatever the material blurred, saturated and
// tinted from the page underneath. The worst 5 % of background pixels (the
// ones closest to the text in luminance) decide the ratio, so a legend chip
// over a busy hull or a header over scrolled content is judged at its weakest
// spot, not its average. Pass = WCAG AA, 4.5:1.
//
// No image dependency: the PNG decoder below handles what Chromium emits
// (8-bit RGB / RGBA, non-interlaced).

import { inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WCAG_AA = 4.5;

// ── PNG ───────────────────────────────────────────────────────────────────────
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decode an 8-bit RGB/RGBA non-interlaced PNG into `{ width, height, data }` (RGBA). */
export function decodePng(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('not a PNG');
  let off = 8;
  let width = 0; let height = 0; let colorType = 0; let bitDepth = 0; let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, color type ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = new Uint8Array(raw.subarray(p, p + stride)); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4; const j = x * bpp;
      out[i] = line[j]; out[i + 1] = line[j + 1]; out[i + 2] = line[j + 2]; out[i + 3] = bpp === 4 ? line[j + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

// ── Colour maths (WCAG 2.x) ──────────────────────────────────────────────────
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrastRatio = (l1, l2) => { const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` / `color(srgb r g b / a)` → [r, g, b, a]. */
export function parseCssColor(str) {
  let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(str);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(str);
  if (m) return [Math.round(+m[1] * 255), Math.round(+m[2] * 255), Math.round(+m[3] * 255), m[4] === undefined ? 1 : +m[4]];
  throw new Error(`cannot parse colour ${str}`);
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];

/**
 * Contrast of a text colour against the background pixels in a frame around
 * the glyph box. The frame (`pad` px outside the tight text rect, which the
 * caller screenshots with that padding) holds no ink from the text itself, so
 * every pixel in it is pure composited background — what the material shows
 * through, gradients included — without the grey anti-aliasing band a glyph
 * edge would add. Pixels within `near` of the text colour are dropped anyway
 * (a neighbouring glyph of the same colour, e.g. an icon). The worst 5 % of
 * the frame (closest to the text in luminance) decides `ratio`; `ratioMedian`
 * is the typical case.
 */
export function contrastFromPixels(png, textRgb, { pad = 3, near = 48 } = {}) {
  const frame = [];
  let inkPixels = 0;
  const { width, height, data } = png;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inFrame = x < pad || y < pad || x >= width - pad || y >= height - pad;
      if (!inFrame) continue;
      const i = (y * width + x) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const d = Math.max(Math.abs(r - textRgb[0]), Math.abs(g - textRgb[1]), Math.abs(b - textRgb[2]));
      if (d <= near) { inkPixels++; continue; }
      frame.push(luminance([r, g, b]));
    }
  }
  if (frame.length === 0) return { ratio: 1, ratioMedian: 1, bgPixels: 0, inkPixels };
  frame.sort((a, b) => a - b);
  const textL = luminance(textRgb);
  const worst = textL < 0.5 ? percentile(frame, 0.05) : percentile(frame, 0.95);
  const median = percentile(frame, 0.5);
  return {
    ratio: +contrastRatio(textL, worst).toFixed(2),
    ratioMedian: +contrastRatio(textL, median).toFixed(2),
    bgPixels: frame.length,
    inkPixels,
  };
}

/**
 * Measure one text element on a live Playwright page. `selector` should point
 * at an element whose own text is what the user reads (a `<span>`, a `<h1>`,
 * a button label). Returns `{ label, selector, text, color, ratio, ratioMedian, pass, … }`
 * or `{ label, selector, error }` when the element is missing / empty.
 */
export async function measureTextContrast(page, selector, label = selector, options = {}) {
  const handle = await page.$(selector);
  if (!handle) return { label, selector, error: 'element not found' };
  const info = await handle.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const r = rects[0] ?? el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: r.left, y: r.top, w: r.width, h: r.height,
      color: cs.color,
      text: (el.textContent ?? '').trim().slice(0, 48),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
  if (!info.text || info.w < 2 || info.h < 2) return { label, selector, error: 'no visible text' };
  const pad = options.pad ?? 3;
  const x = Math.floor(info.x) - pad; const y = Math.floor(info.y) - pad;
  const width = Math.ceil(info.w) + pad * 2; const height = Math.ceil(info.h) + pad * 2;
  if (x < 0 || y < 0 || x + width > info.viewport.w || y + height > info.viewport.h) return { label, selector, error: 'text runs off the viewport' };
  let png;
  try { png = decodePng(await page.screenshot({ clip: { x, y, width, height }, animations: 'disabled' })); }
  catch (e) { return { label, selector, error: `screenshot failed: ${String(e.message || e).split('\n')[0]}` }; }
  const [r, g, b] = parseCssColor(info.color);
  const measured = contrastFromPixels(png, [r, g, b], { ...options, pad });
  return {
    label, selector, text: info.text, color: info.color,
    ...measured,
    pass: measured.ratio >= (options.min ?? WCAG_AA),
  };
}

/** Markdown-ish table of contrast rows for the console and the report. */
export function formatContrastTable(rows) {
  const lines = ['shot | target | text | ratio (worst 5 %) | median | result'];
  for (const r of rows) {
    if (r.error) { lines.push(`${r.shot} | ${r.label} | — | — | — | skipped (${r.error})`); continue; }
    lines.push(`${r.shot} | ${r.label} | "${r.text}" | ${r.ratio.toFixed(2)}:1 | ${r.ratioMedian.toFixed(2)}:1 | ${r.pass ? 'pass' : 'FAIL'}`);
  }
  return lines.join('\n');
}

// ── Page sweep (M1-D1) ───────────────────────────────────────────────────────
//
//   node tools/visual-preview/contrast.mjs                       # login + settings, light + dark, desktop + 390 px, both gold variants
//   node tools/visual-preview/contrast.mjs --only settings --gold dark-label --theme dark
//   node tools/visual-preview/contrast.mjs --json /tmp/contrast.json --verbose
//   node tools/visual-preview/contrast.mjs --dist /path/to/older/client/dist     # a "before" run
//   node tools/visual-preview/contrast.mjs --shots <dir>                         # also save one PNG per view
//
// Serves the built client (packages/boardroom-ai/client/dist) against the mock
// API, and on each page measures EVERY visible text element that owns a text
// node (scrolling the main pane on Settings). Method, per viewport position:
// read every target's computed text colour and glyph boxes, then hide ALL text
// (`color: transparent`) and take one screenshot — what is left inside each
// glyph box is exactly the backdrop behind the letters (gradients, glows,
// tints, glass), with no anti-aliased ink from the text itself or a neighbour.
// The worst 5 % of per-pixel ratios decides the pair (alpha text colours are
// composited per pixel). Thresholds follow WCAG: 4.5:1 for text, 3:1 for large
// text (≥ 24 px, or ≥ 18.66 px bold) and for single glyphs (icons drawn as
// characters). Disabled controls, `aria-hidden` and `sr-only` content are
// skipped (WCAG exempts inactive components and decoration). Any failing pair
// exits 1. The `dark-label` variant sets `data-gold="dark-label"` on <html>
// before the app paints — the same switch a founder flips in client/index.html.

const HIDE_TEXT_CSS = 'html.contrast-sweep-hide-text *, html.contrast-sweep-hide-text *::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }';

/** Tag (data-contrast-id) every visible, fully on-screen text-owning element not yet tagged; return colour + glyph boxes. */
async function collectTextTargets(page, start) {
  return page.evaluate((first) => {
    const out = [];
    let id = first;
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || !node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el) || el.dataset.contrastId) continue;
      seen.add(el);
      if (el.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"], .sr-only, script, style, noscript, option, select, textarea, [data-contrast-skip]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || cs.display === 'none') continue;
      let opacity = 1;
      for (let n = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
      if (opacity < 0.99) continue; // mid-animation or deliberately dimmed (disabled look)
      // Glyph boxes of this element's own text nodes (not its children's).
      const rects = [];
      for (const child of el.childNodes) {
        if (child.nodeType !== 3 || !child.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      if (!rects.length) continue;
      if (rects.some((r) => r.y < 0 || r.x < 0 || r.y + r.h > innerHeight || r.x + r.w > innerWidth)) continue;
      const text = el.textContent.trim();
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const glyph = !/[\p{L}\p{N}]/u.test(text);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      el.dataset.contrastId = String(id++);
      out.push({
        selector: `[data-contrast-id="${el.dataset.contrastId}"]`,
        label: `${el.tagName.toLowerCase()}${glyph ? ' (glyph)' : large ? ' (large)' : ''}`,
        text: text.slice(0, 48), color: cs.color, rects, min: glyph || large ? 3 : 4.5,
      });
    }
    return out;
  }, start);
}

/** Worst-5 % contrast of `textRgba` over the backdrop pixels inside `rects` of a full-viewport `png`. */
export function contrastOverBackdrop(png, rects, textRgba) {
  const [tr, tg, tb, ta = 1] = textRgba;
  const ratios = [];
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)); const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(png.width, Math.ceil(r.x + r.w)); const y1 = Math.min(png.height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        const bg = [png.data[i], png.data[i + 1], png.data[i + 2]];
        const fg = [tr * ta + bg[0] * (1 - ta), tg * ta + bg[1] * (1 - ta), tb * ta + bg[2] * (1 - ta)];
        ratios.push(contrastRatio(luminance(fg), luminance(bg)));
      }
    }
  }
  if (!ratios.length) return { ratio: 1, ratioMedian: 1, bgPixels: 0 };
  ratios.sort((a, b) => a - b);
  return { ratio: +percentile(ratios, 0.05).toFixed(2), ratioMedian: +percentile(ratios, 0.5).toFixed(2), bgPixels: ratios.length };
}

async function sweepPage(page, { scrollSelector } = {}) {
  await page.addStyleTag({ content: HIDE_TEXT_CSS });
  const rows = [];
  let next = 0;
  const positions = [0];
  if (scrollSelector) {
    const { h, ch } = await page.$eval(scrollSelector, (el) => ({ h: el.scrollHeight, ch: el.clientHeight })).catch(() => ({ h: 0, ch: 0 }));
    for (let top = ch - 120; ch > 0 && top < h; top += ch - 120) positions.push(top);
  }
  for (const top of positions) {
    if (scrollSelector) { await page.$eval(scrollSelector, (el, t) => el.scrollTo({ top: t, behavior: 'instant' }), top).catch(() => {}); await page.waitForTimeout(300); }
    const targets = await collectTextTargets(page, next);
    next += targets.length;
    if (!targets.length) continue;
    await page.evaluate(() => document.documentElement.classList.add('contrast-sweep-hide-text'));
    await page.waitForTimeout(60);
    const png = decodePng(await page.screenshot({ animations: 'disabled' }));
    await page.evaluate(() => document.documentElement.classList.remove('contrast-sweep-hide-text'));
    for (const t of targets) {
      const measured = contrastOverBackdrop(png, t.rects, parseCssColor(t.color));
      rows.push({ label: t.label, selector: t.selector, text: t.text, color: t.color, min: t.min, ...measured, pass: measured.ratio >= t.min });
    }
  }
  return rows;
}


export async function contrastSweep({ only, themes = ['light', 'dark'], golds = ['default', 'dark-label'], viewports, dist, shotsDir, log = console.log } = {}) {
  const { startServer, loadPlaywright, launchChromium } = await import('./shoot.mjs');
  const { createMockApi, loadRoutes } = await import('./mock-api.mjs');
  const pagesFixture = (await import('./fixtures/pages.mjs')).default;
  const routes = await loadRoutes();
  const anon = { on: false };
  const meRoute = routes.find((r) => r.method === 'GET' && r.path === '/auth/me');
  const override = { method: 'GET', path: '/auth/me', file: 'contrast.mjs', handler: (req, url, m) => (anon.on ? { status: 401, body: { message: 'Not signed in' } } : meRoute.handler(req, url, m)) };
  const mock = await createMockApi({ routes: [override, ...pagesFixture.routes.map((r) => ({ ...r, file: 'pages.mjs' })), ...routes] });
  const { server, baseUrl } = await startServer({ mock, ...(dist ? { dist } : {}) });
  const pages = [
    { name: 'login', path: '/login', anon: true, ready: 'form' },
    { name: 'settings', path: '/settings', ready: '#decision-frequency', scrollSelector: '#main-content' },
  ].filter((p) => !only || only.includes(p.name));
  const vps = viewports ?? [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
  const pw = loadPlaywright();
  const browser = await launchChromium(pw);
  const rows = [];
  try {
    for (const spec of pages) for (const gold of golds) for (const theme of themes) for (const vp of vps) {
      anon.on = !!spec.anon;
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
      await context.addInitScript(({ t, g }) => {
        localStorage.setItem('theme', t);
        if (g === 'default') return;
        const apply = () => { if (document.documentElement) document.documentElement.dataset.gold = g; };
        apply(); document.addEventListener('readystatechange', apply);
      }, { t: theme, g: gold });
      const page = await context.newPage();
      const shot = `${spec.name} [${theme} · ${gold} · ${vp.name}]`;
      try {
        await page.goto(baseUrl + spec.path, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector(spec.ready, { timeout: 15000 });
        await page.waitForTimeout(900);
        if (shotsDir) { mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: join(shotsDir, `contrast-${spec.name}-${theme}-${gold}-${vp.name}.png`) }); }
        const measured = await sweepPage(page, spec);
        const ok = measured.filter((r) => !r.error);
        const failed = ok.filter((r) => !r.pass);
        log(`▸ ${shot}: ${ok.length} text elements, ${failed.length} below threshold`);
        rows.push(...measured.map((r) => ({ shot, ...r })));
      } catch (e) {
        log(`✗ ${shot}: ${String(e.message || e).split('\n')[0]}`);
        rows.push({ shot, label: 'page', selector: spec.path, error: `page failed: ${String(e.message || e).split('\n')[0]}`, fatal: true });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return rows;
}

function cliArg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }

// Not a top-level await: shoot.mjs imports this module, so the sweep may only
// load it once this module has finished evaluating.
async function main() {
  const only = cliArg('--only', null)?.split(',');
  const theme = cliArg('--theme', null);
  const gold = cliArg('--gold', 'both');
  const rows = await contrastSweep({
    only: only ?? undefined,
    themes: theme ? [theme] : undefined,
    golds: gold === 'both' ? undefined : [gold],
    dist: cliArg('--dist', null) ?? undefined,
    shotsDir: cliArg('--shots', null) ?? undefined,
  });
  const measured = rows.filter((r) => !r.error);
  const failing = measured.filter((r) => !r.pass);
  const fatal = rows.filter((r) => r.fatal);
  if (process.argv.includes('--verbose')) console.log(`\n${formatContrastTable(rows)}`);
  const json = cliArg('--json', null);
  if (json) writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  if (failing.length) console.log(`\nFailing pairs\n${formatContrastTable(failing)}`);
  console.log(`\n${measured.length} text pairs measured across ${new Set(rows.map((r) => r.shot)).size} views — ${failing.length} failing, ${fatal.length} page errors.`);
  if (failing.length || fatal.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
