import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../server';

const DEFAULT_PORT = 3334;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/**
 * F-203: timing-safe string compare. Returns false when lengths differ (so the
 * Buffer.from + timingSafeEqual call below never throws on mismatched-length
 * input). The dummy-buffer pad keeps the call shape constant.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Still spend a fixed amount of work so length-leak via timing is bounded.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export async function startHttpServer(port = DEFAULT_PORT): Promise<void> {
  // F-203: refuse to start in HTTP mode without an API key. Previously the
  // truthiness short-circuit `if (expectedKey && ...)` silently fell open to
  // unauthenticated access, exposing all 15 MCP tools on port 3334.
  const expectedKey = process.env.OMNIMIND_MCP_API_KEY;
  if (!expectedKey) {
    throw new Error(
      'OMNIMIND_MCP_API_KEY must be set when starting omnimind-mcp in HTTP mode. ' +
        'Refusing to start an unauthenticated MCP HTTP listener.'
    );
  }

  const { server, agentCtx } = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Basic API key check for HTTP transport
    const authHeader = req.headers['authorization'];
    const providedKey = (req.headers['x-mcp-api-key'] as string | undefined)
      ?? (typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : undefined);

    if (!providedKey || !safeEqual(providedKey, expectedKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const body = await readBody(req);
    await transport.handleRequest(req, res, body);
  });

  await server.connect(transport);

  httpServer.listen(port, () => {
    console.log(`[omnimind-mcp] HTTP transport started on port ${port}`);
    console.log(`[omnimind-mcp] agent=${agentCtx.agentName} tenant=${agentCtx.tenantId}`);
  });
}
