const OMNIMIND_URL = process.env.OMNIMIND_API_URL ?? 'http://localhost:3333';
const OMNIMIND_KEY = process.env.OMNIMIND_API_KEY ?? 'dev-api-key-change-in-production';

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

  // Health
  async health() {
    return this.request<{ status: string; dbConnected: boolean }>('GET', '/health');
  }
}

// Singleton
export const omnimindClient = new OmniMindClient();
