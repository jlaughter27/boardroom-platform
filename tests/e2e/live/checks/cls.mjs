// Journey check (M1-C1): cumulative layout shift during a persona dispatch stays ≤ 0.05.
//
// Loaded by tests/e2e/live/journey.mjs (checks autoloader): default export
// `{ name, run({ page, api, mcp, metrics }) }`.
//
// What it does:
//   1. Creates a `decide` session through BoardRoom (`POST /api/sessions`).
//   2. Opens /decisions/:id — the stored question with Analyze (M1-C3).
//   3. Starts a `layout-shift` PerformanceObserver, clicks Analyze, and waits for
//      the dispatch to finish (the sticky footer shows the CEO step).
//   4. Scores CLS the way the Web Vitals metric does — the largest session window
//      (shifts < 1 s apart, window ≤ 5 s), ignoring shifts within 500 ms of input —
//      and asserts it is ≤ 0.05. The raw sum of non-input shifts is reported too.
//
// The sandbox stack has no LLM key, so by default the dispatch stream is the
// deterministic replay of four real persona responses from
// tools/visual-preview/fixtures/session-stream.mjs (`full`: deltas → complete,
// one rebuttal, dispatch_complete), served to the page by a fetch shim for this
// session's /dispatch URL only. The client renders exactly what it would for the
// server's stream. With a real key, `E2E_REAL_DISPATCH=1` uses the live server.
//
// Standalone (no live stack): serves client/dist with the visual-preview mock API.
//   pnpm --filter @boardroom/boardroom-ai build && node tests/e2e/live/checks/cls.mjs --standalone

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { dispatchScript, STREAM_QUESTION } from '../../../../tools/visual-preview/fixtures/session-stream.mjs';

export const CLS_BUDGET = 0.05;

/** Browser-side: serve `events` as an SSE body for fetches whose URL contains `match`. */
function installDispatchShim({ match, events }) {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes(match)) return original(input, init);
    const encoder = new TextEncoder();
    const timers = [];
    const body = new ReadableStream({
      start(controller) {
        for (const { at, event } of events) {
          timers.push(setTimeout(() => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)), at));
        }
        const end = Math.max(0, ...events.map((e) => e.at)) + 40;
        timers.push(setTimeout(() => controller.close(), end));
        init?.signal?.addEventListener('abort', () => {
          timers.forEach(clearTimeout);
          try { controller.error(new DOMException('The user aborted a request.', 'AbortError')); } catch { /* closed */ }
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  };
}

/** Browser-side: start recording layout shifts. */
function startLayoutShiftRecorder() {
  window.__layoutShifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__layoutShifts.push({
        value: e.value, startTime: e.startTime, hadRecentInput: e.hadRecentInput,
        sources: (e.sources ?? []).map((s) => {
          const id = s.node?.closest?.('[data-testid]')?.getAttribute('data-testid') ?? s.node?.nodeName ?? '?';
          const state = s.node?.closest?.('[data-state]')?.getAttribute('data-state');
          return `${id}${state ? `:${state}` : ''} y${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}`;
        }),
      });
    }
  }).observe({ type: 'layout-shift', buffered: false });
}

/** Web Vitals CLS: max session window (gap < 1 s, span ≤ 5 s) over shifts without recent input. */
export function scoreCls(shifts) {
  const counted = shifts.filter((s) => !s.hadRecentInput).sort((a, b) => a.startTime - b.startTime);
  let best = 0;
  let windowValue = 0;
  let windowStart = 0;
  let prev = -Infinity;
  for (const s of counted) {
    if (s.startTime - prev >= 1000 || s.startTime - windowStart > 5000) { windowValue = 0; windowStart = s.startTime; }
    windowValue += s.value;
    prev = s.startTime;
    best = Math.max(best, windowValue);
  }
  return { cls: +best.toFixed(4), sum: +counted.reduce((a, s) => a + s.value, 0).toFixed(4), counted: counted.length, ignored: shifts.length - counted.length };
}

