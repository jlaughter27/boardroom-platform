import type { PrismaClient, Prisma } from '@prisma/client';
import type { ReflectableEntityType } from '@boardroom/shared';
import { tryDecryptMemory } from '../lib/memory-crypto';

export async function createDecision(
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  // Extract assumptions to create separately if provided
  const { assumptions, options, personaForecasts, ...rest } = data;

  const createData: any = {
    ...rest,
    userId,
    options: (options ?? []) as Prisma.InputJsonValue,
  };
  if (personaForecasts !== undefined) {
    createData.personaForecasts = personaForecasts as Prisma.InputJsonValue;
  }
  // Phase 6: `decidedAt` defaults to now when a path is chosen at create time.
  if (createData.chosenPath && createData.decidedAt == null) {
    createData.decidedAt = new Date();
  }

  if (assumptions) {
    createData.assumptions = {
      create: (assumptions as any[]).map((a) => ({
        text: a.text,
        confidence: a.confidence,
        reviewAt: a.reviewAt ?? null,
        status: a.status ?? 'ACTIVE',
      })),
    };
  }

  const decision = await prisma.decision.create({
    data: createData,
    include: { assumptions: true },
  });

  return decision;
}

export async function getDecision(
  userId: string,
  id: string,
  prisma: PrismaClient
) {
  return prisma.decision.findFirst({
    where: { id, userId, deletedAt: null },
    include: { assumptions: true },
  });
}

export async function listDecisions(
  userId: string,
  filters: { status?: string; limit?: number; offset?: number },
  prisma: PrismaClient
) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const where: Prisma.DecisionWhereInput = { userId, deletedAt: null };
  if (filters.status) where.status = filters.status as any;

  const [items, total] = await Promise.all([
    prisma.decision.findMany({
      where,
      include: { assumptions: true },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.decision.count({ where }),
  ]);

  return { items, total, offset, limit };
}

export async function updateDecision(
  userId: string,
  id: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  const existing = await prisma.decision.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return null;

  const { assumptions, ...updateData } = data;

  // Convert options to Json if present
  if (updateData.options) {
    updateData.options = updateData.options as Prisma.InputJsonValue;
  }
  if (updateData.personaForecasts !== undefined) {
    updateData.personaForecasts = updateData.personaForecasts as Prisma.InputJsonValue;
  }
  // Phase 6: first time a path is chosen → stamp decidedAt (unless provided).
  if (updateData.chosenPath && !existing.decidedAt && updateData.decidedAt == null) {
    updateData.decidedAt = new Date();
  }

  const decision = await prisma.decision.update({
    where: { id },
    data: {
      ...updateData,
      version: { increment: 1 },
    },
    include: { assumptions: true },
  });

  return decision;
}

// ── Phase 6 — "what changed since last time" (GET /decisions/changes) ──

export interface ParsedEntityRef { entityType: ReflectableEntityType; entityId: string }

/** `goal:abc` → { entityType:'goal', entityId:'abc' }; null when malformed. */
export function parseEntityRef(raw: string): ParsedEntityRef | null {
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const entityType = raw.slice(0, idx);
  const entityId = raw.slice(idx + 1);
  if (!entityId) return null;
  if (entityType !== 'goal' && entityType !== 'project' && entityType !== 'person') return null;
  return { entityType, entityId };
}

/**
 * Projects reachable from an entity: the project itself, projects linked to a
 * goal, or projects a person is assigned to. Used to scope decisions +
 * commitments via link tables.
 */
async function relatedProjectIds(userId: string, ref: ParsedEntityRef, prisma: PrismaClient): Promise<string[]> {
  if (ref.entityType === 'project') return [ref.entityId];
  if (ref.entityType === 'goal') {
    const links = await prisma.goalProjectLink.findMany({ where: { goalId: ref.entityId, project: { userId, deletedAt: null } }, select: { projectId: true } });
    return links.map(l => l.projectId);
  }
  const links = await prisma.projectPersonLink.findMany({ where: { personId: ref.entityId, project: { userId, deletedAt: null } }, select: { projectId: true } });
  return links.map(l => l.projectId);
}

export async function getEntityChanges(
  userId: string,
  ref: ParsedEntityRef,
  since: Date,
  prisma: PrismaClient,
) {
  const projectIds = await relatedProjectIds(userId, ref, prisma);

  const [memoryLinks, decisions, commitments, capsule] = await Promise.all([
    prisma.memoryEntityLink.findMany({ where: { entityType: ref.entityType, entityId: ref.entityId }, select: { memoryId: true } }),
    projectIds.length
      ? prisma.decision.findMany({
          where: {
            userId, deletedAt: null,
            projectLinks: { some: { projectId: { in: projectIds } } },
            OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }, { decidedAt: { gte: since } }],
          },
          include: { assumptions: true },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        })
      : Promise.resolve([]),
    prisma.commitment.findMany({
      where: {
        userId, deletedAt: null,
        OR: [
          ...(projectIds.length ? [{ linkedProjectId: { in: projectIds } }] : []),
          ...(ref.entityType === 'person' ? [{ stakeholderId: ref.entityId }] : []),
        ],
        AND: [{ OR: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }] }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }).then(rows => rows), // OR:[] would match nothing → fine for goal with no projects
    prisma.contextCapsule.findUnique({ where: { userId_entityType_entityId: { userId, entityType: ref.entityType, entityId: ref.entityId } } }),
  ]);

  const memoryIds = memoryLinks.map(l => l.memoryId);
  const memoryRows = memoryIds.length
    ? await prisma.memoryEntry.findMany({
        where: {
          id: { in: memoryIds }, userId, deletedAt: null,
          OR: [{ createdAt: { gte: since } }, { invalidAt: { gte: since } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    : [];

  // Decrypt ministry rows (placeholder → plaintext); drop undecryptable ones;
  // never ship ciphertext over the wire.
  const memories = memoryRows
    .map(m => tryDecryptMemory(m))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .map(({ encryptedContent: _enc, ...rest }) => rest);

  return {
    since: since.toISOString(),
    memories,
    decisions,
    // A commitment OR with zero branches matches nothing in Prisma — guard explicitly.
    commitments: projectIds.length === 0 && ref.entityType !== 'person' ? [] : commitments,
    capsule,
  };
}
