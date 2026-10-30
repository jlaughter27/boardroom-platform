import type { PrismaClient, Prisma, Commitment } from '@prisma/client';
import { daysOverdue, daysUntil } from '@boardroom/shared';
import { invalidateCoreContext } from './core-context.service';
import { HttpError } from '../middleware/error-handler';

// ── RD-12 — ownership checks + CommitmentLink rows on create ──

export interface CommitmentLinksBody {
  decisionId?: string;
  taskId?: string;
}

/**
 * Pure: the CommitmentLink rows to create, decision first then task, keeping
 * only those present. entityTypes are lowercase so the knowledge graph renders
 * them as `commitment_entity` edges.
 */
export function buildCommitmentLinks(links?: CommitmentLinksBody | null): Array<{ entityType: 'decision' | 'task'; entityId: string }> {
  const rows: Array<{ entityType: 'decision' | 'task'; entityId: string }> = [];
  if (links?.decisionId) rows.push({ entityType: 'decision', entityId: links.decisionId });
  if (links?.taskId) rows.push({ entityType: 'task', entityId: links.taskId });
  return rows;
}

type OwnedEntity = 'person' | 'project' | 'decision' | 'task';
const ENTITY_LABEL: Record<OwnedEntity, string> = { person: 'Person', project: 'Project', decision: 'Decision', task: 'Task' };

function notFound(entity: OwnedEntity): HttpError {
  return new HttpError(404, { code: 'not_found', error: 'not_found', entity, message: `${ENTITY_LABEL[entity]} not found` });
}

/**
 * Every referenced row must belong to the caller and not be soft-deleted.
 * A miss is a 404 naming the entity (never a 403: no existence leak).
 */
export async function assertOwned(
  prisma: PrismaClient,
  userId: string,
  refs: { stakeholderId?: unknown; linkedProjectId?: unknown; links?: CommitmentLinksBody | null },
): Promise<void> {
  const where = (id: string) => ({ where: { id, userId, deletedAt: null }, select: { id: true } });
  const checks: Array<Promise<void>> = [];
  if (typeof refs.stakeholderId === 'string' && refs.stakeholderId) {
    const id = refs.stakeholderId;
    checks.push(prisma.person.findFirst(where(id)).then(r => { if (!r) throw notFound('person'); }));
  }
  if (typeof refs.linkedProjectId === 'string' && refs.linkedProjectId) {
    const id = refs.linkedProjectId;
    checks.push(prisma.project.findFirst(where(id)).then(r => { if (!r) throw notFound('project'); }));
  }
  if (refs.links?.decisionId) {
    const id = refs.links.decisionId;
    checks.push(prisma.decision.findFirst(where(id)).then(r => { if (!r) throw notFound('decision'); }));
  }
  if (refs.links?.taskId) {
    const id = refs.links.taskId;
    checks.push(prisma.task.findFirst(where(id)).then(r => { if (!r) throw notFound('task'); }));
  }
  await Promise.all(checks);
}

