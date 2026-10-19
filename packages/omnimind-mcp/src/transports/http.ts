/**
 * Streamable HTTP transport — stateful sessions (M-101), fail-closed auth
 * (F-203), body cap / crash isolation / DNS-rebinding protection (M-105),
 * and a real GET /health (runbook).
 *
 * One `StreamableHTTPServerTransport` + `McpServer` + `OmniMindClient` triple
 * per MCP session, keyed by the `mcp-session-id` header the SDK issues on
 * `initialize`.
 *
 * Front door (Phase 10): every request's bearer credential is resolved to a
 * principal by `lib/principal.ts` — the legacy static key, an `omt_` token
 * (introspected) or an OAuth access token (JWT verified, identity resolved).
 * A session is bound to the principal that opened it; a request on that
 * session with any other principal is answered 404 as if the session did not
 * exist. RFC 9728 Protected Resource Metadata is served at
 * `/.well-known/oauth-protected-resource[/mcp]` when OAuth is configured.
 *
 * Session lifecycle (R-M-04): every request on a session bumps `lastSeenAt`;
 * a sweeper closes sessions idle longer than `OMNIMIND_MCP_SESSION_IDLE_MS`
 * (default 30 min) once a minute, and when the cap is reached a new
 * `initialize` evicts the least-recently-seen session instead of answering 503.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JWTVerifyGetKey } from 'jose';
import { createMcpServer } from '../server';
import type { CreateMcpServerOptions } from '../server';
import { resolveAgentFromEnv } from '../lib/auth';
import { createOmniMindClient, resolveAgentKey } from '../lib/client';
import type { OmniMindClient, ResolvedAgentKey } from '../lib/client';
import { DeferredWorkQueue, DEFERRED_DRAIN_TIMEOUT_MS } from '../lib/deferred-work';
import { AuthFailureLimiter, clientIpOf } from '../lib/rate-limit';
import type { AuthFailureLimiterOptions } from '../lib/rate-limit';
import {
  buildProtectedResourceMetadata,
  buildWwwAuthenticate,
  createPrincipalResolver,
  credentialDigest,
  describeAuthModes,
  hasAnyAuthMode,
  isProtectedResourceMetadataPath,
  resolvePrincipalAuthConfig,
  PRM_PATH,
  STATIC_PRINCIPAL_KEY,
} from '../lib/principal';
import type { PrincipalAuthConfig, PrincipalResolver } from '../lib/principal';
import type { AgentContext } from '../types';

export const DEFAULT_PORT = 3334;
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
export const MAX_SESSIONS = 100;
export const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;
const SESSION_HEADER = 'mcp-session-id';

export interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  /** Last request routed to this session (ms epoch); drives idle eviction. */
  lastSeenAt: number;
  /** `kind:id` of the principal that opened the session; every later request must present the same one. */
  principalKey: string;
  /**
   * M-3 — digest of the effective scopes the session was opened with. A later
   * request from the same identity whose credential grants a *different* scope
   * set (a narrower OAuth client, a re-issued token) is treated as a different
   * caller (404) rather than driving this session with its frozen scopes.
   */
  scopeDigest?: string;
  /** Per-session OmniMind client (delegated or static identity); closed with the session. */
  client?: OmniMindClient;
  /** M-2 — same identity, outlives the session; owned by the app's DeferredWorkQueue. */
  deferredClient?: OmniMindClient;
}

/** M-3 — order-insensitive, duplicate-insensitive fingerprint of a scope set. */
export function scopeDigestOf(scopes: readonly string[]): string {
  const sorted = Array.from(new Set(scopes)).sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 32);
}

/** L-10 — `PORT` must be an integer in 1..65535; `undefined` means "not set" (→ DEFAULT_PORT). */
export function parsePort(raw: string | undefined, fallback = DEFAULT_PORT): number | undefined {
  const value = raw?.trim();
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 && n <= 65535 ? n : undefined;
}

