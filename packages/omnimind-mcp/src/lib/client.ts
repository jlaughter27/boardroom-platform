import { fetch } from 'undici';
import type { MemoryApiRecord } from '@boardroom/shared';
import { assertSourceWeight } from './auth';

export interface OmniMindClientConfig {
  baseUrl: string;
  /** Shared service key — sent as `x-api-key` (authenticates the MCP process to OmniMind). */
  apiKey: string;
  /**
   * M-103 — The per-agent `omk_...` key from keygen (env `OMNIMIND_MCP_AGENT_KEY`).
   * Sent as `x-agent-key` so the API can verify agent identity / tenant / scopes
   * against the `agents` table instead of trusting the x-agent-* headers.
   */
  agentKey?: string;
  timeoutMs?: number;
}

/**
 * Per-request agent identity headers. These propagate through the API
 * middleware (`agent-context.ts`) and onto every memory write so the DB
 * row carries `agent_id`, `tenant_id`, `source_weight` correctly.
 */
export interface AgentHeaders {
  agentId: string;
  tenantId: string;
  sourceWeight: number;
}

/**
 * Parameters for `GET /memories`. Semantics (memory.service.ts searchMemories):
 *   - `query`  → `q`: case-insensitive SUBSTRING match on title OR content.
 *   - `tags`   → `tags`: comma-joined; Prisma `hasEvery` (every tag must be present).
 *   - `status` → exact MemoryStatus; when omitted the API excludes ARCHIVED.
 *   - `domain` → exact match.
 * There is NO similarity threshold on this route; use `searchSimilar` for that.
 */
export interface SearchMemoriesParams {
  query?: string;
  tags?: string[];
  tenantId: string;
  limit?: number;
  offset?: number;
  userId?: string;
  domain?: string;
  status?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'importance';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchSimilarParams {
  query: string;
  userId: string;
  threshold?: number;
  limit?: number;
  domain?: string;
}

/**
 * S-101 — The memory record is the shared wire type. `MemoryRecord` is kept as
 * an alias for existing importers.
 */
export type MemoryRecord = MemoryApiRecord;

/** Reduced row returned by `POST /memories/search-similar`. */
export type SimilarMemoryRecord = Pick<
  MemoryApiRecord,
  'id' | 'title' | 'content' | 'domain' | 'tags' | 'importance' | 'sourceType' | 'tenantId' | 'sourceWeight' | 'createdAt' | 'updatedAt'
> & { similarity: number };

export interface CreateMemoryParams {
  title: string;
  content: string;
  domain: string;
  tags?: string[];
  importance?: number;
  sourceType?: string;
  agentId?: string;
  tenantId?: string;
  sourceWeight?: number;
  // NOTE: `supersedes` was removed (M-107) — CreateMemoryRequestSchema strips
  // it server-side. Supersede via `updateMemory(id, ...)` explicitly.
}

/**
 * M-107 — What `POST /memories` actually returns (memory.service.ts
 * createMemory): the id plus whether the server created a new row or
 * auto-superseded a near-duplicate ("updated").
 */
export interface CreateMemoryResult {
  id: string;
  status: 'created' | 'updated';
  validation?: unknown;
}

export class OmniMindClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly agentKey: string | undefined;
  private readonly timeoutMs: number;
  private agentHeaders: AgentHeaders | null = null;

