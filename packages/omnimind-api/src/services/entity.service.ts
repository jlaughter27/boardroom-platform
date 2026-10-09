import type { PrismaClient } from '@prisma/client';
import { invalidateCoreContext } from './core-context.service';

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

// Phase 6: the cached core-context block (GET /context/core) lists active goals
// with their linked project titles — drop it on every goal / project write.
function touchesCoreContext(model: EntityModel): boolean {
  return model === 'goal' || model === 'project';
}

export async function createEntity(
  model: EntityModel,
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  const delegate = getDelegate(prisma, model) as any;
  const created = await delegate.create({ data: { ...data, userId } });
  if (touchesCoreContext(model)) invalidateCoreContext(userId);
  return created;
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
  const updated = await delegate.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  if (touchesCoreContext(model)) invalidateCoreContext(userId);
  return updated;
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
  if (touchesCoreContext(model)) invalidateCoreContext(userId);
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
  invalidateCoreContext(userId);
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
  invalidateCoreContext(userId);
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

// ---------------------------------------------------------------------------
// Phase 6 (A2) — remaining link tables: ProjectPersonLink, DecisionProjectLink,
// TaskDependency. Same contract as the C-111 writers above: both endpoints
// must belong to `userId` and not be soft-deleted (null → 404), idempotent on
// the unique pair (created:false → 200), unlink returns null when no row was
// removed (→ 404).
//
// Goal / project writes and goal↔project links call `invalidateCoreContext`
// (core-context.service.ts) so GET /context/core never serves a stale block.
// ---------------------------------------------------------------------------

export interface ProjectPersonLinkRow { id: string; projectId: string; personId: string; role: string }
export interface DecisionProjectLinkRow { id: string; decisionId: string; projectId: string }
export interface TaskDependencyRow { id: string; taskId: string; dependsOnTaskId: string }

/** Why a task-dependency write was refused (besides ownership → null). */
export type TaskDependencyRejection = 'self_dependency' | 'cycle';
export type TaskDependencyResult =
  | LinkResult<TaskDependencyRow>
  | { rejected: TaskDependencyRejection };

async function ownsPerson(prisma: PrismaClient, userId: string, id: string): Promise<boolean> {
  return !!(await prisma.person.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } }));
}
async function ownsDecision(prisma: PrismaClient, userId: string, id: string): Promise<boolean> {
  return !!(await prisma.decision.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } }));
}

/**
 * Idempotent on the (projectId, personId) unique pair. When the link exists and
 * a different non-empty `role` is supplied the role is updated (still 200).
 */
export async function linkProjectPerson(
  userId: string,
  projectId: string,
  personId: string,
  role: string | undefined,
  prisma: PrismaClient
): Promise<LinkResult<ProjectPersonLinkRow> | null> {
  const [projectOk, personOk] = await Promise.all([ownsProject(prisma, userId, projectId), ownsPerson(prisma, userId, personId)]);
  if (!projectOk || !personOk) return null;

  const existing = await prisma.projectPersonLink.findUnique({ where: { projectId_personId: { projectId, personId } } });
  if (existing) {
    if (role !== undefined && role !== existing.role) {
      const updated = await prisma.projectPersonLink.update({ where: { id: existing.id }, data: { role } });
      return { link: updated, created: false };
    }
    return { link: existing, created: false };
  }

  const link = await prisma.projectPersonLink.upsert({
    where: { projectId_personId: { projectId, personId } },
    create: { projectId, personId, role: role ?? '' },
    update: {},
  });
  return { link, created: true };
}

export async function unlinkProjectPerson(
  userId: string,
  projectId: string,
  personId: string,
  prisma: PrismaClient
): Promise<{ projectId: string; personId: string; status: 'unlinked' } | null> {
  const [projectOk, personOk] = await Promise.all([ownsProject(prisma, userId, projectId), ownsPerson(prisma, userId, personId)]);
  if (!projectOk || !personOk) return null;
  const { count } = await prisma.projectPersonLink.deleteMany({ where: { projectId, personId } });
  if (count === 0) return null;
  return { projectId, personId, status: 'unlinked' };
}

/** Idempotent on the (decisionId, projectId) unique pair. */
export async function linkDecisionProject(
  userId: string,
  projectId: string,
  decisionId: string,
  prisma: PrismaClient
): Promise<LinkResult<DecisionProjectLinkRow> | null> {
  const [projectOk, decisionOk] = await Promise.all([ownsProject(prisma, userId, projectId), ownsDecision(prisma, userId, decisionId)]);
  if (!projectOk || !decisionOk) return null;

  const existing = await prisma.decisionProjectLink.findUnique({ where: { decisionId_projectId: { decisionId, projectId } } });
  if (existing) return { link: existing, created: false };

  const link = await prisma.decisionProjectLink.upsert({
    where: { decisionId_projectId: { decisionId, projectId } },
    create: { decisionId, projectId },
    update: {},
  });
  return { link, created: true };
}

export async function unlinkDecisionProject(
  userId: string,
  projectId: string,
  decisionId: string,
  prisma: PrismaClient
): Promise<{ projectId: string; decisionId: string; status: 'unlinked' } | null> {
  const [projectOk, decisionOk] = await Promise.all([ownsProject(prisma, userId, projectId), ownsDecision(prisma, userId, decisionId)]);
  if (!projectOk || !decisionOk) return null;
  const { count } = await prisma.decisionProjectLink.deleteMany({ where: { decisionId, projectId } });
  if (count === 0) return null;
  return { projectId, decisionId, status: 'unlinked' };
}

/**
 * `taskId` depends on `dependsOnTaskId`. Rejects a self-dependency and a
 * direct cycle (the reverse edge already exists). Deeper cycles are not
 * walked here — the DAG invariant for longer chains is a Phase 2.5
 * RoadmapService concern.
 */
export async function linkTaskDependency(
  userId: string,
  taskId: string,
  dependsOnTaskId: string,
  prisma: PrismaClient
): Promise<TaskDependencyResult | null> {
  if (taskId === dependsOnTaskId) return { rejected: 'self_dependency' };

  const [taskOk, otherOk] = await Promise.all([ownsTask(prisma, userId, taskId), ownsTask(prisma, userId, dependsOnTaskId)]);
  if (!taskOk || !otherOk) return null;

  const existing = await prisma.taskDependency.findUnique({ where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } } });
  if (existing) return { link: existing, created: false };

  const reverse = await prisma.taskDependency.findUnique({
    where: { taskId_dependsOnTaskId: { taskId: dependsOnTaskId, dependsOnTaskId: taskId } },
  });
  if (reverse) return { rejected: 'cycle' };

  const link = await prisma.taskDependency.upsert({
    where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
    create: { taskId, dependsOnTaskId },
    update: {},
  });
  return { link, created: true };
}

export async function unlinkTaskDependency(
  userId: string,
  taskId: string,
  dependsOnTaskId: string,
  prisma: PrismaClient
): Promise<{ taskId: string; dependsOnTaskId: string; status: 'unlinked' } | null> {
  const [taskOk, otherOk] = await Promise.all([ownsTask(prisma, userId, taskId), ownsTask(prisma, userId, dependsOnTaskId)]);
  if (!taskOk || !otherOk) return null;
  const { count } = await prisma.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId } });
  if (count === 0) return null;
  return { taskId, dependsOnTaskId, status: 'unlinked' };
}
