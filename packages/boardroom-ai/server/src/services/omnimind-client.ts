const OMNIMIND_URL = process.env.OMNIMIND_API_URL ?? 'http://localhost:3333';
const OMNIMIND_KEY = process.env.OMNIMIND_API_KEY;
if (!OMNIMIND_KEY) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set.');

export class OmniMindClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? OMNIMIND_URL;
    this.apiKey = apiKey ?? OMNIMIND_KEY;
  }

  private async request<T>(method: string, path: string, userId?: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };
    if (userId) headers['x-user-id'] = userId;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'upstream_error' }));
      throw Object.assign(new Error(`OmniMind ${method} ${path}: ${res.status}`), {
        status: res.status,
        upstream: error,
      });
    }

    return res.json() as Promise<T>;
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
    return this.request('POST', `/memories/${id}/archive`, userId);
  }

  async searchMemories(userId: string, query: string, limit: number = 20) {
    return this.request('GET', `/memories/search?q=${encodeURIComponent(query)}&limit=${limit}`, userId);
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
