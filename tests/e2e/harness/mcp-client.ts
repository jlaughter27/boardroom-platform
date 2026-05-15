/**
 * Test wrapper around the real MCP stdio server.
 *
 * Spawns `packages/omnimind-mcp/dist/index.js` as a child process with the
 * given agent identity env vars, then connects via the SDK's
 * StdioClientTransport so we can issue real callTool() requests.
 *
 * This is intentionally faithful to how Claude Desktop / Claude Code launch
 * the server in production. The only difference: we point OMNIMIND_API_URL
 * at the local test API, not the Railway deployment.
 *
 * Each test gets its own MCP client → server pair. They're cheap (~50 ms to
 * boot, single Node process spawning a single Node process) and isolation is
 * easier to reason about than a shared client.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestAgent } from './agent-context-factory';

export interface McpHandle {
  client: Client;
  close: () => Promise<void>;
  /**
   * Invoke a tool by name with raw args. Returns the JSON-parsed text response.
   *
   * Why JSON.parse here: every tool in this server returns its result as a
   * single `text` content block with stringified JSON inside (see server.ts).
   * Test assertions are easier against typed objects than against the raw
   * MCP envelope.
   */
  callTool: <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
  /**
   * Like callTool but returns the raw MCP envelope including isError.
   * Use when you specifically want to assert on tool-level failures
   * (validation errors, scope denials, etc.).
   */
  callToolRaw: (name: string, args: Record<string, unknown>) => Promise<RawToolResult>;
}

export interface RawToolResult {
  isError: boolean;
  content: Array<{ type: string; text?: string }>;
  parsed?: unknown;
}

export interface StartMcpOptions {
  agent: TestAgent;
  /** Test API base URL (e.g. http://localhost:3399) — from `harness.config`. */
  apiBaseUrl: string;
  /** Extra env to override or supplement (e.g. for misconfiguration tests). */
  extraEnv?: Record<string, string>;
}

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MCP_ENTRY = path.join(REPO_ROOT, 'packages/omnimind-mcp/dist/index.js');

export async function startMcpClient(opts: StartMcpOptions): Promise<McpHandle> {
  const { agent, apiBaseUrl, extraEnv = {} } = opts;

  // Fail early with an actionable error if the MCP server wasn't built.
  // pnpm build is part of the validation gate, so this is mostly a friendly
  // dev-time check.
  if (!fs.existsSync(MCP_ENTRY)) {
    throw new Error(
      `MCP server bundle not found at ${MCP_ENTRY}.\n` +
        `Build it first:\n` +
        `  pnpm --filter @boardroom/omnimind-mcp build\n` +
        `(or run \`pnpm build\` at the repo root)`
    );
  }

  // Build the full env. We start from process.env so PATH and friends are
  // available, then layer the agent-specific config on top.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OMNIMIND_API_URL: apiBaseUrl,
    OMNIMIND_API_KEY: agent.apiKey,
    OMNIMIND_MCP_AGENT_NAME: agent.agentName,
    OMNIMIND_MCP_TENANT_ID: agent.tenantId,
    OMNIMIND_MCP_SCOPES: agent.scopes.join(','),
    OMNIMIND_MCP_SOURCE_WEIGHT: String(agent.sourceWeight),
    ...extraEnv,
  };

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_ENTRY],
    env,
    stderr: 'pipe', // we want to inspect MCP server stderr on test failures
  });

  const client = new Client({ name: 'e2e-test-client', version: '0.1.0' });
  await client.connect(transport);

  return {
    client,
    close: async () => {
      await transport.close().catch(() => {});
    },
    callTool: async <T = unknown>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client.callTool({ name, arguments: args });
      const block = (result.content as Array<{ type: string; text?: string }>)?.[0];
      if (!block?.text) {
        throw new Error(`Tool ${name} returned no text content: ${JSON.stringify(result)}`);
      }
      if (result.isError) {
        // Surface the structured error to the caller — still parse it so they
        // can assert on the shape.
        const parsed = JSON.parse(block.text) as { error?: string; message?: string };
        const err = new Error(
          `MCP tool ${name} returned error: ${parsed.error ?? 'unknown'} — ${parsed.message ?? block.text}`
        );
        (err as Error & { mcpError?: unknown }).mcpError = parsed;
        throw err;
      }
      return JSON.parse(block.text) as T;
    },
    callToolRaw: async (name: string, args: Record<string, unknown>): Promise<RawToolResult> => {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
      const parsed = content[0]?.text ? safeParse(content[0].text) : undefined;
      return {
        isError: Boolean(result.isError),
        content,
        parsed,
      };
    },
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
