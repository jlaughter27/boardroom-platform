import { fetch } from 'undici';

export interface OmniMindClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Per-request agent identity headers. These propagate through the API
 * middleware (`agent-context.ts`) and onto every memory write so the DB
 * row carries `agent_id`, `tenant_id`, `source_weight` correctly.
 *
 * If unset, the server falls back to the `Agent` table lookup by API-key hash.
 */
export interface AgentHeaders {
  agentId: string;
  tenantId: string;
  sourceWeight: number;
}

export interface SearchMemoriesParams {
  query: string;
  tenantId: string;
  limit?: number;
  similarityThreshold?: number;
  userId?: string;
  domain?: string;
  includeArchived?: boolean;
}

export interface SearchSimilarParams {
  query: string;
  userId: string;
  threshold?: number;
  limit?: number;
  domain?: string;
}

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  domain: string;
  tags: string[];
  importance: number;
  sourceType: string;
  agentId?: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

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
  supersedes?: string;
}

export class OmniMindClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private agentHeaders: AgentHeaders | null = null;

  constructor(config: OmniMindClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  /**
   * Attach agent identity to every subsequent request. Called once at startup
   * by the MCP server when the AgentContext is loaded from env. Tools should
   * NOT call this — they receive the same context via the AgentContext arg.
   */
  setAgentHeaders(headers: AgentHeaders): void {
    this.agentHeaders = headers;
  }

  private async request<T>(method: string, path: string, body?: unknown, userId?: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      };
      if (userId) headers['x-user-id'] = userId;
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

  async searchMemories(params: SearchMemoriesParams): Promise<MemoryRecord[]> {
    const qs = new URLSearchParams({
      q: params.query,
      tenantId: params.tenantId,
      limit: String(params.limit ?? 5),
      ...(params.similarityThreshold !== undefined && { threshold: String(params.similarityThreshold) }),
      ...(params.domain && { domain: params.domain }),
      ...(params.includeArchived && { includeArchived: 'true' }),
    });

    const result = await this.request<{ memories: MemoryRecord[] }>('GET', `/memories?${qs}`, undefined, params.userId);
    return result.memories ?? [];
  }

  async createMemory(params: CreateMemoryParams, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('POST', `/memories`, params, userId);
  }

  async updateMemory(id: string, params: Partial<CreateMemoryParams>, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('PATCH', `/memories/${id}`, params, userId);
  }

  async getMemory(id: string, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('GET', `/memories/${id}`, undefined, userId);
  }

  async searchSimilar(params: SearchSimilarParams): Promise<MemoryRecord[]> {
    const result = await this.request<{ memories: MemoryRecord[] }>(
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
    await this.request<unknown>('POST', '/mcp/agents', params);
  }
}

export function createOmniMindClient(): OmniMindClient {
  const baseUrl = process.env.OMNIMIND_API_URL;
  const apiKey = process.env.OMNIMIND_API_KEY;

  if (!baseUrl) throw new Error('OMNIMIND_API_URL is required');
  if (!apiKey) throw new Error('OMNIMIND_API_KEY is required');

  return new OmniMindClient({ baseUrl, apiKey });
}
