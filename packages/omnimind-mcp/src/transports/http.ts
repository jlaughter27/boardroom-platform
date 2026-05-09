import { createServer, type IncomingMessage, type ServerResponse } from 'http';
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

export async function startHttpServer(port = DEFAULT_PORT): Promise<void> {
  const { server, agentCtx } = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Basic API key check for HTTP transport
    const authHeader = req.headers['authorization'];
    const providedKey = (req.headers['x-mcp-api-key'] as string | undefined)
      ?? (typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : undefined);
    const expectedKey = process.env.OMNIMIND_MCP_API_KEY;

    if (expectedKey && providedKey !== expectedKey) {
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
