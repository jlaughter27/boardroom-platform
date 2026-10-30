import type {
  KnowledgeGraph,
  McpTokenCreateRequest,
  McpTokenCreateResponse,
  McpTokenListResponse,
  McpTokenOptions,
  MemoryBacklinksResponse,
} from '@boardroom/shared';
import { PersonBriefsResponseSchema } from '@boardroom/shared';
import type { PersonBriefsRequest, PersonBriefsResponse } from '@boardroom/shared';
const OMNIMIND_URL = process.env.OMNIMIND_API_URL ?? 'http://localhost:3333';

function getApiKey(): string {
  const apiKey = process.env.OMNIMIND_API_KEY;
  if (!apiKey) {
    throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set.');
  }
  return apiKey;
}

// ---------------------------------------------------------------------------
// Resilience configuration (env-overridable)
// ---------------------------------------------------------------------------
const TIMEOUT_MS = Number(process.env.OMNIMIND_TIMEOUT_MS) || 10_000;
const RETRY_MAX = Number(process.env.OMNIMIND_RETRY_MAX) || 3;
const RETRY_BASE_MS = 100;
const BREAKER_THRESHOLD = Number(process.env.OMNIMIND_BREAKER_THRESHOLD) || 5;
const BREAKER_COOLDOWN_MS = Number(process.env.OMNIMIND_BREAKER_COOLDOWN_MS) || 15_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

// ---------------------------------------------------------------------------
// Circuit breaker — in-memory, per-process (no Redis).
// States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (probing)
// ---------------------------------------------------------------------------
type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  state: BreakerState = 'CLOSED';
  failures = 0;
  lastFailureAt = 0;

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    if (this.failures >= BREAKER_THRESHOLD) {
      this.state = 'OPEN';
    }
  }

  canRequest(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      // Try half-open after cooldown
      if (Date.now() - this.lastFailureAt >= BREAKER_COOLDOWN_MS) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    // HALF_OPEN — allow one probe request
    return true;
  }

  /** Expose state for /health endpoint consumption. */
  toJSON() {
    return { state: this.state, failures: this.failures };
  }
}

/** M6 — per-call admin credential for OmniMind's `/admin/*` (sent as `x-admin-key`). */
export interface AdminCallOptions {
  adminKey?: string;
}

