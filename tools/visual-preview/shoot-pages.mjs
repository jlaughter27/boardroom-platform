#!/usr/bin/env node
// Polish-lane visual harness (Phase C): the shell and the showcase pages in
// both themes, desktop + mobile, plus reduced-motion / reduced-transparency
// variants, a mid-flight route transition, and the contrast-on-glass gate.
//
//   node tools/visual-preview/shoot-pages.mjs --round phase-c-round-1
//   node tools/visual-preview/shoot-pages.mjs --round phase-c-round-0 --dist /path/to/before/dist --legacy
//   node tools/visual-preview/shoot-pages.mjs --only dashboard-scrolled,graph-global --theme dark
//   node tools/visual-preview/shoot-pages.mjs --skip-variants      # desktop + mobile only
//   node tools/visual-preview/shoot-pages.mjs --no-gate            # report contrast, never fail on it
//   node tools/visual-preview/shoot-pages.mjs --gold dark-label    # brand-gold variant (data-gold on <html>), shots suffixed --gold-dark-label
//
// Reuses shoot.mjs (`shootPages`, `startServer`, `DEFAULT_PAGES`) and
// mock-api.mjs. Fixture order: pages.mjs (profile + decision session) →
// dashboard.mjs (cockpit data) → the rest.
//
// Contrast: every `contrast` target is sampled on the live page after the
// shot (tools/visual-preview/contrast.mjs) and written to manifest.json; any
// ratio under 4.5:1 fails the run unless --no-gate. `--legacy` swaps in
// actions that work on a build from before this lane (round-0).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shootPages, startServer, CLIENT_DIST, DEFAULT_PAGES } from './shoot.mjs';
import { createMockApi, loadRoutes } from './mock-api.mjs';
import { formatContrastTable, WCAG_AA } from './contrast.mjs';
import pagesFixture from './fixtures/pages.mjs';
import dashboardFixture from './fixtures/dashboard.mjs';

export const PAGES_OUT = '/tmp/claude-0/-home-user-boardroom-platform/504cfb7a-9286-5499-939f-f39cadb31197/scratchpad/visual';

// ── Contrast targets ──────────────────────────────────────────────────────────
const HEADER_TITLE = { selector: 'header[data-scrolled] h1, header h1', label: 'header title' };
const HEADER_SEARCH = { selector: 'header button[aria-label="Open command palette"] > span', label: 'header search label' };
const HEADER_KBD = { selector: 'header button[aria-label="Open command palette"] kbd', label: 'header ⌘K' };
const LEGEND_LABEL = { selector: '[data-testid="graph-legend"] button:nth-child(2) > span:nth-child(2)', label: 'legend label' };
const LEGEND_COUNT = { selector: '[data-testid="graph-legend"] button:nth-child(2) > span:nth-child(3)', label: 'legend count' };
const LEGEND_OFF = { selector: '[data-testid="graph-legend"] button[aria-pressed="false"] > span:nth-child(2)', label: 'legend label (off)' };
const HOVER_TITLE = { selector: '[data-testid="graph-tooltip"] > div:nth-child(2)', label: 'hover card title' };
const HOVER_META = { selector: '[data-testid="graph-tooltip"] > div:nth-child(1) > span:nth-child(2)', label: 'hover card meta' };
const SHEET_TITLE = { selector: '[role="dialog"] h2', label: 'sheet title' };
const SEGMENT_ACTIVE = { selector: '[data-testid="mode-selector"] [role="tab"][data-active] span span:last-child', label: 'segment (active)' };
const SEGMENT_IDLE = { selector: '[data-testid="mode-selector"] [role="tab"]:not([data-active]) span span:last-child', label: 'segment (idle)' };

