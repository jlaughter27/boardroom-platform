import { describe, it, expect, afterEach } from 'vitest';
import { LIGHT_THEME, DARK_THEME, rampStep, readChartTheme, isDarkMode } from '../../../src/components/viz/theme';

afterEach(() => { document.documentElement.classList.remove('dark'); });

describe('chart theme', () => {
  it('ships five categorical slots and a five-step sequential ramp in both modes', () => {
    for (const t of [LIGHT_THEME, DARK_THEME]) {
      expect(t.series).toHaveLength(5);
      expect(t.sequential).toHaveLength(5);
      expect(new Set(t.series).size).toBe(5);
      for (const hex of [...t.series, ...t.sequential]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('the first four categorical slots are the entity tokens (project, task, goal, person)', () => {
    expect(LIGHT_THEME.series.slice(0, 4)).toEqual([LIGHT_THEME.entity.project, LIGHT_THEME.entity.task, LIGHT_THEME.entity.goal, LIGHT_THEME.entity.person]);
    expect(DARK_THEME.series.slice(0, 4)).toEqual([DARK_THEME.entity.project, DARK_THEME.entity.task, DARK_THEME.entity.goal, DARK_THEME.entity.person]);
  });
  it('the sequential ramp is monotone in lightness (light → dark on light, flipped on dark)', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const l = LIGHT_THEME.sequential.map(lum);
    const d = DARK_THEME.sequential.map(lum);
    for (let i = 1; i < 5; i++) { expect(l[i]).toBeLessThan(l[i - 1]); expect(d[i]).toBeGreaterThan(d[i - 1]); }
  });
  it('readChartTheme follows the dark class and falls back to constants under jsdom', () => {
    expect(isDarkMode()).toBe(false);
    expect(readChartTheme().mode).toBe('light');
    expect(readChartTheme().series).toEqual(LIGHT_THEME.series);
    document.documentElement.classList.add('dark');
    expect(isDarkMode()).toBe(true);
    const t = readChartTheme();
    expect(t.mode).toBe('dark');
    expect(t.surface).toBe(DARK_THEME.surface);
  });
});

describe('rampStep', () => {
  it('quantises into steps with 0 reserved for none', () => {
    expect(rampStep(0, 10, 5)).toBe(0);
    expect(rampStep(1, 10, 5)).toBe(1);
    expect(rampStep(5, 10, 5)).toBe(2);
    expect(rampStep(10, 10, 5)).toBe(4);
    expect(rampStep(99, 10, 5)).toBe(4);
    expect(rampStep(3, 0, 5)).toBe(0);
  });
});