/** R-M-04 — idle timeout from env; invalid / non-positive values fall back to the default. */
export function resolveSessionIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OMNIMIND_MCP_SESSION_IDLE_MS?.trim();
  if (!raw) return DEFAULT_SESSION_IDLE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_IDLE_MS;
}

/**
 * M-5 — what a per-session / gateway OmniMind client is for, and the
 * `x-agent-key` it must carry. The factory receives this so a test double can
 * honour it; the default factory builds `createOmniMindClient(env, { agentKey })`.
 *
 * - `gateway`:   introspection / identity resolution → the gateway key.
 * - `delegated`: a session (or its deferred twin) for a token / OAuth principal → the gateway key.
 * - `static`:    a session (or its deferred twin) for the legacy static key → `OMNIMIND_MCP_STATIC_AGENT_KEY`
 *                only (never the gateway key: the legacy triple does not describe the gateway row and
 *                the API would answer 403 agent_header_mismatch).
 */
export interface ClientPurpose {
  role: 'gateway' | 'delegated' | 'static';
  /** The `x-agent-key` this client must send; `undefined` → none (unverified header triple). */
  agentKey: string | undefined;
}

export interface HttpTransportOptions {
  /** Legacy inbound bearer / x-mcp-api-key (static principal). Optional once `auth` enables tokens or OAuth. */
  apiKey?: string;
  /** Front-door auth config (token introspection / OAuth / public URL). `staticApiKey` here is equivalent to `apiKey`. */
  auth?: Partial<PrincipalAuthConfig>;
  /** Exact `Host` header values accepted (DNS-rebinding protection). */
  allowedHosts?: string[];
  /** Pre-resolved agent context for the static key (defaults to env; only read when a static key is configured). */
  agentCtx?: AgentContext;
  /**
   * M-5 — `x-agent-key` for static-key sessions (`OMNIMIND_MCP_STATIC_AGENT_KEY`).
   * Defaults from env: that var, else — only when no gateway mode is enabled, i.e.
   * a legacy single-identity deployment — `OMNIMIND_MCP_AGENT_KEY`; else none.
   */
  staticAgentKey?: string;
  /** Factory for the per-session McpServer (defaults to createMcpServer bound to the per-session client). */
  createServerFn?: (ctx: AgentContext, client: OmniMindClient, extras?: Pick<CreateMcpServerOptions, 'deferredClient' | 'onDeferred'>) => { server: McpServer; agentCtx: AgentContext };
  /** Extra `createMcpServer` options for the default factory (`appUrl`, `writeExtractMode`). */
  serverOptions?: Pick<CreateMcpServerOptions, 'appUrl' | 'writeExtractMode'>;
  /** Factory for OmniMind clients (defaults to env). Receives the purpose so it can attach the right `x-agent-key`. */
  createClientFn?: (purpose: ClientPurpose) => OmniMindClient;
  /** Gateway-level client used for introspection / identity resolution (defaults to `createClientFn({role:'gateway'})`). */
  gatewayClient?: Pick<OmniMindClient, 'introspectToken' | 'resolveIdentity'>;
  /** JWKS override for OAuth verification (tests). */
  jwks?: JWTVerifyGetKey;
  log?: (line: string) => void;
  /** Max live sessions before the least-recently-seen one is evicted (default MAX_SESSIONS). */
  maxSessions?: number;
  /** Idle time after which a session is closed (default env OMNIMIND_MCP_SESSION_IDLE_MS / 30 min). */
  sessionIdleMs?: number;
  /** How often the idle sweeper runs (default 60 s). */
  sweepIntervalMs?: number;
  /** M-4 — per-IP budget for failed / unauthenticated requests (default 30 per minute). */
  authFailureLimit?: AuthFailureLimiterOptions;
  /** M-4 — attribute requests to the right-most `X-Forwarded-For` entry (`OMNIMIND_MCP_TRUST_PROXY=true`); off → socket peer. */
  trustProxy?: boolean;
  /** M-2 — how long `close()` waits for in-flight deferred extraction (default 30 s). */
  drainTimeoutMs?: number;
}

