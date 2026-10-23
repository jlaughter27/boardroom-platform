/**
 * UI foundation guardrails (docs/02-reference/UI-FOUNDATION.md, ADR-015).
 *
 * Scans client/src for the patterns the Apple-grade pass removed so they do
 * not creep back in: `transition-all`, ease-in on UI, entrances from scale 0,
 * literal z-index values, third-party font requests and `backdrop-blur`
 * outside the navigation layer.
 *
 * To use `backdrop-blur` in a file that is not on the allow-list, put this on
 * the same line and say why:
 *   /* ui-standards: allow backdrop-blur — <reason> *\/
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');

/** Files allowed to use `backdrop-blur` (the navigation layer: overlays, header, floating chrome). */
const BACKDROP_BLUR_ALLOW = new Set([
  'components/ui/Toast.tsx',
  'components/ui/CommandPalette.tsx',
  'components/shared/Modal.tsx',
  'components/shared/AppHeader.tsx',
  'components/ui/Tooltip.tsx',
  'components/ui/Popover.tsx',
  'components/ui/Menu.tsx',
  'styles/tokens.css',
  'index.css',
]);

/**
 * Paths owned by other lanes that are not yet on the standard. Keep this list
 * empty when you can; when you cannot, name the follow-up next to the entry.
 */
const EXCLUDE: { prefix: string; todo: string }[] = [];

const ALLOW_COMMENT = /ui-standards:\s*allow backdrop-blur\s*[—-]\s*\S/;

interface Rule {
  name: string;
  pattern: RegExp;
  /** Return true to accept a matching line anyway (`prev` is the line above, for justification comments). */
  except?: (line: string, file: string, prev?: string) => boolean;
}

