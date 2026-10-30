import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OmniMindClient } from '../../src/services/omnimind-client';

describe('OmniMindClient', () => {
  let client: OmniMindClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new OmniMindClient('http://test:3333', 'test-key');
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets x-api-key and x-user-id headers on requests', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], total: 0, offset: 0, limit: 20 }),
    });

    await client.getGoals('user-123');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://test:3333/goals');
    expect(opts.headers['x-api-key']).toBe('test-key');
    expect(opts.headers['x-user-id']).toBe('user-123');
  });

  // S-2 — admin-only cross-user usage summary
  it('getLlmUsageSummary forwards all=1 and sends x-admin-key only when an adminKey is given', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({ totalCostUsd: 0 }) });

    await client.getLlmUsageSummary({ all: '1', days: '7' }, { adminKey: 'adm-secret' });
    let [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://test:3333/usage/llm/summary?all=1&days=7');
    expect(opts.headers['x-admin-key']).toBe('adm-secret');
    expect(opts.headers['x-api-key']).toBe('test-key'); // extra headers never displace the auth header

    await client.getLlmUsageSummary({ days: '7' });
    [url, opts] = fetchSpy.mock.calls[1];
    expect(url).toBe('http://test:3333/usage/llm/summary?days=7');
    expect(opts.headers['x-admin-key']).toBeUndefined();
  });

  // M6 (2026-10-30) — OmniMind /admin/* is behind x-admin-key; without it every admin panel call was 401 → 502.
  it('every admin call sends x-admin-key (and never displaces x-api-key)', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const opts = { adminKey: 'adm-secret' };
    const calls: Array<[() => Promise<unknown>, string, string]> = [
      [() => client.getAdminStats({ includeAllTenants: 'true' }, opts), 'GET', '/admin/stats?includeAllTenants=true'],
      [() => client.getAdminAgents({ includeAllTenants: 'true' }, opts), 'GET', '/admin/agents?includeAllTenants=true'],
      [() => client.getAdminAudit({ limit: '5' }, opts), 'GET', '/admin/audit?limit=5'],
      [() => client.getAdminMemories({ q: 'x' }, opts), 'GET', '/admin/memories?q=x'],
      [() => client.getAdminContradictions({}, opts), 'GET', '/admin/contradictions?'],
      [() => client.triggerAdminSummarize(opts), 'POST', '/admin/summarize'],
      [() => client.getAdminDuplicates({ threshold: '0.9' }, opts), 'GET', '/admin/duplicates?threshold=0.9'],
      [() => client.mergeAdminDuplicates({ keepId: 'a' }, { includeAllTenants: 'true' }, opts), 'POST', '/admin/duplicates/merge?includeAllTenants=true'],
      [() => client.triggerAdminDecay(opts), 'POST', '/admin/decay/run'],
    ];
    for (const [i, [run, method, path]] of calls.entries()) {
      await run();
      const [url, init] = fetchSpy.mock.calls[i];
      expect(url, path).toBe(`http://test:3333${path}`);
      expect(init.method, path).toBe(method);
      expect(init.headers['x-admin-key'], path).toBe('adm-secret');
      expect(init.headers['x-api-key'], path).toBe('test-key');
      expect(init.headers['x-user-id'], path).toBeUndefined();
    }
  });

  it('omits x-user-id when userId is not provided', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', dbConnected: true }),
    });

    await client.health();

    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('test-key');
    expect(opts.headers['x-user-id']).toBeUndefined();
  });

  it('wraps upstream error response on non-ok status', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ error: 'validation_failed', details: [{ field: 'title', message: 'required' }] }),
    });

    await expect(client.getGoals('user-123')).rejects.toMatchObject({
      message: 'OmniMind GET /goals: 422',
      status: 422,
      upstream: {
        error: 'validation_failed',
        details: [{ field: 'title', message: 'required' }],
      },
    });
  });

  it('handles upstream JSON parse failure gracefully', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(client.health()).rejects.toMatchObject({
      status: 500,
      upstream: { error: 'upstream_error' },
    });
  });

  it('health() returns parsed response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', dbConnected: true }),
    });

    const result = await client.health();
    expect(result).toEqual({ status: 'ok', dbConnected: true });
  });

  it('registerUser sends correct body without x-user-id', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'u1', email: 'a@b.com', name: 'Test', teamId: 't1' }),
    });

    const result = await client.registerUser('a@b.com', 'hash123', 'Test');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://test:3333/auth/register');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.com', passwordHash: 'hash123', name: 'Test' });
    expect(opts.headers['x-user-id']).toBeUndefined();
    expect(result).toEqual({ id: 'u1', email: 'a@b.com', name: 'Test', teamId: 't1' });
  });

  it('appends query string for entity list filters', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], total: 0, offset: 0, limit: 20 }),
    });

    await client.getGoals('user-123', { status: 'active', domain: 'tech' });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://test:3333/goals?status=active&domain=tech');
  });

  // -----------------------------------------------------------------------
  // Resilience layer tests
  // -----------------------------------------------------------------------

  describe('timeout', () => {
    it('attaches an AbortSignal to every fetch call', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', dbConnected: true }),
      });

      await client.health();

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('maps AbortError to ETIMEDOUT', async () => {
      // Simulate fetch throwing AbortError (what happens when the timer fires)
      fetchSpy.mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      await expect(client.health()).rejects.toMatchObject({
        message: expect.stringContaining('timed out'),
        code: 'ETIMEDOUT',
      });
    });
  });

  describe('retry', () => {
    it('retries GET on 502/503/504 and succeeds', async () => {
      let calls = 0;
      fetchSpy.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 502,
            json: () => Promise.resolve({ error: 'bad_gateway' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        });
      });

      const result = await client.listGoals('user-123');

      expect(result).toEqual({ items: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry POST on 502', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'bad_gateway' }),
      });

      await expect(client.createGoal('user-123', { title: 'test' })).rejects.toMatchObject({
        status: 502,
      });

      // POST is not idempotent — should be called exactly once
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry GET on 4xx', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ error: 'validation_failed' }),
      });

      await expect(client.listGoals('user-123')).rejects.toMatchObject({
        status: 422,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry GET on 500 (only 502/503/504)', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal' }),
      });

      await expect(client.health()).rejects.toMatchObject({ status: 500 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries GET on network error and succeeds', async () => {
      let calls = 0;
      fetchSpy.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        });
      });

      const result = await client.listGoals('user-123');

      expect(result).toEqual({ items: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('circuit breaker', () => {
    it('opens after consecutive failures and rejects immediately', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'down' }),
      });

      // Trip the breaker (default threshold from test env = 5). POST is not
      // retried, so each call is exactly one 503.
      const threshold = 5;
      for (let i = 0; i < threshold; i++) {
        await client.createDecision('user-123', {}).catch(() => {});
      }

      expect(client.breaker.state).toBe('OPEN');

      // Next request should be rejected without calling fetch
      const callsBefore = fetchSpy.mock.calls.length;
      await expect(client.health()).rejects.toMatchObject({
        code: 'ECIRCUIT_OPEN',
      });
      expect(fetchSpy.mock.calls.length).toBe(callsBefore); // no new fetch call
    });

    it('resets on success', async () => {
      // Fail a few times (but below threshold)
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'down' }),
      });
      await client.createDecision('user-123', {}).catch(() => {});
      await client.createDecision('user-123', {}).catch(() => {});
      expect(client.breaker.failures).toBe(2);

      // Succeed
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', dbConnected: true }),
      });
      await client.health();

      expect(client.breaker.failures).toBe(0);
      expect(client.breaker.state).toBe('CLOSED');
    });

    it('does NOT trip on 4xx errors', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ error: 'validation' }),
      });

      for (let i = 0; i < 10; i++) {
        await client.getGoals('user-123').catch(() => {});
      }

      // 4xx should not trip the breaker — these are client-side bugs
      expect(client.breaker.failures).toBe(0);
      expect(client.breaker.state).toBe('CLOSED');
    });

    // H1 (2026-10-30): five `GET /memories?sortOrder=sideways` from ONE user
    // answered 500 and opened the shared breaker for every user (and login).
    it('does NOT trip on a plain 500 — OmniMind answered, the request was bad', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal_error' }),
      });

      for (let i = 0; i < 10; i++) {
        await client.getGoals('attacker').catch(() => {});
      }

      expect(client.breaker.failures).toBe(0);
      expect(client.breaker.state).toBe('CLOSED');
      // A different user is still served.
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) });
      await expect(client.getGoals('victim')).resolves.toEqual([]);
    });

    it('counts network errors and timeouts toward the breaker', async () => {
      fetchSpy.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      await client.createDecision('user-123', {}).catch(() => {});
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchSpy.mockRejectedValue(abort);
      await client.createDecision('user-123', {}).catch(() => {});
      expect(client.breaker.failures).toBe(2);
    });

    it.each([502, 503, 504])('counts %i toward the breaker', async (status) => {
      fetchSpy.mockResolvedValue({ ok: false, status, json: () => Promise.resolve({ error: 'down' }) });
      await client.createDecision('user-123', {}).catch(() => {});
      expect(client.breaker.failures).toBe(1);
    });

    // Lane F (2026-10-30): five POST /api/memories {domain:"ministry"} from ONE
    // user answered 503 MINISTRY_DEFERRED and opened the shared breaker → every
    // user (incl. login) got 503 for the cooldown. A deliberate refusal is
    // OmniMind answering correctly, not OmniMind being down.
    const refusal503 = (headers: Record<string, string> = { 'x-omnimind-refusal': '1' }) => ({
      ok: false,
      status: 503,
      headers: new Headers(headers),
      json: () => Promise.resolve({ code: 'MINISTRY_DEFERRED', message: 'deferred' }),
    });

    it('6x MINISTRY_DEFERRED 503 (refusal header) leaves the breaker CLOSED', async () => {
      fetchSpy.mockResolvedValue(refusal503());
      for (let i = 0; i < 6; i++) {
        await expect(client.createMemory('user-a', { content: 'x', domain: 'ministry' })).rejects.toMatchObject({
          status: 503,
          upstream: { code: 'MINISTRY_DEFERRED' },
        });
      }
      expect(client.breaker.failures).toBe(0);
      expect(client.breaker.state).toBe('CLOSED');
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) });
      await expect(client.getGoals('user-b')).resolves.toEqual([]);
    });

    it('a refusal 503 is recognised by its code even without the header (older OmniMind)', async () => {
      fetchSpy.mockResolvedValue(refusal503({}));
      for (let i = 0; i < 6; i++) await client.createMemory('user-a', { content: 'x' }).catch(() => {});
      expect(client.breaker.state).toBe('CLOSED');
      expect(client.breaker.failures).toBe(0);
    });

    it('a refusal 503 on a GET is not retried', async () => {
      fetchSpy.mockResolvedValue(refusal503());
      await expect(client.getGoals('user-a')).rejects.toMatchObject({ status: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(client.breaker.failures).toBe(0);
    });

    it('6x bare 503 (no body / HTML / proxy) opens the breaker', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      });
      for (let i = 0; i < 6; i++) await client.createMemory('user-a', { content: 'x' }).catch(() => {});
      expect(client.breaker.state).toBe('OPEN');
    });

    it('a JSON 503 with an infra code (agent_lookup_failed — DB down) still counts', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'agent_lookup_failed', message: 'Agent identity could not be verified' }),
      });
      for (let i = 0; i < 5; i++) await client.createMemory('user-a', { content: 'x' }).catch(() => {});
      expect(client.breaker.state).toBe('OPEN');
    });
  });

  // Lane C — the only place `userId` actually reaches OmniMind for the MCP
  // token routes is the query string / body built here, so pin it at the
  // fetch level (the route test mocks this whole client).
  describe('MCP tokens — userId pinning on the wire', () => {
    beforeEach(() => {
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ tokens: [] }) });
    });

    it('listMcpTokens / getMcpTokenOptions send ?userId= and x-user-id', async () => {
      await client.listMcpTokens('u 1');
      let [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://test:3333/mcp/tokens?userId=u+1');
      expect(opts.headers['x-user-id']).toBe('u 1');

      await client.getMcpTokenOptions('u-2');
      [url, opts] = fetchSpy.mock.calls[1];
      expect(url).toBe('http://test:3333/mcp/tokens/options?userId=u-2');
      expect(opts.headers['x-user-id']).toBe('u-2');
    });

    it('revokeMcpToken encodes the id and sends ?userId=', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 204 });
      await client.revokeMcpToken('u-1', 'tok/odd id');
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://test:3333/mcp/tokens/tok%2Fodd%20id?userId=u-1');
      expect(opts.method).toBe('DELETE');
      expect(opts.headers['x-user-id']).toBe('u-1');
    });

    it('createMcpToken overwrites any userId in the body with the pinned one and forwards expiresInDays: null', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ token: 't', record: {} }) });
      await client.createMcpToken('jwt-user', {
        userId: 'attacker',
        tenantId: 'josh-business',
        name: 'Claude Code',
        scopes: ['memory:read'],
        expiresInDays: null,
      });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://test:3333/mcp/tokens');
      expect(opts.method).toBe('POST');
      expect(opts.headers['x-user-id']).toBe('jwt-user');
      expect(JSON.parse(opts.body)).toEqual({
        userId: 'jwt-user', tenantId: 'josh-business', name: 'Claude Code', scopes: ['memory:read'], expiresInDays: null,
      });
    });
  });
});
