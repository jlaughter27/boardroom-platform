// End-to-end journey against the LIVE local stack (no mocks):
//   BoardRoom 3001 (production build) → OmniMind 3333 → Postgres 5433, MCP gateway 3334.
// 1. Browser: register → onboarding gate → mark onboarding complete → dashboard, graph, memory, decisions.
// 2. Browser: Settings → Connected AI tools → mint a token (tenant owner set via admin API first).
// 3. MCP golden path with that token: initialize → tools/list → memory_write → memory_search → status_get.
// 4. Cross-client visibility: BoardRoom GET /memories (same user, same cookie) sees the MCP-written memory.
// 5. Revoke the token in BoardRoom → the next MCP call on the open session is refused.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const here = new URL('../../..', import.meta.url).pathname;
  for (const p of [here, '/opt/node-tools/node_modules', ...(process.env.PLAYWRIGHT_MODULE_PATH ? [process.env.PLAYWRIGHT_MODULE_PATH] : [])]) {
    try { return require(require.resolve('playwright', { paths: [p] })); } catch { /* next */ }
  }
  throw new Error('playwright not found');
}
const pw = loadPlaywright();

const APP = process.env.BOARDROOM_URL ?? 'http://127.0.0.1:3001';
const API = process.env.OMNIMIND_URL ?? 'http://127.0.0.1:3333';
const MCP = process.env.MCP_URL ?? 'http://127.0.0.1:3334/mcp';
const ADMIN_KEY = process.env.OMNIMIND_ADMIN_KEY;
const OUT = process.env.E2E_OUT ?? new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
let step = 0;
async function check(name, fn) {
  step += 1;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ step, name, ok: true, ms: Date.now() - t0, detail: detail ?? null });
    console.log(`✓ ${step}. ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  } catch (err) {
    results.push({ step, name, ok: false, ms: Date.now() - t0, error: String(err?.message ?? err) });
    console.log(`× ${step}. ${name} — ${err?.message ?? err}`);
    try {
      if (globalThis.__page) {
        await globalThis.__page.screenshot({ path: join(OUT, `fail-step-${step}.png`) });
        const text = await globalThis.__page.evaluate(() => document.body.innerText.slice(0, 1500));
        writeFileSync(join(OUT, `fail-step-${step}.txt`), `${globalThis.__page.url()}\n\n${text}`);
      }
    } catch { /* best effort */ }
    throw err;
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const email = `journey-${Date.now()}@boardroom-e2e.test`;
const password = 'JourneyPass123!';
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });

let browser;
let rawToken = null;
let tokenId = null;
let userId = null;
let sessionId = null;
let writtenMemoryId = null;
const marker = `e2e-mcp-${Date.now()}`;

async function mcpCall(method, params, { session, id, token = rawToken } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  if (session) headers['mcp-session-id'] = session;
  const res = await fetch(MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: id ?? Math.floor(Math.random() * 1e6), method, params }),
  });
  const ct = res.headers.get('content-type') ?? '';
  let body = null;
  const text = await res.text();
  if (ct.includes('text/event-stream')) {
    const dataLines = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
    body = dataLines.length ? JSON.parse(dataLines[dataLines.length - 1]) : null;
  } else if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body, sessionId: res.headers.get('mcp-session-id') };
}

try {
  browser = await pw.chromium.launch({ headless: true }).catch(() =>
    pw.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  globalThis.__page = page;
  const consoleErrors = [];
  const apiHits = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.origin === new URL(APP).origin && !/\.(js|css|woff2?|png|svg|ico|webmanifest)$/.test(u.pathname) && u.pathname !== '/' && !u.pathname.startsWith('/assets')) apiHits.push({ t: Date.now(), m: r.method(), p: u.pathname + u.search }); });
  page.on('response', r => { if (r.status() === 429) apiHits.push({ t: Date.now(), m: 'RESP429', p: new URL(r.url()).pathname }); });
  const fanout = (sinceMs) => apiHits.filter(h => h.t >= sinceMs && h.m !== 'RESP429');
  const refused = (sinceMs) => apiHits.filter(h => h.t >= sinceMs && h.m === 'RESP429').map(h => h.p);
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await check('login page renders from the production build', async () => {
    const res = await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
    assert(res.ok(), `status ${res.status()}`);
    await page.getByLabel('Email address').waitFor({ timeout: 10000 });
    await shot(page, '01-login');
  });

  await check('register through the UI', async () => {
    await page.getByRole('button', { name: /sign up free/i }).click();
    await page.getByLabel('Full name').fill('Journey User');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 }),
      page.getByRole('button', { name: /create account|sign up|register|get started/i }).click(),
    ]);
    await shot(page, '02-after-register');
    return page.url();
  });

  await check('new user is gated to onboarding', async () => {
    await page.waitForURL(/\/onboarding/, { timeout: 15000 });
    await shot(page, '03-onboarding');
  });

  await check('auth/me reflects the registered user (httpOnly cookie)', async () => {
    const me = await page.request.get(`${APP}/auth/me`);
    assert(me.ok(), `auth/me ${me.status()}`);
    const body = await me.json();
    assert(body.email === email, `email mismatch ${body.email}`);
    userId = body.userId;
    return { userId };
  });

  await check('mark onboarding complete via PATCH /profile (no LLM in the sandbox)', async () => {
    const r = await page.request.patch(`${APP}/profile`, { data: { onboardingComplete: true } });
    assert(r.ok(), `PATCH /profile ${r.status()} ${await r.text()}`);
  });

  await check('dashboard renders with the cockpit row (real API data, empty account)', async () => {
    const t0 = Date.now();
    await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await page.getByTestId('cockpit-row').waitFor({ timeout: 15000 });
    await shot(page, '04-dashboard');
    const hits = fanout(t0);
    const paths = {}; for (const h of hits) paths[h.p.split('?')[0]] = (paths[h.p.split('?')[0]] ?? 0) + 1;
    return { apiRequests: hits.length, refused429: refused(t0), paths };
  });

  await check('seed memories, a goal and a project through BoardRoom', async () => {
    const mem = async (content, domain, memoryClass) => {
      const r = await page.request.post(`${APP}/memories`, { data: { title: content.slice(0, 48), content, domain, memoryClass, sourceType: 'MANUAL' } });
      assert(r.status() === 201, `POST /memories ${r.status()} ${await r.text()}`);
      return r.json();
    };
    await mem('Priya prefers written decisions before the weekly call.', 'business', 'EPISODIC');
    await mem('Sunday evenings are for the family calendar.', 'personal', 'SEMANTIC');
    const m1 = await mem('Founders churn when the first session takes over four minutes.', 'business', 'SEMANTIC');
    const g = await page.request.post(`${APP}/goals`, { data: { title: 'Reach 100 paying founders', status: 'active', domain: 'business' } });
    assert([200, 201].includes(g.status()), `POST /goals ${g.status()} ${await g.text()}`);
    const goal = await g.json();
    const p = await page.request.post(`${APP}/projects`, { data: { title: 'Knowledge Graph', status: 'active', domain: 'business' } });
    assert([200, 201].includes(p.status()), `POST /projects ${p.status()} ${await p.text()}`);
    const project = await p.json();
    const link = async (memId, entityType, entityId) => {
      const r = await page.request.post(`${APP}/memories/${memId}/links`, { data: { entityType, entityId, linkType: 'mentions' } });
      assert([200, 201].includes(r.status()), `POST /memories/${memId}/links ${r.status()} ${await r.text()}`);
    };
    await link(m1.id, 'goal', goal.id);
    await link(m1.id, 'project', project.id);
    return { goal: goal.id, project: project.id, memory: m1.id };
  });

  await check('knowledge graph page renders and settles', async () => {
    const t0 = Date.now();
    await page.goto(`${APP}/graph`, { waitUntil: 'networkidle' });
    const view = page.getByTestId('knowledge-graph-view');
    const empty = page.getByText(/No linked entities yet|Your graph is empty/);
    await Promise.race([view.waitFor({ timeout: 20000 }), empty.first().waitFor({ timeout: 20000 })]);
    const hasView = await view.count();
    if (hasView) await page.waitForFunction(() => document.querySelector('[data-testid="knowledge-graph-view"]')?.getAttribute('data-settled') === 'true', null, { timeout: 20000 }).catch(() => {});
    await shot(page, '05-graph');
    const r = refused(t0);
    assert(r.length === 0, `429s during graph load: ${r.join(', ')}`);
    assert(hasView, 'graph rendered the empty state instead of the canvas (no linked entities)');
    return { apiRequests: fanout(t0).length };
  });

  await check('memory explorer lists the seeded memories', async () => {
    await page.goto(`${APP}/memory`, { waitUntil: 'networkidle' });
    await page.getByText('Founders churn when the first session', { exact: false }).first().waitFor({ timeout: 15000 });
    await shot(page, '06-memory');
  });

  await check('decision lab renders', async () => {
    await page.goto(`${APP}/decisions`, { waitUntil: 'networkidle' });
    await page.locator('#main-content').getByRole('heading', { name: /decision lab/i }).waitFor({ timeout: 15000 });
    await shot(page, '07-decisions');
  });

  await check('create a decision session (no LLM dispatch)', async () => {
    const r = await page.request.post(`${APP}/sessions`, { data: { question: 'Should we move from usage-based to per-seat pricing before the Q1 renewals?', mode: 'decide' } });
    assert([200, 201].includes(r.status()), `POST /sessions ${r.status()} ${await r.text()}`);
    const body = await r.json();
    sessionId = body.id ?? body.sessionId ?? body.session?.id;
    assert(sessionId, `no session id in ${JSON.stringify(body).slice(0, 200)}`);
    await page.goto(`${APP}/decisions/${sessionId}`, { waitUntil: 'networkidle' });
    await shot(page, '08-decision-session');
    return { sessionId };
  });

  await check('admin: make the user the owner of josh-business (operator step 2)', async () => {
    assert(ADMIN_KEY, 'OMNIMIND_ADMIN_KEY not set for the journey');
    const r = await fetch(`${API}/admin/tenants/josh-business`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY, 'x-api-key': process.env.OMNIMIND_API_KEY ?? '' },
      body: JSON.stringify({ ownerUserId: userId }),
    });
    assert(r.ok, `PATCH /admin/tenants ${r.status} ${await r.text()}`);
  });

  await check('settings → Connected AI tools → New token → Create token', async () => {
    await page.goto(`${APP}/settings#connected-tools`, { waitUntil: 'networkidle' });
    const panel = page.getByTestId('connected-tools-panel');
    await panel.scrollIntoViewIfNeeded();
    const btn = panel.getByRole('button', { name: 'New token' });
    await btn.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'New token');
      return b && !b.disabled;
    }, null, { timeout: 15000 });
    await btn.click();
    const form = page.getByTestId('mcp-token-form');
    await form.waitFor({ timeout: 10000 });
    await form.getByLabel('Token name').fill('E2E journey client');
    const rw = form.getByText(/read\s*&\s*write/i).first();
    if (await rw.count()) await rw.click();
    await shot(page, '09-token-form');
    await form.getByRole('button', { name: 'Create token' }).click();
    const created = page.getByTestId('mcp-token-created');
    await created.waitFor({ timeout: 15000 });
    const showBtn = created.getByRole('button', { name: /^show$/i }).first();
    if (await showBtn.count()) await showBtn.click();
    const input = created.getByTestId('mcp-raw-token').locator('input, textarea, code').first();
    rawToken = (await input.inputValue().catch(async () => (await input.textContent()) ?? '')).trim();
    if (!rawToken.startsWith('omt_')) {
      const text = await created.innerText();
      rawToken = text.match(/omt_[A-Za-z0-9_-]{20,}/)?.[0] ?? rawToken;
    }
    assert(rawToken.startsWith('omt_'), `token does not look like omt_: ${rawToken.slice(0, 6)}…`);
    await shot(page, '10-token-created');
    const list = await page.request.get(`${APP}/mcp/tokens`);
    const tokens = await list.json();
    const rows = Array.isArray(tokens) ? tokens : (tokens.items ?? tokens.tokens ?? []);
    tokenId = rows.find(t => t.name === 'E2E journey client')?.id ?? rows[0]?.id;
    return { tokenPrefix: rawToken.slice(0, 8), tokenId };
  });

  await check('MCP: initialize with the minted token returns a session', async () => {
    const r = await mcpCall('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-journey', version: '1.0' } }, { id: 1 });
    assert(r.status === 200, `initialize ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.sessionId, 'no mcp-session-id header');
    mcpSession = r.sessionId;
    const sv = r.body?.result?.serverInfo;
    return { server: sv?.name, version: sv?.version, instructions: Boolean(r.body?.result?.instructions) };
  });

  await check('MCP: tools/list exposes the 20 tools', async () => {
    await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${rawToken}`, 'mcp-session-id': mcpSession }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const r = await mcpCall('tools/list', {}, { session: mcpSession, id: 2 });
    const tools = r.body?.result?.tools ?? [];
    assert(tools.length === 20, `expected 20 tools, got ${tools.length}`);
    return tools.map(t => t.name).sort().join(',');
  });

  await check('MCP: memory_write stores a memory under the token principal', async () => {
    const r = await mcpCall('tools/call', { name: 'memory_write', arguments: { content: `${marker}: the MCP gateway wrote this from the e2e journey.`, domain: 'business' } }, { session: mcpSession, id: 3 });
    assert(r.status === 200, `memory_write ${r.status}`);
    const sc = r.body?.result?.structuredContent ?? null;
    const text = r.body?.result?.content?.[0]?.text ?? '';
    assert(!r.body?.result?.isError, `isError: ${text}`);
    writtenMemoryId = sc?.id ?? sc?.memory?.id ?? (text.match(/"id"\s*:\s*"([^"]+)"/)?.[1]) ?? null;
    return { id: writtenMemoryId, text: text.slice(0, 120) };
  });

  await check('MCP: memory_search finds it (hybrid search, no embeddings provider in the sandbox)', async () => {
    const r = await mcpCall('tools/call', { name: 'memory_search', arguments: { query: marker, limit: 5 } }, { session: mcpSession, id: 4 });
    const text = JSON.stringify(r.body?.result ?? {});
    assert(text.includes(marker), `marker not in search result: ${text.slice(0, 300)}`);
  });

  await check('MCP: status_get composite answers', async () => {
    const r = await mcpCall('tools/call', { name: 'status_get', arguments: {} }, { session: mcpSession, id: 5 });
    assert(r.status === 200 && !r.body?.result?.isError, `status_get ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await check('cross-client: BoardRoom lists the memory the MCP client wrote', async () => {
    const r = await page.request.get(`${APP}/memories?q=${encodeURIComponent(marker)}&limit=10`);
    assert(r.ok(), `GET /memories ${r.status()}`);
    const body = await r.json();
    const items = body.items ?? body;
    assert(items.some(m => String(m.content).includes(marker)), `memory not visible via BoardRoom: ${JSON.stringify(body).slice(0, 300)}`);
    const row = items.find(m => String(m.content).includes(marker));
    return { agentId: row.agentId ?? row.agent_id, tenantId: row.tenantId, sourceType: row.sourceType };
  });

  await check('UI: memory explorer shows the MCP-written memory', async () => {
    await page.goto(`${APP}/memory`, { waitUntil: 'networkidle' });
    await page.getByText(marker, { exact: false }).first().waitFor({ timeout: 15000 });
    await shot(page, '11-memory-from-mcp');
  });

  await check('revoke the token in BoardRoom → open MCP session is refused', async () => {
    assert(tokenId, 'no token id');
    const r = await page.request.delete(`${APP}/mcp/tokens/${tokenId}`);
    assert(r.ok() || r.status() === 204, `DELETE /mcp/tokens ${r.status()} ${await r.text()}`);
    await new Promise(res => setTimeout(res, 800));
    const after = await mcpCall('tools/call', { name: 'status_get', arguments: {} }, { session: mcpSession, id: 6 });
    const refused = after.status === 401 || after.status === 403 || after.status === 404 || after.body?.error || after.body?.result?.isError;
    assert(refused, `expected refusal after revoke, got ${after.status} ${JSON.stringify(after.body).slice(0, 200)}`);
    return { status: after.status, code: after.body?.error?.message ?? after.body?.error?.code ?? after.body?.result?.content?.[0]?.text?.slice(0, 80) };
  });

  await check('no uncaught page errors during the journey', async () => {
    const real = consoleErrors.filter(e => !/favicon|manifest|net::ERR_|404|Failed to load resource/i.test(e));
    assert(real.length === 0, real.slice(0, 5).join(' | '));
    return { consoleNoise: consoleErrors.length - real.length };
  });
} catch {
  // recorded in results
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed → ${OUT}/results.json`);
  process.exit(failed ? 1 : 0);
}
var mcpSession;
