// Deterministic knowledge-graph fixture for the visual harness.
//
// ~350 nodes across all seven types, ~700 edges across all ten edge types,
// five clear communities (product, go-to-market, AI systems, personal,
// ministry) with a few bridges between them, `createdAt` / `validAt` spread
// over 12 months, and a slice of SUPERSEDED / ARCHIVED memories so the
// timeline's hollow glyphs have something to show. Pure and seeded: the same
// seed always yields the same graph, so screenshots are comparable run to run.

export const FIXTURE_NOW = Date.parse('2026-10-20T12:00:00.000Z');
const YEAR_MS = 365 * 86_400_000;

/** mulberry32 — small, fast, deterministic. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMUNITIES = [
  {
    key: 'product', domain: 'business', tag: 'product',
    goal: 'Launch BoardRoom v1 to 100 paying founders',
    projects: ['Decision Lab v2', 'Memory Explorer', 'Knowledge Graph', 'Onboarding bootstrap', 'Billing & plans', 'Persona runtime'],
    people: ['Maya Chen', 'Luis Ortega', 'Priya Natarajan', 'Tom Baker', 'Ingrid Solberg', 'Dev Patel', 'Sofia Marin'],
    taskVerbs: ['Ship', 'Refactor', 'Instrument', 'Design', 'Test', 'Document'],
    nouns: ['SSE streaming', 'debate ledger', 'outcome review modal', 'calibration chart', 'prompt cache', 'spotlight search', 'entity picker', 'reflection capsules', 'hybrid ranker', 'graph timeline'],
    memoryThemes: ['Founders churn when the first session takes over 4 minutes', 'Haiku handles extraction at a tenth of the cost', 'Users ask for a "why" behind every CEO synthesis', 'Prompt caching cut p95 latency by 38%', 'The graph page is the most-shared screenshot', 'Local-first graph tested better than the global hairball'],
  },
  {
    key: 'gtm', domain: 'business', tag: 'go-to-market',
    goal: 'Reach $25k MRR from indie founders and consultants',
    projects: ['Founder newsletter', 'Consultant partner program', 'Pricing experiment', 'Launch on Product Hunt', 'Case studies'],
    people: ['Ava Rhodes', 'Ben Okafor', 'Clara Jensen', 'Dmitri Volkov', 'Elena Costa', 'Farid Haddad'],
    taskVerbs: ['Draft', 'Send', 'Interview', 'Publish', 'Negotiate', 'Review'],
    nouns: ['pricing page', 'partner deck', 'founder interviews', 'launch thread', 'testimonial video', 'annual plan offer', 'referral loop', 'webinar series'],
    memoryThemes: ['Consultants pay for the memory, founders pay for the personas', 'Annual plans convert 2× when framed as a retainer', 'Product Hunt traffic converts poorly without onboarding', 'Partners want white-label exports', 'The newsletter drives most trial sign-ups'],
  },
  {
    key: 'ai', domain: 'ai-systems', tag: 'ai-systems',
    goal: 'Run a trustworthy memory layer every agent can share',
    projects: ['OmniMind MCP gateway', 'Retrieval eval harness', 'Fact extractor', 'Contradiction detection', 'Backup & restore'],
    people: ['Noor Siddiqui', 'Owen Blake', 'Ravi Menon', 'Zoe Lindqvist', 'Kenji Watanabe'],
    taskVerbs: ['Benchmark', 'Harden', 'Migrate', 'Audit', 'Wire', 'Tune'],
    nouns: ['pgvector index', 'trigram layer', 'scope enforcement', 'token introspection', 'idempotency keys', 'bitemporal validity', 'reflection job', 'OTel traces', 'agent keys'],
    memoryThemes: ['Hybrid recall@10 sits at 0.52 against a 0.5 gate', 'Ministry embeddings must stay local — no OpenAI fallback', 'The gateway identity is the ceiling for every token', 'Async extraction keeps memory_write under 10 s', 'Supersede-with-provenance beats delete'],
  },
  {
    key: 'personal', domain: 'personal', tag: 'personal',
    goal: 'Sabbath rhythm: one full rest day a week',
    projects: ['Morning routine', 'Family calendar', 'Marathon training'],
    people: ['Hannah', 'Grace', 'Jonah', 'Dr. Alvarez', 'Coach Ruiz'],
    taskVerbs: ['Plan', 'Book', 'Schedule', 'Prepare', 'Call'],
    nouns: ['long run', 'date night', 'school pickup rota', 'quarterly reflection', 'sleep tracker', 'budget review'],
    memoryThemes: ['Rest days make the next week measurably sharper', 'Training before 7am is the only slot that survives', 'Hannah prefers decisions written down before discussing them', 'Sunday evenings are for the family calendar'],
  },
  {
    key: 'ministry', domain: 'ministry', tag: 'ministry',
    goal: 'Grow small groups from 6 to 12 by spring',
    projects: ['Small group leader pipeline', 'Youth mentoring', 'Easter outreach', 'Benevolence fund'],
    people: ['Pastor Will', 'Deacon Rose', 'Marcus Lee', 'Tamara Osei', 'Eli Brandt', 'Ruth Okonkwo'],
    taskVerbs: ['Recruit', 'Train', 'Host', 'Visit', 'Organise'],
    nouns: ['leader retreat', 'host homes', 'mentoring pairs', 'outreach budget', 'prayer list', 'visitation rota'],
    memoryThemes: ['Groups that eat together retain members', 'Leaders need a co-leader before they launch', 'Youth attendance doubles when parents are invited', 'The benevolence fund needs a second signer'],
  },
];

const STATUS_FOR = {
  task: ['pending', 'in_progress', 'done', 'blocked'],
  decision: ['DECIDED', 'DECIDED', 'DECIDED', 'REVIEWED'],
  commitment: ['OPEN', 'OPEN', 'FULFILLED', 'OVERDUE'],
};

/**
 * Build the fixture graph.
 * @param {number} seed
 * @returns {{ graph: import('@boardroom/shared').KnowledgeGraph, memories: object[], communities: Map<string, string> }}
 */