// ── Shared steps ──────────────────────────────────────────────────────────────
const settle = [{ sleep: 600 }];
const waitDashboard = [
  { wait: '[data-testid="cockpit-row"]' },
  { wait: '[data-testid="memory-pulse-heatmap"]', timeout: 20000 },
  { wait: '[data-testid="whats-moving-chart"]' },
  { wait: '[data-testid="llm-cost-widget"]' },
];
const waitLegacyDashboard = [{ wait: 'h1' }, { sleep: 1500 }];
/** Scroll the main pane so content sits under the header; wait for the IntersectionObserver callback. */
const scrollUnderHeader = [{ scroll: { selector: '#main-content', top: 420 } }, { sleep: 350 }];
const openConfigurator = [{ click: 'button:has-text("Customize")' }, { wait: '[role="dialog"]' }, { sleep: 450 }];
const RECORD_VT = `(() => { const orig = document.startViewTransition; if (typeof orig !== 'function') return; window.__vt = []; document.startViewTransition = function (opts) { const t = opts && opts.types ? Array.from(opts.types) : []; window.__vt.push(t); return orig.call(document, opts); }; })()`;
const SLOW_VT = '::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 6s !important; }';
const HAS_VT = 'typeof document.startViewTransition === "function"';
// Streaming decision session (fixtures/session-stream.mjs): the stored question → Analyze → mid-stream.
// The cards must show prose only — the assert fails the shot if a brace or a JSON key leaks.
const NO_JSON_IN_CARDS = '[...document.querySelectorAll("[data-testid=persona-card]")].every((c) => !/[{}]|"?(situationReading|personaId|keyAssumptions)"?\\s*:/.test(c.textContent))';
const streamMid = [
  { wait: '[data-testid="session-review"]' }, { click: '[data-testid="session-review"] button:has-text("Analyze")' },
  { wait: '[data-testid="persona-card"][data-state="streaming"]' }, { wait: '[data-testid="persona-card"][data-state="complete"]' },
  { sleep: 1100 }, { assert: NO_JSON_IN_CARDS, message: 'a streaming card rendered JSON' },
];
// After an error (M1-C2): the Critic failed, the rest finished — error card with Retry, honest CEO step.
const NO_THINKING = '!document.body.innerText.includes("Thinking")';
const afterError = [
  { wait: '[data-testid="session-review"]' }, { click: '[data-testid="session-review"] button:has-text("Analyze")' },
  { wait: '[data-testid="persona-card"][data-state="error"]' }, { wait: '[data-testid="session-footer"] button:has-text("Synthesize without Critic")', timeout: 20000 },
  { sleep: 400 }, { assert: NO_THINKING, message: '"Thinking..." is on the page after an error' },
  { assert: '!!document.querySelector("[data-testid=persona-card][data-state=error] button")', message: 'the error card has no Retry button' },
];

// Token reveal with a very long MCP URL (M1-D3, fixtures/pages.mjs): mint a token, then
// assert nothing scrolls sideways — the document and the app's scroll pane — while the
// snippet block itself does overflow (so the check is exercising something) and shows its fade.
const TOKEN_PANEL = '[data-testid="connected-tools-panel"]';
const tokenCreatedLongUrl = [
  { wait: `${TOKEN_PANEL} button:has-text("New token"):not([disabled])` },
  { click: `${TOKEN_PANEL} button:has-text("New token")` },
  { wait: '[data-testid="mcp-token-form"]' },
  { click: '[data-testid="mcp-token-form"] button[type="submit"]' },
  { wait: '[data-testid="mcp-snippet"]' },
  { assert: '!document.querySelector("[data-testid=mcp-url-warning]")', message: 'the long-URL connect-info did not reach the page (placeholder URL shown)' },
  { evaluate: 'document.querySelector("[data-testid=mcp-token-created]").scrollIntoView({ block: "start" })' },
  { sleep: 400 },
  { noOverflowX: ['#main-content'] },
  { assert: '[...document.querySelectorAll("[data-testid=mcp-snippet] pre")].some((p) => p.scrollWidth > p.clientWidth)', message: 'no snippet block overflows — the long URL is not exercising the scroll' },
  { assert: '[...document.querySelectorAll("[data-testid=mcp-snippet] [data-overflowing]")].every((w) => !!w.querySelector("[aria-hidden=true]")) && !!document.querySelector("[data-testid=mcp-snippet] [data-overflowing]")', message: 'an overflowing snippet block has no fade edge' },
];
// Profile read fails with 503 (open breaker): the dashboard shell renders with the retry banner — no onboarding redirect (M1-D3).
const profileUnavailable = [
  { wait: '[data-testid="profile-unavailable-banner"]' },
  { wait: '[data-testid="cockpit-row"]' },
  { sleep: 600 },
  { assert: 'location.pathname === "/"', message: 'a 503 profile read navigated away from the shell' },
];

