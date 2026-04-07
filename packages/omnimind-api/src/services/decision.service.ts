import type { PrismaClient, Prisma } from '@prisma/client';

export async function createDecision(
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  // Extract assumptions to create separately if provided
  const { assumptions, options, ...rest } = data;

  const createData: any = {
    ...rest,
    userId,
    options: (options ?? []) as Prisma.InputJsonValue,
  };

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