const RULES: Rule[] = [
  {
    name: 'no `transition-all` (list the properties that change)',
    pattern: /\btransition-all\b/,
  },
  {
    name: 'no ease-in on the UI layer (`ease-in-out` is fine for on-screen movement)',
    // Tailwind `ease-in`, CSS `ease-in`, Motion `easeIn` / 'easeIn'.
    pattern: /(?<![\w-])ease-in(?!-out)(?![\w-])|\beaseIn\b(?!Out)/,
  },
  {
    name: 'no entrances from scale 0 (start at 0.9 or above)',
    pattern: /\bscale:\s*0\s*[,}]|\bscale\(0\)/,
  },
  {
    name: 'no literal z-index (use the `z-*` tokens: z-dropdown, z-sticky, z-modal, z-toast …)',
    pattern: /\bz-50\b|\bz-\[/,
  },
  {
    name: 'no third-party font requests (type is self-hosted)',
    pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/,
  },
  {
    name: 'no `backdrop-blur` outside the navigation layer (or add a `ui-standards: allow backdrop-blur — <reason>` comment)',
    pattern: /\bbackdrop-blur\b/,
    except: (line, file) => BACKDROP_BLUR_ALLOW.has(file) || ALLOW_COMMENT.test(line),
  },
  {
    // Native selects cannot carry the popup motion, the hairline surface or
    // typeahead styling; `ui/Select` can. Put the justification on the line
    // above (or the same line) when one has to stay.
    name: 'no native `<select` outside ui/Select.tsx (or add a `ui-standards: allow select — <reason>` comment above it)',
    pattern: /<select\b/,
    except: (line, file, prev) => file === 'components/ui/Select.tsx' || ALLOW_SELECT.test(line) || ALLOW_SELECT.test(prev ?? ''),
  },
  {
    // Header / chrome state never comes from a scroll listener: an
    // IntersectionObserver sentinel costs nothing per frame (hooks/useScrolledSentinel).
    name: 'no scroll event listeners (use an IntersectionObserver sentinel; or add a `ui-standards: allow scroll-listener — <reason>` comment)',
    pattern: /addEventListener\(\s*['"]scroll['"]|\bonScroll=/,
    except: (line) => ALLOW_SCROLL.test(line),
  },
];

const ALLOW_SELECT = /ui-standards:\s*allow select\s*[—-]\s*\S/;
const ALLOW_SCROLL = /ui-standards:\s*allow scroll-listener\s*[—-]\s*\S/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC)
  .map((full) => ({ full, rel: relative(SRC, full).split('\\').join('/') }))
  .filter(({ rel }) => !EXCLUDE.some((e) => rel.startsWith(e.prefix)));

describe('ui standards', () => {
  it('scans the client source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const rule of RULES) {
    it(rule.name, () => {
      const hits: string[] = [];
      for (const { full, rel } of files) {
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (rule.pattern.test(line) && !rule.except?.(line, rel, lines[i - 1])) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
      expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
    });
  }

  it('index.html has no inline <script> (production CSP is script-src \'self\'; the theme bootstrap lives in /theme-init.js)', () => {
    const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>/g)].filter(m => !/\bsrc=/.test(m[1]));
    expect(inline.map(m => m[0])).toEqual([]);
  });

  it('index.html does not load fonts from a third party', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lane D · M1-D1 — brand gold passes AA (docs/roadmap/PHASE-8-ROADMAP.md).
//
// 1. Token pairs: parse styles/tokens.css, resolve every theme × gold variant
//    (light / dark × default / `data-gold="dark-label"`), and require text
//    pairs ≥ 4.5:1 and non-text pairs (solid gold as a shape) ≥ 3:1.
// 2. Usage: `text-primary` is the solid brand gold, tuned for fills — text in
//    gold reads `text-primary-text`. Solid `bg-primary` carries
//    `text-primary-foreground`, and hover on solid gold uses `bg-primary-hover`
//    (a `/90` tint lightens the surface under a white label below AA).
// ─────────────────────────────────────────────────────────────────────────────

const TOKENS_CSS = join(SRC, 'styles', 'tokens.css');

type Rgba = [number, number, number, number];
interface GoldState { dark: boolean; gold: 'default' | 'dark-label' }

const GOLD_STATES: GoldState[] = [
  { dark: false, gold: 'default' },
  { dark: true, gold: 'default' },
  { dark: false, gold: 'dark-label' },
  { dark: true, gold: 'dark-label' },
];
const stateName = (s: GoldState) => `${s.dark ? 'dark' : 'light'} · ${s.gold === 'default' ? 'default gold' : 'data-gold="dark-label"'}`;

/**
 * Does a tokens.css selector list apply to `state`? Understands exactly the
 * pieces the token file uses on <html>: `:root`, `.dark`, `:not(.dark)` and
 * `[data-gold="…"]`. Anything else left in a selector (`.material`, `0%`,
 * `from`) means the block is not a theme block and is ignored.
 */
function selectorApplies(selectorList: string, state: GoldState): boolean {
  return selectorList.split(',').some((raw) => {
    let s = raw.trim();
    if (!s) return false;
    let ok = true;
    s = s.replace(/:not\(\.dark\)/g, () => { ok &&= !state.dark; return ''; });
    s = s.replace(/\[data-gold=["']?([\w-]+)["']?\]/g, (_m, v: string) => { ok &&= state.gold === v; return ''; });
    s = s.replace(/\.dark\b/g, () => { ok &&= state.dark; return ''; });
    s = s.replace(/:root|\bhtml\b/g, '');
    return s.trim() === '' && ok;
  });
}

/** Custom properties in effect for `state`, in source order (later blocks win; the file orders blocks by specificity). */
function resolveTokens(css: string, state: GoldState): Map<string, string> {
  const vars = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorApplies(m[1], state)) continue;
    for (const decl of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(decl[1], decl[2].trim());
  }
  return vars;
}

function tokenColor(vars: Map<string, string>, name: string, depth = 0): Rgba {
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`token ${name} is not defined`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (ref) { if (depth > 8) throw new Error(`token ${name}: var() loop`); return tokenColor(vars, ref[1], depth + 1); }
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(raw);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`token ${name}: cannot parse colour "${raw}"`);
}

const WHITE: Rgba = [255, 255, 255, 1];
const over = (top: Rgba, base: Rgba): Rgba => {
  const a = top[3];
  return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1];
};
const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const relLum = (c: Rgba) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const wcagRatio = (a: Rgba, b: Rgba) => { const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** A surface: a token, optionally a tint of it (`alpha`) laid over another surface token (Tailwind `bg-primary/10`). */
interface Surface { token: string; alpha?: number; over?: string }
interface TokenPair { fg: string; bg: Surface; why: string }

function surfaceColor(vars: Map<string, string>, s: Surface): Rgba {
  const base = s.over ? over(tokenColor(vars, s.over), WHITE) : WHITE;
  const c = tokenColor(vars, s.token);
  const top: Rgba = s.alpha === undefined ? c : [c[0], c[1], c[2], c[3] * s.alpha];
  return over(top, base);
}

const on = (token: string, alpha?: number, overToken?: string): Surface => ({ token, alpha, over: overToken });

/** Text pairs — WCAG 1.4.3, 4.5:1. */
const TEXT_PAIRS: TokenPair[] = [
  { fg: '--color-primary-foreground', bg: on('--color-primary'), why: 'label on a solid gold button / chip' },
  { fg: '--color-primary-foreground', bg: on('--color-primary-hover'), why: 'label on a hovered solid gold button' },
  { fg: '--color-primary-text', bg: on('--color-background'), why: 'gold text on the page' },
  { fg: '--color-primary-text', bg: on('--color-card'), why: 'gold text on a card' },
  { fg: '--color-primary-text', bg: on('--color-muted'), why: 'gold text on a muted well' },
  { fg: '--color-primary-text', bg: on('--surface-2'), why: 'gold text in a popover / menu' },
  { fg: '--color-primary-text', bg: on('--color-primary', 0.1, '--color-card'), why: 'gold text on a bg-primary/10 tint (Badge accent, selected nav)' },
  { fg: '--color-primary-text', bg: on('--color-primary', 0.1, '--color-background'), why: 'gold text on a bg-primary/10 tint over the page' },
  { fg: '--color-primary-text', bg: on('--color-primary', 0.15, '--color-background'), why: 'gold text on a bg-primary/15 tint (onboarding step dots)' },
  { fg: '--color-foreground', bg: on('--color-background'), why: 'body text' },
  { fg: '--color-card-foreground', bg: on('--color-card'), why: 'card text' },
  { fg: '--color-foreground', bg: on('--color-muted'), why: 'text on a muted well' },
  { fg: '--color-muted-foreground', bg: on('--color-background'), why: 'secondary text on the page' },
  { fg: '--color-muted-foreground', bg: on('--color-card'), why: 'secondary text on a card' },
  { fg: '--color-muted-foreground', bg: on('--color-muted'), why: 'secondary text on a muted well' },
  { fg: '--color-destructive-foreground', bg: on('--color-destructive'), why: 'label on a danger button' },
  { fg: '--color-background', bg: on('--color-success'), why: 'label on a success button (text-background)' },
  { fg: '--color-success', bg: on('--color-card'), why: 'success text' },
  { fg: '--color-warning', bg: on('--color-card'), why: 'warning text' },
  { fg: '--color-danger', bg: on('--color-card'), why: 'danger text' },
  { fg: '--color-info', bg: on('--color-card'), why: 'info text' },
  { fg: '--color-sidebar-foreground', bg: on('--color-sidebar-bg'), why: 'sidebar text' },
  { fg: '--color-sidebar-foreground-muted', bg: on('--color-sidebar-bg'), why: 'sidebar secondary text (theme toggle, sign out)' },
  { fg: '--color-muted-foreground-on-glass', bg: on('--color-background'), why: 'secondary text on glass / the login brand panel' },
  { fg: '--color-sidebar-primary', bg: on('--color-sidebar-bg'), why: 'gold wordmark on the always-dark sidebar' },
];

/** Non-text pairs — WCAG 1.4.11, 3:1: solid gold as a shape (button edge, switch, progress, logo, icon). */
const NON_TEXT_PAIRS: TokenPair[] = [
  { fg: '--color-primary', bg: on('--color-background'), why: 'solid gold shape on the page' },
  { fg: '--color-primary', bg: on('--color-card'), why: 'solid gold shape on a card' },
  { fg: '--color-sidebar-primary', bg: on('--color-sidebar-bg'), why: 'gold logo / active-page bar on the sidebar' },
];

function failingPairs(state: GoldState, pairs: TokenPair[], min: number): string[] {
  const vars = resolveTokens(readFileSync(TOKENS_CSS, 'utf8'), state);
  const out: string[] = [];
  for (const p of pairs) {
    let ratio: number;
    try {
      const bg = surfaceColor(vars, p.bg);
      ratio = wcagRatio(over(tokenColor(vars, p.fg), bg), bg);
    } catch (e) {
      out.push(`${p.fg} on ${p.bg.token}: ${(e as Error).message}`);
      continue;
    }
    if (ratio < min) {
      const surface = p.bg.alpha === undefined ? p.bg.token : `${p.bg.token}/${Math.round(p.bg.alpha * 100)} over ${p.bg.over}`;
      out.push(`${p.fg} on ${surface}: ${ratio.toFixed(2)}:1 < ${min}:1 — ${p.why}`);
    }
  }
  return out;
}

/**
 * Lines that may keep `text-primary` (the solid gold) because what they colour
 * is not text: the logo mark, icons and decorative glyphs (non-text, 3:1 —
 * covered by NON_TEXT_PAIRS). Each entry matches on file + a fragment of the
 * line. Lane C entries are files Lane D may not edit in M1; they move to
 * `text-primary-text` in M1-D2 / M1-D4, after M1-C2 / M1-C4.
 */
const TEXT_PRIMARY_ALLOW: { file: string; contains: string; reason: string }[] = [
  { file: 'pages/LoginPage.tsx', contains: '<Logo variant="icon"', reason: 'logo mark' },
  { file: 'pages/OnboardingPage.tsx', contains: '<Logo variant="icon"', reason: 'logo mark' },
  { file: 'components/shared/AppHeader.tsx', contains: 'md:hidden flex items-center gap-2 text-primary', reason: 'mobile logo link (icon only)' },
  { file: 'components/shared/AINudge.tsx', contains: '<svg', reason: 'icon' },
  { file: 'components/shared/NotificationCenter.tsx', contains: "case 'outcome_review'", reason: 'notification icon colour' },
  { file: 'components/ui/EmptyState.tsx', contains: '<Glyph', reason: 'icon' },
  { file: 'components/ui/CommandPalette.tsx', contains: 'w-5 text-center text-primary', reason: 'result-type glyph' },
  { file: 'components/ui/CommandPalette.tsx', contains: "cn(ICON_CLASS, 'text-primary')", reason: 'icon' },
  { file: 'components/ui/Select.tsx', contains: 'BaseSelect.ItemIndicator', reason: 'check-mark icon' },
  { file: 'components/decision/SimulationPanel.tsx', contains: "{'\\u2022'}", reason: 'decorative bullet' },
  { file: 'components/dashboard/WeeklyMemoCard.tsx', contains: 'aria-hidden', reason: 'decorative bullet' },
  { file: 'components/dashboard/OutcomeReviewBanner.tsx', contains: "{'\\u25CF'}", reason: 'decorative status dot' },
  { file: 'components/decision/PersonaCard.tsx', contains: 'text-primary', reason: 'Lane C file in M1 — repoint in M1-D2' },
  { file: 'pages/DecisionSessionPage.tsx', contains: 'text-primary', reason: 'Lane C file in M1 — repoint in M1-D4' },
];

const TEXT_PRIMARY = /text-primary(?![\w-])/;
const SOLID_GOLD = /(?<![\w-])bg-primary(?![\w/-])/;
const NON_GOLD_LABEL = /(?<![\w-])text-(?:foreground|white|black|background|muted-foreground)(?![\w-])/;
const GOLD_TINT_HOVER = /hover:bg-primary\/(?:80|90)\b/;

function scan(test: (line: string, rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const { full, rel } of files) {
    if (!rel.endsWith('.tsx') && !rel.endsWith('.ts')) continue;
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (test(line, rel)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return hits;
}

describe('brand gold and token contrast (Lane D · M1-D1)', () => {
  it('the selector matcher reads the theme blocks the way the browser does', () => {
    const light: GoldState = { dark: false, gold: 'default' };
    const darkLabel: GoldState = { dark: false, gold: 'dark-label' };
    expect(selectorApplies(':root', light)).toBe(true);
    expect(selectorApplies('.dark', light)).toBe(false);
    expect(selectorApplies(':root[data-gold="dark-label"]:not(.dark)', darkLabel)).toBe(true);
    expect(selectorApplies(':root[data-gold="dark-label"]:not(.dark)', { dark: true, gold: 'dark-label' })).toBe(false);
    expect(selectorApplies(':root[data-gold="dark-label"]:not(.dark)', light)).toBe(false);
    expect(selectorApplies('.material', light)).toBe(false);
    expect(selectorApplies('0%, 100%', light)).toBe(false);
    expect(wcagRatio([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 5);
  });

  for (const state of GOLD_STATES) {
    it(`${stateName(state)}: text pairs ≥ 4.5:1`, () => {
      const fails = failingPairs(state, TEXT_PAIRS, 4.5);
      expect(fails, `\n${fails.join('\n')}\n`).toEqual([]);
    });
    it(`${stateName(state)}: non-text pairs ≥ 3:1`, () => {
      const fails = failingPairs(state, NON_TEXT_PAIRS, 3);
      expect(fails, `\n${fails.join('\n')}\n`).toEqual([]);
    });
  }

  it('ships both gold variants: white labels by default, dark labels under data-gold="dark-label"', () => {
    const css = readFileSync(TOKENS_CSS, 'utf8');
    const label = (s: GoldState) => relLum(tokenColor(resolveTokens(css, s), '--color-primary-foreground'));
    const fill = (s: GoldState) => tokenColor(resolveTokens(css, s), '--color-primary').slice(0, 3).join(',');
    expect(label({ dark: false, gold: 'default' }), 'default light label should be white').toBeGreaterThan(0.9);
    expect(label({ dark: false, gold: 'dark-label' }), 'dark-label variant should use a dark label').toBeLessThan(0.05);
    expect(fill({ dark: false, gold: 'dark-label' }), 'the variants must differ in the light gold fill').not.toBe(fill({ dark: false, gold: 'default' }));
  });

  it('`text-primary` is never a text colour outside the allow-list (use `text-primary-text`)', () => {
    const hits = scan((line, rel) => TEXT_PRIMARY.test(line) && !TEXT_PRIMARY_ALLOW.some((a) => a.file === rel && line.includes(a.contains)));
    expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
  });

  it('every allow-list entry still matches a line (no stale exemptions)', () => {
    const stale = TEXT_PRIMARY_ALLOW.filter((a) => {
      const f = files.find((x) => x.rel === a.file);
      return !f || !readFileSync(f.full, 'utf8').split('\n').some((l) => TEXT_PRIMARY.test(l) && l.includes(a.contains));
    }).map((a) => `${a.file} — "${a.contains}"`);
    expect(stale).toEqual([]);
  });

  it('solid `bg-primary` carries `text-primary-foreground`, never another label colour', () => {
    const hits = scan((line) => SOLID_GOLD.test(line) && NON_GOLD_LABEL.test(line) && !line.includes('text-primary-foreground'));
    expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
  });

  it('hover on solid gold uses `bg-primary-hover`, not a lighter `/80` or `/90` tint', () => {
    const hits = scan((line) => GOLD_TINT_HOVER.test(line));
    expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RD-1 — memory content is markdown (docs/roadmap/PHASE-8-REAL-DATA-ROADMAP.md).
//
// One sanitizing renderer: react-markdown + remark-gfm in
// components/memory/MemoryMarkdown.tsx, never raw HTML. Memory content is not
// dumped as plain text in the memory components (the detail renders markdown,
// the cards strip it), and wide markdown tables scroll inside their own region.
// ─────────────────────────────────────────────────────────────────────────────

const MARKDOWN_RENDERER = 'components/memory/MemoryMarkdown.tsx';

describe('memory markdown (RD-1)', () => {
  it('no `dangerouslySetInnerHTML`, `rehype-raw` or `allowDangerousHtml` anywhere in the client', () => {
    const hits = scan((line) => /dangerouslySetInnerHTML|rehype-raw|allowDangerousHtml/.test(line));
    expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
  });

  it('react-markdown is imported only by the one sanitizing renderer', () => {
    const hits = scan((line, rel) => /from ['"]react-markdown['"]/.test(line) && rel !== MARKDOWN_RENDERER);
    expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
    const src = readFileSync(join(SRC, MARKDOWN_RENDERER), 'utf8');
    expect(src).toMatch(/from ['"]react-markdown['"]/);
    expect(src).toMatch(/from ['"]remark-gfm['"]/);
  });

  it('memory components never render `memory.content` as raw JSX text', () => {
    const hits = scan((line, rel) => rel.startsWith('components/memory/') && /\{\s*(memory|m|rm|selectedMemory)\.content\s*\}/.test(line));
    expect(hits, `\n${hits.join('\n')}\n`).toEqual([]);
  });

  it('memory cards build their preview with markdownToPlainText', () => {
    const src = readFileSync(join(SRC, 'components/memory/MemoryCard.tsx'), 'utf8');
    expect(src).toMatch(/markdownToPlainText\(/);
    expect(src).not.toMatch(/\{\s*memory\.content\s*\}/);
  });

  it('markdown tables sit in a focusable overflow-x-auto region (they scroll inside the panel, never the page)', () => {
    const src = readFileSync(join(SRC, MARKDOWN_RENDERER), 'utf8');
    const start = src.indexOf('table: (');
    const table = src.slice(start, src.indexOf('thead:', start));
    expect(start).toBeGreaterThan(-1);
    expect(table).toMatch(/overflow-x-auto/);
    expect(table).toMatch(/tabIndex=\{0\}/);
    expect(table).toMatch(/role="region"/);
  });
});
