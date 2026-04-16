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
      return await fetch(url, { ...init, signal: controller.signal });
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
  private async request<T>(method: string, path: string, userId?: string, body?: unknown): Promise<T> {
    // Circuit breaker gate
    if (!this.breaker.canRequest()) {
      throw Object.assign(
        new Error(`OmniMind circuit breaker OPEN — ${this.breaker.failures} consecutive failures`),
        { code: 'ECIRCUIT_OPEN', status: 503 },
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
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
        return res.json() as Promise<T>;
      } catch (err: unknown) {
        const error = err as Error & { status?: number; code?: string };

        // 4xx: client-side error — throw immediately, don't trip breaker.
        // The server responded correctly; the request was bad.
        if (error.status && error.status >= 400 && error.status < 500) {
          throw error;
        }

        // 5xx (has .status): server error — trip breaker, throw.
        if (error.status && error.status >= 500) {
          this.breaker.recordFailure();
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
  async getContextForPersona(req: { query: string; persona: string; userId: string; maxItems?: number; includeEntities?: string[] }) {
    return this.request('POST', '/context/for-persona', req.userId, req);
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

  async getUserByEmail(email: string) {
    return this.request<{ id: string; email: string; name: string; passwordHash: string; teamId: string } | null>(
      'POST', '/auth/login', undefined, { email }
    );
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

  // User profile
  async updateUserProfile(userId: string, data: unknown) {
    return this.request('PATCH', '/user-profile', userId, data);
  }

  // Memories
  async listMemories(userId: string, params?: string) {
    const qs = params ? `?${params}` : '';
    return this.request('GET', `/memories${qs}`, userId);
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

  // Memory Entity Links
  async createMemoryLink(userId: string, memoryId: string, data: { entityType: string; entityId: string; linkType?: string }) {
    return this.request('POST', `/memories/${memoryId}/links`, userId, data);
  }

  async getMemoryLinks(userId: string, memoryId: string) {
    return this.request('GET', `/memories/${memoryId}/links`, userId);
  }

  async deleteMemoryLink(userId: string, memoryId: string, linkId: string) {
    return this.request('DELETE', `/memories/${memoryId}/links/${linkId}`, userId);
  }

  // Health
  async health() {
    return this.request<{ status: string; dbConnected: boolean }>('GET', '/health');
  }
}

// Singleton
export const omnimindClient = new OmniMindClient();
