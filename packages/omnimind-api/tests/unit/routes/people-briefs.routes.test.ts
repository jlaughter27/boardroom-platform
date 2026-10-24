/**
 * RD-13 — POST /people/briefs through the real Express app (Prisma mocked).
 * 400 / 403 agent_context_unsupported / 422 / 200, the total fallback, route
 * ordering before /:id, and the POST-read scope.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PersonBriefsResponseSchema } from '@boardroom/shared';

const mockPrisma = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) });
  return {
    person: t(), memoryEntityLink: t(), memoryEntry: t(), commitment: t(), task: t(),
    projectPersonLink: t(), decision: t(), contextCapsule: t(), agent: t(),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn(),
  };
});
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const svc = vi.hoisted(() => ({ throwNext: false }));
vi.mock('../../../src/services/person-brief.service', async (orig) => {
  const real = await orig<typeof import('../../../src/services/person-brief.service')>();
  return {
    ...real,
    buildPersonBriefs: vi.fn(async (...args: Parameters<typeof real.buildPersonBriefs>) => {
      if (svc.throwNext) throw new Error('escaped');
      return real.buildPersonBriefs(...args);
    }),
  };
});

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { requiredScopeFor } from '../../../src/middleware/scope-enforcer';
import { READ_ONLY_POST_PATHS } from '../../../src/middleware/rate-limiter';
import { buildPersonBriefs } from '../../../src/services/person-brief.service';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const post = (b: unknown, headers: Record<string, string> = { 'x-user-id': USER }) => {
  let r = request(app).post('/people/briefs').set('x-api-key', API_KEY);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(b as object);
};

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  svc.throwNext = false;
  mockPrisma.person.findMany.mockResolvedValue([
    { id: 'p1', name: 'Avery Testperson', role: 'Elder', relationshipToUser: null, importance: 0.5, lastContactAt: null },
  ]);
});

describe('POST /people/briefs (RD-13)', () => {
  it('400 without x-user-id', async () => {
    const res = await post({ attendees: [{ key: '0:0', name: 'Avery Testperson' }] }, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('403 agent_context_unsupported for an agent caller; the service is not called', async () => {
    const res = await post({ attendees: [{ key: '0:0', name: 'Avery Testperson' }] }, {
      'x-user-id': USER, 'x-agent-id': 'claude-code-test', 'x-tenant-id': 'test-business', 'x-source-weight': '1.0',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('agent_context_unsupported');
    expect(buildPersonBriefs).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    ['41 attendees', { attendees: Array.from({ length: 41 }, (_, i) => ({ key: `0:${i}`, name: `Person ${i}` })) }],
    ['9 events', { events: Array.from({ length: 9 }, (_, i) => ({ key: `e${i}`, titleTokens: ['sync'], smallMeeting: false })) }],
    ['an attendee with an empty name', { attendees: [{ key: '0:0', name: '' }] }],
  ])('422 for %s', async (_label, b) => {
    const res = await post(b);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('validation_failed');
    expect(buildPersonBriefs).not.toHaveBeenCalled();
  });

  it('200 with a body that passes PersonBriefsResponseSchema (and never reaches a /:id handler)', async () => {
    const res = await post({ attendees: [{ key: '0:0', name: 'avery testperson' }], events: [{ key: 'e0', titleTokens: ['coffee', 'avery'], smallMeeting: true }] });
    expect(res.status).toBe(200);
    expect(PersonBriefsResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.attendeeMatches[0]).toMatchObject({ personId: 'p1', method: 'exact' });
    expect(res.body.titleMatches[0]).toMatchObject({ personId: 'p1', method: 'title_first_name' });
    expect(res.body.briefs.p1.name).toBe('Avery Testperson');
    expect(mockPrisma.person.findFirst).not.toHaveBeenCalled();
  });

  it('a throw that escapes the service → 200 partial, never 5xx', async () => {
    svc.throwNext = true;
    const res = await post({ attendees: [{ key: '0:0', name: 'Avery Testperson' }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ partial: true, briefs: {}, titleMatches: [] });
    expect(res.body.attendeeMatches).toEqual([{ key: '0:0', personId: null, ambiguous: false, method: null }]);
    expect(PersonBriefsResponseSchema.safeParse(res.body).success).toBe(true);
  });

  it('is a POST read: memory:read scope and the read rate-limit bucket', () => {
    expect(requiredScopeFor('POST', '/people/briefs')).toBe('memory:read');
    expect(requiredScopeFor('POST', '/people')).toBe('memory:write');
    expect(READ_ONLY_POST_PATHS.has('/people/briefs')).toBe(true);
  });
});
