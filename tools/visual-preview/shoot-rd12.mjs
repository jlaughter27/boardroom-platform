#!/usr/bin/env node
// RD-12 visual proof: "Waiting on others" in the nudges widget, the Delegate
// dialog from a committed decision and from a task, and the uncommitted hint —
// light + dark, desktop + 390 px, with the contrast gate (4.5:1).
//
//   node tools/visual-preview/shoot-rd12.mjs --round rd-12-round-1 [--only rd12-dialog-decision] [--no-gate]
//
// Fixtures: fixtures/delegation-data.mjs (mounted first via fixtures/pages.mjs).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shootPages, startServer, CLIENT_DIST } from './shoot.mjs';
import { pagesMock, PAGES_OUT } from './shoot-pages.mjs';
import { WCAG_AA } from './contrast.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const round = arg('--round', 'rd-12-round-1');
const only = arg('--only', null)?.split(',');
const gate = !process.argv.includes('--no-gate');

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const waitDash = [{ wait: '[data-testid="cockpit-row"]' }, { wait: '[data-testid="waiting-on-others"]', timeout: 20000 }];
const toWaiting = [{ evaluate: 'document.querySelector(\'[data-testid="commitment-nudges"]\').scrollIntoView({ block: "start" })' }, { sleep: 500 }];
const toWaitingSection = [{ evaluate: 'document.querySelector(\'[data-testid="waiting-on-others"]\').scrollIntoView({ block: "center" })' }, { sleep: 500 }];
const NOT_TO = { assert: '!document.querySelector(\'[data-testid="waiting-on-others"]\').textContent.includes("to Sam")', message: 'a delegation reads "to {name}"' };

const WAITING_META = { selector: '[data-testid="waiting-row"] p:nth-child(2)', label: 'waiting row meta' };
const WAITING_TITLE = { selector: '[data-testid="waiting-on-others"] h3', label: 'waiting section title' };
const WAITING_ACTION = { selector: '[data-testid="waiting-row"] button', label: 'row action' };
const DIALOG_TITLE = { selector: '[role="dialog"] h2', label: 'dialog title' };
const DIALOG_LABEL = { selector: '[data-testid="delegate-dialog"] label', label: 'field label' };
const DIALOG_NOTE = { selector: '[data-testid="delegate-brief-note"]', label: 'muted note' };
const DIALOG_SECONDARY = { selector: '[data-testid="delegate-dialog"] button:has-text("Copy only")', label: 'Copy only' };
const DIALOG_PREVIEW = { selector: '[data-testid="delegate-preview"]', label: 'brief preview' };
const DISABLED_REASON = { selector: '[data-testid="delegate-disabled-reason"]', label: 'commit hint' };

const openDecisionDialog = [
  { wait: '[data-testid="synthesis-panel"] button[aria-label^="Delegate:"]', timeout: 20000 },
  { click: '[data-testid="synthesis-panel"] button[aria-label^="Delegate:"]' },
  { wait: '[data-testid="delegate-dialog"]' }, { sleep: 400 },
  { click: '[data-testid="delegate-dialog"] ul[aria-label="People"] button:has-text("Sam Ortiz")' },
  { click: '[data-testid="delegate-dialog"] label:has-text("We decided") input' },
  { sleep: 500 },
];

// Scroll the dialog's own scroll container to the end, the way a finger would — scrollIntoView
// would also shift the fixed bottom sheet itself on a phone.
const SCROLL_DIALOG_TO_END = `(() => { const body = document.querySelector('[data-testid="delegate-dialog"]').parentElement; body.scrollTop = body.scrollHeight; return body.scrollTop; })()`;
const SCROLLED = { assert: 'document.querySelector(\'[data-testid="delegate-dialog"]\').parentElement.scrollTop > 0', message: 'the dialog body did not scroll' };

