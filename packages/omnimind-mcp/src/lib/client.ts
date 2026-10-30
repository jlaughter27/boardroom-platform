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
 * Front door — identity of a delegated caller (`omt_` token or OAuth identity)
 * resolved by the HTTP transport. Sent as `x-mcp-principal: <kind>:<id>`
 * together with the gateway's `x-agent-key`; the API derives agent / tenant /
 * source weight / user from the principal row, so the three legacy identity
 * headers are suppressed for such a client.
 */
export interface DelegatedPrincipalRef {
  kind: 'token' | 'oauth';
  id: string;
}

/** `POST /mcp/tokens/introspect` / `POST /mcp/identities/resolve` success payload (the principal row). */
export interface McpPrincipalWire {
  kind: 'token' | 'oauth';
  id: string;
  userId: string;
  tenantId: string;
  agentName: string;
  scopes: string[];
  sourceWeight: number;
  name?: string;
  expiresAt?: string;
}

export type IntrospectResult =
  | { active: true; principal: McpPrincipalWire }
  | { active: false; reason: 'invalid' | 'expired' | 'revoked' };

export type ResolveIdentityResult =
  | { active: true; principal: McpPrincipalWire }
  /** `issuer_not_allowed`: the API's issuer allow-list refused the token's `iss` (also a 401 at the front door). */
  | { active: false; reason: 'unlinked' | 'issuer_not_allowed' };

/** Claims the gateway forwards to `POST /mcp/identities/resolve` after verifying an OAuth access token. */
export interface IdentityClaims {
  issuer: string;
  subject: string;
  email?: string;
  emailVerified?: boolean;
  clientId?: string;
}

/** `GET /mcp/audit/stats` — server-side latency / error rate for one tool. */
export interface AuditStats {
  tool: string;
  sinceHours: number;
  count: number;
  p50Ms: number;
  p95Ms: number;
  errorRate: number;
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
> &
  // Temporal-validity columns ride along when the route returns them; the
  // consolidation pass uses them to skip rows that are already superseded.
  Partial<Pick<MemoryApiRecord, 'status' | 'invalidAt' | 'supersededBy'>> & { similarity: number };

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
  /** RD-12 — direction; missing means USER. */
  owedBy?: 'USER' | 'STAKEHOLDER';
  /** RD-12 — counterparty name (GET /commitments/nudges rows). */
  stakeholderName?: string | null;
  [extra: string]: unknown;
}

/** RD-12 — GET /commitments/nudges rows carry the counterparty name and direction. */
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

/**
 * A non-2xx answer from OmniMind. `status` lets callers tell a client-side
 * refusal (4xx — the request itself was bad) from an outage (5xx / network),
 * e.g. the front door maps introspection 4xx to `invalid_token` and only
 * 5xx / network errors to `503 auth_unavailable`. The message keeps the
 * historical `OmniMind <METHOD> <path> → <status>: <body>` shape.
 */
