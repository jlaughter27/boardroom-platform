/**
 * Fix lane H (2026-10-30) — offset-paged entity lists ordered by `createdAt`
 * only: rows with an equal timestamp (bulk imports, one transaction) could
 * shift between pages, so a row was shown twice or never. Every paged list now
 * adds `{ id: 'desc' }` as a tie-breaker.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));

import { listEntities } from '../../../src/services/entity.service';
import { listDecisions } from '../../../src/services/decision.service';
import { listCommitments } from '../../../src/services/commitment.service';

const TIE_BROKEN = [{ createdAt: 'desc' }, { id: 'desc' }];
const table = () => ({ findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });

describe('paged lists order with an id tie-breaker', () => {
  it.each(['goal', 'project', 'task', 'person'] as const)('listEntities(%s)', async (model) => {
    const prisma = { goal: table(), project: table(), task: table(), person: table() } as any;
    await listEntities(model, 'user-1', { limit: 20, offset: 40 }, prisma);
    expect(prisma[model].findMany.mock.calls[0][0]).toMatchObject({ orderBy: TIE_BROKEN, take: 20, skip: 40 });
  });

  it('listDecisions', async () => {
    const prisma = { decision: table() } as any;
    await listDecisions('user-1', { limit: 10, offset: 10 }, prisma);
    expect(prisma.decision.findMany.mock.calls[0][0]).toMatchObject({ orderBy: TIE_BROKEN, take: 10, skip: 10 });
  });

  it('listCommitments', async () => {
    const prisma = { commitment: table() } as any;
    await listCommitments('user-1', { limit: 10, offset: 10 }, prisma);
    expect(prisma.commitment.findMany.mock.calls[0][0]).toMatchObject({ orderBy: TIE_BROKEN, take: 10, skip: 10 });
  });
});
