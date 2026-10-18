import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { MAX_PAGE_SIZE } from '../lib/cursor';
import { PROVENANCE, McpProvenanceSchema } from '../lib/provenance';
import type { OmniMindClient, MemoryRecord } from '../lib/client';
import { McpValidationError, READ_ONLY_ANNOTATIONS } from '../types';
import type { AgentContext, McpTool } from '../types';

/**
 * ChatGPT connector shape — `search({query})` → `{results:[{id,title,url}]}`
 * and `fetch({id})` → one document. Thin read-only wrappers over the same
 * hybrid `POST /memories/search` path as `memory_search` and the by-id read.
 * ChatGPT keys its confirmation prompts off `readOnlyHint`, and Deep
 * Research / company knowledge retrieve through exactly this pair.
 *
 * `userId` defaults to the bound user (`AgentContext.defaultUserId` — the
 * principal's user for a delegated caller, `OMNIMIND_MCP_USER_ID` for stdio).
 */
export const SEARCH_DEFAULT_LIMIT = 10;

export interface ConnectorToolOptions {
  /** `OMNIMIND_MCP_APP_URL` — when set, result urls are `${appUrl}/memory/${id}`; else `omnimind://<tenant>/memory/<id>`. */
  appUrl?: string;
}

export function resolveAppUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.OMNIMIND_MCP_APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

export function memoryUrl(ctx: AgentContext, id: string, appUrl: string | undefined): string {
  return appUrl ? `${appUrl}/memory/${encodeURIComponent(id)}` : `omnimind://${ctx.tenantId}/memory/${encodeURIComponent(id)}`;
}

const NON_MEMORY_NODE_TYPES = ['goal', 'project', 'task', 'person', 'decision', 'commitment'];
const RAW_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Accept a memory id in any form this server hands out — the raw id, a
 * `memory:<id>` graph node id, the `omnimind://<tenant>/memory/<id>` resource
 * form (tenant must match) or the app url — and refuse anything else with
 * VALIDATION_ERROR. Ids of goals / people / tasks are never fetched here.
 */
export function parseMemoryId(raw: string, ctx: AgentContext, appUrl: string | undefined): string {
  const value = raw.trim();
  const reject = (why: string): never => {
    throw new McpValidationError(`Invalid tool input: id: ${why}`, [{ path: 'id', message: why }]);
  };
  if (!value) return reject('must not be empty');

  const resource = /^omnimind:\/\/([^/]+)\/memory\/([^/?#]+)$/.exec(value);
  if (resource) {
    if (decodeURIComponent(resource[1]) !== ctx.tenantId) return reject('resource tenant does not match this principal');
    return checkRaw(decodeURIComponent(resource[2]), reject);
  }
  if (appUrl && value.startsWith(`${appUrl}/memory/`)) {
    return checkRaw(decodeURIComponent(value.slice(appUrl.length + '/memory/'.length).split(/[?#]/)[0]), reject);
  }
  const node = /^([a-z]+):(.+)$/.exec(value);
  if (node) {
    if (node[1] === 'memory') return checkRaw(node[2], reject);
    if (NON_MEMORY_NODE_TYPES.includes(node[1])) return reject(`"${node[1]}:" ids are not memories; fetch only accepts memory ids`);
    return reject('not a memory id');
  }
  return checkRaw(value, reject);
}

function checkRaw(id: string, reject: (why: string) => never): string {
  return RAW_ID.test(id) ? id : reject('not a memory id');
}

const SearchInput = z.object({
  query: z.string().min(1).describe('Natural-language search query over the memory store'),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(SEARCH_DEFAULT_LIMIT).describe(`Max results (default ${SEARCH_DEFAULT_LIMIT}, max ${MAX_PAGE_SIZE})`),
  userId: z.string().optional().describe('Defaults to the authenticated user'),
});

const FetchInput = z.object({
  id: z.string().min(1).describe('A memory id returned by search'),
  userId: z.string().optional().describe('Defaults to the authenticated user'),
});

export const SearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});

export const SearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
  provenance: McpProvenanceSchema,
});

export const FetchOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  metadata: z.object({
    domain: z.string().optional(),
    tags: z.array(z.string()).optional(),
    createdAt: z.string().optional(),
    validAt: z.string().optional(),
    invalidAt: z.string().nullable().optional(),
    status: z.string().optional(),
    sourceType: z.string().optional(),
    agentId: z.string().optional(),
  }),
  provenance: McpProvenanceSchema,
});

