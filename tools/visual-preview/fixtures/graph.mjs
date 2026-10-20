// Graph + memory fixtures: the knowledge graph, 1-hop backlinks, unlinked
// mentions, hybrid search, memory list / detail and the entity lists the
// inspector's link editors read. All derived from one seeded graph so the
// Graph page and the Memory Explorer agree with each other.

import { buildGraph, scoreMemory, FIXTURE_NOW } from './graph-data.mjs';

const SEED = Number(process.env.VISUAL_PREVIEW_SEED ?? 7);
export const { graph, memories, communities } = buildGraph(SEED);

const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
const memoriesById = new Map(memories.map((m) => [m.id, m]));
const edgesByNode = new Map();
for (const e of graph.edges) {
  for (const id of [e.source, e.target]) {
    if (!edgesByNode.has(id)) edgesByNode.set(id, []);
    edgesByNode.get(id).push(e);
  }
}

const ok = (body) => ({ body });
/** `PaginatedResponse<T>` — the shape every entity list endpoint returns (api.ts unwraps `.items`). */
const paged = (items) => ok({ items, total: items.length, offset: 0, limit: items.length });
const notFound = (message) => ({ status: 404, body: { message } });

/** `GET /graph?types=&domain=&memoryLimit=&includeArchived=` — the same filters the server applies. */
function getGraph(_req, url) {
  const types = url.searchParams.get('types')?.split(',').filter(Boolean);
  const domain = url.searchParams.get('domain');
  const memoryLimit = Math.min(500, Number(url.searchParams.get('memoryLimit') ?? 150));
  const includeArchived = url.searchParams.get('includeArchived') === 'true';
  let nodes = graph.nodes.filter((n) => (!types || types.includes(n.type)) && (includeArchived || n.status !== 'ARCHIVED'));
  if (domain) nodes = nodes.filter((n) => n.domain === null || n.domain === domain);
  const mems = nodes.filter((n) => n.type === 'memory').sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  const memoryLimitHit = mems.length > memoryLimit;
  const keptMemories = new Set(mems.slice(0, memoryLimit).map((n) => n.id));
  nodes = nodes.filter((n) => n.type !== 'memory' || keptMemories.has(n.id));
  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  const nodeCounts = { goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0 };
  for (const n of nodes) nodeCounts[n.type] += 1;
  const linked = new Set(); for (const e of edges) { linked.add(e.source); linked.add(e.target); }
  return ok({ nodes, edges, stats: { nodeCounts, edgeCount: edges.length, isolatedNodes: nodes.filter((n) => !linked.has(n.id)).length, memoryLimitHit }, generatedAt: new Date(FIXTURE_NOW).toISOString() });
}

/** `GET /graph/backlinks/:nodeId` → `{ node, backlinks: [{ node, edge }] }`. */
function getBacklinks(_req, _url, match) {
  const id = decodeURIComponent(match[1]);
  const node = nodesById.get(id);
  if (!node) return notFound(`No node ${id}`);
  const backlinks = (edgesByNode.get(id) ?? []).map((edge) => {
    const otherId = edge.source === id ? edge.target : edge.source;
    return { node: nodesById.get(otherId), edge };
  }).filter((b) => b.node);
  return ok({ node, backlinks });
}

/** A handful of memories that mention an entity by name without a link. */
function getUnlinkedMentions(_req, url) {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const people = graph.nodes.filter((n) => n.type === 'person');
  const projects = graph.nodes.filter((n) => n.type === 'project');
  const items = memories.slice(0, Math.min(limit, 9)).map((m, i) => {
    const ent = i % 2 === 0 ? people[i % people.length] : projects[i % projects.length];
    return { memoryId: m.id, memoryTitle: m.title, entityType: ent.type, entityId: ent.refId, entityLabel: ent.label, snippet: `…${m.content.slice(0, 90)}… (${ent.label})` };
  });
  return ok({ items });
}

