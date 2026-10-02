import { fetch } from 'undici';
import type { KnowledgeGraphEdge, KnowledgeGraphNode, MemoryApiRecord } from '@boardroom/shared';
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

/**
 * Phase 6 — per-call write options. `idempotencyKey` is sent as the
 * `Idempotency-Key` header (≤128 chars); OmniMind replays the stored result
 * for 24 h on the same (agent, key) and marks it `Idempotent-Replayed: true`.
 */
export interface WriteOptions {
  idempotencyKey?: string;
}

/**
 * `PATCH /memories/:id`. `supersedes` (Phase 6, A1) marks THAT memory
 * `invalidAt = now(), supersededBy = <this id>` and appends it to this row's
 * `consolidatedFrom` — content of the old row is never mutated.
 */
export interface UpdateMemoryParams extends Partial<CreateMemoryParams> {
  supersedes?: string;
}

/** `POST /memories/search` (A2) — hybrid semantic + FTS + trigram with the forgetting curve. */
export interface HybridSearchParams {
  query: string;
  /** ≤ 20 from the MCP side (API allows ≤ 50). */
  limit?: number;
  domain?: string;
  tags?: string[];
  status?: string;
  includeArchived?: boolean;
  /** ISO timestamp — temporal validity filter (`validAt <= asOf < invalidAt`). */
  asOf?: string;
  /** Opaque cursor (base64 of `{offset}`) from a previous page. */
  cursor?: string;
}

export type HybridMemoryRecord = MemoryApiRecord & { score?: number };

export interface HybridSearchResult {
  items: HybridMemoryRecord[];
  nextCursor: string | null;
}

export type ReflectEntityType = 'goal' | 'project' | 'person';

/** ContextCapsule on the wire (ISO strings). Phase 6 adds sourceMemoryIds / importanceSeen / version. */
export interface CapsuleRecord {
  id: string;
  userId?: string;
  entityType: string;
  entityId: string;
  summary: string;
  openRisks?: string[];
  unresolvedQuestions?: string[];
  activeStakeholders?: string[];
  recentChanges?: string[];
  sourceMemoryIds?: string[];
  importanceSeen?: number;
  version?: number;
  generatedAt?: string;
  staleAfter?: string;
  [extra: string]: unknown;
}

/** `GET /graph/backlinks/:nodeId` (A2). */
export interface BacklinksResult {
  node: KnowledgeGraphNode;
  backlinks: Array<{ node: KnowledgeGraphNode; edge: KnowledgeGraphEdge }>;
}

/** Commitment on the wire (ISO strings) as returned by `GET /commitments/nudges` (A1). */
export interface CommitmentRecord {
  id: string;
  description?: string;
  deadline?: string | null;
  status?: string;
  stakeholderId?: string | null;
  linkedProjectId?: string | null;
  [extra: string]: unknown;
}

export interface CommitmentNudges {
  dueSoon: CommitmentRecord[];
  overdue: CommitmentRecord[];
}

/** `POST /usage/llm` body (A1). Cost is computed server-side with `estimateCostUsd`. */
export interface LlmUsageRecord {
  service: string;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  sessionId?: string;
  userId?: string;
}

function idempotencyHeaders(opts?: WriteOptions): Record<string, string> | undefined {
  const key = opts?.idempotencyKey?.trim();
  return key ? { 'Idempotency-Key': key } : undefined;
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

  async createMemory(params: CreateMemoryParams, userId: string, opts?: WriteOptions): Promise<CreateMemoryResult> {
    return this.request<CreateMemoryResult>('POST', `/memories`, params, userId, idempotencyHeaders(opts));
  }

  async updateMemory(id: string, params: UpdateMemoryParams, userId: string, opts?: WriteOptions): Promise<MemoryRecord> {
    return this.request<MemoryRecord>('PATCH', `/memories/${encodeURIComponent(id)}`, params, userId, idempotencyHeaders(opts));
  }

  /**
   * Phase 6 — hybrid search (`POST /memories/search`). Same stack as
   * `/context/for-persona`: semantic + FTS + trigram → rank → forgetting
   * curve → decrypt. Tenant comes from the agent headers.
   */
  async searchHybrid(params: HybridSearchParams, userId: string): Promise<HybridSearchResult> {
    const body: Record<string, unknown> = { query: params.query, limit: Math.min(params.limit ?? 5, 20) };
    if (params.domain) body.domain = params.domain;
    if (params.tags && params.tags.length > 0) body.tags = params.tags;
    if (params.status) body.status = params.status;
    if (params.includeArchived) body.includeArchived = true;
    if (params.asOf) body.asOf = params.asOf;
    if (params.cursor) body.cursor = params.cursor;
    const result = await this.request<{ items?: HybridMemoryRecord[]; nextCursor?: string | null }>(
      'POST',
      '/memories/search',
      body,
      userId
    );
    return { items: result.items ?? [], nextCursor: result.nextCursor ?? null };
  }

  /** Phase 6 — `POST /context/reflect` regenerates one entity's capsule now and returns it. */
  async reflect(params: { entityType: ReflectEntityType; entityId: string }, userId: string): Promise<CapsuleRecord> {
    const result = await this.request<CapsuleRecord | { capsule: CapsuleRecord }>('POST', '/context/reflect', params, userId);
    return 'capsule' in result && result.capsule && typeof result.capsule === 'object'
      ? (result.capsule as CapsuleRecord)
      : (result as CapsuleRecord);
  }

  /** Phase 6 — `GET /context/capsules?entityIds=goal:x,person:y` → capsules (missing ones are simply absent). */
  async getCapsules(entityIds: string[], userId: string): Promise<CapsuleRecord[]> {
    if (entityIds.length === 0) return [];
    const qs = new URLSearchParams({ entityIds: entityIds.join(',') });
    const result = await this.request<{ items?: CapsuleRecord[] }>('GET', `/context/capsules?${qs}`, undefined, userId);
    return result.items ?? [];
  }

  /** Phase 6 — `GET /graph/backlinks/:nodeId` (`nodeId` = `type:refId`). */
  async getBacklinks(nodeId: string, userId: string): Promise<BacklinksResult> {
    const result = await this.request<BacklinksResult>('GET', `/graph/backlinks/${encodeURIComponent(nodeId)}`, undefined, userId);
    return { node: result.node, backlinks: result.backlinks ?? [] };
  }

  /** Phase 6 — `GET /commitments/nudges` → `{ dueSoon, overdue }` (SQL only, no LLM). */
  async getCommitmentNudges(userId: string): Promise<CommitmentNudges> {
    const result = await this.request<Partial<CommitmentNudges>>('GET', '/commitments/nudges', undefined, userId);
    return { dueSoon: result.dueSoon ?? [], overdue: result.overdue ?? [] };
  }

  async getGoal(id: string, userId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/goals/${encodeURIComponent(id)}`, undefined, userId);
  }

  async getPerson(id: string, userId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/people/${encodeURIComponent(id)}`, undefined, userId);
  }

  /**
   * Phase 6 — `POST /usage/llm`. Fire-and-forget: the returned promise never
   * rejects (failures are logged), so callers can `void` it safely.
   */
  async recordLlmUsage(usage: LlmUsageRecord): Promise<void> {
    try {
      await this.request<unknown>('POST', '/usage/llm', usage, usage.userId);
    } catch (err) {
      console.error('[usage] Failed to record LLM usage:', (err as Error).message);
    }
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