// Memory Detail renders markdown (RD-1, fixtures/pages.mjs "Vault-imported memories"):
// search the vault notes, open the playbook, wait for the link-row target to resolve
// and the backlinks to load. Asserts: no raw markdown, 2 resolved + 1 unresolved
// wikilink, a backlink, and no sideways page scroll.
const MD = '[data-testid="memory-markdown"]';
const openPlaybook = [
  { wait: '[aria-label="Search memories"]' },
  { type: { selector: '[aria-label="Search memories"]', text: 'pricing playbook' } },
  { wait: 'button:has(h3:text-is("Pricing playbook"))' },
  { click: 'button:has(h3:text-is("Pricing playbook"))' },
  { wait: `${MD} table` },
  { wait: `${MD} [data-testid="wikilink"][data-memory-id="m-vault-prepay"]` },
  { wait: '[data-testid="backlink"]' },
  { sleep: 400 },
  { assert: `!/\\*\\*|\\[\\[|^#/m.test(document.querySelector('${MD}').innerText)`, message: 'raw markdown syntax is visible in Memory Detail' },
  { assert: `document.querySelectorAll('${MD} [data-testid="wikilink"][data-resolved="true"]').length === 2 && document.querySelectorAll('${MD} [data-testid="wikilink"][data-resolved="false"]').length === 1`, message: 'expected 2 resolved + 1 unresolved wikilinks' },
  { assert: '[...document.querySelectorAll("[data-testid=backlink]")].some((b) => b.textContent.includes("Q3 pricing retro"))', message: 'the backlink is missing from "Linked from"' },
];
const MD_CONTRAST = [
  { selector: `${MD} p`, label: 'markdown body' },
  { selector: `${MD} [data-testid="wikilink"][data-resolved="true"]`, label: 'wikilink (resolved)' },
  { selector: `${MD} [data-testid="wikilink"][data-resolved="false"]`, label: 'wikilink (not imported)' },
  { selector: `${MD} th`, label: 'table header' },
  { selector: `${MD} td`, label: 'table cell' },
];
const LOWER_CONTRAST = [
  { selector: `${MD} blockquote p`, label: 'block quote' },
  { selector: `${MD} ol li`, label: 'ordered list item' },
  { selector: '[data-testid="backlink"] span', label: 'backlink title' },
];
const scrollToBacklinks = [
  { evaluate: 'document.querySelector(\'[data-testid="memory-backlinks"]\').scrollIntoView({ block: "end" })' },
  { sleep: 300 },
];
const TABLE_SCROLLS_IN_PANEL = [
  { evaluate: `document.querySelector('${MD} [data-testid="markdown-table-scroll"]').scrollIntoView({ block: 'center' })` },
  { sleep: 300 },
  { noOverflowX: ['#main-content'] },
  { assert: `(() => { const r = document.querySelector('${MD} [data-testid="markdown-table-scroll"]'); return r.scrollWidth > r.clientWidth; })()`, message: 'the wide table does not overflow its own scroll region at this width' },
];
// Keyboard: focus the resolved wikilink, press Enter → the target opens and its title takes focus.
const openWikilinkByKeyboard = [
  ...openPlaybook,
  { evaluate: `document.querySelector('${MD} [data-testid="wikilink"][data-memory-id="m-vault-prepay"]').focus()` },
  { press: 'Enter' },
  { wait: '[data-memory-title]:text-is("Annual prepay terms")' },
  { wait: '[data-testid="backlink"]' },
  { sleep: 400 },
  { assert: 'document.activeElement && document.activeElement.hasAttribute("data-memory-title")', message: 'focus did not move to the opened memory title' },
];

