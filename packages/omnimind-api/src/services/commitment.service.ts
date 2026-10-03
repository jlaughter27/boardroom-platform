import type { PrismaClient, Prisma, Commitment } from '@prisma/client';
import { invalidateCoreContext } from './core-context.service';

export async function createCommitment(
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  const created = await prisma.commitment.create({
    data: { ...data, userId } as any,
  });
  // Phase 6: open commitments are part of the cached core block.
  invalidateCoreContext(userId);
  invalidateNudgeCache(userId);
  return created;
}

export async function getCommitment(
  userId: string,
  id: string,
  prisma: PrismaClient
) {
  return prisma.commitment.findFirst({
    where: { id, userId, deletedAt: null },
  });
}

export async function listCommitments(
  userId: string,
  filters: { status?: string; overdue?: boolean; limit?: number; offset?: number },
  prisma: PrismaClient
) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const where: Prisma.CommitmentWhereInput = { userId, deletedAt: null };
  if (filters.status) where.status = filters.status as any;

  // Overdue filter: deadline < now AND status = OPEN
  if (filters.overdue) {
    where.deadline = { lt: new Date() };
    where.status = 'OPEN';
  }

  const [items, total] = await Promise.all([
    prisma.commitment.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.commitment.count({ where }),
  ]);

  return { items, total, offset, limit };
}

export async function updateCommitment(
  userId: string,
  id: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  const existing = await prisma.commitment.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return null;

  const updated = await prisma.commitment.update({
    where: { id },
    data: data as any,
  });
  invalidateCoreContext(userId);
  invalidateNudgeCache(userId);
  return updated;
}

// ── Phase 6 — commitment nudges (contract §Commitment nudges; SQL only) ──

export const NUDGE_HORIZON_DAYS = 3;

export interface CommitmentNudges {
  dueSoon: Commitment[];
  overdue: Commitment[];
}

/**
 * Pure `where` builders so the query shape is unit-testable without a DB.
 * - overdue: OPEN, deadline < now
 * - dueSoon: OPEN, now <= deadline <= now + 3 days
 */
export function buildOverdueWhere(userId: string, now: Date): Prisma.CommitmentWhereInput {
  return { userId, deletedAt: null, status: 'OPEN', deadline: { lt: now } };
}

export function buildDueSoonWhere(userId: string, now: Date, horizonDays = NUDGE_HORIZON_DAYS): Prisma.CommitmentWhereInput {
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  return { userId, deletedAt: null, status: 'OPEN', deadline: { gte: now, lte: horizon } };
}

export async function getCommitmentNudges(userId: string, prisma: PrismaClient, now: Date = new Date()): Promise<CommitmentNudges> {
  const [overdue, dueSoon] = await Promise.all([
    prisma.commitment.findMany({ where: buildOverdueWhere(userId, now), orderBy: { deadline: 'asc' }, take: 50 }),
    prisma.commitment.findMany({ where: buildDueSoonWhere(userId, now), orderBy: { deadline: 'asc' }, take: 50 }),
  ]);
  const nudges = { dueSoon, overdue };
  setCachedNudges(userId, nudges);
  return nudges;
}

/**
 * Lightweight in-process list refreshed by the daily job and by every live
 * query. Readers that must not hit the DB (Doer context on the hot path when
 * the DB is degraded) can fall back to it.
 */
const nudgeCache = new Map<string, { value: CommitmentNudges; computedAt: number }>();

export function setCachedNudges(userId: string, value: CommitmentNudges): void {
  nudgeCache.set(userId, { value, computedAt: Date.now() });
}

export function getCachedNudges(userId: string): CommitmentNudges | null {
  return nudgeCache.get(userId)?.value ?? null;
}

export function invalidateNudgeCache(userId: string): void {
  nudgeCache.delete(userId);
}

/** Render "Open commitments" lines for the Doer context. Pure. */
export function renderCommitmentLines(nudges: CommitmentNudges, now: Date = new Date()): string[] {
  const fmt = (c: Commitment, tag: string) => {
    const due = c.deadline ? c.deadline.toISOString().slice(0, 10) : 'no deadline';
    const days = c.deadline ? Math.round((c.deadline.getTime() - now.getTime()) / 86_400_000) : null;
    const rel = days === null ? '' : days < 0 ? ` (${Math.abs(days)}d overdue)` : days === 0 ? ' (today)' : ` (in ${days}d)`;
    return `${tag}: ${c.description} — due ${due}${rel}`;
  };
  return [
    ...nudges.overdue.map(c => fmt(c, 'OVERDUE')),
    ...nudges.dueSoon.map(c => fmt(c, 'DUE SOON')),
  ];
}
