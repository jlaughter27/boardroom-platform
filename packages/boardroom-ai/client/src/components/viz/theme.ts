import type { KnowledgeGraphNodeType } from '@boardroom/shared';

/**
 * Chart theme — the dataviz method's parameters, mapped onto the app tokens.
 *
 * Colour is assigned by the job it does (categorical / sequential / status),
 * never hand-picked per chart. Both palettes below were run through the
 * dataviz validator (adjacent pairlist, light surface #ffffff, dark surface
 * #1a1a18):
 *
 *   light  #2a78d6,#1baf7a,#b5890a,#c9407a,#4a3aa7
 *          CVD ΔE 9.9 · normal 17.0 · contrast WARN on #1baf7a (2.82:1) →
 *          relief rule: every chart ships a legend + off-screen table.
 *   dark   #2f7fd9,#199e70,#c98500,#d55181,#9085e9
 *          CVD ΔE 8.4 · normal 19.3 · all ≥ 3:1.
 *          (`--color-entity-commitment` dark `#b48cff` sits above the dark
 *          lightness band, so slot 5 is stepped down to `#9085e9` here.)
 *
 * The first four slots are the entity tokens in tokens.css (project, task,
 * goal, person) so a series colour on the dashboard agrees with the same
 * entity's colour on the graph.
 */

export type ChartMode = 'light' | 'dark';

export interface ChartTheme {
  mode: ChartMode;
  /** Chart surface (the card). Used for the 2px gaps and rings between marks. */
  surface: string;
  /** Page background behind the card. */
  background: string;
  /** Hairline grid / axis rule — one step off the surface. */
  grid: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  /** Low-emphasis series colour (context lines, sparkline history). */
  deemphasis: string;
  /** Status — reserved meaning, never reused as a series. */
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Categorical slots in fixed order. Assign 1..N; never cycle. */
  series: readonly string[];
  /** One-hue (brand gold) sequential ramp, light → dark on light; anchor flips on dark. */
  sequential: readonly string[];
  /** Entity-type colours as the graph paints them. */
  entity: Record<KnowledgeGraphNodeType, string>;
  font: string;
}

export const LIGHT_THEME: ChartTheme = {
  mode: 'light',
  surface: '#ffffff',
  background: '#fafaf6',
  grid: '#e6e4db',
  border: '#e6e4db',
  text: '#1a1a16',
  textMuted: '#6b6960',
  accent: '#b5890a',
  deemphasis: '#c9c7bd',
  success: '#15803d',
  warning: '#c2410c',
  danger: '#b91c1c',
  info: '#1d4ed8',
  series: ['#2a78d6', '#1baf7a', '#b5890a', '#c9407a', '#4a3aa7'],
  sequential: ['#fae6bb', '#efcc83', '#dbad3e', '#bb8900', '#8a6100'],
  entity: {
    goal: '#b5890a', project: '#2a78d6', task: '#1baf7a', person: '#c9407a',
    decision: '#111111', commitment: '#4a3aa7', memory: '#8a887e',
  },
  font: 'Inter, system-ui, sans-serif',
};

export const DARK_THEME: ChartTheme = {
  mode: 'dark',
  surface: '#1a1a18',
  background: '#111110',
  grid: '#2e2e2a',
  border: '#2e2e2a',
  text: '#e8e8e2',
  textMuted: '#9a9890',
  accent: '#d4a31a',
  deemphasis: '#4a4a44',
  success: '#34d399',
  warning: '#fb923c',
  danger: '#f87171',
  info: '#60a5fa',
  series: ['#2f7fd9', '#199e70', '#c98500', '#d55181', '#9085e9'],
  sequential: ['#493b1c', '#6f530a', '#946e00', '#c19000', '#e9b532'],
  entity: {
    goal: '#c98500', project: '#2f7fd9', task: '#199e70', person: '#d55181',
    decision: '#f0f0f0', commitment: '#b48cff', memory: '#6f6e66',
  },
  font: 'Inter, system-ui, sans-serif',
};

/** Token name → theme field, for the live read in `readChartTheme`. */
const TOKEN_MAP: Array<[keyof Omit<ChartTheme, 'mode' | 'series' | 'sequential' | 'entity'>, string]> = [
  ['surface', '--color-card'],
  ['background', '--color-background'],
  ['grid', '--color-border'],
  ['border', '--color-border'],
  ['text', '--color-foreground'],
  ['textMuted', '--color-muted-foreground'],
  ['accent', '--color-primary'],
  ['success', '--color-success'],
  ['warning', '--color-warning'],
  ['danger', '--color-danger'],
  ['info', '--color-info'],
  ['font', '--font-sans'],
];

const ENTITY_TYPES: KnowledgeGraphNodeType[] = ['goal', 'project', 'task', 'person', 'decision', 'commitment', 'memory'];

export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

/**
 * Read the live token values (so a re-themed app re-themes its charts) and
 * fall back to the validated constants where a token is missing.
 */
export function readChartTheme(mode: ChartMode = isDarkMode() ? 'dark' : 'light'): ChartTheme {
  const base = mode === 'dark' ? DARK_THEME : LIGHT_THEME;
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return base;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw || fb;
  };
  const out: ChartTheme = { ...base, entity: { ...base.entity } };
  for (const [field, token] of TOKEN_MAP) out[field] = v(token, base[field]);
  for (const t of ENTITY_TYPES) out.entity[t] = v(`--color-entity-${t}`, base.entity[t]);
  return out;
}

/** Quantise a value into one of `steps.length` ramp steps; 0 (or ≤ 0) is always step 0. */
export function rampStep(value: number, max: number, steps: number): number {
  if (!(value > 0) || !(max > 0) || steps <= 1) return 0;
  const n = steps - 1;
  return Math.min(n, Math.max(1, Math.ceil((value / max) * n)));
}
