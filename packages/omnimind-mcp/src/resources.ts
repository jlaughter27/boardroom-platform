import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OmniMindClient } from './lib/client';
import { requireScope } from './lib/namespace';
import { withAudit } from './lib/audit';
import { statusGetTool } from './tools/status.tool';
import { walkNeighborhood } from './tools/graph.tool';
import type { AgentContext } from './types';

/**
 * Phase 6 — `omnimind://{tenant}/…` resources. Narrow on purpose: a status
 * snapshot, one goal / person capsule, one 2-hop graph neighbourhood. The
 * whole graph is never a single resource and tools are not mirrored 1:1.
 *
 * `{tenant}` MUST equal the server's bound tenant — any other value is refused
 * (resources have no scope argument, so the URI is the only boundary a client
 * can probe). Reads run as `ctx.defaultUserId` (`OMNIMIND_MCP_USER_ID`); when
 * it is unset the resource returns a `NO_USER_BOUND` payload rather than
 * guessing a user.
 *
 * Every read is audited (R-M-06): the status resource delegates to
 * `status_get` (audited as that tool); goal / person / graph reads go through
 * `withAudit` under `resource:<name>` so mcp_audit_logs sees them too.
 */
export const RESOURCE_MIME = 'application/json';
export const RESOURCE_TEMPLATES = [
  'omnimind://{tenant}/status',
  'omnimind://{tenant}/goal/{id}',
  'omnimind://{tenant}/person/{id}',
  'omnimind://{tenant}/graph/{nodeId}',
] as const;

export class TenantMismatchError extends Error {
  readonly code = 'TENANT_MISMATCH';
  constructor(requested: string, bound: string) {
    super(`Resource tenant "${requested}" does not match this server's bound tenant "${bound}"`);
    this.name = 'TenantMismatchError';
  }
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export function assertTenant(ctx: AgentContext, requested: string): void {
  if (decodeURIComponent(requested) !== ctx.tenantId) throw new TenantMismatchError(requested, ctx.tenantId);
}

function json(uri: string, payload: unknown) {
  return { contents: [{ uri, mimeType: RESOURCE_MIME, text: JSON.stringify(payload, null, 2) }] };
}

function noUser(uri: string) {
  return json(uri, {
    error: 'NO_USER_BOUND',
    message: 'Set OMNIMIND_MCP_USER_ID on the MCP server to read omnimind:// resources (tools take userId explicitly; resources cannot).',
  });
}

export function registerResources(server: McpServer, client: OmniMindClient, ctx: AgentContext): void {
  const meta = (title: string, description: string) => ({ title, description, mimeType: RESOURCE_MIME });

  server.registerResource(
    'status',
    new ResourceTemplate(RESOURCE_TEMPLATES[0], {
      // The only enumerable instance is this server's own tenant.
      list: async () => ({
        resources: [{ uri: `omnimind://${ctx.tenantId}/status`, name: `status (${ctx.tenantId})`, mimeType: RESOURCE_MIME }],
      }),
    }),
    meta('Status snapshot', 'Same payload as the status_get tool: recent decisions, active tasks, blockers, pending commitments, commitments due soon.'),
    async (uri, vars) => {
      assertTenant(ctx, one(vars.tenant));
      if (!ctx.defaultUserId) return noUser(uri.href);
      const snapshot = await statusGetTool(client, ctx).execute({ userId: ctx.defaultUserId });
      return json(uri.href, snapshot);
    }
  );

  server.registerResource(
    'goal',
    new ResourceTemplate(RESOURCE_TEMPLATES[1], { list: undefined }),
    meta('Goal capsule', 'A goal plus its context capsule (summary, open risks, unresolved questions, recent changes).'),
    async (uri, vars) => {
      assertTenant(ctx, one(vars.tenant));
      requireScope(ctx, 'memory:read');
      if (!ctx.defaultUserId) return noUser(uri.href);
      const id = decodeURIComponent(one(vars.id));
      const userId = ctx.defaultUserId;
      const payload = await withAudit(client, ctx, 'resource:goal', { id, userId }, async () => {
        const [goal, capsules] = await Promise.all([
          client.getGoal(id, userId),
          client.getCapsules([`goal:${id}`], userId).catch(() => []),
        ]);
        return { goal, capsule: capsules[0] ?? null };
      });
      return json(uri.href, payload);
    }
  );

  server.registerResource(
    'person',
    new ResourceTemplate(RESOURCE_TEMPLATES[2], { list: undefined }),
    meta('Person capsule', 'A person plus their context capsule.'),
    async (uri, vars) => {
      assertTenant(ctx, one(vars.tenant));
      requireScope(ctx, 'memory:read');
      if (!ctx.defaultUserId) return noUser(uri.href);
      const id = decodeURIComponent(one(vars.id));
      const userId = ctx.defaultUserId;
      const payload = await withAudit(client, ctx, 'resource:person', { id, userId }, async () => {
        const [person, capsules] = await Promise.all([
          client.getPerson(id, userId),
          client.getCapsules([`person:${id}`], userId).catch(() => []),
        ]);
        return { person, capsule: capsules[0] ?? null };
      });
      return json(uri.href, payload);
    }
  );

  server.registerResource(
    'graph',
    new ResourceTemplate(RESOURCE_TEMPLATES[3], { list: undefined }),
    meta('Graph neighbourhood', '2-hop knowledge-graph neighbourhood around `<type>:<refId>` (max 60 nodes). Prefer the graph_neighborhood tool when your client supports tools.'),
    async (uri, vars) => {
      assertTenant(ctx, one(vars.tenant));
      requireScope(ctx, 'memory:read');
      if (!ctx.defaultUserId) return noUser(uri.href);
      const nodeId = decodeURIComponent(one(vars.nodeId));
      const userId = ctx.defaultUserId;
      const graph = await withAudit(client, ctx, 'resource:graph', { nodeId, hops: 2, userId }, () =>
        walkNeighborhood(client, userId, nodeId, 2)
      );
      return json(uri.href, graph);
    }
  );
}
