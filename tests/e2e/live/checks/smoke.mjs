// Journey check (M1-A3): the sample check. Copy this file to add your own.
//
// Loaded by tests/e2e/live/journey.mjs (checks autoloader, contract in ./README.md).
// It proves the three handles a check receives actually work against the live stack:
//   api  — BoardRoom /health answers 200 with `service` and `version`, /ready answers 200
//   page — the signed-in dashboard renders its main landmark in this check's fresh page
//   mcp  — a JSON-RPC `ping` on the journey's open MCP session answers without an error
// Read-only: it writes nothing, so it is safe in any order and on any engine.

export async function run({ page, api, mcp, browser }) {
  const health = await api.request.get(`${api.app}/health`);
  if (health.status() !== 200) throw new Error(`GET /health ${health.status()}`);
  const body = await health.json();
  if (body.service !== 'boardroom-ai') throw new Error(`GET /health service=${body.service}`);
  if (typeof body.version !== 'string' || !body.version) throw new Error('GET /health has no version');

  const ready = await api.request.get(`${api.app}/ready`);
  if (ready.status() !== 200) throw new Error(`GET /ready ${ready.status()} ${await ready.text()}`);

  await page.goto(`${api.app}/`, { waitUntil: 'networkidle' });
  await page.locator('#main-content').waitFor({ timeout: 15000 });
  if (/\/login/.test(new URL(page.url()).pathname)) throw new Error('the check page is not signed in');

  const ping = await mcp.call('ping', {});
  if (ping.status !== 200 || ping.body?.error) throw new Error(`MCP ping ${ping.status} ${JSON.stringify(ping.body).slice(0, 160)}`);

  return { browser, version: body.version, omnimindConnected: body.omnimindConnected, mcpPing: 'ok' };
}

export default { name: 'smoke: health, ready, signed-in page, MCP ping', run };
