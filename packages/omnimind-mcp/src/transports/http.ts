/**
 * Streamable HTTP transport — stateful sessions (M-101), fail-closed auth
 * (F-203), body cap / crash isolation / DNS-rebinding protection (M-105),
 * and a real GET /health (runbook).
 *
 * One `StreamableHTTPServerTransport` + `McpServer` pair per MCP session,
 * keyed by the `mcp-session-id` header the SDK issues on `initialize`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from '../server';
import { resolveAgentFromEnv } from '../lib/auth';
import type { AgentContext } from '../types';

export const DEFAULT_PORT = 3334;
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
export const MAX_SESSIONS = 100;
const SESSION_HEADER = 'mcp-session-id';

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

export interface HttpTransportOptions {
  /** Inbound bearer / x-mcp-api-key. Required — HTTP mode refuses to start without it. */
  apiKey: string;
  /** Exact `Host` header values accepted (DNS-rebinding protection). */
  allowedHosts?: string[];
  /** Pre-resolved agent context (defaults to env). */
  agentCtx?: AgentContext;
  /** Factory for the per-session McpServer (defaults to createMcpServer). */
  createServerFn?: (ctx: AgentContext) => { server: McpServer; agentCtx: AgentContext };
  log?: (line: string) => void;
}

export interface HttpConfig {
  apiKey: string;
  allowedHosts: string[] | undefined;
}

/**
 * F-203 — Resolve HTTP-mode config from env. Throws when `OMNIMIND_MCP_API_KEY`
 * is unset: the old transport silently ran open.
 */
export function resolveHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const apiKey = env.OMNIMIND_MCP_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OMNIMIND_MCP_API_KEY is required in HTTP mode (it is the inbound bearer token clients must present). ' +
        'Refusing to start an unauthenticated MCP endpoint.'
    );
  }
  const hostsRaw = env.OMNIMIND_MCP_ALLOWED_HOSTS?.trim();
  const allowedHosts = hostsRaw
    ? hostsRaw.split(',').map(h => h.trim()).filter(Boolean)
    : undefined; // undefined → derived from the bound port at listen time
  return { apiKey, allowedHosts };
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
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
  close: () => Promise<void>;
}

export function createHttpApp(opts: HttpTransportOptions): HttpApp {
  if (!opts.apiKey) throw new Error('createHttpApp: apiKey is required');
  const log = opts.log ?? ((line: string) => console.log(line));
  const sessions = new Map<string, Session>();
  const startedAt = Date.now();
  let boundPort: number | undefined;
  const agentCtx = opts.agentCtx ?? resolveAgentFromEnv();
  const makeServer = opts.createServerFn ?? ((ctx: AgentContext) => createMcpServer(ctx));

  const allowedHosts = (): string[] =>
    opts.allowedHosts ?? defaultAllowedHosts(boundPort ?? DEFAULT_PORT);

  async function createSession(): Promise<Session> {
    const { server } = makeServer(agentCtx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: allowedHosts(),
      onsessioninitialized: (sid: string) => {
        sessions.set(sid, { transport, server, createdAt: Date.now() });
        log(`[omnimind-mcp] session opened ${sid} (${sessions.size} active)`);
      },
      onsessionclosed: (sid: string) => {
        sessions.delete(sid);
        log(`[omnimind-mcp] session closed ${sid} (${sessions.size} active)`);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessions.delete(sid)) log(`[omnimind-mcp] session dropped ${sid} (${sessions.size} active)`);
    };
    await server.connect(transport);
    return { transport, server, createdAt: Date.now() };
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (url.pathname === '/health' && method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        uptime: Math.round((Date.now() - startedAt) / 1000),
        sessions: sessions.size,
        agent: agentCtx.agentName,
        tenant: agentCtx.tenantId,
      });
      return;
    }

    if (!keysMatch(extractPresentedKey(req), opts.apiKey)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="omnimind-mcp"');
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

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
        const session = sessions.get(sessionId);
        if (!session) {
          rpcError(res, 404, -32001, 'Session not found');
          return;
        }
        await session.transport.handleRequest(req, res, body);
        return;
      }

      if (isInitializeRequest(body)) {
        if (sessions.size >= MAX_SESSIONS) {
          rpcError(res, 503, -32000, `Too many active sessions (max ${MAX_SESSIONS})`);
          return;
        }
        const session = await createSession();
        await session.transport.handleRequest(req, res, body);
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
      const session = sessions.get(sessionId);
      if (!session) {
        rpcError(res, 404, -32001, 'Session not found');
        return;
      }
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
    const open = Array.from(sessions.values());
    sessions.clear();
    await Promise.all(open.map(s => s.transport.close().catch(() => undefined)));
  }

  return { handler, sessions, setPort: p => { boundPort = p; }, close };
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
 * missing `OMNIMIND_MCP_API_KEY` exits the process with code 1. Tests pass
 * `opts` explicitly and `port = 0` for an ephemeral port.
 */
export async function startHttpServer(
  port = DEFAULT_PORT,
  opts?: Partial<HttpTransportOptions>
): Promise<StartedHttpServer> {
  let config: HttpConfig;
  try {
    config = opts?.apiKey ? { apiKey: opts.apiKey, allowedHosts: opts.allowedHosts } : resolveHttpConfig();
  } catch (err) {
    console.error(`[omnimind-mcp] ${(err as Error).message}`);
    process.exit(1);
  }

  const app = createHttpApp({ ...opts, apiKey: config.apiKey, allowedHosts: opts?.allowedHosts ?? config.allowedHosts });
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

  const close = async () => {
    await app.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  };

  return { server: httpServer, app, port: boundPort, close };
}
