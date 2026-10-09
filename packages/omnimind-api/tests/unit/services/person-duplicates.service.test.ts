/**
 * Phase 6 (A2) — GET /people/duplicates: pg_trgm similarity ≥ 0.6, a.id < b.id,
 * user + soft-delete scoped, pairs assembled from live Person rows.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { findDuplicatePeople, DUPLICATE_SIMILARITY_THRESHOLD } from '../../../src/services/person-duplicates.service';

function fakePrisma(rows: any[], people: any[]) {
  return {
    $queryRaw: vi.fn(async () => rows),
    person: { findMany: vi.fn(async () => people) },
  } as unknown as PrismaClient & { $queryRaw: ReturnType<typeof vi.fn>; person: { findMany: ReturnType<typeof vi.fn> } };
}

const sqlText = (call: any[]) => (call[0] as string[]).join('?');

describe('findDuplicatePeople', () => {
  it('queries similarity(a.name, b.name) >= 0.6 by default, a.id < b.id, scoped to the user and live rows', async () => {
    const prisma = fakePrisma([], []);
    const res = await findDuplicatePeople('user-1', {}, prisma);
    expect(res).toEqual({ pairs: [] });
    const call = prisma.$queryRaw.mock.calls[0];
    const text = sqlText(call);
    expect(text).toContain('similarity(a.name, b.name)');
    expect(text).toContain('a.id < b.id');
    expect(text).toContain('a.user_id = ?');
    expect(text).toContain('a.deleted_at IS NULL');
    expect(text).toContain('b.deleted_at IS NULL');
    expect(call.slice(1)).toEqual(['user-1', DUPLICATE_SIMILARITY_THRESHOLD, 100]);
    expect(prisma.person.findMany).not.toHaveBeenCalled();
  });

  it('clamps threshold to [0.3, 1] and limit to [1, 200]', async () => {
    const p1 = fakePrisma([], []);
    await findDuplicatePeople('u', { threshold: 0.05, limit: 5000 }, p1);
    expect(p1.$queryRaw.mock.calls[0].slice(1)).toEqual(['u', 0.3, 200]);
    const p2 = fakePrisma([], []);
    await findDuplicatePeople('u', { threshold: 7, limit: 0 }, p2);
    expect(p2.$queryRaw.mock.calls[0].slice(1)).toEqual(['u', 1, 1]);
  });

  it('assembles {a, b, similarity} from the live Person rows and drops pairs whose member vanished', async () => {
    const a = { id: 'p1', name: 'Alex Rivera', userId: 'user-1' };
    const b = { id: 'p2', name: 'Alex Rivera-Smith', userId: 'user-1' };
    const prisma = fakePrisma(
      [
        { a_id: 'p1', b_id: 'p2', similarity: 0.72 },
        { a_id: 'p1', b_id: 'p9', similarity: 0.61 }, // p9 deleted between the two queries
      ],
      [a, b],
    );
    const res = await findDuplicatePeople('user-1', {}, prisma);
    expect(res.pairs).toEqual([{ a, b, similarity: 0.72 }]);
    expect(prisma.person.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2', 'p9'] }, userId: 'user-1', deletedAt: null },
    });
  });
});