// ── Page sets ─────────────────────────────────────────────────────────────────
export function pageSets({ legacy = false } = {}) {
  const dash = legacy ? waitLegacyDashboard : waitDashboard;
  const graph = (name) => DEFAULT_PAGES.find((p) => p.name === name);

  const desktop = [
    { name: 'dashboard', path: '/', actions: [...dash, ...settle] },
    ...(legacy ? [] : [{ name: 'profile-unavailable', path: '/?state=profile-unavailable', actions: profileUnavailable }]),
    {
      name: 'dashboard-scrolled', path: '/',
      actions: [...dash, ...scrollUnderHeader, ...(legacy ? [] : [{ assert: '!!document.querySelector("header[data-scrolled]")', message: 'header did not flip data-scrolled after scrolling' }])],
      contrast: [HEADER_TITLE, HEADER_SEARCH, HEADER_KBD],
    },
    { name: 'dashboard-configurator', path: '/', actions: [...dash, ...openConfigurator], contrast: legacy ? [] : [SHEET_TITLE] },
    {
      name: 'settings', path: '/settings',
      actions: legacy
        ? [{ wait: 'select' }, { sleep: 400 }]
        : [{ wait: '#decision-frequency' }, { click: '#decision-frequency' }, { wait: '[role="listbox"]' }, { sleep: 300 }],
    },
    { ...graph('memory-explorer') },
    ...(legacy ? [] : [
      { name: 'memory-markdown', path: '/memory', actions: [...openPlaybook, { noOverflowX: ['#main-content'] }], contrast: MD_CONTRAST },
      { name: 'memory-markdown-table', path: '/memory', actions: [...openPlaybook, ...TABLE_SCROLLS_IN_PANEL.filter((s) => !s.assert)] },
      { name: 'memory-markdown-backlinks', path: '/memory', actions: [...openPlaybook, ...scrollToBacklinks], contrast: LOWER_CONTRAST },
      { name: 'memory-wikilink-open', path: '/memory', actions: openWikilinkByKeyboard },
    ]),
    {
      name: 'decision-new', path: '/decisions/new',
      actions: legacy ? [{ wait: 'textarea' }, { sleep: 400 }] : [{ wait: '[data-testid="mode-selector"]' }, { sleep: 400 }],
      contrast: legacy ? [] : [SEGMENT_ACTIVE, SEGMENT_IDLE],
    },
    {
      name: 'decision-session', path: '/decisions/s-visual',
      actions: legacy
        ? [{ wait: 'text=CEO Synthesis' }, { sleep: 600 }]
        : [{ wait: '[data-testid="synthesis-panel"]' }, { sleep: 400 }, { click: '[aria-label="Open synthesis as a sheet"]' }, { wait: '[data-testid="synthesis-sheet-body"]' }, { sleep: 500 }],
      contrast: legacy ? [] : [SHEET_TITLE],
    },
    ...(legacy ? [] : [
      { name: 'decision-session-streaming', path: '/decisions/s-stream', actions: streamMid },
      { name: 'decision-session-error', path: '/decisions/s-stream-error', actions: afterError },
    ]),
    { ...graph('graph-global'), measure: false, actions: [...graph('graph-global').actions, { hoverCanvas: { selector: '[data-testid="knowledge-graph-view"] canvas', until: '[data-testid="graph-tooltip"]' } }, { sleep: 350 }], contrast: [LEGEND_LABEL, LEGEND_COUNT, LEGEND_OFF, HOVER_TITLE, HOVER_META] },
    { ...graph('graph-local'), contrast: [LEGEND_LABEL, LEGEND_COUNT] },
    { ...graph('graph-spotlight'), contrast: [LEGEND_LABEL] },
    { ...graph('graph-timeline'), contrast: [LEGEND_LABEL] },
    // Route transition, captured mid-flight: slow the animation to 6 s, click
    // the Memory link, screenshot while both pages are on screen. The asserts
    // check the wiring (types tagged forward on the click, back on history.back()).
    {
      name: 'route-transition', path: '/',
      actions: legacy ? [...dash] : [
        ...dash,
        { assert: HAS_VT, message: 'this Chromium has no View Transition API' },
        { style: SLOW_VT },
        { click: 'aside a[href="/memory"]' },
        { sleep: 700 },
      ],
    },
    {
      name: 'route-transition-back', path: '/',
      actions: legacy ? [...dash] : [
        ...dash,
        { click: 'aside a[href="/memory"]' }, { wait: '[aria-label="Search memories"]' }, { sleep: 500 },
        { assert: '(window.__vt || []).some((t) => t.includes("nav-forward"))', message: 'forward navigation was not tagged nav-forward' },
        { style: SLOW_VT },
        { evaluate: 'history.back()' },
        { sleep: 700 },
        { assert: '(window.__vt || []).some((t) => t.includes("nav-back"))', message: 'back navigation was not tagged nav-back' },
        { assert: '!!document.querySelector("[data-page-root]")', message: 'page root missing' },
      ],
    },
  ];

  const mobile = [
    { name: 'dashboard-mobile', path: '/', actions: [...dash, ...settle] },
    ...(legacy ? [] : [{ name: 'profile-unavailable-mobile', path: '/?state=profile-unavailable', actions: profileUnavailable }]),
    ...(legacy ? [] : [
      { name: 'decision-session-streaming-mobile', path: '/decisions/s-stream', actions: streamMid },
      // Mobile stacks the cards: scroll the failed one into view before the shot.
      { name: 'decision-session-error-mobile', path: '/decisions/s-stream-error', actions: [...afterError, { evaluate: 'document.querySelector("[data-testid=persona-card][data-state=error]").scrollIntoView({ block: "center" })' }, { sleep: 300 }] },
    ]),
    {
      name: 'decision-session-sheet-mobile', path: '/decisions/s-visual',
      actions: legacy
        ? [{ wait: 'text=CEO Synthesis' }, { sleep: 600 }]
        : [{ wait: '[data-testid="synthesis-panel"]' }, { click: '[aria-label="Open synthesis as a sheet"]' }, { wait: '[data-testid="sheet-grabber"]' }, { sleep: 500 }],
      contrast: legacy ? [] : [SHEET_TITLE],
    },
    ...(legacy ? [] : [
      // The detail stacks under the list on a phone: bring the note into view; the wide table must scroll inside its region.
      { name: 'memory-markdown-mobile', path: '/memory', actions: [...openPlaybook, { evaluate: 'document.querySelector(\'[data-testid="memory-detail"]\').scrollIntoView({ block: "start" })' }, { sleep: 300 }, { noOverflowX: ['#main-content'] }], contrast: MD_CONTRAST },
      { name: 'memory-markdown-backlinks-mobile', path: '/memory', actions: [...openPlaybook, ...scrollToBacklinks, { noOverflowX: ['#main-content'] }], contrast: LOWER_CONTRAST },
      { name: 'memory-markdown-table-mobile', path: '/memory', actions: [...openPlaybook, ...TABLE_SCROLLS_IN_PANEL] },
    ]),
  ];

  // Reduced motion: materials unchanged, every transition collapsed, no drag handle on the sheet.
  const reducedMotion = [
    { name: 'dashboard', path: '/', actions: [...dash, ...settle] },
    { ...graph('graph-global'), measure: false },
    {
      name: 'dashboard-configurator', path: '/',
      actions: [...dash, ...openConfigurator, ...(legacy ? [] : [
        { assert: 'parseFloat(getComputedStyle(document.querySelector("[role=dialog]")).transitionDuration) <= 0.001', message: 'dialog transition did not collapse under reduced motion' },
      ])],
    },
  ];
  const reducedMotionMobile = legacy ? [] : [
    {
      name: 'decision-session-sheet-mobile', path: '/decisions/s-visual',
      actions: [{ wait: '[data-testid="synthesis-panel"]' }, { click: '[aria-label="Open synthesis as a sheet"]' }, { wait: '[data-testid="synthesis-sheet-body"]' }, { sleep: 300 },
        { assert: '!document.querySelector("[data-testid=sheet-grabber]")', message: 'drag grabber rendered under reduced motion' }],
    },
  ];

  // Reduced transparency (class toggle, see index.css): every material falls back to a solid card surface.
  const reducedTransparency = [
    {
      name: 'dashboard-scrolled', path: '/',
      actions: [...dash, ...scrollUnderHeader, ...(legacy ? [] : [
        { assert: 'getComputedStyle(document.querySelector("header")).backdropFilter === "none"', message: 'header still blurs under reduced transparency' },
      ])],
      contrast: [HEADER_TITLE, HEADER_SEARCH],
    },
    {
      ...graph('graph-global'), measure: false,
      actions: [...graph('graph-global').actions, ...(legacy ? [] : [
        { assert: 'getComputedStyle(document.querySelector("[data-testid=graph-legend]")).backdropFilter === "none"', message: 'legend still blurs under reduced transparency' },
      ])],
      contrast: [LEGEND_LABEL, LEGEND_COUNT],
    },
    { name: 'dashboard-configurator', path: '/', actions: [...dash, ...openConfigurator] },
  ];

  // No sideways scroll on the one-time token reveal, shot at 1280 px and 390 px (M1-D3).
  const overflow = [{ name: 'token-created-long-url', path: '/settings?state=token-created-long-url', actions: tokenCreatedLongUrl }];

  return { desktop, mobile, reducedMotion, reducedMotionMobile, reducedTransparency, overflow };
}

