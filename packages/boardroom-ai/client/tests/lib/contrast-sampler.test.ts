/**
 * The contrast-on-glass sampler the visual harness gates on
 * (tools/visual-preview/contrast.mjs). jsdom cannot composite a blurred
 * header, so the Playwright shoot does the real measurement; this covers the
 * maths and the PNG path it relies on with a synthetic image.
 */
import { deflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
// @ts-ignore — plain ESM harness module (tools/), no type declarations on purpose.
import { contrastFromPixels, contrastRatio, decodePng, luminance, parseCssColor, WCAG_AA } from '../../../../../tools/visual-preview/contrast.mjs';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** Minimal RGBA PNG (filter 0 on every row) from a pixel callback. */
function encodePng(width: number, height: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = px(x, y); const i = y * (width * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('contrast sampler', () => {
  it('computes WCAG ratios and parses CSS colours', () => {
    expect(contrastRatio(luminance([255, 255, 255]), luminance([0, 0, 0]))).toBeCloseTo(21, 1);
    // --color-muted-foreground (#6b6960) on white, and the on-glass step (#55534b).
    expect(contrastRatio(luminance([107, 105, 96]), luminance([255, 255, 255]))).toBeCloseTo(5.5, 1);
    expect(contrastRatio(luminance([85, 83, 75]), luminance([255, 255, 255]))).toBeGreaterThan(7);
    expect(parseCssColor('rgb(26, 26, 22)')).toEqual([26, 26, 22, 1]);
    expect(parseCssColor('rgba(26, 26, 22, 0.5)')).toEqual([26, 26, 22, 0.5]);
    expect(parseCssColor('color(srgb 1 0 0 / 0.5)')).toEqual([255, 0, 0, 0.5]);
    expect(WCAG_AA).toBe(4.5);
  });

  it('decodes an RGBA PNG', () => {
    const png = decodePng(encodePng(3, 2, (x, y) => [x * 100, y * 200, 7]));
    expect(png.width).toBe(3);
    expect(png.height).toBe(2);
    expect(Array.from(png.data.subarray(0, 4))).toEqual([0, 0, 7, 255]);
    expect(Array.from(png.data.subarray((1 * 3 + 2) * 4, (1 * 3 + 2) * 4 + 4))).toEqual([200, 200, 7, 255]);
  });

  it('judges the text against the worst 5 % of the frame around it, ignoring the glyph box', () => {
    // 20×10: a 3 px frame of white with a mid-grey strip at the right edge; the inside is "glyph" grey that must not count.
    const png = decodePng(encodePng(20, 10, (x, y) => {
      const inFrame = x < 3 || y < 3 || x >= 17 || y >= 7;
      if (!inFrame) return [120, 120, 120];
      return x >= 18 ? [128, 128, 128] : [255, 255, 255];
    }));
    const dark = contrastFromPixels(png, [26, 26, 22], { pad: 3 });
    expect(dark.ratioMedian).toBeGreaterThan(15); // mostly white behind
    expect(dark.ratio).toBeLessThan(4.5); // the grey strip (14 % of the frame) is the worst 5 %
    expect(dark.ratio).toBeGreaterThan(3);
    expect(dark.inkPixels).toBe(0);
  });

  it('drops frame pixels that are the text colour itself (a neighbouring glyph)', () => {
    const png = decodePng(encodePng(12, 10, (x) => (x < 2 ? [26, 26, 22] : [255, 255, 255])));
    const r = contrastFromPixels(png, [26, 26, 22], { pad: 3 });
    expect(r.inkPixels).toBeGreaterThan(0);
    expect(r.ratio).toBeGreaterThan(15);
  });
});