export async function run({ page, api, metrics }) {
  const created = await api.request.post(`${api.app}/api/sessions`, { data: { question: STREAM_QUESTION, mode: 'decide' } });
  if (![200, 201].includes(created.status())) throw new Error(`POST /api/sessions ${created.status()} ${await created.text()}`);
  const body = await created.json();
  const sessionId = body.sessionId ?? body.id;
  if (!sessionId) throw new Error(`no session id in ${JSON.stringify(body).slice(0, 200)}`);

  const replay = process.env.E2E_REAL_DISPATCH !== '1';
  if (replay) {
    const { events } = dispatchScript('full');
    await page.addInitScript(installDispatchShim, { match: `/sessions/${sessionId}/dispatch`, events });
  }

  await page.goto(`${api.app}/decisions/${sessionId}`, { waitUntil: 'networkidle' });
  const review = page.getByTestId('session-review');
  await review.waitFor({ timeout: 15000 });
  if (!(await review.getByRole('heading', { level: 1 }).innerText()).includes('per-seat')) throw new Error('the stored question is not the H1');
  await page.waitForTimeout(400); // let the entrance settle before measuring

  await page.evaluate(startLayoutShiftRecorder);
  await review.getByRole('button', { name: 'Analyze' }).click();
  await page.locator('[data-testid="persona-card"][data-state="streaming"]').first().waitFor({ timeout: 15000 });
  if (metrics?.shot) await metrics.shot('cls-mid-dispatch');
  const footer = page.getByTestId('session-footer');
  await footer.getByRole('button', { name: /Synthesize/ }).waitFor({ timeout: replay ? 30000 : 180000 });
  await page.waitForTimeout(600); // trailing shifts after dispatch_complete count too
  if (metrics?.shot) await metrics.shot('cls-after-dispatch');

  const shifts = await page.evaluate(() => window.__layoutShifts ?? []);
  const score = scoreCls(shifts);
  const worst = shifts.filter((s) => !s.hadRecentInput).sort((a, b) => b.value - a.value).slice(0, 3)
    .map((s) => `${s.value.toFixed(4)}@${Math.round(s.startTime)}ms[${s.sources.join(',')}]`);
  if (score.cls > CLS_BUDGET) throw new Error(`CLS ${score.cls} > ${CLS_BUDGET} during dispatch (worst: ${worst.join(' ')})`);
  return { ...score, budget: CLS_BUDGET, stream: replay ? 'replay(full)' : 'live', sessionId, worst };
}

export default { name: 'CLS ≤ 0.05 during dispatch', run };

// ── Standalone: client/dist + the visual-preview mock API, light theme, 1440×900 ──
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes('--standalone')) {
  const { startServer } = await import('../../../../tools/visual-preview/shoot.mjs');
  const { pagesMock } = await import('../../../../tools/visual-preview/shoot-pages.mjs');
  const require = createRequire(import.meta.url);
  let pw;
  for (const p of [resolve(fileURLToPath(import.meta.url), '../../../../..'), '/opt/node-tools/node_modules']) {
    try { pw = require(require.resolve('playwright', { paths: [p] })); break; } catch { /* next */ }
  }
  if (!pw) throw new Error('playwright not found');
  const { server, baseUrl } = await startServer({ mock: await pagesMock() });
  const browser = await pw.chromium.launch({ headless: true }).catch(() =>
    pw.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
  let failed = false;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, colorScheme: 'light' });
      const page = await context.newPage();
      try {
        const result = await run({ page, api: { app: baseUrl, request: page.request } });
        console.log(`✓ CLS ${viewport.width}×${viewport.height}: ${JSON.stringify(result)}`);
      } catch (e) {
        failed = true;
        console.log(`× CLS ${viewport.width}×${viewport.height}: ${e.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failed ? 1 : 0);
}