export async function createCommitment(
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  // RD-12: `links` is not a column — split it off, check every reference, and
  // write the CommitmentLink rows in the same create (one data builder, so a
  // later tenant stamp applies to delegations too).
  const { links, ...rest } = data as Record<string, unknown> & { links?: CommitmentLinksBody | null };
  await assertOwned(prisma, userId, { stakeholderId: rest.stakeholderId, linkedProjectId: rest.linkedProjectId, links });
  const linkRows = buildCommitmentLinks(links);
  const created = await prisma.commitment.create({
    data: { ...rest, userId, ...(linkRows.length ? { commitmentLinks: { create: linkRows } } : {}) } as any,
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
  filters: { status?: string; overdue?: boolean; limit?: number; offset?: number; owedBy?: 'USER' | 'STAKEHOLDER' },
  prisma: PrismaClient
) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const where: Prisma.CommitmentWhereInput = { userId, deletedAt: null };
  if (filters.status) where.status = filters.status as any;
  // RD-12: direction filter (M1-B1's commitment_list / snapshot use owedBy=USER).
  if (filters.owedBy) where.owedBy = filters.owedBy;

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
  // RD-12 hardening: a re-pointed counterparty or project must be the caller's own.
  await assertOwned(prisma, userId, { stakeholderId: data.stakeholderId, linkedProjectId: data.linkedProjectId });

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

/** RD-12: a nudge row carries its counterparty's name (null when none). */
export type CommitmentNudgeRow = Commitment & { stakeholderName: string | null };

export interface CommitmentNudges {
  dueSoon: CommitmentNudgeRow[];
  overdue: CommitmentNudgeRow[];
  /** RD-12 follow-up: open delegations due after the nudge horizon, so a delegation never
   *  disappears from "Waiting on others" just because its date is more than 3 days away. */
  waitingLater: CommitmentNudgeRow[];
}

const NUDGE_INCLUDE = { stakeholder: { select: { name: true } } } as const;

function toNudgeRow(row: Commitment & { stakeholder?: { name: string } | null }): CommitmentNudgeRow {
  const { stakeholder, ...c } = row;
  return { ...c, stakeholderName: stakeholder?.name ?? null };
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

/** Open delegations (others owe the user) due after the horizon, or with no deadline. */
export function buildWaitingLaterWhere(userId: string, now: Date, horizonDays = NUDGE_HORIZON_DAYS): Prisma.CommitmentWhereInput {
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  return { userId, deletedAt: null, status: 'OPEN', owedBy: 'STAKEHOLDER', OR: [{ deadline: { gt: horizon } }, { deadline: null }] };
}

export async function getCommitmentNudges(userId: string, prisma: PrismaClient, now: Date = new Date()): Promise<CommitmentNudges> {
  const [overdueRows, dueSoonRows, waitingLaterRows] = await Promise.all([
    prisma.commitment.findMany({ where: buildOverdueWhere(userId, now), orderBy: { deadline: 'asc' }, take: 50, include: NUDGE_INCLUDE }),
    prisma.commitment.findMany({ where: buildDueSoonWhere(userId, now), orderBy: { deadline: 'asc' }, take: 50, include: NUDGE_INCLUDE }),
    prisma.commitment.findMany({ where: buildWaitingLaterWhere(userId, now), orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 50, include: NUDGE_INCLUDE }),
  ]);
  const nudges: CommitmentNudges = { dueSoon: dueSoonRows.map(toNudgeRow), overdue: overdueRows.map(toNudgeRow), waitingLater: waitingLaterRows.map(toNudgeRow) };
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

/** Nudge-shaped input for the renderer: `owedBy` / `stakeholderName` optional so older callers keep compiling. */
type RenderableCommitment = Pick<Commitment, 'description' | 'deadline'> & { owedBy?: string | null; stakeholderName?: string | null };

/**
 * RD-12 — a delegation line: "waiting on {name}", never "to {name}". Day counts
 * use the shared daysOverdue / daysUntil helpers (end-of-UTC-day deadlines).
 */
function fmtDelegation(c: RenderableCommitment, tag: string, now: Date): string {
  const who = c.stakeholderName ?? 'someone';
  if (!c.deadline) return `${tag}: waiting on ${who} — ${c.description} — due no deadline`;
  const ymd = c.deadline.toISOString().slice(0, 10);
  const over = daysOverdue(c.deadline, now);
  const until = daysUntil(c.deadline, now);
  const rel = over > 0 ? ` (${over}d overdue)` : until === 0 ? ' (today)' : ` (in ${until}d)`;
  return `${tag}: waiting on ${who} — ${c.description} — due ${ymd}${rel}`;
}

/** Render "Open commitments" lines for the Doer context. Pure. */
export function renderCommitmentLines(
  nudges: { dueSoon: RenderableCommitment[]; overdue: RenderableCommitment[] },
  now: Date = new Date(),
): string[] {
  const fmt = (c: RenderableCommitment, tag: string) => {
    if (c.owedBy === 'STAKEHOLDER') return fmtDelegation(c, tag, now);
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
