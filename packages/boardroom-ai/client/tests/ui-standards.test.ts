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

  it('index.html does not load fonts from a third party', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });
});
