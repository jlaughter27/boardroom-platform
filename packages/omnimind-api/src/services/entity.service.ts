import type { PrismaClient } from '@prisma/client';

// Generic CRUD for Person, Goal, Project, Task entities
type EntityModel = 'person' | 'goal' | 'project' | 'task';

function getDelegate(prisma: PrismaClient, model: EntityModel) {
  const delegates = {
    person: prisma.person,
    goal: prisma.goal,
    project: prisma.project,
    task: prisma.task,
  };
  return delegates[model];
}

export async function createEntity(
  model: EntityModel,
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  const delegate = getDelegate(prisma, model) as any;
  return delegate.create({ data: { ...data, userId } });
}

export async function getEntity(
  model: EntityModel,
  userId: string,
  id: string,
  prisma: PrismaClient,
  include?: Record<string, unknown>
) {
  const delegate = getDelegate(prisma, model) as any;
  const query: Record<string, unknown> = { where: { id, userId, deletedAt: null } };
  if (include) query.include = include;
  return delegate.findFirst(query);
}

export async function listEntities(
  model: EntityModel,
  userId: string,
  filters: { limit?: number; offset?: number; [key: string]: unknown },
  prisma: PrismaClient
) {
  const delegate = getDelegate(prisma, model) as any;
  const limit = Math.min((filters.limit as number) ?? 20, 100);
  const offset = (filters.offset as number) ?? 0;

  const where: Record<string, unknown> = { userId, deletedAt: null };

  // Entity-specific filters
  if (filters.status) where.status = filters.status;
  if (filters.domain) where.domain = filters.domain;
  if (filters.level !== undefined) where.level = parseInt(filters.level as string, 10);
  if (filters.owner) where.owner = filters.owner;
  if (filters.priority !== undefined) where.priority = parseInt(filters.priority as string, 10);
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { title: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    delegate.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
    delegate.count({ where }),
  ]);

  return { items, total, offset, limit };
}

export async function updateEntity(
  model: EntityModel,
  userId: string,
  id: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  const delegate = getDelegate(prisma, model) as any;
  const existing = await delegate.findFirst({ where: { id, userId, deletedAt: null } });
  if (!existing) return null;
  return delegate.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
}

export async function deleteEntity(
  model: EntityModel,
  userId: string,
  id: string,
  prisma: PrismaClient
) {
  const delegate = getDelegate(prisma, model) as any;
  const existing = await delegate.findFirst({ where: { id, userId, deletedAt: null } });
  if (!existing) return null;
  await delegate.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id, status: 'deleted' as const };
}
