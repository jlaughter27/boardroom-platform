import type { PrismaClient, Prisma } from '@prisma/client';

export async function createCommitment(
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  return prisma.commitment.create({
    data: { ...data, userId } as any,
  });
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

  return prisma.commitment.update({
    where: { id },
    data: data as any,
  });
}
