import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createOmniMindClient, OmniMindHttpError } from './lib/client';
import type { OmniMindClient } from './lib/client';
import { resolveAgentFromEnv } from './lib/auth';
import { memoryWriteTool, memorySearchTool, memorySupersedeT, memoryReflectTool, memoryConsolidateTool } from './tools/memory.tool';
import type { WriteExtractMode } from './tools/memory.tool';
import { decisionLogTool } from './tools/decision.tool';
import { taskUpsertTool, taskStatusTool, taskListTool, taskCompleteTool, taskBlockTool } from './tools/task.tool';
import { projectStatusTool, projectSummaryTool } from './tools/project.tool';
import { personGetTool } from './tools/person.tool';
import { commitmentLogTool, commitmentListTool } from './tools/commitment.tool';
import { statusGetTool } from './tools/status.tool';
import { graphNeighborhoodTool } from './tools/graph.tool';
import { searchTool, fetchTool, resolveAppUrl } from './tools/connector.tool';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';
import { SERVER_INSTRUCTIONS } from './instructions';
import { ScopeDeniedError, McpValidationError } from './types';
import type { AgentContext, McpTool, McpToolAnnotations } from './types';

export interface BuildToolsOptions {
  /** `OMNIMIND_MCP_APP_URL` — result urls for `search` / `fetch`. */
  appUrl?: string;
  /** `OMNIMIND_MCP_WRITE_EXTRACT` override for `memory_write`. */
  writeExtractMode?: WriteExtractMode;
  /** M-2 — client for `memory_write`'s async extraction tail; outlives the session (HTTP front door). Identity is bound by `createMcpServer`. */
  deferredClient?: OmniMindClient;
  /** M-2 — receives each deferred-extraction promise so the HTTP app can drain them on shutdown. */
  onDeferred?: (done: Promise<void>) => void;
}

/** Every tool this server registers, in registration order (18 Phase 6 tools + the `search` / `fetch` connector pair). */
export function buildTools(client: ReturnType<typeof createOmniMindClient>, agentCtx: AgentContext, opts: BuildToolsOptions = {}): McpTool[] {
  const connector = { appUrl: opts.appUrl ?? resolveAppUrl() };
  return [
    memoryWriteTool(client, agentCtx, {
      ...(opts.writeExtractMode ? { extractMode: opts.writeExtractMode } : {}),
      ...(opts.deferredClient ? { deferredClient: opts.deferredClient } : {}),
      ...(opts.onDeferred ? { onDeferred: opts.onDeferred } : {}),
    }),
    memorySearchTool(client, agentCtx),
    memorySupersedeT(client, agentCtx),
    decisionLogTool(client, agentCtx),
    taskUpsertTool(client, agentCtx),
    taskStatusTool(client, agentCtx),
    taskListTool(client, agentCtx),
    taskCompleteTool(client, agentCtx),
    taskBlockTool(client, agentCtx),
    projectStatusTool(client, agentCtx),
    projectSummaryTool(client, agentCtx),
    personGetTool(client, agentCtx),
    commitmentLogTool(client, agentCtx),
    commitmentListTool(client, agentCtx),
    statusGetTool(client, agentCtx),
    // Phase 6
    memoryReflectTool(client, agentCtx),
    memoryConsolidateTool(client, agentCtx),
    graphNeighborhoodTool(client, agentCtx),
    // Front door — ChatGPT connector shape
    searchTool(client, agentCtx, connector),
    fetchTool(client, agentCtx, connector),
  ];
}

export const TOOL_COUNT = 20;

/**
 * Tool `_meta` key Claude Code honours to always prompt before a call. Set
 * generically for every tool whose annotations say `destructiveHint: true`
 * (memory_supersede, memory_consolidate) — memory poisoning is the live threat
 * for a shared store and these two rewrite existing rows.
 */
export const REQUIRES_USER_INTERACTION_META = 'anthropic/requiresUserInteraction';

export function toolMeta(annotations: McpToolAnnotations): Record<string, unknown> | undefined {
  return annotations.destructiveHint ? { [REQUIRES_USER_INTERACTION_META]: true } : undefined;
}

function errorResult(error: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error, message }) }],
    isError: true as const,
  };
}

/**
 * Bind the caller's identity to the outbound client. A delegated principal
 * (HTTP front door: `omt_` token / OAuth) gets `x-agent-key` + `x-mcp-principal`
 * and never the legacy triple; everything else (stdio, static key) keeps
 * sending `x-agent-id` / `x-tenant-id` / `x-source-weight` as before.
 */
