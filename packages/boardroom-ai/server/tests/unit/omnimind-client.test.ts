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
});
