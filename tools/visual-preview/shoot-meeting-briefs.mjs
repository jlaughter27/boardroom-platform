#!/usr/bin/env node
// RD-13 visual harness: the dashboard "Meeting prep · next 24 h" card in each
// state (connected collapsed / expanded, no meetings, not connected,
// unavailable), light + dark, desktop (1440×900) + phone (390×844), with the
// contrast gate on every text role the card introduces.
//
//   node tools/visual-preview/shoot-meeting-briefs.mjs --round rd-13-round-1
//   node tools/visual-preview/shoot-meeting-briefs.mjs --only connected-expanded --theme dark
//   node tools/visual-preview/shoot-meeting-briefs.mjs --no-gate
//
// The state is picked with the `rd13-briefs` cookie read by
// fixtures/meeting-briefs.mjs. Dashboard + meeting-brief routes are mounted
// first (as in shoot-dashboard.mjs), then every other fixture.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shootPages, startServer, CLIENT_DIST } from './shoot.mjs';
import { createMockApi, loadRoutes } from './mock-api.mjs';
import { formatContrastTable, WCAG_AA } from './contrast.mjs';
import dashboardFixture from './fixtures/dashboard.mjs';
import briefsFixture from './fixtures/meeting-briefs.mjs';

export const BRIEFS_OUT = '/tmp/claude-0/-home-user-boardroom-platform/504cfb7a-9286-5499-939f-f39cadb31197/scratchpad/visual';

const CARD = '[data-testid="meeting-briefs"]';
const ROW1 = `${CARD} [data-testid="meeting-brief-row"]:nth-child(1)`;
const ROW2 = `${CARD} [data-testid="meeting-brief-row"]:nth-child(2)`;
const C = {
  title: { selector: `${CARD} h3`, label: 'card title' },
  time: { selector: `${ROW1} [data-testid="meeting-brief-time"]`, label: 'time' },
  timeInline: { selector: `${ROW1} [data-testid="meeting-brief-time-inline"]`, label: 'time (phone)' },
  eventTitle: { selector: `${ROW1} [data-testid="meeting-brief-title"]`, label: 'event title' },
  chip: { selector: `${ROW1} [data-testid="meeting-brief-chip"]`, label: 'person chip' },
  more: { selector: `${ROW2} [data-testid="meeting-brief-more"]`, label: '+N' },
  headline: { selector: `${ROW1} [data-testid="meeting-brief-headline"]`, label: 'collapsed headline' },
  detailName: { selector: `${ROW1} [data-testid="brief-p-avery"] > p`, label: 'detail name' },
  section: { selector: `${ROW1} [data-section="You owe"] > p`, label: 'section label' },
  item: { selector: `${ROW1} [data-section="You owe"] li`, label: 'section item' },
  overdue: { selector: `${ROW1} [data-section="You owe"] li .text-danger`, label: 'overdue meta' },
  meta: { selector: `${ROW1} [data-section="They owe you"] li span`, label: 'item meta' },
  moreItems: { selector: `${ROW1} [data-section="Recent"] li:last-child`, label: '+N more' },
  capsule: { selector: `${ROW1} [data-section="capsule"]`, label: 'capsule' },
  line: { selector: `${CARD} span, p${CARD}`, label: 'muted line' },
  retry: { selector: `${CARD} button`, label: 'Retry' },
  nudge: { selector: 'p.text-sm.font-medium.text-foreground', label: 'nudge title' },
};

const waitShell = [{ wait: '[data-testid="cockpit-row"]' }];
const settle = [{ sleep: 700 }];
// Bring the card's top just under the sticky header.
const toCard = [{ evaluate: `(() => { const c = document.querySelector('${CARD}'); const m = document.querySelector('#main-content'); if (c && m) m.scrollTop += c.getBoundingClientRect().top - 72; })()` }, { sleep: 250 }];
/** The card must not scroll sideways or poke past the viewport (the dashboard itself has a pre-existing phone overflow, so #main-content is not asserted). */
const cardFits = { evaluate: `(() => { const c = document.querySelector('${CARD}'); if (!c) return; const r = c.getBoundingClientRect(); const wide = [...c.querySelectorAll('*')].find((el) => el.getBoundingClientRect().right > r.right + 1); if (r.right > window.innerWidth + 1 || c.scrollWidth > c.clientWidth + 1 || wide) throw new Error('meeting-briefs card overflows: ' + (wide ? wide.outerHTML.slice(0, 120) : Math.round(r.right))); })()` };
const expand = [{ click: `${ROW1} button[aria-expanded]` }, { wait: `${ROW1} button[aria-expanded="true"]` }, { sleep: 300 }];