const pages = [
  { name: 'rd12-dashboard-waiting', path: '/?state=delegations', actions: [...waitDash, ...toWaiting, NOT_TO], contrast: [WAITING_TITLE, WAITING_META, WAITING_ACTION] },
  { name: 'rd12-dialog-decision', path: '/decisions/s-delegate', actions: openDecisionDialog, contrast: [DIALOG_TITLE, DIALOG_LABEL] },
  {
    name: 'rd12-dialog-decision-preview', path: '/decisions/s-delegate',
    actions: [...openDecisionDialog, { evaluate: SCROLL_DIALOG_TO_END }, { sleep: 400 }, SCROLLED],
    contrast: [DIALOG_NOTE, DIALOG_SECONDARY],
  },
  {
    name: 'rd12-decision-next-actions', path: '/decisions/s-delegate',
    actions: [{ wait: '[data-testid="synthesis-panel"] button[aria-label^="Delegate:"]', timeout: 20000 }, { evaluate: 'document.querySelector(\'[data-testid="synthesis-panel"] button[aria-label^="Delegate:"]\').scrollIntoView({ block: "center" })' }, { sleep: 400 }],
  },
  {
    name: 'rd12-decision-uncommitted', path: '/decisions/s-visual',
    actions: [{ wait: '[data-testid="delegate-disabled-reason"]', timeout: 20000 }, { evaluate: 'document.querySelector(\'[data-testid="delegate-disabled-reason"]\').scrollIntoView({ block: "center" })' }, { sleep: 400 }],
    contrast: [DISABLED_REASON],
  },
];

// Entry B: open the first goal that has projects, then its first project, and bring a task's Delegate button into view.
const OPEN_TREE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = [...document.querySelectorAll('h2')].find((h) => h.textContent.includes('Goals'))?.closest('.space-y-3');
  if (!tree) return false;
  for (const goalBtn of tree.querySelectorAll(':scope > div > div > button, :scope > div > div:first-child > button')) {
    goalBtn.click(); await sleep(250);
    const projBtn = tree.querySelector('.ml-6 > div > button');
    if (projBtn) { projBtn.click(); await sleep(300); break; }
    goalBtn.click(); await sleep(100);
  }
  const btn = tree.querySelector('button[aria-label^="Delegate:"]');
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' });
  return true;
})()`;
const TASK_DELEGATE = { assert: '!!document.querySelector(\'button[aria-label^="Delegate:"]\')', message: 'no task Delegate button in the goal tree' };
const taskPages = [
  { name: 'rd12-task-delegate', path: '/', actions: [{ wait: '[data-testid="cockpit-row"]' }, { wait: 'h2:has-text("Goals")', timeout: 20000 }, { evaluate: OPEN_TREE }, { sleep: 500 }, TASK_DELEGATE] },
  { name: 'rd12-task-dialog', path: '/', actions: [{ wait: '[data-testid="cockpit-row"]' }, { wait: 'h2:has-text("Goals")', timeout: 20000 }, { evaluate: OPEN_TREE }, { sleep: 300 }, { evaluate: 'document.querySelector(\'button[aria-label^="Delegate:"]\').click()' }, { wait: '[data-testid="delegate-dialog"]' }, { sleep: 600 }], contrast: [DIALOG_TITLE, DIALOG_LABEL] },
];

const mobileOnly = [
  { name: 'rd12-dashboard-waiting-rows', path: '/?state=delegations', actions: [...waitDash, ...toWaitingSection, NOT_TO], contrast: [WAITING_META, WAITING_ACTION] },
];

const outDir = join(PAGES_OUT, round);
mkdirSync(outDir, { recursive: true });
const mock = await pagesMock();
const { server, baseUrl } = await startServer({ dist: CLIENT_DIST, mock });
const results = [];
try {
  results.push(...await shootPages([...pages, ...taskPages], outDir, { baseUrl, onlyNames: only, viewport: DESKTOP }));
  results.push(...await shootPages([...pages, ...taskPages, ...mobileOnly], outDir, { baseUrl, onlyNames: only, viewport: MOBILE, suffix: '-390' }));
} finally {
  server.close();
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(results, null, 2));
for (const r of results) for (const c of r.contrast ?? []) console.log(`${r.name} [${r.theme}] ${c.label}: ${c.error ? `skipped (${c.error})` : `${c.ratio}:1`}`);
const failures = results.flatMap((r) => (r.contrast ?? []).filter((c) => c.ratio != null && c.ratio < WCAG_AA).map((c) => `${r.file ?? r.name}: ${c.label} ${c.ratio}`));
const errors = results.filter((r) => r.error).map((r) => `${r.file ?? r.name}: ${r.error}`);
console.log(`\n${results.length} shots → ${outDir}`);
if (errors.length) { console.log(`errors:\n${errors.join('\n')}`); process.exitCode = 1; }
if (failures.length) { console.log(`contrast below ${WCAG_AA}:1:\n${failures.join('\n')}`); if (gate) process.exitCode = 1; }
else console.log(`contrast gate: every sampled target ≥ ${WCAG_AA}:1`);