export class OmniMindClient {
  private baseUrl: string;
  private _apiKey: string | undefined;
  /** Shared circuit breaker — one per OmniMind instance. */
  readonly breaker = new CircuitBreaker();

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? OMNIMIND_URL;
    this._apiKey = apiKey;
  }

  private get apiKey(): string {
    if (!this._apiKey) {
      this._apiKey = getApiKey();
    }
    return this._apiKey;
  }

  // Test helper
  static reloadApiKey(client: OmniMindClient): void {
    client._apiKey = getApiKey();
  }

  // ---------------------------------------------------------------------------
  // fetch with timeout (AbortController)
  // ---------------------------------------------------------------------------
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal as AbortSignal });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw Object.assign(new Error(`OmniMind request timed out after ${timeoutMs}ms`), {
          code: 'ETIMEDOUT',
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Core request — timeout + retry + circuit breaker
  // ---------------------------------------------------------------------------
  private async request<T>(
    method: string,
    path: string,
    userId?: string,
    body?: unknown,
    /** S-2: per-call extra headers (e.g. `x-admin-key`). Cannot override the auth/correlation headers. */
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    // Circuit breaker gate
    if (!this.breaker.canRequest()) {
      throw Object.assign(
        new Error(`OmniMind circuit breaker OPEN — ${this.breaker.failures} consecutive failures`),
        { code: 'ECIRCUIT_OPEN', status: 503 },
      );
    }

    const requestId = crypto.randomUUID();
    const headers: Record<string, string> = {
      ...(extraHeaders ?? {}),
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'x-request-id': requestId,
    };
    if (userId) headers['x-user-id'] = userId;

    const isIdempotent = method === 'GET' || method === 'HEAD';
    const maxAttempts = isIdempotent ? RETRY_MAX : 1;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: 'upstream_error' }));
          const err = Object.assign(new Error(`OmniMind ${method} ${path}: ${res.status}`), {
            status: res.status,
            upstream: error,
          });

          // Retry gateway errors (502/503/504) for idempotent methods
          if (isIdempotent && RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
            lastError = err;
            await this.backoff(attempt);
            continue;
          }

          // Throw — the catch block below handles breaker/retry decisions
          throw err;
        }

        // Success — reset breaker
        this.breaker.recordSuccess();
        // Phase 6 link routes may answer 204 No Content — nothing to parse.
        if (res.status === 204) return undefined as T;
        return res.json() as Promise<T>;
      } catch (err: unknown) {
        const error = err as Error & { status?: number; code?: string };

        // 4xx: client-side error — throw immediately, don't trip breaker.
        // The server responded correctly; the request was bad.
        if (error.status && error.status >= 400 && error.status < 500) {
          throw error;
        }

        // 5xx (has .status). Only 502/503/504 (the same set the GET retry
        // policy uses) say OmniMind itself is unhealthy and count toward the
        // breaker. Any other 5xx (a 500 from one bad request) means OmniMind
        // answered: it is not counted, or one user replaying a request that
        // 500s could open the shared breaker for every user (H1).
        if (error.status && error.status >= 500) {
          if (RETRYABLE_STATUS.has(error.status)) this.breaker.recordFailure();
          throw error;
        }

        // Network-level error (timeout, DNS, socket hang-up) — no .status.
        // Retry if idempotent; otherwise trip breaker and throw.
        if (isIdempotent && attempt < maxAttempts) {
          lastError = error;
          await this.backoff(attempt);
          continue;
        }

        this.breaker.recordFailure();
        throw error;
      }
    }

    // Should not be reachable, but TypeScript needs it
    this.breaker.recordFailure();
    throw lastError ?? new Error(`OmniMind ${method} ${path}: max retries exhausted`);
  }

  /** Exponential backoff with jitter: base * 2^(attempt-1) ± 25% */
  private backoff(attempt: number): Promise<void> {
    const base = RETRY_BASE_MS * 2 ** (attempt - 1);
    const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25%
    const ms = Math.max(0, Math.round(base + jitter));
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Context
  async getContextForPersona(req: {
    query: string;
    persona: string;
    userId: string;
    maxItems?: number;
    includeEntities?: string[];
    /** Phase 6 — Critic reads archived/superseded memories too. */
    includeArchived?: boolean;
    /** Phase 6 — Critic focuses on DECISION-class memories. */
    memoryClass?: string;
    /** Phase 6 — temporal validity: only what was valid at this instant (ISO). */
    asOf?: string;
  }) {
    return this.request('POST', '/context/for-persona', req.userId, req);
  }

  // ---------------------------------------------------------------------------
  // Phase 6 — core context, decisions/calibration, reflection, nudges, usage
  // ---------------------------------------------------------------------------

  /** Deterministic markdown block shared by every persona call (prompt-cache prefix). */
  async getCoreContext(userId: string) {
    return this.request<{ block: string; tokensEstimate: number; hash: string; generatedAt: string }>(
      'GET', '/context/core', userId,
    );
  }

  async createDecision(userId: string, input: unknown) {
    return this.request('POST', '/decisions', userId, input);
  }

  async getCalibration(userId: string, params?: Record<string, string>) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/decisions/calibration${qs}`, userId);
  }

  async getDecisionChanges(userId: string, params: Record<string, string>) {
    const qs = '?' + new URLSearchParams(params).toString();
    return this.request('GET', `/decisions/changes${qs}`, userId);
  }

  async reflectEntity(userId: string, body: { entityType: 'goal' | 'project' | 'person'; entityId: string }) {
    return this.request('POST', '/context/reflect', userId, body);
  }

  async getCapsules(userId: string, entityIds: string[]) {
    const qs = entityIds.length ? '?' + new URLSearchParams({ entityIds: entityIds.join(',') }).toString() : '';
    return this.request('GET', `/context/capsules${qs}`, userId);
  }

  async getCommitmentNudges(userId: string) {
    return this.request('GET', '/commitments/nudges', userId);
  }

  /** Phase 6 — lets the nudges widget mark a commitment FULFILLED / etc. */
  async updateCommitment(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/commitments/${id}`, userId, input);
  }

  /** RD-12 — POST /commitments (delegations); forwards the dialog's Idempotency-Key. */
  async createCommitment(userId: string, input: unknown, idempotencyKey?: string) {
    return this.request('POST', '/commitments', userId, input, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
  }

  async updateMemoItem(userId: string, memoId: string, itemKey: string, body: { state: 'accepted' | 'dismissed' | 'snoozed'; until?: string }) {
    return this.request('PATCH', `/cortex/memo/${encodeURIComponent(memoId)}/items/${encodeURIComponent(itemKey)}`, userId, body);
  }

  /** Fire-and-forget target of lib/llm-usage.ts. No x-user-id header requirement; userId travels in the body. */
  async postLlmUsage(body: { service: string; purpose: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; durationMs?: number; sessionId?: string; userId?: string }) {
    return this.request<{ id: string; costUsd: number }>('POST', '/usage/llm', body.userId, body);
  }

  /**
   * S-2: OmniMind requires `x-admin-key` for the cross-user (`all=1`) summary.
   * Pass `adminKey` to send it; omitted, the call is scoped to the API key only.
   */
  async getLlmUsageSummary(params?: Record<string, string>, options: { adminKey?: string } = {}) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    const extra = options.adminKey ? { 'x-admin-key': options.adminKey } : undefined;
    return this.request('GET', `/usage/llm/summary${qs}`, undefined, undefined, extra);
  }

  // Phase 6 — entity links (ProjectPersonLink / DecisionProjectLink / TaskDependency)
  async linkProjectPerson(userId: string, projectId: string, personId: string, body?: { role?: string }) {
    return this.request('POST', `/projects/${projectId}/people/${personId}`, userId, body ?? {});
  }

  async unlinkProjectPerson(userId: string, projectId: string, personId: string) {
    return this.request('DELETE', `/projects/${projectId}/people/${personId}`, userId);
  }

  async linkProjectDecision(userId: string, projectId: string, decisionId: string) {
    return this.request('POST', `/projects/${projectId}/decisions/${decisionId}`, userId);
  }

  async unlinkProjectDecision(userId: string, projectId: string, decisionId: string) {
    return this.request('DELETE', `/projects/${projectId}/decisions/${decisionId}`, userId);
  }

  async addTaskDependency(userId: string, taskId: string, otherTaskId: string) {
    return this.request('POST', `/tasks/${taskId}/depends-on/${otherTaskId}`, userId);
  }

  async removeTaskDependency(userId: string, taskId: string, otherTaskId: string) {
    return this.request('DELETE', `/tasks/${taskId}/depends-on/${otherTaskId}`, userId);
  }

  // Phase 6 — graph extras
  async getBacklinks(userId: string, nodeId: string) {
    return this.request('GET', `/graph/backlinks/${encodeURIComponent(nodeId)}`, userId);
  }

  async getUnlinkedMentions(userId: string, limit?: number) {
    const qs = limit ? `?limit=${limit}` : '';
    return this.request('GET', `/graph/unlinked-mentions${qs}`, userId);
  }

  async linkUnlinkedMention(userId: string, body: { memoryId: string; entityType: string; entityId: string }) {
    return this.request('POST', '/graph/unlinked-mentions/link', userId, body);
  }

  async getPeopleDuplicates(userId: string) {
    return this.request('GET', '/people/duplicates', userId);
  }

  /** Hybrid search (same stack as /context/for-persona). */
  async searchMemoriesHybrid(userId: string, body: { query: string; limit?: number; domain?: string; tags?: string[]; status?: string; includeArchived?: boolean; asOf?: string; cursor?: string }) {
    return this.request('POST', '/memories/search', userId, body);
  }

  // Memory
  async createMemory(userId: string, input: unknown) {
    return this.request('POST', '/memories', userId, input);
  }

  // Entities
  async getGoals(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/goals${qs}`, userId);
  }

  async getProjects(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/projects${qs}`, userId);
  }

  async getPeople(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/people${qs}`, userId);
  }

  async getDecisions(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/decisions${qs}`, userId);
  }

  async getCommitments(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/commitments${qs}`, userId);
  }

  async getUserProfile(userId: string) {
    return this.request('GET', '/user-profile', userId);
  }

  // Auth (service-to-service, no x-user-id needed)
  async registerUser(email: string, passwordHash: string, name: string) {
    return this.request<{ id: string; email: string; name: string; teamId: string }>(
      'POST', '/auth/register', undefined, { email, passwordHash, name }
    );
  }

  /**
   * B-115 — Credential verification goes through the resilient client
   * (timeout/retry/breaker/x-request-id). OmniMind performs the bcrypt
   * compare server-side; passwordHash never crosses the seam.
   * Returns null on 401 (invalid credentials); rethrows anything else.
   */
  async verifyCredentials(email: string, password: string) {
    try {
      return await this.request<{ id: string; email: string; name: string; teamId: string }>(
        'POST', '/auth/verify', undefined, { email, password }
      );
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 401) return null;
      throw err;
    }
  }

  async getUserById(id: string) {
    return this.request<{ id: string; email: string; name: string; teamId: string } | null>(
      'GET', `/auth/user/${id}`
    );
  }

  // Entity CRUD (proxy for BoardRoom server routes)
  async createGoal(userId: string, input: unknown) {
    return this.request('POST', '/goals', userId, input);
  }

  async createProject(userId: string, input: unknown) {
    return this.request('POST', '/projects', userId, input);
  }

  async createPerson(userId: string, input: unknown) {
    return this.request('POST', '/people', userId, input);
  }

  async createTask(userId: string, input: unknown) {
    return this.request('POST', '/tasks', userId, input);
  }

  async listGoals(userId: string) {
    return this.request('GET', '/goals', userId);
  }

  async listProjects(userId: string) {
    return this.request('GET', '/projects', userId);
  }

  async listPeople(userId: string) {
    return this.request('GET', '/people', userId);
  }

  async listTasks(userId: string) {
    return this.request('GET', '/tasks', userId);
  }

  async listDecisions(userId: string) {
    return this.request('GET', '/decisions', userId);
  }

  /** RD-12 — one decision by id (owner-scoped by OmniMind; 404 otherwise). */
  async getDecision(userId: string, id: string) {
    return this.request('GET', `/decisions/${encodeURIComponent(id)}`, userId);
  }

  async listCommitments(userId: string) {
    return this.request('GET', '/commitments', userId);
  }

  async updateGoal(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/goals/${id}`, userId, input);
  }

  async updateProject(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/projects/${id}`, userId, input);
  }

  async updatePerson(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/people/${id}`, userId, input);
  }

  async updateTask(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/tasks/${id}`, userId, input);
  }

  async deleteGoal(userId: string, id: string) {
    return this.request('DELETE', `/goals/${id}`, userId);
  }

  async deleteProject(userId: string, id: string) {
    return this.request('DELETE', `/projects/${id}`, userId);
  }

  async deletePerson(userId: string, id: string) {
    return this.request('DELETE', `/people/${id}`, userId);
  }

  async deleteTask(userId: string, id: string) {
    return this.request('DELETE', `/tasks/${id}`, userId);
  }

  // Entity hierarchy links (C-111). PROPOSED OmniMind contract — OmniMind does
  // not expose these yet (only the GoalProjectLink / ProjectTaskLink Prisma
  // models exist). Until the omnimind-api side lands, these return the
  // upstream 404 unchanged (B-106 pass-through).
  async linkGoalProject(userId: string, goalId: string, projectId: string) {
    return this.request('POST', `/goals/${goalId}/projects/${projectId}`, userId);
  }

  async linkProjectTask(userId: string, projectId: string, taskId: string) {
    return this.request('POST', `/projects/${projectId}/tasks/${taskId}`, userId);
  }

  // User profile
  async updateUserProfile(userId: string, data: unknown) {
    return this.request('PATCH', '/user-profile', userId, data);
  }

  // Memories
  async listMemories(userId: string, params?: string) {
    const qs = params ? `?${params}` : '';
    return this.request('GET', `/memories${qs}`, userId);
  }

  /** RD-4 — per-domain { count, limit, over } against the soft domain budgets (user-wide). */
  async getMemoryBudget(userId: string) {
    return this.request('GET', '/memories/budget', userId);
  }

  async getMemoryById(userId: string, id: string) {
    return this.request('GET', `/memories/${id}`, userId);
  }

  async updateMemory(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/memories/${id}`, userId, input);
  }

  async archiveMemory(userId: string, id: string) {
    return this.request('DELETE', `/memories/${id}`, userId);
  }

  async searchMemories(userId: string, query: string, limit: number = 20) {
    return this.request('GET', `/memories?q=${encodeURIComponent(query)}&limit=${limit}`, userId);
  }

  // Outcome Reviews
  async getOutcomeReviews(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/outcome-reviews${qs}`, userId);
  }

  async getPendingReviews(userId: string) {
    return this.request('GET', '/outcome-reviews/pending', userId);
  }

  async completeReview(userId: string, nudgeId: string, data: unknown) {
    return this.request('POST', `/outcome-reviews/${nudgeId}/complete`, userId, data);
  }

  async skipReview(userId: string, nudgeId: string) {
    return this.request('POST', `/outcome-reviews/${nudgeId}/skip`, userId);
  }

  // Cortex — Patterns
  async getPatterns(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/cortex/patterns${qs}`, userId);
  }

  async triggerPatternScan(userId: string) {
    return this.request('POST', '/cortex/patterns/scan', userId);
  }

  // Cortex — Memos
  async getLatestMemo(userId: string) {
    return this.request('GET', '/cortex/memo/latest', userId);
  }

  async getMemoHistory(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/cortex/memo/history${qs}`, userId);
  }

  async triggerMemoGeneration(userId: string) {
    return this.request('POST', '/cortex/memo/generate', userId);
  }

  // Cortex — Contradictions
  async getContradictions(userId: string, filters?: Record<string, string>) {
    const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.request('GET', `/cortex/contradictions${qs}`, userId);
  }

  async scanContradictions(userId: string) {
    return this.request('POST', '/cortex/contradictions/scan', userId);
  }

  async updateContradiction(userId: string, id: string, data: unknown) {
    return this.request('PATCH', `/cortex/contradictions/${id}`, userId, data);
  }

  // OAuth tokens
  async getOAuthToken(userId: string, provider: string) {
    return this.request('GET', `/oauth/token/${provider}`, userId);
  }

  async saveOAuthToken(userId: string, data: { provider: string; accessToken: string; refreshToken: string | null; expiresAt: string | null; scope: string | null; calendarId: string | null }) {
    return this.request('POST', '/oauth/token', userId, data);
  }

  async deleteOAuthToken(userId: string, provider: string) {
    return this.request('DELETE', `/oauth/token/${provider}`, userId);
  }

  // Subscription
  async getSubscription(userId: string) {
    return this.request('GET', '/subscription', userId);
  }

  async createSubscription(userId: string, data: unknown) {
    return this.request('POST', '/subscription', userId, data);
  }

  async updateSubscription(userId: string, data: unknown) {
    return this.request('PATCH', '/subscription', userId, data);
  }

  // Custom Personas
  async getCustomPersonas(userId: string) {
    return this.request('GET', '/custom-personas', userId);
  }

  async createCustomPersona(userId: string, input: unknown) {
    return this.request('POST', '/custom-personas', userId, input);
  }

  async updateCustomPersona(userId: string, id: string, input: unknown) {
    return this.request('PATCH', `/custom-personas/${id}`, userId, input);
  }

  async deleteCustomPersona(userId: string, id: string) {
    return this.request('DELETE', `/custom-personas/${id}`, userId);
  }

  // Cortex — Simulation
  async runSimulation(userId: string, data: { chosenPath: string; sessionQuestion: string }) {
    return this.request('POST', '/cortex/simulate', userId, data);
  }

  // Relationships
  async getRelationshipGraph(userId: string) {
    return this.request('GET', '/relationships/graph', userId);
  }

  /** Knowledge graph (Obsidian-style view). Query keys mirror shared KnowledgeGraphQuery. */
  async getKnowledgeGraph(userId: string, query: Record<string, string> = {}) {
    const qs = new URLSearchParams(query).toString();
    return this.request<KnowledgeGraph>('GET', `/graph${qs ? `?${qs}` : ''}`, userId);
  }

  // Memory Entity Links
  async createMemoryLink(userId: string, memoryId: string, data: { entityType: string; entityId: string; linkType?: string }) {
    return this.request('POST', `/memories/${memoryId}/links`, userId, data);
  }

  async getMemoryLinks(userId: string, memoryId: string) {
    return this.request('GET', `/memories/${memoryId}/links`, userId);
  }

  /** RD-1 — memories that link TO this one ("Linked from"). */
  async getMemoryBacklinks(userId: string, memoryId: string) {
    return this.request<MemoryBacklinksResponse>('GET', `/memories/${encodeURIComponent(memoryId)}/backlinks`, userId);
  }

  async deleteMemoryLink(userId: string, memoryId: string, linkId: string) {
    return this.request('DELETE', `/memories/${memoryId}/links/${linkId}`, userId);
  }

  // Health
  async health() {
    return this.request<{ status: string; dbConnected: boolean }>('GET', '/health');
  }

  // Admin (no userId — cross-agent views). M6: OmniMind mounts /admin/* behind
  // `requireAdminKey`, so every call carries `x-admin-key` (BoardRoom's
  // OMNIMIND_ADMIN_KEY, resolved by admin.routes.ts — 503 there when unset).
  private adminHeaders(options: AdminCallOptions): Record<string, string> | undefined {
    return options.adminKey ? { 'x-admin-key': options.adminKey } : undefined;
  }

  async getAdminStats(params?: Record<string, string>, options: AdminCallOptions = {}) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/admin/stats${qs}`, undefined, undefined, this.adminHeaders(options));
  }

  async getAdminAgents(options: AdminCallOptions = {}) {
    return this.request('GET', '/admin/agents', undefined, undefined, this.adminHeaders(options));
  }

  async getAdminAudit(params?: Record<string, string>, options: AdminCallOptions = {}) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/admin/audit${qs}`, undefined, undefined, this.adminHeaders(options));
  }

  async getAdminMemories(params?: Record<string, string>, options: AdminCallOptions = {}) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/admin/memories${qs}`, undefined, undefined, this.adminHeaders(options));
  }

  async getAdminContradictions(params?: Record<string, string>, options: AdminCallOptions = {}) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/admin/contradictions${qs}`, undefined, undefined, this.adminHeaders(options));
  }

  async triggerAdminSummarize(options: AdminCallOptions = {}) {
    return this.request('POST', '/admin/summarize', undefined, undefined, this.adminHeaders(options));
  }

  async getAdminDuplicates(params?: Record<string, string>, options: AdminCallOptions = {}) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/admin/duplicates${qs}`, undefined, undefined, this.adminHeaders(options));
  }

  async mergeAdminDuplicates(body: Record<string, unknown>, options: AdminCallOptions = {}) {
    return this.request('POST', '/admin/duplicates/merge', undefined, body, this.adminHeaders(options));
  }

  async triggerAdminDecay(options: AdminCallOptions = {}) {
    return this.request('POST', '/admin/decay/run', undefined, undefined, this.adminHeaders(options));
  }

  // ---------------------------------------------------------------------------
  // Lane C — personal MCP tokens (OmniMind /mcp/tokens, owned by Lane A1).
  // userId travels BOTH as the `x-user-id` header and as the query/body field
  // A1's contract reads; the route layer pins it to the JWT user.
  // ---------------------------------------------------------------------------
  async listMcpTokens(userId: string) {
    const qs = new URLSearchParams({ userId }).toString();
    return this.request<McpTokenListResponse>('GET', `/mcp/tokens?${qs}`, userId);
  }

  async createMcpToken(userId: string, body: McpTokenCreateRequest) {
    return this.request<McpTokenCreateResponse>('POST', '/mcp/tokens', userId, { ...body, userId });
  }

  async revokeMcpToken(userId: string, tokenId: string) {
    const qs = new URLSearchParams({ userId }).toString();
    return this.request<void>('DELETE', `/mcp/tokens/${encodeURIComponent(tokenId)}?${qs}`, userId);
  }

  async getMcpTokenOptions(userId: string) {
    const qs = new URLSearchParams({ userId }).toString();
    return this.request<McpTokenOptions>('GET', `/mcp/tokens/options?${qs}`, userId);
  }

  // ---------------------------------------------------------------------------
  // RD-13 — meeting prep briefs. A POST, so never retried; the response is
  // contract-checked (a mismatch throws OmniMindContractError, which the
  // /calendar/briefs route turns into `unavailable`).
  // ---------------------------------------------------------------------------
  async getPersonBriefs(userId: string, body: PersonBriefsRequest): Promise<PersonBriefsResponse> {
    const raw = await this.request<unknown>('POST', '/people/briefs', userId, body);
    const parsed = PersonBriefsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OmniMindContractError('POST /people/briefs', parsed.error.issues.length);
    }
    return parsed.data;
  }
}

// Singleton
export const omnimindClient = new OmniMindClient();

/** RD-13 — an OmniMind response that does not match its shared Zod contract. */
export class OmniMindContractError extends Error {
  readonly code = 'EOMNIMIND_CONTRACT';
  constructor(readonly endpoint: string, readonly issueCount: number) {
    super(`OmniMind ${endpoint}: response failed contract validation (${issueCount} issue(s))`);
    this.name = 'OmniMindContractError';
  }
}