export function bindClientIdentity(client: OmniMindClient, agentCtx: AgentContext): void {
  if (agentCtx.principal) {
    client.setDelegatedPrincipal({ kind: agentCtx.principal.kind, id: agentCtx.principal.id });
    return;
  }
  client.setAgentHeaders({
    agentId: agentCtx.agentId,
    tenantId: agentCtx.tenantId,
    sourceWeight: agentCtx.sourceWeight,
  });
}

/**
 * When a user is bound to this server (`defaultUserId`: the principal's user
 * for a delegated caller, `OMNIMIND_MCP_USER_ID` for stdio) a tool's `userId`
 * argument becomes optional in the advertised schema and is filled in before
 * execution. For a delegated principal a conflicting explicit `userId` is a
 * VALIDATION_ERROR — a model-supplied id can never widen access.
 */
export function relaxUserIdSchema<T extends McpTool['inputSchema']>(schema: T, agentCtx: AgentContext): McpTool['inputSchema'] {
  const userId = schema.shape.userId;
  if (!agentCtx.defaultUserId || !userId || userId.isOptional()) return schema;
  return schema.extend({ userId: userId.optional().describe('Defaults to the authenticated user') });
}

export function withBoundUser(args: unknown, agentCtx: AgentContext, hasUserIdArg: boolean): unknown {
  if (!agentCtx.defaultUserId || !hasUserIdArg) return args;
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  if (agentCtx.principal) {
    if (a.userId !== undefined && a.userId !== agentCtx.defaultUserId) {
      throw new McpValidationError('Invalid tool input: userId: does not match the authenticated principal', [
        { path: 'userId', message: 'does not match the authenticated principal' },
      ]);
    }
    return { ...a, userId: agentCtx.defaultUserId };
  }
  return a.userId === undefined ? { ...a, userId: agentCtx.defaultUserId } : a;
}

export interface CreateMcpServerOptions extends BuildToolsOptions {
  /** Per-session client (HTTP front door); defaults to one built from env. The server binds its identity. */
  client?: OmniMindClient;
}

export function createMcpServer(ctx?: AgentContext, opts: CreateMcpServerOptions = {}) {
  const agentCtx = ctx ?? resolveAgentFromEnv();
  const client = opts.client ?? createOmniMindClient();
  // Bind caller identity to the client so every outbound HTTP request carries
  // either x-agent-id / x-tenant-id / x-source-weight (static identity; the
  // server-side middleware reads these to populate req.agentContext) or
  // x-mcp-principal (delegated principal, resolved server-side). The deferred
  // client (M-2) acts for the same caller after the session is gone.
  bindClientIdentity(client, agentCtx);
  if (opts.deferredClient && opts.deferredClient !== client) bindClientIdentity(opts.deferredClient, agentCtx);

  const server = new McpServer(
    {
      name: 'omnimind-mcp',
      version: '0.3.0',
    },
    { instructions: SERVER_INSTRUCTIONS }
  );

  const tools = buildTools(client, agentCtx, opts);

  for (const tool of tools) {
    const hasUserIdArg = Boolean(tool.inputSchema.shape.userId);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Zod object schemas are accepted directly (AnySchema); the SDK converts
        // them to JSON Schema for tools/list and validates args / structuredContent.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: relaxUserIdSchema(tool.inputSchema, agentCtx) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputSchema: tool.outputSchema as any,
        annotations: tool.annotations,
        ...(toolMeta(tool.annotations) ? { _meta: toolMeta(tool.annotations) } : {}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any) => {
        try {
          const result = await tool.execute(withBoundUser(args, agentCtx, hasUserIdArg));
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (err) {
          if (err instanceof ScopeDeniedError) return errorResult('SCOPE_DENIED', (err as Error).message);
          if (err instanceof McpValidationError) return errorResult('VALIDATION_ERROR', (err as Error).message);
          // L-6 — the API intersects delegated scopes with the gateway ceiling;
          // its 403 insufficient_scope is the same typed refusal as a local
          // requireScope() miss, not an opaque HTTP error string.
          if (err instanceof OmniMindHttpError && err.isInsufficientScope) {
            return errorResult('SCOPE_DENIED', `OmniMind refused ${tool.name}: insufficient_scope (the effective scopes for this principal are narrower than the tool requires)`);
          }
          throw err;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    );
  }

  registerResources(server, client, agentCtx);
  registerPrompts(server, agentCtx);

  return { server, agentCtx, tools, client };
}