export interface HttpConfig {
  /** The legacy static key, when configured. */
  apiKey: string | undefined;
  auth: PrincipalAuthConfig;
  allowedHosts: string[] | undefined;
  /** M-5 — `x-agent-key` for static sessions and where it came from. */
  staticAgentKey: ResolvedAgentKey;
  trustProxy: boolean;
}

/**
 * M-5 — the `x-agent-key` static-key sessions send. `OMNIMIND_MCP_STATIC_AGENT_KEY`
 * when set; otherwise `OMNIMIND_MCP_AGENT_KEY` only when no gateway mode (tokens /
 * OAuth) is enabled — in that deployment it cannot be a gateway key, it is the
 * agent's own (M-103) and dropping it would silently un-verify the server.
 */
export function resolveStaticAgentKey(auth: Pick<PrincipalAuthConfig, 'tokenAuth' | 'oauth'>, env: NodeJS.ProcessEnv = process.env): ResolvedAgentKey {
  const gatewayModes = Boolean(auth.tokenAuth || auth.oauth);
  return resolveAgentKey(gatewayModes ? 'static' : 'single-agent', env);
}

/**
 * F-203 — Resolve HTTP-mode config from env. Throws when no inbound auth is
 * configured (static key, token auth or OAuth): the old transport silently ran open.
 */
export function resolveHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const auth = resolvePrincipalAuthConfig(env);
  const hostsRaw = env.OMNIMIND_MCP_ALLOWED_HOSTS?.trim();
  const allowedHosts = hostsRaw
    ? hostsRaw.split(',').map(h => h.trim()).filter(Boolean)
    : undefined; // undefined → derived from the bound port at listen time
  const trustProxy = /^(1|true|yes|on)$/i.test(env.OMNIMIND_MCP_TRUST_PROXY?.trim() ?? '');
  return { apiKey: auth.staticApiKey, auth, allowedHosts, staticAgentKey: resolveStaticAgentKey(auth, env), trustProxy };
}

function mergeAuth(opts: Pick<HttpTransportOptions, 'apiKey' | 'auth'>): PrincipalAuthConfig {
  return {
    tokenAuth: false,
    ...opts.auth,
    ...(opts.apiKey ? { staticApiKey: opts.apiKey } : {}),
  };
}

