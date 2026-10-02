/**
 * Minimal OmniMind HTTP client for the eval tree.
 *
 * Why its own client: the eval runs from the repo root (no @boardroom/shared
 * resolution) and must survive OmniMind's per-user rate limiter
 * (RATE_LIMITS.MAX_QUERIES_PER_MINUTE = 20 per user per HTTP method). A 429
 * carries `retryAfter` seconds; we honour it instead of failing the run.
 */

export interface OmniClientOptions {
  baseUrl: string;
  apiKey: string;
  userId: string;
  /** Max attempts on 429/5xx/network errors. */
  maxAttempts?: number;
  /** Upper bound for a single back-off sleep (ms). */
  maxSleepMs?: number;
  log?: (msg: string) => void;
}

export interface OmniResponse<T> {
  status: number;
  body: T;
}

export class OmniHttpError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, message?: string) {
    super(message ?? `OmniMind HTTP ${status}`);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class OmniClient {
  private readonly maxAttempts: number;
  private readonly maxSleepMs: number;
  constructor(private readonly opts: OmniClientOptions) {
    this.maxAttempts = opts.maxAttempts ?? 8;
    this.maxSleepMs = opts.maxSleepMs ?? 65_000;
  }

  get userId(): string { return this.opts.userId; }

  async request<T = unknown>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<OmniResponse<T>> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < this.maxAttempts) {
      attempt++;
      try {
        const res = await fetch(`${this.opts.baseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.opts.apiKey,
            'x-user-id': this.opts.userId,
            ...extraHeaders,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

        if (res.status === 429) {
          const retryAfter = (parsed as { retryAfter?: number } | null)?.retryAfter;
          const wait = Math.min(this.maxSleepMs, Math.max(1000, (typeof retryAfter === 'number' ? retryAfter : 5) * 1000 + 250));
          this.opts.log?.(`429 on ${method} ${path} (user ${this.opts.userId}); sleeping ${Math.round(wait / 1000)}s`);
          await sleep(wait);
          continue;
        }
        if (res.status >= 500 && attempt < this.maxAttempts) {
          const wait = Math.min(this.maxSleepMs, 500 * 2 ** attempt);
          this.opts.log?.(`${res.status} on ${method} ${path}; retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        return { status: res.status, body: parsed as T };
      } catch (err) {
        lastErr = err;
        const wait = Math.min(this.maxSleepMs, 500 * 2 ** attempt);
        this.opts.log?.(`network error on ${method} ${path}: ${(err as Error).message}; retry in ${wait}ms`);
        await sleep(wait);
      }
    }
    throw new OmniHttpError(0, null, `gave up after ${this.maxAttempts} attempts: ${(lastErr as Error | undefined)?.message ?? 'rate limited'}`);
  }

  async expect<T = unknown>(method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201]): Promise<T> {
    const r = await this.request<T>(method, path, body);
    if (!okStatuses.includes(r.status)) throw new OmniHttpError(r.status, r.body, `${method} ${path} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body;
  }
}

export async function waitForHealth(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = (err as Error).message;
    }
    await sleep(1000);
  }
  throw new Error(`OmniMind at ${baseUrl} not healthy after ${timeoutMs}ms (${last})`);
}

export function envConfig(): { baseUrl: string; apiKey: string; userPrefix: string } {
  return {
    baseUrl: (process.env.OMNIMIND_API_URL ?? 'http://localhost:3333').replace(/\/$/, ''),
    apiKey: process.env.OMNIMIND_API_KEY ?? 'dev-omnimind-api-key-local-only',
    userPrefix: process.env.EVAL_IR_USER_PREFIX ?? 'eval-ir',
  };
}
