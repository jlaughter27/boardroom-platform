// RD-17 — persisted Decision Lab sessions (`decision_sessions`, ADR-005).
//
// BoardRoom owns the session flow and writes its state through; OmniMind only
// stores it. Every query is scoped by userId and excludes archived rows
// (`deletedAt IS NULL`). Session content is never embedded.

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  DECISION_SESSION_STATE_MAX_BYTES,
  DECISION_SESSION_LIST_DEFAULT_LIMIT,
  DECISION_SESSION_LIST_MAX_LIMIT,
  DecisionSessionStatus,
} from '@boardroom/shared';
import type {
  CreateDecisionSessionRequest,
  UpdateDecisionSessionRequest,
  DecisionSessionListResponse,
  DecisionSessionSummary,
} from '@boardroom/shared';

/** Wire record (dates as Date; Express serializes them to ISO). */
export interface DecisionSessionRecord {
  id: string;
  userId: string;
  roomId: string | null;
  question: string;
  mode: string | null;
  status: DecisionSessionStatus;
  personaResponses: Record<string, unknown>;
  ceoSynthesis: string | null;
  state: Record<string, unknown> | null;
  decisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const RECORD_SELECT = {
  id: true, userId: true, roomId: true, question: true, mode: true, status: true,
  personaResponses: true, ceoSynthesis: true, state: true, createdAt: true, updatedAt: true,
  decision: { select: { id: true, deletedAt: true } },
} satisfies Prisma.DecisionSessionSelect;

type RecordRow = Prisma.DecisionSessionGetPayload<{ select: typeof RECORD_SELECT }>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function toRecord(row: RecordRow): DecisionSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    roomId: row.roomId,
    question: row.question,
    mode: row.mode,
    status: row.status as DecisionSessionStatus,
    personaResponses: asObject(row.personaResponses) ?? {},
    ceoSynthesis: row.ceoSynthesis,
    state: asObject(row.state),
    decisionId: row.decision && !row.decision.deletedAt ? row.decision.id : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * UTF-8 bytes of the JSON of the request's `personaResponses` + `state` (the
 * snapshot). Over {@link DECISION_SESSION_STATE_MAX_BYTES} the route answers 413.
 */
export function snapshotBytes(body: Pick<UpdateDecisionSessionRequest, 'personaResponses' | 'state'>): number {
  return Buffer.byteLength(JSON.stringify({ p: body.personaResponses ?? null, s: body.state ?? null }), 'utf8');
}

export function snapshotTooLarge(body: Pick<UpdateDecisionSessionRequest, 'personaResponses' | 'state'>): boolean {
  return snapshotBytes(body) > DECISION_SESSION_STATE_MAX_BYTES;
}

/** Prisma data for the writable fields that are present in `body` (absent = untouched). */
function writableData(body: UpdateDecisionSessionRequest): Prisma.DecisionSessionUncheckedUpdateInput {
  const data: Prisma.DecisionSessionUncheckedUpdateInput = {};
  if (body.question !== undefined) data.question = body.question;
  if (body.mode !== undefined) data.mode = body.mode;
  if (body.status !== undefined) data.status = body.status;
  if (body.personaResponses !== undefined) data.personaResponses = body.personaResponses as Prisma.InputJsonValue;
  if (body.ceoSynthesis !== undefined) data.ceoSynthesis = body.ceoSynthesis;
  if (body.state !== undefined) data.state = body.state === null ? Prisma.DbNull : body.state as Prisma.InputJsonValue;
  return data;
}

export async function createDecisionSession(
  userId: string,
  body: CreateDecisionSessionRequest,
  prisma: PrismaClient,
): Promise<DecisionSessionRecord> {
  const data = writableData(body);
  const row = await prisma.decisionSession.create({
    data: { ...(data as Prisma.DecisionSessionUncheckedCreateInput), userId, question: body.question },
    select: RECORD_SELECT,
  });
  return toRecord(row);
}

