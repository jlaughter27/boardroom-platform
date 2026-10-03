import type { PrismaClient } from '@prisma/client';
import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeType,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  KnowledgeGraphQuery,
} from '@boardroom/shared';
import { normalizeDomain } from '@boardroom/shared';

/**
 * Knowledge graph projection — one bulk read over the entity tables and the
 * link tables, returned as namespaced nodes + edges for the Obsidian-style
 * graph view.
 *
 * Rules:
 *  - every node and both ends of every edge belong to `userId` and are not
 *    soft-deleted; edges whose endpoints were filtered out are dropped
 *  - memories are capped (importance desc) so the graph stays renderable;
 *    stats.memoryLimitHit tells the UI the layer was truncated
 *  - tenant scoping applies to memories when an agent context is present
 *    (entities are user-scoped only, matching the rest of the API)
 *  - no memory content is returned, only titles — ministry rows therefore
 *    never surface ciphertext or plaintext content through this endpoint
 */

const DEFAULT_MEMORY_LIMIT = 150;
const MAX_MEMORY_LIMIT = 500;

const ALL_TYPES: KnowledgeGraphNodeType[] = [
  'goal', 'project', 'task', 'person', 'decision', 'commitment', 'memory',
];

/** Entity types a polymorphic link (MemoryEntityLink / CommitmentLink) may name. */
const POLYMORPHIC_TYPES: Record<string, KnowledgeGraphNodeType> = {
  goal: 'goal',
  project: 'project',
  task: 'task',
  person: 'person',
  decision: 'decision',
  commitment: 'commitment',
  memory: 'memory',
};

export const nodeId = (type: KnowledgeGraphNodeType, refId: string): string => `${type}:${refId}`;

const edgeId = (type: KnowledgeGraphEdgeType, source: string, target: string): string =>
  `${type}:${source}->${target}`;

const iso = (d: Date): string => d.toISOString();

const domainOrNull = (d: string | null | undefined): string | null => {
  if (!d) return null;
  const n = normalizeDomain(d);
  return n.length ? n : null;
};

export interface KnowledgeGraphOptions extends KnowledgeGraphQuery {
  tenantId?: string;
}

