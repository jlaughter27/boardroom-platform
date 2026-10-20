#!/usr/bin/env node
// Tiny mock of the BoardRoom client API for the visual harness.
//
// Every `fixtures/*.mjs` module next to this file is auto-loaded at startup.
// Each default-exports `{ routes: [{ method, path, handler }] }` where `path`
// is a string (exact match after the `/api` prefix is stripped) or a RegExp
// (matched against the same stripped path; the match is passed to the
// handler), and `handler(req, url, match)` returns `{ status?, body?,
// headers? }` (or a Promise of it). The first matching route wins; modules
// load in filename order, so a lane that wants to override a route names its
// file so it sorts first.
//
// Run standalone (`node tools/visual-preview/mock-api.mjs --port 3999`) and
// point `vite dev`'s `/api` proxy at it, or import `createMockApi()` and mount
// the returned handler in another server (shoot.mjs does the latter).

import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, 'fixtures');

/** Load every fixture module and flatten their routes, in filename order. */
export async function loadRoutes(dir = FIXTURES_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  const routes = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const def = mod.default;
    if (!def || !Array.isArray(def.routes)) continue; // helpers (graph-data.mjs) export no routes
    for (const r of def.routes) routes.push({ ...r, file: f });
  }
  return routes;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', () => resolve(undefined));
  });
}

/**
 * Build the API. Returns `{ routes, handle }` where `handle(req, res)` answers
 * one request (paths with or without the `/api` prefix) and resolves `true`
 * when a route matched, `false` otherwise (the caller decides what a miss
 * means — shoot.mjs answers 404 JSON).
 */
export async function createMockApi(options = {}) {
  const routes = options.routes ?? await loadRoutes(options.fixturesDir);
  const log = options.log ?? (() => {});

  async function handle(req, res) {
    const url = new URL(req.url, 'http://mock.local');
    const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
    const method = req.method.toUpperCase();
    for (const r of routes) {
      if (r.method.toUpperCase() !== method) continue;
      let match = null;
      if (typeof r.path === 'string') { if (r.path !== path) continue; }
      else { match = r.path.exec(path); if (!match) continue; }
      req.json = await readBody(req);
      let out;
      try { out = await r.handler(req, url, match); }
      catch (e) { out = { status: 500, body: { message: String(e && e.message || e) } }; }
      const status = out?.status ?? 200;
      const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(out?.headers ?? {}) };
      log(`${method} ${path} → ${status} (${r.file})`);
      res.writeHead(status, headers);
      res.end(status === 204 || out?.body === undefined ? '' : JSON.stringify(out.body));
      return true;
    }
    log(`${method} ${path} → no route`);
    return false;
  }

  return { routes, handle };
}

/** Standalone server: `node mock-api.mjs --port 3999`. */
export async function listen(port = 3999, options = {}) {
  const api = await createMockApi({ log: options.quiet ? undefined : (l) => console.log(`[mock-api] ${l}`), ...options });
  const server = createServer(async (req, res) => {
    const hit = await api.handle(req, res);
    if (!hit) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: `No mock route for ${req.method} ${req.url}` })); }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, api, port: server.address().port };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--port');
  const port = i >= 0 ? Number(process.argv[i + 1]) : 3999;
  const { api } = await listen(port);
  console.log(`[mock-api] listening on http://127.0.0.1:${port} with ${api.routes.length} routes`);
}
