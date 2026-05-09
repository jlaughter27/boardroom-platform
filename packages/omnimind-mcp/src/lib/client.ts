import { fetch } from 'undici';

export interface OmniMindClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
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

  constructor(config: OmniMindClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
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
      ...(params.userId && { userId: params.userId }),
      ...(params.domain && { domain: params.domain }),
      ...(params.includeArchived && { includeArchived: 'true' }),
    });

    const result = await this.request<{ memories: MemoryRecord[] }>('GET', `/memories?${qs}`);
    return result.memories ?? [];
  }

  async createMemory(params: CreateMemoryParams, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('POST', `/memories`, { ...params, userId });
  }

  async updateMemory(id: string, params: Partial<CreateMemoryParams>, userId: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('PATCH', `/memories/${id}`, { ...params, userId });
  }

  async getMemory(id: string): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('GET', `/memories/${id}`);
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
}

export function createOmniMindClient(): OmniMindClient {
  const baseUrl = process.env.OMNIMIND_API_URL;
  const apiKey = process.env.OMNIMIND_API_KEY;

  if (!baseUrl) throw new Error('OMNIMIND_API_URL is required');
  if (!apiKey) throw new Error('OMNIMIND_API_KEY is required');

  return new OmniMindClient({ baseUrl, apiKey });
}