export async function getKnowledgeGraph(
  userId: string,
  opts: KnowledgeGraphOptions,
  prisma: PrismaClient,
): Promise<KnowledgeGraph> {
  const wanted = new Set<KnowledgeGraphNodeType>(opts.types?.length ? opts.types : ALL_TYPES);
  const memoryLimit = Math.min(Math.max(opts.memoryLimit ?? DEFAULT_MEMORY_LIMIT, 0), MAX_MEMORY_LIMIT);
  const includeMemories = wanted.has('memory') && memoryLimit > 0;

  const alive = { userId, deletedAt: null } as const;

  const [goals, projects, tasks, people, decisions, commitments, memories] = await Promise.all([
    wanted.has('goal')
      ? prisma.goal.findMany({
          where: alive,
          select: { id: true, title: true, domain: true, status: true, level: true, parentGoalId: true, createdAt: true },
        })
      : [],
    wanted.has('project')
      ? prisma.project.findMany({
          where: alive,
          select: { id: true, title: true, domain: true, status: true, createdAt: true },
        })
      : [],
    wanted.has('task')
      ? prisma.task.findMany({
          where: alive,
          select: { id: true, title: true, status: true, priority: true, createdAt: true },
        })
      : [],
    wanted.has('person')
      ? prisma.person.findMany({
          where: alive,
          select: { id: true, name: true, role: true, domains: true, importance: true, createdAt: true },
        })
      : [],
    wanted.has('decision')
      ? prisma.decision.findMany({
          where: alive,
          select: { id: true, title: true, status: true, sessionId: true, createdAt: true },
        })
      : [],
    wanted.has('commitment')
      ? prisma.commitment.findMany({
          where: alive,
          select: { id: true, description: true, status: true, stakeholderId: true, linkedProjectId: true, createdAt: true },
        })
      : [],
    includeMemories
      ? prisma.memoryEntry.findMany({
          where: {
            ...alive,
            ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
            ...(opts.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
          },
          select: { id: true, title: true, domain: true, importance: true, status: true, memoryClass: true, createdAt: true },
          orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
          take: memoryLimit,
        })
      : [],
  ]);

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodes = new Map<string, KnowledgeGraphNode>();
  const put = (n: KnowledgeGraphNode) => nodes.set(n.id, n);

  for (const g of goals) {
    put({
      id: nodeId('goal', g.id), type: 'goal', refId: g.id, label: g.title,
      domain: domainOrNull(g.domain), status: g.status, importance: null, createdAt: iso(g.createdAt),
      meta: { level: g.level, parentGoalId: g.parentGoalId ?? null },
    });
  }
  for (const p of projects) {
    put({
      id: nodeId('project', p.id), type: 'project', refId: p.id, label: p.title,
      domain: domainOrNull(p.domain), status: p.status, importance: null, createdAt: iso(p.createdAt), meta: {},
    });
  }
  for (const t of tasks) {
    put({
      id: nodeId('task', t.id), type: 'task', refId: t.id, label: t.title,
      domain: null, status: t.status, importance: null, createdAt: iso(t.createdAt),
      meta: { priority: t.priority },
    });
  }
  for (const p of people) {
    put({
      id: nodeId('person', p.id), type: 'person', refId: p.id, label: p.name,
      domain: domainOrNull(p.domains[0]), status: null, importance: p.importance, createdAt: iso(p.createdAt),
      meta: { role: p.role ?? null, domains: p.domains.join(',') },
    });
  }
  for (const d of decisions) {
    put({
      id: nodeId('decision', d.id), type: 'decision', refId: d.id, label: d.title,
      domain: null, status: d.status, importance: null, createdAt: iso(d.createdAt),
      meta: { sessionId: d.sessionId ?? null },
    });
  }
  for (const c of commitments) {
    put({
      id: nodeId('commitment', c.id), type: 'commitment', refId: c.id,
      label: c.description.length > 80 ? `${c.description.slice(0, 77)}…` : c.description,
      domain: null, status: c.status, importance: null, createdAt: iso(c.createdAt), meta: {},
    });
  }
  for (const m of memories) {
    put({
      id: nodeId('memory', m.id), type: 'memory', refId: m.id, label: m.title,
      domain: domainOrNull(m.domain), status: m.status, importance: m.importance, createdAt: iso(m.createdAt),
      meta: { memoryClass: m.memoryClass },
    });
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  // Only query link tables whose endpoint types are both wanted.
  const has = (a: KnowledgeGraphNodeType, b: KnowledgeGraphNodeType) => wanted.has(a) && wanted.has(b);
  const memoryIds = memories.map((m) => m.id);
  const commitmentIds = commitments.map((c) => c.id);

  const [goalProject, projectTask, projectPerson, decisionProject, taskDeps, memoryLinks, commitmentLinks] =
    await Promise.all([
      has('goal', 'project')
        ? prisma.goalProjectLink.findMany({ where: { goal: { userId } }, select: { goalId: true, projectId: true } })
        : [],
      has('project', 'task')
        ? prisma.projectTaskLink.findMany({ where: { project: { userId } }, select: { projectId: true, taskId: true } })
        : [],
      has('project', 'person')
        ? prisma.projectPersonLink.findMany({ where: { project: { userId } }, select: { projectId: true, personId: true, role: true } })
        : [],
      has('decision', 'project')
        ? prisma.decisionProjectLink.findMany({ where: { decision: { userId } }, select: { decisionId: true, projectId: true } })
        : [],
      wanted.has('task')
        ? prisma.taskDependency.findMany({ where: { task: { userId } }, select: { taskId: true, dependsOnTaskId: true } })
        : [],
      memoryIds.length
        ? prisma.memoryEntityLink.findMany({
            where: { memoryId: { in: memoryIds } },
            select: { memoryId: true, entityType: true, entityId: true, linkType: true },
          })
        : [],
      commitmentIds.length
        ? prisma.commitmentLink.findMany({
            where: { commitmentId: { in: commitmentIds } },
            select: { commitmentId: true, entityType: true, entityId: true },
          })
        : [],
    ]);

  const edges = new Map<string, KnowledgeGraphEdge>();
  const link = (type: KnowledgeGraphEdgeType, source: string, target: string, label: string | null = null) => {
    if (source === target) return;
    if (!nodes.has(source) || !nodes.has(target)) return; // endpoint filtered (deleted / other user / not wanted)
    const id = edgeId(type, source, target);
    if (!edges.has(id)) edges.set(id, { id, source, target, type, label });
  };

  for (const g of goals) {
    if (g.parentGoalId) link('goal_hierarchy', nodeId('goal', g.parentGoalId), nodeId('goal', g.id));
  }
  for (const l of goalProject) link('goal_project', nodeId('goal', l.goalId), nodeId('project', l.projectId));
  for (const l of projectTask) link('project_task', nodeId('project', l.projectId), nodeId('task', l.taskId));
  for (const l of projectPerson) link('project_person', nodeId('project', l.projectId), nodeId('person', l.personId), l.role || null);
  for (const l of decisionProject) link('decision_project', nodeId('decision', l.decisionId), nodeId('project', l.projectId));
  for (const l of taskDeps) link('task_dependency', nodeId('task', l.taskId), nodeId('task', l.dependsOnTaskId));
  for (const c of commitments) {
    if (c.stakeholderId) link('commitment_person', nodeId('commitment', c.id), nodeId('person', c.stakeholderId));
    if (c.linkedProjectId) link('commitment_project', nodeId('commitment', c.id), nodeId('project', c.linkedProjectId));
  }
  for (const l of commitmentLinks) {
    const t = POLYMORPHIC_TYPES[l.entityType.toLowerCase()];
    if (t) link('commitment_entity', nodeId('commitment', l.commitmentId), nodeId(t, l.entityId));
  }
  for (const l of memoryLinks) {
    const t = POLYMORPHIC_TYPES[l.entityType.toLowerCase()];
    if (t) link('memory_entity', nodeId('memory', l.memoryId), nodeId(t, l.entityId), l.linkType || null);
  }

  // ── Domain filter: keep matching domain nodes + their domain-less neighbours ──
  if (opts.domain) {
    const want = normalizeDomain(opts.domain);
    const keep = new Set<string>();
    for (const n of nodes.values()) if (n.domain === want) keep.add(n.id);
    for (const e of edges.values()) {
      const s = nodes.get(e.source)!;
      const t = nodes.get(e.target)!;
      if (keep.has(e.source) && t.domain === null) keep.add(e.target);
      if (keep.has(e.target) && s.domain === null) keep.add(e.source);
    }
    for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
    for (const [id, e] of [...edges]) if (!nodes.has(e.source) || !nodes.has(e.target)) edges.delete(id);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const degree = new Map<string, number>();
  for (const e of edges.values()) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodeCounts: Record<KnowledgeGraphNodeType, number> = {
    goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0,
  };
  let isolated = 0;
  for (const n of nodes.values()) {
    nodeCounts[n.type] += 1;
    if (!degree.has(n.id)) isolated += 1;
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    stats: {
      nodeCounts,
      edgeCount: edges.size,
      isolatedNodes: isolated,
      memoryLimitHit: includeMemories && memories.length >= memoryLimit,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase 6 (A2) — backlinks for one node (`GET /graph/backlinks/:nodeId`).
//
// Returns every edge incident to the node (both directions — `edge.source` /
// `edge.target` carry the direction) with the node at the other end. The
// entity side reuses the projection above with the memory layer switched off
// (memoryLimit 0), so no importance cap can hide an entity backlink; memory
// backlinks are then read straight from MemoryEntityLink for the node, so they
// are complete too (tenant-scoped when an agent context is present).
// ---------------------------------------------------------------------------

export interface Backlink {
  node: KnowledgeGraphNode;
  edge: KnowledgeGraphEdge;
}

export interface BacklinksResult {
  node: KnowledgeGraphNode;
  backlinks: Backlink[];
}

export interface BacklinksOptions {
  tenantId?: string;
  /** Include ARCHIVED memories among memory backlinks (default false). */
  includeArchived?: boolean;
}

const NODE_ID_RE = /^(goal|project|task|person|decision|commitment|memory):(.+)$/;

/** Parses `type:refId`; null when malformed or the type is unknown. */
export function parseNodeId(raw: string): { type: KnowledgeGraphNodeType; refId: string } | null {
  const m = NODE_ID_RE.exec(raw ?? '');
  if (!m) return null;
  return { type: m[1] as KnowledgeGraphNodeType, refId: m[2] };
}

type MemoryNodeRow = {
  id: string; title: string; domain: string; importance: number; status: string; memoryClass: string; createdAt: Date;
};

const memoryNode = (m: MemoryNodeRow): KnowledgeGraphNode => ({
  id: nodeId('memory', m.id), type: 'memory', refId: m.id, label: m.title,
  domain: domainOrNull(m.domain), status: m.status, importance: m.importance, createdAt: iso(m.createdAt),
  meta: { memoryClass: m.memoryClass },
});

/** null → the node does not exist / is soft-deleted / belongs to someone else. */
export async function getBacklinks(
  userId: string,
  rawNodeId: string,
  opts: BacklinksOptions,
  prisma: PrismaClient,
): Promise<BacklinksResult | null> {
  const parsed = parseNodeId(rawNodeId);
  if (!parsed) return null;
  const { type, refId } = parsed;
  const id = nodeId(type, refId);

  // Entity-side graph (no memories) — complete for the user's entity tables.
  const graph = await getKnowledgeGraph(userId, { memoryLimit: 0 }, prisma);
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = new Map(graph.edges.map(e => [e.id, e]));

  const memoryWhere = {
    userId,
    deletedAt: null,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    ...(opts.includeArchived ? {} : { status: { not: 'ARCHIVED' as const } }),
  };
  const memorySelect = { id: true, title: true, domain: true, importance: true, status: true, memoryClass: true, createdAt: true } as const;

  let node: KnowledgeGraphNode | undefined;
  if (type === 'memory') {
    const m = await prisma.memoryEntry.findFirst({ where: { ...memoryWhere, id: refId }, select: memorySelect });
    if (!m) return null;
    node = memoryNode(m);
    nodes.set(node.id, node);

    const links = await prisma.memoryEntityLink.findMany({
      where: { memoryId: refId },
      select: { entityType: true, entityId: true, linkType: true },
    });
    for (const l of links) {
      const t = POLYMORPHIC_TYPES[l.entityType.toLowerCase()];
      if (!t) continue;
      const target = nodeId(t, l.entityId);
      if (!nodes.has(target)) continue; // dangling / foreign / deleted
      const eid = edgeId('memory_entity', node.id, target);
      if (!edges.has(eid)) edges.set(eid, { id: eid, source: node.id, target, type: 'memory_entity', label: l.linkType || null });
    }
  } else {
    node = nodes.get(id);
    if (!node) return null;

    // R-O-13: legacy rows may carry mixed-case entity types — match case-insensitively.
    const links = await prisma.memoryEntityLink.findMany({
      where: { entityType: { equals: type, mode: 'insensitive' }, entityId: refId },
      select: { memoryId: true, linkType: true },
    });
    if (links.length > 0) {
      const memories = await prisma.memoryEntry.findMany({
        where: { ...memoryWhere, id: { in: Array.from(new Set(links.map(l => l.memoryId))) } },
        select: memorySelect,
      });
      const byId = new Map(memories.map(m => [m.id, m]));
      for (const l of links) {
        const m = byId.get(l.memoryId);
        if (!m) continue; // archived / other tenant / deleted
        const source = nodeId('memory', m.id);
        if (!nodes.has(source)) nodes.set(source, memoryNode(m));
        const eid = edgeId('memory_entity', source, id);
        if (!edges.has(eid)) edges.set(eid, { id: eid, source, target: id, type: 'memory_entity', label: l.linkType || null });
      }
    }
  }

  const backlinks: Backlink[] = [];
  for (const e of edges.values()) {
    const otherId = e.source === id ? e.target : e.target === id ? e.source : null;
    if (!otherId) continue;
    const other = nodes.get(otherId);
    if (!other) continue;
    backlinks.push({ node: other, edge: e });
  }
  backlinks.sort((a, b) => a.edge.type.localeCompare(b.edge.type) || a.node.label.localeCompare(b.node.label));

  return { node, backlinks };
}