/** pages.mjs first, then the dashboard data, then every other fixture. */
export async function pagesMock() {
  const others = (await loadRoutes()).filter((r) => r.file !== 'dashboard.mjs' && r.file !== 'pages.mjs');
  const mine = pagesFixture.routes.map((r) => ({ ...r, file: 'pages.mjs' }));
  const dash = dashboardFixture.routes.map((r) => ({ ...r, file: 'dashboard.mjs' }));
  return createMockApi({ routes: [...mine, ...dash, ...others] });
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
// Init scripts run before <html> exists; apply the class as soon as it does.
const REDUCE_TRANSPARENCY = '(() => { const apply = () => { if (document.documentElement) document.documentElement.classList.add("reduce-transparency"); }; apply(); document.addEventListener("readystatechange", apply); document.addEventListener("DOMContentLoaded", apply); })()';

export async function shootAllPages({ round = 'phase-c-round-1', outRoot = PAGES_OUT, dist = CLIENT_DIST, only, themes, legacy = false, skipVariants = false, gold = 'default', log = console.log } = {}) {
  const outDir = join(outRoot, round);
  mkdirSync(outDir, { recursive: true });
  const mock = await pagesMock();
  const { server, baseUrl } = await startServer({ dist, mock });
  const sets = pageSets({ legacy });
  // Brand-gold variant (M1-D1): `data-gold="<variant>"` on <html> before the app paints; shots get a `--gold-<variant>` suffix.
  const goldScript = gold && gold !== 'default'
    ? `; (() => { const apply = () => { if (document.documentElement) document.documentElement.dataset.gold = ${JSON.stringify(gold)}; }; apply(); document.addEventListener("readystatechange", apply); })()`
    : '';
  const g = goldScript ? `--gold-${gold}` : '';
  const base = { baseUrl, themes, onlyNames: only, log, initScript: `${RECORD_VT}${goldScript}`, suffix: g || undefined };
  const results = [];
  try {
    results.push(...await shootPages(sets.desktop, outDir, { ...base, viewport: DESKTOP }));
    results.push(...await shootPages(sets.mobile, outDir, { ...base, viewport: MOBILE }));
    results.push(...await shootPages(sets.overflow, outDir, { ...base, viewport: LAPTOP, suffix: `-1280${g}` }));
    results.push(...await shootPages(sets.overflow, outDir, { ...base, viewport: MOBILE, suffix: `-390${g}` }));
    if (!skipVariants) {
      results.push(...await shootPages(sets.reducedMotion, outDir, { ...base, viewport: DESKTOP, reducedMotion: 'reduce', suffix: `--reduced-motion${g}` }));
      results.push(...await shootPages(sets.reducedMotionMobile, outDir, { ...base, viewport: MOBILE, reducedMotion: 'reduce', suffix: `--reduced-motion${g}` }));
      results.push(...await shootPages(sets.reducedTransparency, outDir, { ...base, viewport: DESKTOP, suffix: `--reduced-transparency${g}`, initScript: `${RECORD_VT}; ${REDUCE_TRANSPARENCY}${goldScript}` }));
    }
  } finally {
    server.close();
  }
  const contrast = results.flatMap((r) => (r.contrast ?? []).map((c) => ({ shot: `${r.name} [${r.theme}]`, ...c })));
  const contrastFailures = contrast.filter((c) => !c.error && !c.pass);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ shotAt: new Date().toISOString(), round, dist, legacy, threshold: WCAG_AA, results, contrast, contrastFailures }, null, 2));
  return { outDir, results, contrast, contrastFailures };
}

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const round = arg('--round', 'phase-c-round-1');
  const distArg = arg('--dist', null);
  const dist = distArg ? resolve(distArg) : CLIENT_DIST;
  if (!existsSync(join(dist, 'index.html'))) { console.error(`No build at ${dist}`); process.exit(1); }
  const only = arg('--only', null)?.split(',');
  const theme = arg('--theme', null);
  const legacy = process.argv.includes('--legacy');
  const skipVariants = process.argv.includes('--skip-variants');
  const gold = arg('--gold', 'default');
  const gate = !process.argv.includes('--no-gate');
  const { outDir, results, contrast, contrastFailures } = await shootAllPages({ round, outRoot: arg('--out', PAGES_OUT), dist, only, themes: theme ? [theme] : undefined, legacy, skipVariants, gold });
  const failed = results.filter((r) => r.error);
  console.log(`\n${results.length - failed.length}/${results.length} shots saved under ${outDir}`);
  for (const r of results) if (r.errors?.length) console.log(`  ${r.name} [${r.theme}] console errors: ${r.errors.join(' | ').slice(0, 300)}`);
  if (contrast.length) console.log(`\nContrast on glass (threshold ${WCAG_AA}:1)\n${formatContrastTable(contrast)}`);
  if (contrastFailures.length) console.log(`\n${contrastFailures.length} contrast sample(s) below ${WCAG_AA}:1${gate ? ' — failing the shoot' : ''}`);
  if (failed.length || (gate && contrastFailures.length)) process.exitCode = 1;
}
