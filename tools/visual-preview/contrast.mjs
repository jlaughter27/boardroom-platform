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
    pass: measured.ratio >= WCAG_AA,
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