export class OmniMindHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  constructor(method: string, path: string, status: number, bodyText: string) {
    super(`OmniMind ${method} ${path} → ${status}: ${bodyText}`);
    this.name = 'OmniMindHttpError';
    this.status = status;
    this.bodyText = bodyText;
  }
  /** True for the API's `403 insufficient_scope` (delegated scopes narrower than the tool's requirement). */
  get isInsufficientScope(): boolean {
    return this.status === 403 && /insufficient_scope/.test(this.bodyText);
  }
  /**
   * True for the API's `401 { error: 'principal_invalid', reason }` — the
   * delegated principal behind `x-mcp-principal` was revoked, expired or no
   * longer exists (agent-context.ts evicts its own cache synchronously on
   * revoke, so this is the first and authoritative signal the MCP server gets).
   */
  get isPrincipalInvalid(): boolean {
    return this.status === 401 && this.parsedBody()?.error === 'principal_invalid';
  }
  /** `revoked` | `expired` | `not_found` | `malformed` from a `principal_invalid` body; undefined otherwise. */
  get principalInvalidReason(): PrincipalInvalidReason | undefined {
    if (!this.isPrincipalInvalid) return undefined;
    const reason = this.parsedBody()?.reason;
    return reason === 'revoked' || reason === 'expired' || reason === 'not_found' || reason === 'malformed' ? reason : 'revoked';
  }
  private parsedBody(): { error?: unknown; reason?: unknown } | undefined {
    try {
      const parsed: unknown = JSON.parse(this.bodyText);
      return parsed && typeof parsed === 'object' ? (parsed as { error?: unknown; reason?: unknown }) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Why the API refused a delegated principal (`reason` field of its `401 principal_invalid` body). */
export type PrincipalInvalidReason = 'revoked' | 'expired' | 'not_found' | 'malformed';

/** What a client reports when an outbound delegated call is refused with `401 principal_invalid`. */
export interface PrincipalInvalidEvent {
  /** `kind:id` of the delegated principal this client acts for. */
  principalKey: string;
  reason: PrincipalInvalidReason;
  method: string;
  path: string;
}

export class OmniMindClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly agentKey: string | undefined;
  private readonly timeoutMs: number;
  private agentHeaders: AgentHeaders | null = null;
  private delegated: DelegatedPrincipalRef | null = null;
  private closed = false;
  private principalInvalidHandler: ((event: PrincipalInvalidEvent) => void) | null = null;

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

  /**
   * Front door — bind this client to a delegated principal instead of a static
   * agent identity. Every subsequent request carries `x-agent-key` (the
   * gateway's own key — required) and `x-mcp-principal: <kind>:<id>`, and the
   * three legacy identity headers are never sent even if `setAgentHeaders`
   * was called earlier. One client per MCP session; see `close()`.
   */
  setDelegatedPrincipal(principal: DelegatedPrincipalRef): void {
    if (!this.agentKey) {
      throw new Error('OMNIMIND_MCP_AGENT_KEY (the gateway agent key with scope mcp:delegate) is required to act for a delegated principal');
    }
    if (!principal.id || (principal.kind !== 'token' && principal.kind !== 'oauth')) {
      throw new Error('setDelegatedPrincipal: kind must be token|oauth and id must be non-empty');
    }
    this.delegated = { kind: principal.kind, id: principal.id };
    this.agentHeaders = null;
  }

  /** `kind:id` of the bound delegated principal, or undefined for a static-identity client. */
  get delegatedPrincipalKey(): string | undefined {
    return this.delegated ? `${this.delegated.kind}:${this.delegated.id}` : undefined;
  }

  /**
   * Front door — called (at most once per failing request, never thrown
   * through) when a delegated call is refused with `401 principal_invalid`.
   * The HTTP transport uses it to evict the credential from its positive
   * cache and close the session, so revocation in BoardRoom is effective
   * immediately rather than at the end of the cache window. Static-identity
   * clients never fire it (there is no principal to invalidate).
   */
  onPrincipalInvalid(handler: ((event: PrincipalInvalidEvent) => void) | null): void {
    this.principalInvalidHandler = handler;
  }

  /**
   * Routes outside the API's delegated allow-list (`GET /mcp/audit/stats`,
   * `POST /mcp/agents`, token introspection, identity resolution) are
   * gateway / static-identity calls: the API answers 403
   * `delegated_route_forbidden` for an `x-mcp-principal` caller, so refuse
   * locally with a message that says which client to use.
   */
  private assertNotDelegated(route: string): void {
    if (this.delegated) {
      throw new Error(`OmniMind ${route} is a gateway-only route and cannot be called for a delegated principal (${this.delegatedPrincipalKey}); use the static / gateway client`);
    }
  }

  /**
   * Mark the client closed: later requests reject instead of acting for a
   * session that no longer exists. No sockets are held per instance (undici's
   * global pool is shared), so this is identity hygiene, not resource cleanup.
   */
  close(): void {
    this.closed = true;
    this.delegated = null;
    this.agentHeaders = null;
    this.principalInvalidHandler = null;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private async request<T>(method: string, path: string, body?: unknown, userId?: string, extraHeaders?: Record<string, string>): Promise<T> {
    if (this.closed) throw new Error(`OmniMind ${method} ${path} refused: client closed (session ended)`);
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
      if (this.delegated) {
        // Delegated call: the API resolves agent / tenant / weight / user from
        // the principal row. The legacy triple is deliberately absent.
        headers['x-mcp-principal'] = `${this.delegated.kind}:${this.delegated.id}`;
      } else if (this.agentHeaders) {
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
        const error = new OmniMindHttpError(method, path, res.status, text);
        const principalKey = this.delegatedPrincipalKey;
        if (principalKey && this.principalInvalidHandler && error.isPrincipalInvalid) {
          try {
            this.principalInvalidHandler({ principalKey, reason: error.principalInvalidReason ?? 'revoked', method, path });
          } catch (hookErr) {
            console.error('[omnimind-mcp] onPrincipalInvalid handler failed:', (hookErr as Error).message);
          }
        }
        throw error;
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
    return this.request<MemoryRecord>('GET', `/memories/${encodeURIComponent(id)}`, undefined, userId);
  }

  /** `DELETE /memories/:id` — soft delete: the row becomes `ARCHIVED` with `deletedAt` set (used by `bench --cleanup`). */
  async archiveMemory(id: string, userId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/memories/${encodeURIComponent(id)}`, undefined, userId);
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

  /**
   * Front door — `POST /mcp/tokens/introspect`. Called by the gateway-level
   * client (static identity, `x-agent-key` with `mcp:delegate`), never by a
   * per-session delegated client. The raw token travels only in the body.
   */
  async introspectToken(token: string): Promise<IntrospectResult> {
    this.assertNotDelegated('POST /mcp/tokens/introspect');
    return this.request<IntrospectResult>('POST', '/mcp/tokens/introspect', { token });
  }

  /** Front door — `POST /mcp/identities/resolve`: verified OAuth claims → linked principal (or `unlinked` / `issuer_not_allowed`). */
  async resolveIdentity(claims: IdentityClaims): Promise<ResolveIdentityResult> {
    this.assertNotDelegated('POST /mcp/identities/resolve');
    return this.request<ResolveIdentityResult>('POST', '/mcp/identities/resolve', claims);
  }

  /** `GET /mcp/audit/stats?tool=…&sinceHours=…` — used by the `bench` subcommand (static / gateway identity only). */
  async getAuditStats(params: { tool: string; sinceHours?: number }): Promise<AuditStats> {
    this.assertNotDelegated('GET /mcp/audit/stats');
    const qs = new URLSearchParams({ tool: params.tool, sinceHours: String(params.sinceHours ?? 24) });
    return this.request<AuditStats>('GET', `/mcp/audit/stats?${qs}`);
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
    this.assertNotDelegated('POST /mcp/agents');
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

/**
 * Which `x-agent-key` a client sends. The two env vars mean different things
 * once the HTTP front door delegates for other principals:
 *
 * - `OMNIMIND_MCP_AGENT_KEY` — the GATEWAY key (`mcp:delegate`): introspection,
 *   identity resolution and every delegated (`x-mcp-principal`) call.
 * - `OMNIMIND_MCP_STATIC_AGENT_KEY` — optional; the key of the agent row that
 *   matches `OMNIMIND_MCP_AGENT_NAME` / `TENANT_ID` / `SOURCE_WEIGHT`, for a
 *   legacy *verified* static-key deployment. Static sessions never send the
 *   gateway key: the API would 403 `agent_header_mismatch` because the legacy
 *   triple does not describe the gateway row.
 *
 * `single-agent` is the stdio / CLI process (one identity, no gateway): it
 * keeps the historical behaviour — `OMNIMIND_MCP_STATIC_AGENT_KEY` when set,
 * else `OMNIMIND_MCP_AGENT_KEY`, else unverified.
 */
export type AgentKeyRole = 'gateway' | 'static' | 'single-agent';

export interface ResolvedAgentKey {
  key: string | undefined;
  /** Which env var supplied it (for the startup log); `none` → unverified header triple. */
  source: 'OMNIMIND_MCP_AGENT_KEY' | 'OMNIMIND_MCP_STATIC_AGENT_KEY' | 'none';
}

export function resolveAgentKey(role: AgentKeyRole, env: NodeJS.ProcessEnv = process.env): ResolvedAgentKey {
  const gateway = env.OMNIMIND_MCP_AGENT_KEY?.trim() || undefined;
  const staticKey = env.OMNIMIND_MCP_STATIC_AGENT_KEY?.trim() || undefined;
  if (role === 'gateway') return gateway ? { key: gateway, source: 'OMNIMIND_MCP_AGENT_KEY' } : { key: undefined, source: 'none' };
  if (staticKey) return { key: staticKey, source: 'OMNIMIND_MCP_STATIC_AGENT_KEY' };
  if (role === 'single-agent' && gateway) return { key: gateway, source: 'OMNIMIND_MCP_AGENT_KEY' };
  return { key: undefined, source: 'none' };
}

export interface CreateOmniMindClientOptions {
  /**
   * Explicit `x-agent-key` (or `undefined` for none). When the property is
   * absent the client resolves the `single-agent` role from env (stdio / CLI).
   */
  agentKey?: string;
}

export function createOmniMindClient(env: NodeJS.ProcessEnv = process.env, opts?: CreateOmniMindClientOptions): OmniMindClient {
  const baseUrl = env.OMNIMIND_API_URL;
  const apiKey = env.OMNIMIND_API_KEY;
  const agentKey = opts && 'agentKey' in opts ? opts.agentKey : resolveAgentKey('single-agent', env).key;

  if (!baseUrl) throw new Error('OMNIMIND_API_URL is required');
  if (!apiKey) throw new Error('OMNIMIND_API_KEY is required');

  return new OmniMindClient({ baseUrl, apiKey, agentKey });
}