export interface SearchResult {
  id: string;
  title: string;
  url: string;
}

export interface SearchOutput {
  results: SearchResult[];
  provenance: typeof PROVENANCE;
}

export interface FetchOutput {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    domain?: string;
    tags?: string[];
    createdAt?: string;
    validAt?: string;
    invalidAt?: string | null;
    status?: string;
    sourceType?: string;
    agentId?: string;
  };
  provenance: typeof PROVENANCE;
}

function boundUser(ctx: AgentContext, explicit: string | undefined): string {
  const userId = explicit ?? ctx.defaultUserId;
  if (!userId) {
    throw new McpValidationError('Invalid tool input: userId: required (no user is bound to this principal)', [
      { path: 'userId', message: 'required (no user is bound to this principal)' },
    ]);
  }
  return userId;
}

function titleOf(m: Pick<MemoryRecord, 'title' | 'content'>): string {
  return (m.title && m.title.trim()) || (m.content ?? '').slice(0, 80) || '(untitled)';
}

export function searchTool(client: OmniMindClient, ctx: AgentContext, opts: ConnectorToolOptions = {}) {
  return {
    name: 'search',
    title: 'Search (connector)',
    description: 'Read-only connector search over the shared memory store (same hybrid semantic + full-text + trigram ranking as memory_search). Returns {results:[{id,title,url}]}; pass an id to fetch for the full text.',
    inputSchema: SearchInput,
    outputSchema: SearchOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown): Promise<SearchOutput> {
      requireScope(ctx, 'memory:read');
      const input = parseInput(SearchInput, raw);
      const userId = boundUser(ctx, input.userId);
      return withAudit(client, ctx, 'search', { query: input.query, limit: input.limit, userId }, async () => {
        const { items } = await client.searchHybrid({ query: input.query, limit: input.limit }, userId);
        return {
          results: items.map(m => ({ id: m.id, title: titleOf(m), url: memoryUrl(ctx, m.id, opts.appUrl) })),
          provenance: PROVENANCE,
        };
      });
    },
  } satisfies McpTool;
}

export function fetchTool(client: OmniMindClient, ctx: AgentContext, opts: ConnectorToolOptions = {}) {
  return {
    name: 'fetch',
    title: 'Fetch (connector)',
    description: 'Read-only connector fetch of one memory by id (from search): {id,title,text,url,metadata}. Only memory ids are accepted.',
    inputSchema: FetchInput,
    outputSchema: FetchOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown): Promise<FetchOutput> {
      requireScope(ctx, 'memory:read');
      const input = parseInput(FetchInput, raw);
      const userId = boundUser(ctx, input.userId);
      const id = parseMemoryId(input.id, ctx, opts.appUrl);
      return withAudit(client, ctx, 'fetch', { id, userId }, async () => {
        const m = await client.getMemory(id, userId);
        return {
          id: m.id,
          title: titleOf(m),
          text: m.content ?? '',
          url: memoryUrl(ctx, m.id, opts.appUrl),
          metadata: {
            ...(m.domain !== undefined ? { domain: m.domain } : {}),
            ...(m.tags !== undefined ? { tags: m.tags } : {}),
            ...(m.createdAt !== undefined ? { createdAt: m.createdAt } : {}),
            ...(m.validAt !== undefined ? { validAt: m.validAt } : {}),
            ...(m.invalidAt !== undefined ? { invalidAt: m.invalidAt } : {}),
            ...(m.status !== undefined ? { status: m.status } : {}),
            ...(m.sourceType !== undefined ? { sourceType: m.sourceType } : {}),
            ...(m.agentId !== undefined ? { agentId: m.agentId } : {}),
          },
          provenance: PROVENANCE,
        };
      });
    },
  } satisfies McpTool;
}
