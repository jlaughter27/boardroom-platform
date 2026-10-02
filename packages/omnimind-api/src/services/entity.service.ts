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
    const searchClauses: Record<string, unknown>[] = [];
    // 'name' exists only on Person
    if (model === 'person') {
      searchClauses.push({ name: { contains: filters.q, mode: 'insensitive' } });
    }
    // 'title' exists on Goal, Project, Task (not Person)
    if (model !== 'person') {
      searchClauses.push({ title: { contains: filters.q, mode: 'insensitive' } });
    }
    // Person has 'notes', others don't have a general description field
    if (model === 'person') {
      searchClauses.push({ notes: { contains: filters.q, mode: 'insensitive' } });
    }
    where.OR = searchClauses;
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

// ---------------------------------------------------------------------------
// C-111 — Goal → Project → Task link tables (GoalProjectLink, ProjectTaskLink)
//
// CLAUDE.md principle 2: Goals → Projects → Tasks form a DAG via link tables.
// The Prisma models existed but nothing wrote to them. Every link operation
// verifies BOTH endpoints belong to `userId` and are not soft-deleted; a
// missing/foreign endpoint is reported as null (→ 404) without revealing
// which side failed.
// ---------------------------------------------------------------------------

export interface GoalProjectLinkRow { id: string; goalId: string; projectId: string }
export interface ProjectTaskLinkRow { id: string; projectId: string; taskId: string }
export interface LinkResult<T> { link: T; created: boolean }

async function ownsGoal(prisma: PrismaClient, userId: string, id: string): Promise<boolean> {
  return !!(await prisma.goal.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } }));
}
async function ownsProject(prisma: PrismaClient, userId: string, id: string): Promise<boolean> {
  return !!(await prisma.project.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } }));
}
async function ownsTask(prisma: PrismaClient, userId: string, id: string): Promise<boolean> {
  return !!(await prisma.task.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } }));
}

/** Idempotent on the (goalId, projectId) unique pair. null → one endpoint is not the user's. */
export async function linkGoalProject(
  userId: string,
  goalId: string,
  projectId: string,
  prisma: PrismaClient
): Promise<LinkResult<GoalProjectLinkRow> | null> {
  const [goalOk, projectOk] = await Promise.all([ownsGoal(prisma, userId, goalId), ownsProject(prisma, userId, projectId)]);
  if (!goalOk || !projectOk) return null;

  const existing = await prisma.goalProjectLink.findUnique({ where: { goalId_projectId: { goalId, projectId } } });
  if (existing) return { link: existing, created: false };

  const link = await prisma.goalProjectLink.upsert({
    where: { goalId_projectId: { goalId, projectId } },
    create: { goalId, projectId },
    update: {},
  });
  return { link, created: true };
}

export async function unlinkGoalProject(
  userId: string,
  goalId: string,
  projectId: string,
  prisma: PrismaClient
): Promise<{ goalId: string; projectId: string; status: 'unlinked' } | null> {
  const [goalOk, projectOk] = await Promise.all([ownsGoal(prisma, userId, goalId), ownsProject(prisma, userId, projectId)]);
  if (!goalOk || !projectOk) return null;
  const { count } = await prisma.goalProjectLink.deleteMany({ where: { goalId, projectId } });
  if (count === 0) return null;
  return { goalId, projectId, status: 'unlinked' };
}

/** Idempotent on the (projectId, taskId) unique pair. null → one endpoint is not the user's. */
export async function linkProjectTask(
  userId: string,
  projectId: string,
  taskId: string,
  prisma: PrismaClient
): Promise<LinkResult<ProjectTaskLinkRow> | null> {
  const [projectOk, taskOk] = await Promise.all([ownsProject(prisma, userId, projectId), ownsTask(prisma, userId, taskId)]);
  if (!projectOk || !taskOk) return null;

  const existing = await prisma.projectTaskLink.findUnique({ where: { projectId_taskId: { projectId, taskId } } });
  if (existing) return { link: existing, created: false };

  const link = await prisma.projectTaskLink.upsert({
    where: { projectId_taskId: { projectId, taskId } },
    create: { projectId, taskId },
    update: {},
  });
  return { link, created: true };
}

export async function unlinkProjectTask(
  userId: string,
  projectId: string,
  taskId: string,
  prisma: PrismaClient
): Promise<{ projectId: string; taskId: string; status: 'unlinked' } | null> {
  const [projectOk, taskOk] = await Promise.all([ownsProject(prisma, userId, projectId), ownsTask(prisma, userId, taskId)]);
  if (!projectOk || !taskOk) return null;
  const { count } = await prisma.projectTaskLink.deleteMany({ where: { projectId, taskId } });
  if (count === 0) return null;
  return { projectId, taskId, status: 'unlinked' };
}
