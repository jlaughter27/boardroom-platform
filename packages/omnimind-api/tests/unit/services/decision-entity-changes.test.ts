/**
 * R-O-04 — GET /decisions/changes memories are tenant-scoped for agent callers,
 * and ministry rows are never decrypted for agents outside the ministry tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));

import { getEntityChanges, parseEntityRef } from '../../../src/services/decision.service';
import { ENCRYPTED_CONTENT_PLACEHOLDER } from '../../../src/lib/memory-crypto';

const since = new Date('2026-09-25T00:00:00Z');

function fakePrisma(memories: unknown[]) {
  return {
    memoryEntityLink: { findMany: vi.fn().mockResolvedValue([{ memoryId: 'm1' }, { memoryId: 'm2' }]) },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
    commitment: { findMany: vi.fn().mockResolvedValue([]) },
    contextCapsule: { findUnique: vi.fn().mockResolvedValue(null) },
    memoryEntry: { findMany: vi.fn().mockResolvedValue(memories) },
    goalProjectLink: { findMany: vi.fn().mockResolvedValue([]) },
    projectPersonLink: { findMany: vi.fn().mockResolvedValue([]) },
  } as any;
}

const business = { id: 'm1', userId: 'u1', domain: 'business', content: 'plain', encryptedContent: null, createdAt: since, invalidAt: null };
const ministry = { id: 'm2', userId: 'u1', domain: 'ministry', content: ENCRYPTED_CONTENT_PLACEHOLDER, encryptedContent: 'v1:abc', createdAt: since, invalidAt: null };

describe('getEntityChanges tenant scope (R-O-04)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes the memory lookup to the agent tenant when one is given', async () => {
    const prisma = fakePrisma([business]);
    await getEntityChanges('u1', parseEntityRef('project:p1')!, since, prisma, { tenantId: 'josh-business' });
    const where = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: { in: ['m1', 'm2'] }, userId: 'u1', deletedAt: null, tenantId: 'josh-business' });
  });

  it('BoardRoom (no agent context) is not tenant-filtered', async () => {
    const prisma = fakePrisma([business]);
    await getEntityChanges('u1', parseEntityRef('project:p1')!, since, prisma);
    expect(prisma.memoryEntry.findMany.mock.calls[0][0].where).not.toHaveProperty('tenantId');
  });

  it('never ships encryptedContent and does not decrypt ministry rows for an agent outside the ministry tenant', async () => {
    const prisma = fakePrisma([business, ministry]);
    const out = await getEntityChanges('u1', parseEntityRef('project:p1')!, since, prisma, { tenantId: 'josh-business' });
    const byId = Object.fromEntries(out.memories.map(m => [m.id, m as Record<string, unknown>]));
    expect(byId.m1.content).toBe('plain');
    expect(byId.m2.content).toBe(ENCRYPTED_CONTENT_PLACEHOLDER); // placeholder, not plaintext
    for (const m of out.memories) expect(m).not.toHaveProperty('encryptedContent');
  });
});
