/**
 * RD-13 — the real getMeetingBriefs: the contract check (a body failing
 * MeetingBriefsResponseSchema resolves to null) and the refresh query.
 * Synthetic data only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MeetingBriefsResponse } from '@boardroom/shared';
import { getMeetingBriefs } from '../../src/lib/api';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const valid: MeetingBriefsResponse = {
  generatedAt: '2026-10-24T08:00:00.000Z',
  windowEnd: '2026-10-25T08:00:00.000Z',
  calendar: 'connected',
  events: [],
  briefs: {},
  omitted: { noKnownPeople: 2, overCap: 0, allDayOrDeclined: 1 },
  partial: false,
};

describe('getMeetingBriefs (RD-13)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the parsed body when it matches the contract', async () => {
    fetchMock.mockResolvedValue(okJson(valid));
    await expect(getMeetingBriefs()).resolves.toEqual(valid);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/calendar/briefs');
  });

  it('returns null for a malformed body', async () => {
    for (const bad of [{ ...valid, calendar: 'sideways' }, { ...valid, events: 'nope' }, { hello: 'world' }, null]) {
      fetchMock.mockResolvedValueOnce(okJson(bad));
      await expect(getMeetingBriefs()).resolves.toBeNull();
    }
  });

  it('adds refresh=1 only when asked', async () => {
    fetchMock.mockResolvedValue(okJson(valid));
    await getMeetingBriefs({ refresh: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/calendar/briefs?refresh=1');
  });
});