const STATES = {
  'connected-collapsed': { cookie: 'connected', actions: [...waitShell, { wait: CARD }, ...settle, ...toCard], contrast: [C.title, C.time, C.eventTitle, C.chip, C.more, C.headline] },
  'connected-expanded': { cookie: 'connected', actions: [...waitShell, { wait: CARD }, ...expand, ...settle, ...toCard], contrast: [C.detailName, C.section, C.item, C.overdue, C.meta, C.moreItems, C.capsule] },
  empty: { cookie: 'empty', actions: [...waitShell, { wait: CARD }, ...settle], contrast: [C.line] },
  unavailable: { cookie: 'unavailable', actions: [...waitShell, { wait: CARD }, ...settle], contrast: [C.line, C.retry] },
  // No cookie → `not_configured`: the card renders nothing (the pre-RD-13 dashboard).
  baseline: { cookie: 'none', actions: [...waitShell, ...settle], contrast: [] },
  'not-connected': { cookie: 'not_connected', actions: [...waitShell, { wait: 'text=Connect your calendar for meeting prep' }, { sleep: 1200 }], contrast: [] },
};

async function briefsMock() {
  const others = (await loadRoutes()).filter((r) => r.file !== 'dashboard.mjs' && r.file !== 'meeting-briefs.mjs');
  const mine = [
    ...briefsFixture.routes.map((r) => ({ ...r, file: 'meeting-briefs.mjs' })),
    ...dashboardFixture.routes.map((r) => ({ ...r, file: 'dashboard.mjs' })),
  ];
  return createMockApi({ routes: [...mine, ...others] });
}

export async function shootMeetingBriefs({ round = 'rd-13-round-1', outRoot = BRIEFS_OUT, dist = CLIENT_DIST, only, themes, log = console.log } = {}) {
  const outDir = join(outRoot, round);
  mkdirSync(outDir, { recursive: true });
  const mock = await briefsMock();
  const { server, baseUrl } = await startServer({ dist, mock });
  const results = [];
  try {
    for (const [name, st] of Object.entries(STATES)) {
      if (only && !only.includes(name)) continue;
      const initScript = `document.cookie = 'rd13-briefs=${st.cookie}; path=/';`;
      for (const [suffix, viewport] of [['', { width: 1440, height: 900 }], ['-mobile', { width: 390, height: 844 }]]) {
        const contrast = suffix ? st.contrast.map((t) => (t === C.time ? C.timeInline : t)) : st.contrast;
        const page = { name: `${name}${suffix}`, path: '/', actions: [...st.actions, cardFits], contrast };
        results.push(...await shootPages([page], outDir, { baseUrl, themes, viewport, initScript, log }));
      }
    }
  } finally {
    server.close();
  }
  const contrast = results.flatMap((r) => (r.contrast ?? []).map((c) => ({ shot: `${r.name} [${r.theme}]`, ...c })));
  const contrastFailures = contrast.filter((c) => !c.error && !c.pass);
  const missing = contrast.filter((c) => c.error);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ shotAt: new Date().toISOString(), round, dist, threshold: WCAG_AA, results, contrast, contrastFailures, missing }, null, 2));
  return { outDir, results, contrast, contrastFailures, missing };
}

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const distArg = arg('--dist', null);
  const dist = distArg ? resolve(distArg) : CLIENT_DIST;
  if (!existsSync(join(dist, 'index.html'))) { console.error(`No build at ${dist}`); process.exit(1); }
  const theme = arg('--theme', null);
  const gate = !process.argv.includes('--no-gate');
  const { outDir, results, contrast, contrastFailures, missing } = await shootMeetingBriefs({
    round: arg('--round', 'rd-13-round-1'), outRoot: arg('--out', BRIEFS_OUT), dist,
    only: arg('--only', null)?.split(','), themes: theme ? [theme] : undefined,
  });
  const failed = results.filter((r) => r.error);
  console.log(`\n${results.length - failed.length}/${results.length} shots saved under ${outDir}`);
  for (const r of results) if (r.errors?.length) console.log(`  ${r.name} [${r.theme}] console errors: ${r.errors.join(' | ').slice(0, 300)}`);
  if (contrast.length) console.log(`\nContrast (threshold ${WCAG_AA}:1)\n${formatContrastTable(contrast)}`);
  if (missing.length) console.log(`\n${missing.length} contrast target(s) not measured`);
  if (contrastFailures.length) console.log(`\n${contrastFailures.length} contrast sample(s) below ${WCAG_AA}:1${gate ? ' — failing the shoot' : ''}`);
  if (failed.length || (gate && (contrastFailures.length || missing.length))) process.exitCode = 1;
}