/** `POST /memories/search` — hybrid search stand-in with scores, layers and cursor paging. */
function hybridSearch(req) {
  const body = req.json ?? {};
  const query = String(body.query ?? '');
  const limit = Math.min(50, Number(body.limit ?? 20));
  const offset = body.cursor ? Number(Buffer.from(String(body.cursor), 'base64').toString('utf8')) || 0 : 0;
  const asOf = body.asOf ? Date.parse(body.asOf) : null;
  let rows = memories
    .filter((m) => body.includeArchived || m.status !== 'ARCHIVED')
    .filter((m) => !body.domain || m.domain === body.domain)
    .filter((m) => !body.status || m.status === body.status)
    .filter((m) => !Array.isArray(body.tags) || body.tags.length === 0 || body.tags.every((t) => m.tags.includes(t)))
    .filter((m) => asOf === null || (Date.parse(m.validAt) <= asOf && (m.invalidAt === null || Date.parse(m.invalidAt) > asOf)))
    .map((m) => ({ m, score: scoreMemory(m, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id));
  const page = rows.slice(offset, offset + limit).map(({ m, score }, i) => ({
    ...m,
    score: Math.round(score * 1000) / 1000,
    layers: i % 3 === 0 ? ['semantic', 'fulltext'] : i % 3 === 1 ? ['semantic'] : ['fulltext', 'trigram'],
  }));
  const nextCursor = offset + limit < rows.length ? Buffer.from(String(offset + limit)).toString('base64') : null;
  return ok({ items: page, nextCursor });
}

/** `GET /memories` list endpoint (used for empty queries + the detail's "related"). */
function listMemories(_req, url) {
  const p = url.searchParams;
  const q = (p.get('q') ?? '').toLowerCase();
  const limit = Number(p.get('limit') ?? 20); const offset = Number(p.get('offset') ?? 0);
  let rows = memories.filter((m) => m.status !== 'ARCHIVED');
  if (p.get('domain')) rows = rows.filter((m) => m.domain === p.get('domain'));
  if (p.get('status')) rows = rows.filter((m) => m.status === p.get('status'));
  if (p.get('memoryClass')) rows = rows.filter((m) => m.memoryClass === p.get('memoryClass'));
  if (q) rows = rows.filter((m) => `${m.title} ${m.content}`.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return ok({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit });
}

// Entity lists for the inspector's link editors / entity pickers.
const entity = (type) => graph.nodes.filter((n) => n.type === type);
const goals = () => entity('goal').map((n) => ({ id: n.refId, userId: 'u-josh', title: n.label, description: null, level: n.meta.level ?? 1, status: n.status ?? 'active', domain: n.domain, parentGoalId: null, targetDate: null, createdAt: n.createdAt, updatedAt: n.createdAt, version: 1 }));
const projects = () => entity('project').map((n) => ({ id: n.refId, userId: 'u-josh', title: n.label, description: null, status: n.status ?? 'active', domain: n.domain, priority: n.meta.priority ?? 'normal', startDate: null, targetDate: null, createdAt: n.createdAt, updatedAt: n.createdAt, version: 1 }));
const tasks = () => entity('task').map((n) => ({ id: n.refId, userId: 'u-josh', title: n.label, description: null, status: n.status ?? 'pending', priority: n.meta.priority ?? 2, dueDate: null, estimatedHours: null, createdAt: n.createdAt, updatedAt: n.createdAt, version: 1 }));
const people = () => entity('person').map((n) => ({ id: n.refId, userId: 'u-josh', name: n.label, role: n.meta.role ?? null, organization: null, email: null, notes: null, importance: n.importance ?? 0.5, domains: n.domain ? [n.domain] : [], interactionFrequency: 'monthly', lastContactAt: null, createdAt: n.createdAt, updatedAt: n.createdAt, version: 1 }));
const decisions = () => entity('decision').map((n) => ({ id: n.refId, userId: 'u-josh', sessionId: n.meta.sessionId ?? null, title: n.label, question: n.label, status: n.status ?? 'DECIDED', chosenPath: null, rationale: null, domain: n.domain, decidedAt: n.createdAt, reviewAt: null, createdAt: n.createdAt, updatedAt: n.createdAt, version: 1 }));
const commitments = () => entity('commitment').map((n) => ({ id: n.refId, userId: 'u-josh', description: n.label, status: n.status ?? 'OPEN', direction: 'OUTBOUND', stakeholderId: null, linkedProjectId: null, dueAt: n.meta.dueAt ?? null, fulfilledAt: null, createdAt: n.createdAt, updatedAt: n.createdAt, version: 1 }));

export default {
  routes: [
    { method: 'GET', path: '/graph', handler: getGraph },
    { method: 'GET', path: /^\/graph\/backlinks\/(.+)$/, handler: getBacklinks },
    { method: 'GET', path: '/graph/unlinked-mentions', handler: getUnlinkedMentions },
    { method: 'POST', path: '/graph/unlinked-mentions/link', handler: () => ({ status: 201, body: { id: 'link-new' } }) },
    { method: 'POST', path: '/memories/search', handler: hybridSearch },
    { method: 'GET', path: '/memories', handler: listMemories },
    { method: 'GET', path: /^\/memories\/([^/]+)$/, handler: (_r, _u, m) => (memoriesById.has(m[1]) ? ok(memoriesById.get(m[1])) : notFound('No memory')) },
    { method: 'GET', path: /^\/memories\/([^/]+)\/links$/, handler: (_r, _u, m) => ok((edgesByNode.get(`memory:${m[1]}`) ?? []).map((e, i) => {
      const other = nodesById.get(e.target);
      return { id: `${e.id}#${i}`, memoryId: m[1], entityType: other?.type ?? 'project', entityId: other?.refId ?? '', linkType: e.label ?? 'mentions', createdAt: other?.createdAt ?? new Date(FIXTURE_NOW).toISOString() };
    })) },
    { method: 'POST', path: /^\/memories\/([^/]+)\/links$/, handler: () => ({ status: 201, body: { id: 'link-new' } }) },
    { method: 'GET', path: '/goals', handler: () => paged(goals()) },
    { method: 'GET', path: '/projects', handler: () => paged(projects()) },
    { method: 'GET', path: '/tasks', handler: () => paged(tasks()) },
    { method: 'GET', path: '/people', handler: () => paged(people()) },
    { method: 'GET', path: '/people/duplicates', handler: () => ok({ pairs: [] }) },
    { method: 'GET', path: '/decisions', handler: () => paged(decisions()) },
    { method: 'GET', path: '/commitments', handler: () => paged(commitments()) },
  ],
};