export function defaultAllowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/** Constant-time key comparison on equal-length (sha256) buffers. */
export function keysMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Case-insensitive `Bearer <token>` or `x-mcp-api-key` header. */
export function extractPresentedKey(req: IncomingMessage): string | undefined {
  const direct = req.headers['x-mcp-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^\s*bearer\s+(.+?)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  return undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new BodyTooLargeError(`Content-Length ${declared} exceeds ${maxBytes}`));
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new BodyTooLargeError(`Body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted by client')));
  });
}

export interface HttpApp {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  sessions: Map<string, Session>;
  /** Called once the listening port is known so default allowedHosts can be derived. */
  setPort: (port: number) => void;
  /** The `Host` values the DNS-rebinding guard accepts right now. */
  allowedHosts: () => string[];
  /** Close every session idle longer than `sessionIdleMs`; returns the ids closed. Runs on a timer; exposed for tests. */
  sweepIdle: (now?: number) => Promise<string[]>;
  /** The effective inbound-auth configuration (secrets included — never log it whole). */
  authConfig: PrincipalAuthConfig;
  /** The principal resolver (tests inspect its cache). */
  resolver: PrincipalResolver;
  /** M-2 — in-flight deferred extraction and the long-lived clients it runs on. */
  deferred: DeferredWorkQueue;
  /** M-4 — per-IP failed-auth budget. */
  authLimiter: AuthFailureLimiter;
  /** M-5 — which `x-agent-key` static sessions send (source only; never the key). */
  staticAgentKeySource: ResolvedAgentKey['source'];
  close: () => Promise<void>;
}

export function createHttpApp(opts: HttpTransportOptions): HttpApp {
  const authConfig = mergeAuth(opts);
  if (!hasAnyAuthMode(authConfig)) {
    throw new Error('createHttpApp: at least one inbound auth mode is required (apiKey, auth.tokenAuth or auth.oauth)');
  }
  const log = opts.log ?? ((line: string) => console.log(line));
  const sessions = new Map<string, Session>();
  const startedAt = Date.now();
  let boundPort: number | undefined;
  // The env identity is only needed (and only read — it exits on missing vars) for the static key.
  const staticAgentCtx = authConfig.staticApiKey ? (opts.agentCtx ?? resolveAgentFromEnv()) : undefined;
  // M-5 — two keys, two jobs: the gateway key never rides on a static session.
  const gatewayModes = Boolean(authConfig.tokenAuth || authConfig.oauth);
  const staticAgentKey: ResolvedAgentKey = opts.staticAgentKey !== undefined
    ? { key: opts.staticAgentKey || undefined, source: opts.staticAgentKey ? 'OMNIMIND_MCP_STATIC_AGENT_KEY' : 'none' }
    : resolveStaticAgentKey(authConfig);
  const gatewayAgentKey = authConfig.agentKey;
  const purposeFor = (principalKey: string): ClientPurpose =>
    principalKey === STATIC_PRINCIPAL_KEY ? { role: 'static', agentKey: staticAgentKey.key } : { role: 'delegated', agentKey: gatewayAgentKey };
  const createClient = opts.createClientFn ?? ((purpose: ClientPurpose) => createOmniMindClient(process.env, { agentKey: purpose.agentKey }));
  const gateway = gatewayModes ? (opts.gatewayClient ?? createClient({ role: 'gateway', agentKey: gatewayAgentKey })) : undefined;
  const resolver = createPrincipalResolver(authConfig, { staticAgentCtx, gateway, jwks: opts.jwks, log });
  const makeServer = opts.createServerFn
    ?? ((ctx: AgentContext, client: OmniMindClient, extras?: Pick<CreateMcpServerOptions, 'deferredClient' | 'onDeferred'>) =>
      createMcpServer(ctx, { client, ...opts.serverOptions, ...extras }));
  const maxSessions = opts.maxSessions ?? MAX_SESSIONS;
  const sessionIdleMs = opts.sessionIdleMs ?? resolveSessionIdleMs();
  const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const deferred = new DeferredWorkQueue(log);
  const authLimiter = new AuthFailureLimiter(opts.authFailureLimit);
  const trustProxy = opts.trustProxy ?? false;
  let warnedUntrustedProxy = false;
  const drainTimeoutMs = opts.drainTimeoutMs ?? DEFERRED_DRAIN_TIMEOUT_MS;

  const allowedHosts = (): string[] =>
    opts.allowedHosts ?? defaultAllowedHosts(boundPort ?? DEFAULT_PORT);

  /** Remove from the map first so a slow/failed transport.close() can never leave a ghost entry. */
  async function closeSession(sid: string, reason: string): Promise<void> {
    const session = sessions.get(sid);
    if (!session) return;
    sessions.delete(sid);
    session.client?.close();
    if (session.deferredClient) deferred.release(session.deferredClient);
    log(`[omnimind-mcp] session ${reason} ${sid} (${sessions.size} active)`);
    await session.transport.close().catch(() => undefined);
  }

  async function sweepIdle(now = Date.now()): Promise<string[]> {
    const stale: string[] = [];
    for (const [sid, s] of sessions) if (now - s.lastSeenAt >= sessionIdleMs) stale.push(sid);
    for (const sid of stale) await closeSession(sid, `idle-closed after ${Math.round(sessionIdleMs / 1000)}s`);
    return stale;
  }

  async function evictLeastRecentlySeen(): Promise<void> {
    let victim: string | undefined;
    let oldest = Infinity;
    for (const [sid, s] of sessions) if (s.lastSeenAt < oldest) { oldest = s.lastSeenAt; victim = sid; }
    if (victim) await closeSession(victim, `evicted (cap ${maxSessions})`);
  }

  // R-M-04 — unref'd so the sweeper never keeps a shutting-down process alive.
  const sweeper = setInterval(() => { void sweepIdle(); }, sweepIntervalMs);
  sweeper.unref?.();

  /** Drop a session the transport reported closed and release its clients. */
  function forget(sid: string, reason: string): void {
    const session = sessions.get(sid);
    if (!session) return;
    sessions.delete(sid);
    session.client?.close();
    if (session.deferredClient) deferred.release(session.deferredClient);
    log(`[omnimind-mcp] session ${reason} ${sid} (${sessions.size} active)`);
  }

  async function createSession(agentCtx: AgentContext, principalKey: string, scopeDigest: string): Promise<Session> {
    const purpose = purposeFor(principalKey);
    const client = createClient(purpose);
    // M-2 — a twin bound to the same identity that the session does not own:
    // deferred extraction runs on it and the queue closes it once idle.
    const deferredClient = createClient(purpose);
    deferred.adopt(deferredClient);
    let server: McpServer;
    try {
      ({ server } = makeServer(agentCtx, client, { deferredClient, onDeferred: done => deferred.track(deferredClient, done) }));
    } catch (err) {
      client.close();
      deferred.release(deferredClient);
      throw err;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: allowedHosts(),
      onsessioninitialized: (sid: string) => {
        const now = Date.now();
        sessions.set(sid, { transport, server, client, deferredClient, principalKey, scopeDigest, createdAt: now, lastSeenAt: now });
        log(`[omnimind-mcp] session opened ${sid} (${sessions.size} active)`);
      },
      onsessionclosed: (sid: string) => forget(sid, 'closed'),
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) forget(sid, 'dropped');
      else {
        client.close(); // never initialized
        deferred.release(deferredClient);
      }
    };
    await server.connect(transport);
    const now = Date.now();
    return { transport, server, client, deferredClient, principalKey, scopeDigest, createdAt: now, lastSeenAt: now };
  }

  /**
   * M-1 — the SDK validates `Accept` (406), `Content-Type` (415) and the
   * DNS-rebinding `Host` guard (403) *inside* `handleRequest` and only calls
   * `onsessioninitialized` on success. A rejected initialize therefore left a
   * fully built McpServer + transport + clients that were in no map and never
   * closed. Tear them down when no session id was assigned.
   */
  async function discardUninitialized(session: Session): Promise<void> {
    if (session.transport.sessionId) return;
    session.client?.close();
    if (session.deferredClient) deferred.release(session.deferredClient);
    await session.transport.close().catch(() => undefined);
  }

  /** Session lookup that never distinguishes "unknown id" from "someone else's session" (or the same identity with other scopes, M-3). */
  function boundSession(sessionId: string, principalKey: string, scopeDigest: string): Session | undefined {
    const session = sessions.get(sessionId);
    if (!session || session.principalKey !== principalKey) return undefined;
    if (session.scopeDigest !== undefined && session.scopeDigest !== scopeDigest) return undefined;
    return session;
  }

  /** L-4 — the specific reason goes to the log (with a credential digest prefix, never the credential); the body is generic. */
  function refuse(res: ServerResponse, ip: string, presented: string | undefined, reason: string): void {
    authLimiter.recordFailure(ip);
    log(`[omnimind-mcp] auth refused from ${ip}: ${reason}${presented ? ` (credential ${credentialDigest(presented).slice(0, 12)}…)` : ''}`);
    res.setHeader('WWW-Authenticate', buildWwwAuthenticate(authConfig, presented !== undefined));
    sendJson(res, 401, { error: presented !== undefined ? 'invalid_token' : 'unauthorized' });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (url.pathname === '/health' && method === 'GET') {
      // R-M-05 — unauthenticated, so it says nothing about who this server is
      // (agent name / tenant id used to be here).
      sendJson(res, 200, {
        status: 'ok',
        uptime: Math.round((Date.now() - startedAt) / 1000),
        sessions: sessions.size,
      });
      return;
    }

    if (isProtectedResourceMetadataPath(url.pathname) && (method === 'GET' || method === 'HEAD')) {
      // RFC 9728 — public by design; 404 when OAuth is not configured so a
      // header-token-only deployment advertises nothing.
      const prm = buildProtectedResourceMetadata(authConfig);
      if (!prm) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendJson(res, 200, prm, { 'Cache-Control': 'public, max-age=300' });
      return;
    }

    const presented = extractPresentedKey(req);
    const ip = clientIpOf(req, trustProxy);
    if (!trustProxy && !warnedUntrustedProxy && req.headers['x-forwarded-for'] !== undefined) {
      // Behind a proxy (Railway) without OMNIMIND_MCP_TRUST_PROXY every caller
      // shares the proxy's socket address, so they share ONE failure budget.
      // Known-good credentials are never throttled, so live clients keep
      // working; only new / failing logins from behind that proxy compete.
      warnedUntrustedProxy = true;
      log(`[omnimind-mcp] X-Forwarded-For seen but OMNIMIND_MCP_TRUST_PROXY is not set: the auth failure limit is keyed on the proxy address ${ip}, shared by every client behind it. Set OMNIMIND_MCP_TRUST_PROXY=true when this server is only reachable through that proxy.`);
    }
    // M-4 — out of failure budget: refuse before any introspection / JWKS /
    // identity call, unless the credential is already known good (a live
    // session behind the same NAT keeps working while someone else floods).
    if (!resolver.isKnownGood(presented)) {
      const decision = authLimiter.check(ip);
      if (decision.limited) {
        log(`[omnimind-mcp] auth rate limit: ${ip} (retry after ${decision.retryAfterS}s)`);
        sendJson(res, 429, { error: 'too_many_requests', message: 'too many failed authentication attempts' }, { 'Retry-After': String(decision.retryAfterS) });
        return;
      }
    }
    const resolution = await resolver.resolve(presented);
    if (!resolution.ok) {
      if (resolution.status === 503) {
        sendJson(res, 503, { error: 'auth_unavailable', message: resolution.reason }, { 'Retry-After': '5' });
        return;
      }
      refuse(res, ip, presented, resolution.reason);
      return;
    }
    const { key: principalKey, agentCtx } = resolution;
    const scopeDigest = scopeDigestOf(agentCtx.scopes);

    const sidHeader = req.headers[SESSION_HEADER];
    const sessionId = typeof sidHeader === 'string' ? sidHeader : undefined;

    if (method === 'POST') {
      let raw: string;
      try {
        raw = await readBody(req, MAX_BODY_BYTES);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          sendJson(res, 413, { error: 'Payload Too Large', limitBytes: MAX_BODY_BYTES });
        } else {
          rpcError(res, 400, -32700, `Could not read request body: ${(err as Error).message}`);
        }
        return;
      }
      let body: unknown;
      try {
        body = raw.length ? JSON.parse(raw) : undefined;
      } catch {
        rpcError(res, 400, -32700, 'Parse error: invalid JSON');
        return;
      }

      if (sessionId) {
        const session = boundSession(sessionId, principalKey, scopeDigest);
        if (!session) {
          rpcError(res, 404, -32001, 'Session not found');
          return;
        }
        session.lastSeenAt = Date.now();
        await session.transport.handleRequest(req, res, body);
        return;
      }

      if (isInitializeRequest(body)) {
        // R-M-04 — at the cap, make room by dropping the least-recently-seen
        // session (an abandoned client) rather than refusing the live one.
        while (sessions.size >= maxSessions) await evictLeastRecentlySeen();
        const session = await createSession(agentCtx, principalKey, scopeDigest);
        try {
          await session.transport.handleRequest(req, res, body);
        } finally {
          await discardUninitialized(session); // M-1
        }
        return;
      }

      rpcError(res, 400, -32000, 'Bad Request: no valid session ID provided (send initialize first)');
      return;
    }

    if (method === 'GET' || method === 'DELETE') {
      if (!sessionId) {
        rpcError(res, 400, -32000, `Bad Request: ${SESSION_HEADER} header required`);
        return;
      }
      const session = boundSession(sessionId, principalKey, scopeDigest);
      if (!session) {
        rpcError(res, 404, -32001, 'Session not found');
        return;
      }
      session.lastSeenAt = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    rpcError(res, 405, -32000, 'Method Not Allowed');
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(req, res);
    } catch (err) {
      console.error('[omnimind-mcp] request failed:', (err as Error).stack ?? (err as Error).message);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal Server Error' });
      } else {
        res.end();
      }
    }
  }

  async function close(): Promise<void> {
    clearInterval(sweeper);
    const open = Array.from(sessions.values());
    sessions.clear();
    for (const s of open) {
      s.client?.close();
      if (s.deferredClient) deferred.release(s.deferredClient);
    }
    await Promise.all(open.map(s => s.transport.close().catch(() => undefined)));
    // M-2 — let in-flight extraction finish (bounded) before the process goes away.
    if (deferred.size > 0) log(`[omnimind-mcp] shutdown: waiting up to ${Math.round(drainTimeoutMs / 1000)}s for ${deferred.size} deferred extraction(s)`);
    await deferred.close(drainTimeoutMs);
  }

  return {
    handler, sessions, setPort: p => { boundPort = p; }, allowedHosts, sweepIdle, authConfig, resolver,
    deferred, authLimiter, staticAgentKeySource: staticAgentKey.source, close,
  };
}

let processHandlersInstalled = false;
/** M-105 — a rejected promise from an aborted client must not take the HTTP server down. */
export function installProcessHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.on('unhandledRejection', reason => {
    console.error('[omnimind-mcp] unhandledRejection:', reason instanceof Error ? reason.stack : reason);
  });
  process.on('uncaughtException', err => {
    console.error('[omnimind-mcp] uncaughtException (server kept running):', err.stack ?? err.message);
  });
}

export interface StartedHttpServer {
  server: Server;
  app: HttpApp;
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the HTTP transport. With no `opts`, config comes from env and a
 * missing inbound-auth configuration exits the process with code 1. Tests
 * pass `opts` explicitly and `port = 0` for an ephemeral port.
 */
export async function startHttpServer(
  port = DEFAULT_PORT,
  opts?: Partial<HttpTransportOptions>
): Promise<StartedHttpServer> {
  let config: HttpConfig;
  try {
    if (opts?.apiKey || opts?.auth) {
      const auth = mergeAuth(opts);
      config = {
        apiKey: opts.apiKey, auth, allowedHosts: opts.allowedHosts,
        staticAgentKey: opts.staticAgentKey !== undefined
          ? { key: opts.staticAgentKey || undefined, source: opts.staticAgentKey ? 'OMNIMIND_MCP_STATIC_AGENT_KEY' : 'none' }
          : resolveStaticAgentKey(auth),
        trustProxy: opts.trustProxy ?? false,
      };
    } else {
      config = resolveHttpConfig();
    }
  } catch (err) {
    console.error(`[omnimind-mcp] ${(err as Error).message}`);
    process.exit(1);
  }

  const app = createHttpApp({
    ...opts,
    apiKey: config.apiKey,
    auth: config.auth,
    allowedHosts: opts?.allowedHosts ?? config.allowedHosts,
    staticAgentKey: config.staticAgentKey.key ?? '',
    trustProxy: opts?.trustProxy ?? config.trustProxy,
  });
  installProcessHandlers();

  const httpServer = createServer((req, res) => { void app.handler(req, res); });
  httpServer.on('clientError', (err: Error & { code?: string }, socket) => {
    if (err.code !== 'ECONNRESET' && socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n{"error":"Bad Request"}');
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => { httpServer.off('error', reject); resolve(); });
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  app.setPort(boundPort);

  const log = opts?.log ?? ((line: string) => console.log(line));
  log(`[omnimind-mcp] HTTP transport started on port ${boundPort} (stateful Streamable HTTP, health: GET /health)`);
  log(`[omnimind-mcp] inbound auth: ${describeAuthModes(config.auth).join('; ')}`);
  // M-5 — which x-agent-key each kind of session sends (sources only, never the keys).
  if (config.auth.staticApiKey) {
    const src = config.staticAgentKey.source;
    log(`[omnimind-mcp] static-key sessions: x-agent-key ${src === 'none' ? 'none (unverified x-agent-id / x-tenant-id / x-source-weight headers)' : `from ${src}`}${src === 'OMNIMIND_MCP_AGENT_KEY' ? ' (legacy single-identity deployment: no token / OAuth mode enabled)' : ''}`);
  }
  if (config.auth.tokenAuth || config.auth.oauth) {
    log('[omnimind-mcp] delegated sessions, introspection and identity resolution: x-agent-key from OMNIMIND_MCP_AGENT_KEY (gateway, scope mcp:delegate)');
  }
  log(`[omnimind-mcp] auth failure limit: per-IP token bucket (429 + Retry-After); client IP from ${opts?.trustProxy ?? config.trustProxy ? 'right-most X-Forwarded-For (OMNIMIND_MCP_TRUST_PROXY)' : 'socket peer (set OMNIMIND_MCP_TRUST_PROXY=true behind a proxy / Railway)'}`);
  if (config.auth.oauth) {
    log(`[omnimind-mcp] protected resource metadata: GET ${PRM_PATH} (resource ${config.auth.publicUrl})`);
  } else if (config.auth.tokenAuth && !config.auth.publicUrl) {
    log('[omnimind-mcp] hint: set OMNIMIND_MCP_PUBLIC_URL to the URL clients connect to (it becomes the RFC 8707 audience once OMNIMIND_MCP_OAUTH_ISSUER is set).');
  }
  // R-M-07 — the DNS-rebinding guard refuses any other Host with 403, which
  // is confusing behind a proxy / Railway domain. Say what is accepted.
  const hosts = app.allowedHosts();
  const hostsFromDefault = !(opts?.allowedHosts ?? config.allowedHosts);
  log(`[omnimind-mcp] allowedHosts: ${hosts.join(', ')}${hostsFromDefault ? ' (default — loopback only)' : ''}`);
  if (hostsFromDefault) {
    log('[omnimind-mcp] hint: set OMNIMIND_MCP_ALLOWED_HOSTS=<host[:port]>[,…] to the exact Host header clients send when this server is reached through a proxy, container hostname or public domain; otherwise those requests get 403 Invalid Host header.');
  }
  log(`[omnimind-mcp] sessions: idle timeout ${Math.round((opts?.sessionIdleMs ?? resolveSessionIdleMs()) / 1000)}s, cap ${opts?.maxSessions ?? MAX_SESSIONS} (least-recently-seen evicted at cap)`);

  const close = async () => {
    await app.close();
    await new Promise<void>(resolve => {
      httpServer.close(() => resolve());
      // Every session is closed and deferred work drained: idle keep-alive
      // sockets (SDK clients hold one) must not keep the process alive for
      // Node's 5 s keepAliveTimeout; anything still active gets 1 s.
      httpServer.closeIdleConnections();
      const force = setTimeout(() => httpServer.closeAllConnections(), 1_000);
      force.unref();
    });
  };

  return { server: httpServer, app, port: boundPort, close };
}
