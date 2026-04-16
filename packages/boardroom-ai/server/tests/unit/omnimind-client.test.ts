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
        status: 500,
        json: () => Promise.resolve({ error: 'down' }),
      });

      // Trip the breaker (default threshold from test env = 5)
      const threshold = 5;
      for (let i = 0; i < threshold; i++) {
        await client.health().catch(() => {});
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
        status: 500,
        json: () => Promise.resolve({ error: 'down' }),
      });
      await client.health().catch(() => {});
      await client.health().catch(() => {});
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
  });
});