export function buildGraph(seed = 7) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const iso = (ms) => new Date(ms).toISOString();
  /** A date in the last 12 months, biased so recent months are busier. */
  const when = (bias = 0.5) => {
    const t = Math.pow(r(), 1 + bias); // 0 = now, 1 = a year ago
    return FIXTURE_NOW - t * YEAR_MS;
  };

  const nodes = [];
  const edges = [];
  const edgeIds = new Set();
  const communityOf = new Map();
  const memories = [];

  const add = (type, refId, label, extra) => {
    const id = `${type}:${refId}`;
    nodes.push({ id, type, refId, label, domain: null, status: null, importance: null, createdAt: iso(when()), meta: {}, ...extra });
    return id;
  };
  const link = (type, source, target, label = null) => {
    const id = `${type}:${source}->${target}`;
    if (edgeIds.has(id) || source === target) return;
    edgeIds.add(id);
    edges.push({ id, source, target, type, label });
  };

  // ── Root goal + one goal per community ───────────────────────────────────
  const root = add('goal', 'g-root', 'Build a decision-intelligence company that funds the mission', { domain: 'business', status: 'active', meta: { level: 0 }, createdAt: iso(FIXTURE_NOW - YEAR_MS * 0.98) });
  communityOf.set(root, 'product');

  const byCommunity = {};
  COMMUNITIES.forEach((c, ci) => {
    const b = { goal: null, projects: [], people: [], tasks: [], decisions: [], commitments: [], memories: [], entities: [] };
    byCommunity[c.key] = b;
    b.goal = add('goal', `g-${c.key}`, c.goal, { domain: c.domain, status: 'active', meta: { level: 1 }, createdAt: iso(FIXTURE_NOW - YEAR_MS * (0.9 - ci * 0.05)) });
    communityOf.set(b.goal, c.key);
    link('goal_hierarchy', b.goal, root);
    // a sub-goal per community (second hierarchy level)
    const sub = add('goal', `g-${c.key}-q4`, `Q4 milestone: ${c.projects[0]}`, { domain: c.domain, status: 'active', meta: { level: 2 } });
    communityOf.set(sub, c.key);
    link('goal_hierarchy', sub, b.goal);

    c.projects.forEach((title, pi) => {
      const id = add('project', `p-${c.key}-${pi}`, title, { domain: c.domain, status: pi === c.projects.length - 1 ? 'planned' : 'active', meta: { priority: pi < 2 ? 'high' : 'normal' } });
      communityOf.set(id, c.key);
      b.projects.push(id);
      link('goal_project', pi === 0 ? sub : b.goal, id);
    });
    c.people.forEach((name, pi) => {
      const id = add('person', `h-${c.key}-${pi}`, name, { domain: c.domain, importance: Math.round((0.35 + r() * 0.6) * 100) / 100, meta: { role: pi === 0 ? 'lead' : pick(['engineer', 'advisor', 'partner', 'customer', 'volunteer']) } });
      communityOf.set(id, c.key);
      b.people.push(id);
      // each person works on 1–3 projects of their community
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) link('project_person', pick(b.projects), id, pick(['owner', 'contributor', 'reviewer', 'stakeholder']));
    });
    // tasks: 2–3 per project
    c.projects.forEach((_, pi) => {
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const title = `${pick(c.taskVerbs)} ${pick(c.nouns)}`;
        const id = add('task', `t-${c.key}-${pi}-${k}`, title, { domain: c.domain, status: pick(STATUS_FOR.task), meta: { priority: Math.ceil(r() * 3) } });
        communityOf.set(id, c.key);
        b.tasks.push(id);
        link('project_task', b.projects[pi], id);
      }
    });
    // task dependencies inside the community
    for (let k = 0; k < Math.max(3, Math.floor(b.tasks.length * 0.45)); k++) link('task_dependency', pick(b.tasks), pick(b.tasks));
    // decisions: 1 per project (+1 for the big ones)
    c.projects.forEach((title, pi) => {
      const n = pi < 2 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const id = add('decision', `d-${c.key}-${pi}-${k}`, `${pick(['Adopt', 'Defer', 'Cut', 'Double down on', 'Pilot'])} ${pick(c.nouns)} for ${title}`, { domain: c.domain, status: pick(STATUS_FOR.decision), meta: { sessionId: `s-${c.key}-${pi}-${k}`, mode: pick(['decide', 'stress-test', 'plan']) } });
        communityOf.set(id, c.key);
        b.decisions.push(id);
        link('decision_project', id, b.projects[pi]);
      }
    });
    // commitments: ~1 per person
    c.people.forEach((name, pi) => {
      if (r() < 0.2) return;
      const id = add('commitment', `c-${c.key}-${pi}`, `${pick(['Send', 'Review', 'Deliver', 'Intro to', 'Follow up on'])} ${pick(c.nouns)} with ${name.split(' ')[0]}`, { domain: c.domain, status: pick(STATUS_FOR.commitment), meta: { dueAt: iso(FIXTURE_NOW + (r() - 0.3) * 30 * 86_400_000) } });
      communityOf.set(id, c.key);
      b.commitments.push(id);
      link('commitment_person', id, b.people[pi]);
      if (r() < 0.7) link('commitment_project', id, pick(b.projects));
      if (r() < 0.4) link('commitment_entity', id, pick(b.tasks), 'task');
    });
    b.entities = [...b.projects, ...b.people, ...b.tasks, ...b.decisions, b.goal];
  });

  // ── Bridges between communities (people who span, decisions that touch two projects) ─
  const bridge = (a, bKey) => {
    const pa = byCommunity[a]; const pb = byCommunity[bKey];
    link('project_person', pick(pb.projects), pa.people[0], 'advisor');
    link('decision_project', pick(pa.decisions), pick(pb.projects));
  };
  bridge('product', 'gtm'); bridge('product', 'ai'); bridge('ai', 'product'); bridge('gtm', 'product');
  bridge('personal', 'ministry'); bridge('ministry', 'personal'); bridge('product', 'personal');

  // ── Memories: ~180, 2–3 links each mostly inside the community ─────────────
  const CLASSES = ['SEMANTIC', 'SEMANTIC', 'EPISODIC', 'PROCEDURAL', 'DECISION'];
  const TAGS = ['insight', 'customer', 'risk', 'metric', 'process', 'quote'];
  let mi = 0;
  const target = 180;
  while (mi < target) {
    const c = COMMUNITIES[mi % COMMUNITIES.length];
    const b = byCommunity[c.key];
    const theme = c.memoryThemes[Math.floor(r() * c.memoryThemes.length)];
    const variant = pick(['', ' — follow-up', ' (customer call)', ' (retro)', ' — data point', ' (session note)']);
    const title = `${theme}${variant}`;
    const createdMs = when(0.6);
    const validMs = createdMs - r() * 10 * 86_400_000;
    const roll = r();
    const status = roll < 0.1 ? 'SUPERSEDED' : roll < 0.15 ? 'ARCHIVED' : roll < 0.3 ? 'CONFIRMED' : 'ACTIVE';
    const invalidMs = status === 'SUPERSEDED' || status === 'ARCHIVED' ? Math.min(FIXTURE_NOW, validMs + (20 + r() * 120) * 86_400_000) : null;
    const importance = Math.round((0.2 + r() * 0.8) * 100) / 100;
    const refId = `m-${String(mi + 1).padStart(3, '0')}`;
    const content = `${theme}. Captured during ${pick(['a founder call', 'a board session', 'a retro', 'a weekly memo', 'an inbox sweep', 'a planning session'])}; ${pick(['confidence is high', 'needs a second source', 'contradicts an earlier note', 'drives the current roadmap', 'worth revisiting next quarter'])}. Tagged ${c.tag}.`;
    const memory = {
      id: refId,
      userId: 'u-josh',
      title,
      content,
      domain: c.domain,
      sector: c.tag,
      tags: [c.tag, pick(TAGS), ...(r() < 0.3 ? [pick(TAGS)] : [])],
      memoryClass: pick(CLASSES),
      importance,
      confidence: pick(['HIGH', 'HIGH', 'MEDIUM', 'LOW']),
      status,
      validAt: iso(validMs),
      invalidAt: invalidMs === null ? null : iso(invalidMs),
      supersededBy: status === 'SUPERSEDED' ? `m-${String(((mi + 7) % target) + 1).padStart(3, '0')}` : null,
      sourceType: pick(['SESSION', 'MANUAL', 'EMAIL', 'AGENT']),
      sourceRef: null,
      sourceWeight: 1,
      version: 1,
      metadata: {},
      createdAt: iso(createdMs),
      updatedAt: iso(createdMs),
      lastAccessedAt: null,
      agentId: pick(['boardroom-ai', 'boardroom-ai', 'mcp-token:claude-code']),
      tenantId: c.domain === 'ministry' ? 'tgfc-ministry' : c.domain === 'personal' ? 'josh-personal' : 'josh-business',
    };
    memories.push(memory);
    const id = add('memory', refId, title, { domain: c.domain, status, importance, createdAt: iso(createdMs), meta: { memoryClass: memory.memoryClass, validAt: memory.validAt, invalidAt: memory.invalidAt } });
    communityOf.set(id, c.key);
    b.memories.push(id);
    const n = 2 + (r() < 0.35 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const cross = r() < 0.1;
      const pool = cross ? byCommunity[pick(COMMUNITIES).key].entities : b.entities;
      link('memory_entity', id, pick(pool), pick(['mentions', 'about', 'evidence_for', 'mentions']));
    }
    mi += 1;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const nodeCounts = { goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0 };
  for (const n of nodes) nodeCounts[n.type] += 1;
  const linked = new Set();
  for (const e of edges) { linked.add(e.source); linked.add(e.target); }
  const graph = {
    nodes,
    edges,
    stats: { nodeCounts, edgeCount: edges.length, isolatedNodes: nodes.filter((n) => !linked.has(n.id)).length, memoryLimitHit: false },
    generatedAt: iso(FIXTURE_NOW),
  };
  return { graph, memories, communities: communityOf };
}

/** Cheap relevance for the mock hybrid search: token overlap on title + content + tags. */
export function scoreMemory(memory, query) {
  const q = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (q.length === 0) return 0;
  const hay = `${memory.title} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
  let hits = 0;
  for (const t of q) if (hay.includes(t)) hits += 1;
  if (hits === 0) return 0;
  return Math.min(0.99, 0.35 + (hits / q.length) * 0.5 + memory.importance * 0.14);
}