export async function getDecisionSession(
  userId: string,
  id: string,
  prisma: PrismaClient,
): Promise<DecisionSessionRecord | null> {
  const row = await prisma.decisionSession.findFirst({
    where: { id, userId, deletedAt: null },
    select: RECORD_SELECT,
  });
  return row ? toRecord(row) : null;
}

/** Replaces each given field. Null when the session is missing, archived or another user's. */
export async function updateDecisionSession(
  userId: string,
  id: string,
  body: UpdateDecisionSessionRequest,
  prisma: PrismaClient,
): Promise<DecisionSessionRecord | null> {
  const { count } = await prisma.decisionSession.updateMany({
    where: { id, userId, deletedAt: null },
    data: writableData(body) as Prisma.DecisionSessionUncheckedUpdateManyInput,
  });
  if (count === 0) return null;
  return getDecisionSession(userId, id, prisma);
}

/** Soft delete. False when already archived, missing or another user's. */
export async function archiveDecisionSession(userId: string, id: string, prisma: PrismaClient): Promise<boolean> {
  const { count } = await prisma.decisionSession.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

interface SummaryRow {
  id: string;
  question: string;
  mode: string | null;
  status: string;
  has_ceo: boolean;
  persona_count: number;
  decision_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const SYNTHESIZED_STATUSES = new Set<string>([DecisionSessionStatus.SYNTHESIZED, DecisionSessionStatus.DECIDED]);

export async function listDecisionSessions(
  userId: string,
  query: { limit?: number; offset?: number },
  prisma: PrismaClient,
): Promise<DecisionSessionListResponse> {
  const limit = Math.min(query.limit ?? DECISION_SESSION_LIST_DEFAULT_LIMIT, DECISION_SESSION_LIST_MAX_LIMIT);
  const offset = query.offset ?? 0;
  // Raw SQL so the page never loads `state` / full persona responses just to count them.
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>`
      SELECT ds.id, ds.question, ds.mode, ds.status::text AS status,
             (ds.ceo_synthesis IS NOT NULL) AS has_ceo,
             CASE WHEN jsonb_typeof(ds.persona_responses) = 'object'
                  THEN (SELECT count(*) FROM jsonb_object_keys(ds.persona_responses))::int
                  ELSE 0 END AS persona_count,
             d.id AS decision_id, ds.created_at, ds.updated_at
        FROM decision_sessions ds
        LEFT JOIN decisions d ON d.decision_session_id = ds.id AND d.deleted_at IS NULL
       WHERE ds.user_id = ${userId} AND ds.deleted_at IS NULL
       ORDER BY ds.created_at DESC, ds.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
    prisma.decisionSession.count({ where: { userId, deletedAt: null } }),
  ]);
  const items: DecisionSessionSummary[] = rows.map((r) => ({
    id: r.id,
    question: r.question,
    mode: r.mode,
    status: r.status as DecisionSessionStatus,
    personaCount: Number(r.persona_count) || 0,
    hasSynthesis: r.has_ceo || SYNTHESIZED_STATUSES.has(r.status),
    decisionId: r.decision_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return { items, total, offset, limit };
}

/**
 * RD-17 — before `POST /decisions` links `decisionSessionId`: the session must
 * be this user's and not archived (false → 422 `invalid_reference`). A
 * soft-deleted decision still holding the (unique) link releases it so the
 * session can commit again.
 */
export async function prepareDecisionSessionLink(
  userId: string,
  decisionSessionId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const session = await prisma.decisionSession.findFirst({
    where: { id: decisionSessionId, userId, deletedAt: null },
    select: { id: true, decision: { select: { id: true, deletedAt: true } } },
  });
  if (!session) return false;
  if (session.decision?.deletedAt) {
    await prisma.decision.update({ where: { id: session.decision.id }, data: { decisionSessionId: null } });
  }
  return true;
}
