import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../../src/lib/api';

function okJson(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('Phase 6 api param building', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({}));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

  it('commitDecision POSTs the forecast body to /sessions/:id/decide', async () => {
    await api.commitDecision('s 1', { chosenPath: 'A', expectedOutcome: 'B', probabilitySuccess: 0.7 });
    const [url, init] = lastCall();
    expect(url).toBe('/api/sessions/s%201/decide');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ chosenPath: 'A', expectedOutcome: 'B', probabilitySuccess: 0.7 });
  });

  it('getCalibration adds successThreshold only when provided', async () => {
    await api.getCalibration();
    expect(lastCall()[0]).toBe('/api/decisions/calibration');
    await api.getCalibration(4);
    expect(lastCall()[0]).toBe('/api/decisions/calibration?successThreshold=4');
  });

  it('getDecisionChanges encodes entityId and ISO since (Date or string)', async () => {
    await api.getDecisionChanges('project:abc', new Date('2026-09-01T00:00:00.000Z'));
    expect(lastCall()[0]).toBe('/api/decisions/changes?entityId=project%3Aabc&since=2026-09-01T00%3A00%3A00.000Z');
    await api.getDecisionChanges('person:p1', '2026-09-02T00:00:00.000Z');
    expect(lastCall()[0]).toBe('/api/decisions/changes?entityId=person%3Ap1&since=2026-09-02T00%3A00%3A00.000Z');
  });

  it('getCommitmentNudges hits /commitments/nudges', async () => {
    await api.getCommitmentNudges();
    expect(lastCall()[0]).toBe('/api/commitments/nudges');
  });

  it('updateMemoItem PATCHes /cortex/memo/:id/items/:itemKey with state (+ until)', async () => {
    await api.updateMemoItem('memo1', 'patternsNoticed:2', { state: 'snoozed', until: '2026-10-09T00:00:00.000Z' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/cortex/memo/memo1/items/patternsNoticed%3A2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ state: 'snoozed', until: '2026-10-09T00:00:00.000Z' });
  });

  it('graph extras build the contract paths', async () => {
    await api.getGraphBacklinks('goal:g1');
    expect(lastCall()[0]).toBe('/api/graph/backlinks/goal%3Ag1');
    await api.getUnlinkedMentions();
    expect(lastCall()[0]).toBe('/api/graph/unlinked-mentions?limit=50');
    await api.getUnlinkedMentions(10);
    expect(lastCall()[0]).toBe('/api/graph/unlinked-mentions?limit=10');
    await api.linkUnlinkedMention({ memoryId: 'm', entityType: 'person', entityId: 'p' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/graph/unlinked-mentions/link');
    expect(JSON.parse(init.body as string)).toEqual({ memoryId: 'm', entityType: 'person', entityId: 'p' });
  });

  it('link editors call the project/task link routes', async () => {
    await api.addProjectPerson('pr1', 'pe1', 'Advisor');
    let [url, init] = lastCall();
    expect(url).toBe('/api/projects/pr1/people/pe1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ role: 'Advisor' });

    await api.addProjectPerson('pr1', 'pe2');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({});

    await api.linkProjectDecision('pr1', 'd1');
    [url, init] = lastCall();
    expect(url).toBe('/api/projects/pr1/decisions/d1');
    expect(init.method).toBe('POST');

    await api.addTaskDependency('t1', 't2');
    [url, init] = lastCall();
    expect(url).toBe('/api/tasks/t1/depends-on/t2');
    expect(init.method).toBe('POST');

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) } as unknown as Response);
    await expect(api.removeTaskDependency('t1', 't2')).resolves.toBeUndefined();
    expect(lastCall()[1].method).toBe('DELETE');
  });

  it('getPeopleDuplicates and getLlmUsageSummary', async () => {
    await api.getPeopleDuplicates();
    expect(lastCall()[0]).toBe('/api/people/duplicates');
    await api.getLlmUsageSummary();
    expect(lastCall()[0]).toBe('/api/usage/llm/summary?days=7&all=1');
    await api.getLlmUsageSummary(30);
    expect(lastCall()[0]).toBe('/api/usage/llm/summary?days=30&all=1');
  });

  it('capsules + hybrid search', async () => {
    await api.getCapsules(['goal:a', 'project:b']);
    expect(lastCall()[0]).toBe('/api/context/capsules?entityIds=goal%3Aa%2Cproject%3Ab');
    await api.hybridSearchMemories({ query: 'runway', limit: 5, includeArchived: true });
    const [url, init] = lastCall();
    expect(url).toBe('/api/memories/search');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'runway', limit: 5, includeArchived: true });
  });
});
