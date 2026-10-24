/**
 * RD-13 — OmniMindClient.getPersonBriefs: a single (never retried) POST whose
 * response is contract-checked with PersonBriefsResponseSchema.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OmniMindClient, OmniMindContractError } from '../../src/services/omnimind-client';

const valid = {
  generatedAt: '2026-10-24T09:00:00.000Z', partial: false,
  attendeeMatches: [{ key: '0:0', personId: null, ambiguous: false, method: null }],
  titleMatches: [], briefs: {},
};

describe('OmniMindClient.getPersonBriefs (RD-13)', () => {
  let client: OmniMindClient;
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    client = new OmniMindClient('http://test:3333', 'test-key');
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs /people/briefs with x-user-id and returns the parsed body', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(valid) });
    const body = { attendees: [{ key: '0:0', name: 'Avery Testperson' }], events: [] };
    await expect(client.getPersonBriefs('user-1', body)).resolves.toEqual(valid);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://test:3333/people/briefs');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-user-id']).toBe('user-1');
    expect(JSON.parse(opts.body)).toEqual(body);
  });

  it('throws OmniMindContractError on a malformed body', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ...valid, partial: 'no' }) });
    await expect(client.getPersonBriefs('user-1', { attendees: [{ key: '0:0', name: 'A B' }], events: [] })).rejects.toBeInstanceOf(OmniMindContractError);
  });

  it('is not retried on a 503', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'x' }) });
    await expect(client.getPersonBriefs('user-1', { attendees: [{ key: '0:0', name: 'A B' }], events: [] })).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