  constructor(config: OmniMindClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.agentKey = config.agentKey;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  /**
   * Attach agent identity to every subsequent request. Called once at startup
   * by the MCP server when the AgentContext is loaded from env. Tools should
   * NOT call this — they receive the same context via the AgentContext arg.
   * F-217: the source weight is validated (finite, 0..2) before it is ever sent.
   */
  setAgentHeaders(headers: AgentHeaders): void {
    this.agentHeaders = { ...headers, sourceWeight: assertSourceWeight(headers.sourceWeight) };
  }

  private async request<T>(method: string, path: string, body?: unknown, userId?: string, extraHeaders?: Record<string, string>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      };
      if (this.agentKey) headers['x-agent-key'] = this.agentKey;
      if (userId) headers['x-user-id'] = userId;
      if (extraHeaders) Object.assign(headers, extraHeaders);
      // Propagate agent identity — server middleware (`agent-context.ts`)
      // reads these to populate req.agentContext, which flows into every
      // memory write. Without these, agent_id ends up NULL and tenant_id
      // falls back to the schema default. (Hermes bugs #1, #2, #3, #5.)
      if (this.agentHeaders) {
        headers['x-agent-id'] = this.agentHeaders.agentId;
        headers['x-tenant-id'] = this.agentHeaders.tenantId;
        headers['x-source-weight'] = String(this.agentHeaders.sourceWeight);
      }

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OmniMind ${method} ${path} → ${res.status}: ${text}`);
      }

      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Build the query string for GET /memories. Exported for tests (M-102). */
  static buildSearchQuery(params: SearchMemoriesParams): URLSearchParams {
    const qs = new URLSearchParams();
    if (params.query && params.query.trim().length > 0) qs.set('q', params.query);
    if (params.tags && params.tags.length > 0) qs.set('tags', params.tags.join(','));
    qs.set('tenantId', params.tenantId);
    qs.set('limit', String(params.limit ?? 5));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    if (params.domain) qs.set('domain', params.domain);
    if (params.status) qs.set('status', params.status);
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    if (params.sortOrder) qs.set('sortOrder', params.sortOrder);
    return qs;
  }

  async searchMemories(params: SearchMemoriesParams): Promise<MemoryRecord[]> {
    const qs = OmniMindClient.buildSearchQuery(params);

    // WS-7.3 shape bug fix: the GET /memories route returns
    //   { items: MemoryRecord[], total: number, offset: number, limit: number }
    // (matches the standard listing envelope used elsewhere in the API). The
    // client previously read `result.memories`, which is always undefined →
    // `searchMemories` silently returned `[]`. Surfaced by WS-5 E2E-2 (which
    // had to route around it). The /memories/search-similar POST endpoint
    // does still return `{ memories: [...] }` — that one is correct.
    const result = await this.request<{ items?: MemoryRecord[]; memories?: MemoryRecord[] }>(
      'GET',
      `/memories?${qs}`,
      undefined,
      params.userId
    );
    return result.items ?? result.memories ?? [];
  }

  async createMemory(params: CreateMemoryParams, userId: string): Promise<CreateMemoryResult> {
    return this.request<CreateMemoryResult>('POST', `/memories`, params, userId);
  }

  async updateMemory(id: string, params: Partial<CreateMemoryParams>, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('PATCH', `/memories/${id}`, params, userId);
  }

  async getMemory(id: string, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('GET', `/memories/${id}`, undefined, userId);
  }

  async searchSimilar(params: SearchSimilarParams): Promise<SimilarMemoryRecord[]> {
    const result = await this.request<{ memories: SimilarMemoryRecord[] }>(
      'POST',
      '/memories/search-similar',
      { query: params.query, threshold: params.threshold, limit: params.limit, domain: params.domain },
      params.userId
    );
    return result.memories ?? [];
  }

  async logAudit(entry: {
    agentId: string;
    tenantId: string;
    toolName: string;
    inputJson: unknown;
    outputJson?: unknown;
    errorMessage?: string;
    durationMs: number;
  }): Promise<void> {
    await this.request<unknown>('POST', `/mcp/audit`, entry);
  }

  async registerAgent(params: {
    name: string;
    apiKeyHash: string;
    tenantId: string;
    scopes: string[];
    sourceWeight: number;
  }): Promise<void> {
    // F-104: agent registration is admin-gated server-side (creates tenant/scope
    // identity). Send OMNIMIND_ADMIN_KEY as x-admin-key when available; in
    // production the API returns 503 admin_disabled until that key is set.
    const adminKey = process.env.OMNIMIND_ADMIN_KEY;
    await this.request<unknown>(
      'POST',
      '/mcp/agents',
      params,
      undefined,
      adminKey ? { 'x-admin-key': adminKey } : undefined
    );
  }
}

export function createOmniMindClient(env: NodeJS.ProcessEnv = process.env): OmniMindClient {
  const baseUrl = env.OMNIMIND_API_URL;
  const apiKey = env.OMNIMIND_API_KEY;
  const agentKey = env.OMNIMIND_MCP_AGENT_KEY?.trim() || undefined;

  if (!baseUrl) throw new Error('OMNIMIND_API_URL is required');
  if (!apiKey) throw new Error('OMNIMIND_API_KEY is required');

  return new OmniMindClient({ baseUrl, apiKey, agentKey });
}
