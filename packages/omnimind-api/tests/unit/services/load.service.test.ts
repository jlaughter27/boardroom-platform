/**
 * RD-11 — load check: loadLoadInput (user-scoped reads), computeLoad (pure,
 * deterministic arithmetic) and renderLoadSection (pure, timestamp-free text).
 * All titles and ids are invented.
 */
import { describe, it, expect, vi } from 'vitest';
import { COGNITIVE_LOAD } from '@boardroom/shared';
import { computeLoad, loadLoadInput, renderLoadSection, type LoadInput } from '../../../src/services/load.service';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type P = LoadInput['projects'][number];
type T = LoadInput['tasks'][number];
type C = LoadInput['commitments'][number];

const project = (id: string, domain: string, extra: Partial<P> = {}): P => ({ id, title: `Project ${id}`, status: 'active', domain, ...extra });
const link = (p: P, deleted = false) => ({ id: p.id, domain: p.domain, deleted });
const task = (id: string, links: T['projects'] = [], extra: Partial<T> = {}): T => ({ id, status: 'pending', deadline: null, projects: links, ...extra });
const commitment = (id: string, proj: C['project'] = null, deadline: Date | null = null): C => ({ id, deadline, project: proj });
const empty = (): LoadInput => ({ projects: [], tasks: [], commitments: [], awaitingReview: 0 });

/** The spec's hand-computed fixture: business 44, ministry 8, total 53 → OVER. */
function overFixture(): LoadInput {
  const biz = ['pb1', 'pb2', 'pb3', 'pb4'].map(id => project(id, 'business'));
  biz[0].title = 'Podcast relaunch';
  biz[1].title = 'Newsletter rebuild';
  biz[2].title = 'Partner portal';
  biz[3].title = 'Pricing page test';
  const min = [project('pm1', 'ministry', { title: 'Choir retreat' }), project('pm2', 'ministry', { title: 'Youth night' })];
  const commitments = Array.from({ length: 6 }, (_, i) => commitment(`c${i}`, link(biz[1 + (i % 3)]), i < 2 ? at(-DAY) : at(30 * DAY)));
  const tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`, [link(biz[1 + (i % 3)])], { deadline: i < 3 ? at(-2 * DAY) : at(20 * DAY) }));
  return { projects: [...biz, ...min], tasks, commitments, awaitingReview: 1 };
}

/** Business-only fixture from the spec's points-arithmetic case: 44 + 1 review = 45. */
function businessFixture(): LoadInput {
  const f = overFixture();
  f.projects = f.projects.filter(p => p.domain === 'business');
  return f;
}

/** N points of plain open tasks (no deadline, no links) — no flags unless N > 15. */
const pointsOf = (n: number): LoadInput => ({ ...empty(), tasks: Array.from({ length: n }, (_, i) => task(`t${String(i).padStart(3, '0')}`)) });

/** N points from projects (4 each, spread across domains so no sprawl) + tasks for the remainder. */
function pointsNoFlags(n: number): LoadInput {
  const input = empty();
  let left = n;
  let i = 0;
  while (left >= 4) { input.projects.push(project(`p${String(i).padStart(3, '0')}`, `d${i}`)); left -= 4; i += 1; }
  for (let k = 0; k < left; k++) input.tasks.push(task(`t${k}`));
  return input;
}

const shuffle = <X>(xs: X[]): X[] => {
  const out = [...xs];
  // deterministic "shuffle": reverse + rotate
  out.reverse();
  if (out.length > 2) out.push(...out.splice(0, Math.floor(out.length / 2)));
  return out;
};

describe('computeLoad — domain attribution', () => {
  it('a task takes the smallest-id non-deleted linked project domain; deleted links skipped; no link → unassigned', () => {
    const a = project('pa', 'alpha');
    const b = project('pb', 'beta');
    const z = project('p0', 'zeta');
    const s = computeLoad({
      ...empty(),
      tasks: [
        task('t1', [link(b), link(a)]),          // smallest id pa → alpha
        task('t2', [link(z, true), link(b)]),    // p0 deleted → pb → beta
        task('t3', []),                          // unassigned
        task('t4', [link(z, true)]),             // only deleted → unassigned
      ],
    }, NOW, { coverageComplete: true });
    const row = (d: string) => s.domains.find(r => r.domain === d);
    expect(row('alpha')?.openTasks).toBe(1);
    expect(row('beta')?.openTasks).toBe(1);
    expect(row('unassigned')?.openTasks).toBe(2);
    expect(row('zeta')).toBeUndefined();
  });

  it('a commitment uses its linked project domain, or unassigned if that project is deleted or missing', () => {
    const s = computeLoad({
      ...empty(),
      commitments: [
        commitment('c1', { id: 'px', domain: 'personal', deleted: false }),
        commitment('c2', { id: 'py', domain: 'personal', deleted: true }),
        commitment('c3', null),
      ],
    }, NOW);
    expect(s.domains.find(r => r.domain === 'personal')?.openCommitments).toBe(1);
    expect(s.domains.find(r => r.domain === 'unassigned')?.openCommitments).toBe(2);
  });

  it("empty project domain → 'unassigned'; ' Business ' normalizes to 'business'", () => {
    const s = computeLoad({ ...empty(), projects: [project('p1', ''), project('p2', ' Business '), project('p3', 'business')] }, NOW);
    expect(s.domains.map(r => [r.domain, r.activeProjects])).toEqual([['business', 2], ['unassigned', 1]]);
  });
});

describe('computeLoad — status normalization', () => {
  it("projects 'Paused', 'archived', 'DONE' excluded; 'planning' counted", () => {
    const s = computeLoad({
      ...empty(),
      projects: [
        project('p1', 'business', { status: 'Paused' }),
        project('p2', 'business', { status: 'archived' }),
        project('p3', 'business', { status: 'DONE' }),
        project('p4', 'business', { status: 'planning' }),
      ],
    }, NOW);
    expect(s.totals.activeProjects).toBe(1);
  });

  it("tasks 'Done', 'COMPLETED', 'cancelled' excluded; 'pending' and 'in_progress' counted", () => {
    const s = computeLoad({
      ...empty(),
      tasks: ['Done', 'COMPLETED', 'cancelled', 'pending', 'in_progress'].map((status, i) => task(`t${i}`, [], { status })),
    }, NOW);
    expect(s.totals.openTasks).toBe(2);
  });
});

describe('computeLoad — time boundaries', () => {
  it('deadline === now is not overdue; now - 1 ms is overdue (tasks and commitments)', () => {
    const s = computeLoad({
      ...empty(),
      tasks: [task('t1', [], { deadline: at(0) }), task('t2', [], { deadline: at(-1) })],
      commitments: [commitment('c1', null, at(0)), commitment('c2', null, at(-1))],
    }, NOW);
    expect(s.totals.overdueTasks).toBe(1);
    expect(s.totals.overdueCommitments).toBe(1);
  });

  it('dueThisWeek includes now and now+7d, excludes now+7d+1ms, and excludes commitments', () => {
    const s = computeLoad({
      ...empty(),
      tasks: [task('t1', [], { deadline: at(0) }), task('t2', [], { deadline: at(7 * DAY) }), task('t3', [], { deadline: at(7 * DAY + 1) }), task('t4', [], { deadline: at(-1) })],
      commitments: [commitment('c1', null, at(DAY))],
    }, NOW);
    expect(s.totals.dueThisWeek).toBe(2);
  });
});

describe('computeLoad — points arithmetic', () => {
  it('4 business projects, 6 commitments (2 overdue), 9 tasks (3 overdue) + 1 review → business 44, total 45', () => {
    const s = computeLoad(businessFixture(), NOW);
    expect(s.domains).toEqual([{ domain: 'business', activeProjects: 4, openCommitments: 6, overdueCommitments: 2, openTasks: 9, overdueTasks: 3, points: 4 * 4 + 2 * 6 + 2 * 2 + 9 + 3 }]);
    expect(s.domains[0].points).toBe(44);
    expect(s.points).toBe(45);
    expect(s.capacity).toBe(40);
    expect(s.formulaVersion).toBe(1);
  });

  it('acceptance fixture: business 44, ministry 8, total 53, OVER, flags too_many_overdue (5) + domain_sprawl (business)', () => {
    const s = computeLoad(overFixture(), NOW);
    expect(s.domains.map(r => [r.domain, r.points])).toEqual([['business', 44], ['ministry', 8]]);
    expect(s.points).toBe(53);
    expect(s.level).toBe('over');
    expect(s.flags).toEqual([
      { type: 'too_many_overdue', severity: 'critical', count: 5 },
      { type: 'domain_sprawl', severity: 'warning', count: 4, domain: 'business' },
    ]);
  });
});

describe('computeLoad — levels', () => {
  it('coverageComplete=true: 31 ok, 32 stretched, 47 stretched, 48 over; ok + any flag → stretched', () => {
    const lv = (n: number) => computeLoad(pointsNoFlags(n), NOW, { coverageComplete: true });
    expect(lv(31).flags).toEqual([]);
    expect(lv(31).level).toBe('ok');
    expect(lv(32).level).toBe('stretched');
    expect(lv(47).level).toBe('stretched');
    expect(lv(48).level).toBe('over');
    // 16 tasks = 16 points (ok band) but trips `overloaded`
    const flagged = computeLoad(pointsOf(16), NOW, { coverageComplete: true });
    expect(flagged.points).toBe(16);
    expect(flagged.level).toBe('stretched');
  });

  it('coverageComplete=false: 31 (no flags) unknown, 32 stretched, 50 over', () => {
    const lv = (n: number) => computeLoad(pointsNoFlags(n), NOW, { coverageComplete: false }).level;
    expect(lv(31)).toBe('unknown');
    expect(lv(32)).toBe('stretched');
    expect(lv(50)).toBe('over');
  });

  it('default opts follow COGNITIVE_LOAD.coverageComplete (false) — level is never ok', () => {
    expect(COGNITIVE_LOAD.coverageComplete).toBe(false);
    for (const n of [0, 1, 10, 31, 32, 48, 60]) {
      const s = computeLoad(pointsNoFlags(n), NOW);
      expect(s.coverageComplete).toBe(false);
      expect(s.level).not.toBe('ok');
    }
  });
});

describe('computeLoad — flags', () => {
  const types = (input: LoadInput) => computeLoad(input, NOW).flags;

  it('overloaded: absent at 15 open tasks, warning at 16, critical at 23', () => {
    expect(types(pointsOf(15)).find(f => f.type === 'overloaded')).toBeUndefined();
    expect(types(pointsOf(16)).find(f => f.type === 'overloaded')).toEqual({ type: 'overloaded', severity: 'warning', count: 16 });
    expect(types(pointsOf(22)).find(f => f.type === 'overloaded')?.severity).toBe('warning');
    expect(types(pointsOf(23)).find(f => f.type === 'overloaded')).toEqual({ type: 'overloaded', severity: 'critical', count: 23 });
  });

  it('too_many_overdue: appears at To+Co = 4, not at 3', () => {
    const od = (tasks: number, commits: number): LoadInput => ({
      ...empty(),
      tasks: Array.from({ length: tasks }, (_, i) => task(`t${i}`, [], { deadline: at(-DAY) })),
      commitments: Array.from({ length: commits }, (_, i) => commitment(`c${i}`, null, at(-DAY))),
    });
    expect(types(od(2, 1)).find(f => f.type === 'too_many_overdue')).toBeUndefined();
    expect(types(od(2, 2)).find(f => f.type === 'too_many_overdue')).toEqual({ type: 'too_many_overdue', severity: 'critical', count: 4 });
  });

  it('deadline_cluster: appears at 6 due this week, not at 5', () => {
    const due = (n: number): LoadInput => ({ ...empty(), tasks: Array.from({ length: n }, (_, i) => task(`t${i}`, [], { deadline: at(DAY) })) });
    expect(types(due(5)).find(f => f.type === 'deadline_cluster')).toBeUndefined();
    expect(types(due(6)).find(f => f.type === 'deadline_cluster')).toEqual({ type: 'deadline_cluster', severity: 'warning', count: 6 });
  });

  it('domain_sprawl: 4 active business projects flag; 4 unassigned do not', () => {
    const biz = types({ ...empty(), projects: [1, 2, 3, 4].map(i => project(`p${i}`, 'business')) });
    expect(biz).toEqual([{ type: 'domain_sprawl', severity: 'warning', count: 4, domain: 'business' }]);
    expect(types({ ...empty(), projects: [1, 2, 3, 4].map(i => project(`p${i}`, '')) })).toEqual([]);
    expect(types({ ...empty(), projects: [1, 2, 3].map(i => project(`p${i}`, 'business')) })).toEqual([]);
  });

  it('emission order is fixed: overloaded, too_many_overdue, deadline_cluster, then domain_sprawl by domain', () => {
    const input: LoadInput = {
      projects: [
        ...[1, 2, 3, 4].map(i => project(`pz${i}`, 'zebra')),
        ...[1, 2, 3, 4].map(i => project(`pa${i}`, 'apple')),
      ],
      tasks: [
        ...Array.from({ length: 10 }, (_, i) => task(`to${i}`, [], { deadline: at(-DAY) })),
        ...Array.from({ length: 7 }, (_, i) => task(`tw${i}`, [], { deadline: at(DAY) })),
      ],
      commitments: [],
      awaitingReview: 0,
    };
    const flags = computeLoad(input, NOW).flags;
    expect(flags.map(f => f.domain ? `${f.type}:${f.domain}` : f.type)).toEqual([
      'overloaded', 'too_many_overdue', 'deadline_cluster', 'domain_sprawl:apple', 'domain_sprawl:zebra',
    ]);
    expect(flags.map(f => f.count)).toEqual([17, 10, 7, 4, 4]);
  });
});

describe('computeLoad — stop candidates', () => {
  it('ministry and unassigned projects are excluded from candidates but counted in totals and domain rows', () => {
    const s = computeLoad({
      ...empty(),
      projects: [project('p1', 'ministry', { title: 'Choir retreat' }), project('p2', '', { title: 'Loose ends' }), project('p3', 'business', { title: 'Podcast relaunch' })],
    }, NOW);
    expect(s.stopCandidates.map(c => c.title)).toEqual(['Podcast relaunch']);
    expect(s.totals.activeProjects).toBe(3);
    expect(s.domains.map(r => r.domain).sort()).toEqual(['business', 'ministry', 'unassigned']);
  });

  it('orders by open work ascending, then title, then id; caps at 5 with omittedCandidates = eligible - 5', () => {
    const ps = [
      project('p7', 'business', { title: 'Beta' }),
      project('p2', 'business', { title: 'Alpha' }),
      project('p1', 'business', { title: 'Beta' }),
      project('p3', 'business', { title: 'Gamma' }),
      project('p4', 'business', { title: 'Delta' }),
      project('p5', 'business', { title: 'Epsilon' }),
      project('p6', 'business', { title: 'Zulu' }),
    ];
    const tasks = [task('t1', [link(ps[1])]), task('t2', [link(ps[1])]), task('t3', [link(ps[3])])]; // Alpha 2, Gamma 1
    const commitments = [commitment('c1', link(ps[4]))]; // Delta 1
    const s = computeLoad({ projects: ps, tasks, commitments, awaitingReview: 0 }, NOW);
    expect(s.stopCandidates.map(c => `${c.title}/${c.projectId}`)).toEqual(['Beta/p1', 'Beta/p7', 'Epsilon/p5', 'Zulu/p6', 'Delta/p4']);
    expect(s.omittedCandidates).toBe(2);
    expect(s.stopCandidates[4]).toEqual({ projectId: 'p4', title: 'Delta', domain: 'business', openTasks: 0, openCommitments: 1 });
  });
});

describe('computeLoad — empty user', () => {
  it('points 0, unknown under default coverage, no flags, no domains; renders (none recorded) and flags: none', () => {
    const s = computeLoad(empty(), NOW);
    expect(s.points).toBe(0);
    expect(s.level).toBe('unknown');
    expect(s.flags).toEqual([]);
    expect(s.domains).toEqual([]);
    expect(s.stopCandidates).toEqual([]);
    expect(s.omittedCandidates).toBe(0);
    const text = renderLoadSection(s, { includeCandidates: true });
    expect(text).toContain('  - (none recorded)');
    expect(text).toContain('- flags: none');
    expect(text).toContain('- level: UNKNOWN — records show 0 points (capacity 40); spare capacity cannot be confirmed');
  });
});

describe('computeLoad — determinism', () => {
  it('shuffled input deep-equals the original snapshot and renders identically', () => {
    const input = overFixture();
    input.projects.push(project('pc1', 'consulting', { title: 'Workshop deck' }), project('pc0', 'consulting', { title: 'Workshop deck' }));
    input.tasks[0].projects.push(link(input.projects[0]));
    const shuffled: LoadInput = {
      projects: shuffle(input.projects),
      tasks: shuffle(input.tasks).map(t => ({ ...t, projects: shuffle(t.projects) })),
      commitments: shuffle(input.commitments),
      awaitingReview: input.awaitingReview,
    };
    const a = computeLoad(input, NOW);
    const b = computeLoad(shuffled, NOW);
    expect(b).toEqual(a);
    expect(renderLoadSection(b, { includeCandidates: true })).toBe(renderLoadSection(a, { includeCandidates: true }));
  });
});

describe('renderLoadSection', () => {
  it('renders the exact v1 format for the acceptance fixture', () => {
    const text = renderLoadSection(computeLoad(overFixture(), NOW), { includeCandidates: true });
    expect(text).toBe([
      '## Current load (computed from your records; formula v1)',
      '- level: OVER — 53 points (capacity 40)',
      '- by domain (active projects / open commitments, overdue / open tasks, overdue / points):',
      '  - business: 4 / 6, 2 / 9, 3 / 44',
      '  - ministry: 2 / 0, 0 / 0, 0 / 8',
      '- decisions past their review date: 1',
      '- flags: too_many_overdue (5), domain_sprawl (business: 4 active projects)',
      '- not counted: tasks and commitments logged through MCP tools, so the real load is at least this',
      '- active projects you could pause (fewest open items first):',
      '  - Podcast relaunch (business; 0 open tasks, 0 open commitments)',
      '  - Newsletter rebuild (business; 3 open tasks, 2 open commitments)',
      '  - Partner portal (business; 3 open tasks, 2 open commitments)',
      '  - Pricing page test (business; 3 open tasks, 2 open commitments)',
    ].join('\n'));
  });

  it('contains no ISO timestamp and no trailing newline', () => {
    const text = renderLoadSection(computeLoad(overFixture(), NOW), { includeCandidates: true });
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text.endsWith('\n')).toBe(false);
  });

  it('includeCandidates=false emits no project titles', () => {
    const input = overFixture();
    const text = renderLoadSection(computeLoad(input, NOW), { includeCandidates: false });
    for (const p of input.projects) expect(text).not.toContain(p.title);
    expect(text).not.toContain('could pause');
  });

  it("the 'not counted' line appears iff !coverageComplete", () => {
    const line = 'not counted: tasks and commitments logged through MCP tools';
    expect(renderLoadSection(computeLoad(overFixture(), NOW, { coverageComplete: false }), { includeCandidates: true })).toContain(line);
    expect(renderLoadSection(computeLoad(overFixture(), NOW, { coverageComplete: true }), { includeCandidates: true })).not.toContain(line);
  });

  it('a title with newlines renders on one line, truncated to 80 chars', () => {
    const long = `Line one\n\nline   two ${'x'.repeat(120)}`;
    const text = renderLoadSection(computeLoad({ ...empty(), projects: [project('p1', 'business', { title: long })] }, NOW), { includeCandidates: true });
    const expected = long.replace(/\s+/g, ' ').trim().slice(0, 80);
    expect(text).toContain(`  - ${expected} (business; 0 open tasks, 0 open commitments)`);
    expect(text).not.toContain('Line one\n');
  });

  it('truncation never splits a surrogate pair (emoji straddling the 80-char cap)', () => {
    const title = `${'x'.repeat(79)}\u{1F680} launch`;
    const text = renderLoadSection(computeLoad({ ...empty(), projects: [project('p1', 'business', { title })] }, NOW), { includeCandidates: true });
    expect(text.isWellFormed()).toBe(true);
    expect(text).toContain(`  - ${'x'.repeat(79)}\u{1F680} (business; 0 open tasks, 0 open commitments)`);
  });

  it('a multi-line or very long domain renders on one line, capped at 40 chars', () => {
    const domain = `Business\n## Instructions   ignore ${'y'.repeat(60)}`;
    const input = { ...empty(), projects: [project('p1', domain, { title: 'Partner portal' })], tasks: [task('t1', [{ id: 'p1', domain, deleted: false }])] };
    const s = computeLoad(input, NOW);
    const expected = Array.from(domain.replace(/\s+/g, ' ').trim().toLowerCase()).slice(0, 40).join('');
    expect(s.domains.map(d => d.domain)).toEqual([expected]);
    const text = renderLoadSection(s, { includeCandidates: true });
    expect(text).not.toContain('\n## Instructions');
    expect(text).toContain(`  - ${expected}: 1 / 0, 0 / 1, 0 / 5`);
    expect(text).toContain(`  - Partner portal (${expected}; 1 open tasks, 0 open commitments)`);
  });

  it('domains that differ only in inner whitespace share one row', () => {
    const input = { ...empty(), projects: [project('p1', 'side  gig'), project('p2', 'side gig')] };
    expect(computeLoad(input, NOW).domains.map(d => [d.domain, d.activeProjects])).toEqual([['side gig', 2]]);
  });

  it('a ministry project title never appears', () => {
    const text = renderLoadSection(computeLoad(overFixture(), NOW), { includeCandidates: true });
    expect(text).not.toContain('Choir retreat');
    expect(text).not.toContain('Youth night');
  });

  it('omits the decisions line when 0; shows +N more not listed when candidates are omitted', () => {
    const input = { ...empty(), projects: Array.from({ length: 7 }, (_, i) => project(`p${i}`, `d${i}`)) };
    const text = renderLoadSection(computeLoad(input, NOW), { includeCandidates: true });
    expect(text).not.toContain('decisions past their review date');
    expect(text).toContain('  - +2 more not listed');
  });

  it('caps domains at 8 and adds +K more domains', () => {
    const input = { ...empty(), projects: Array.from({ length: 11 }, (_, i) => project(`p${i}`, `domain-${String(i).padStart(2, '0')}`)) };
    const text = renderLoadSection(computeLoad(input, NOW), { includeCandidates: false });
    expect(text.split('\n').filter(l => /^ {2}- domain-\d\d:/.test(l))).toHaveLength(8);
    expect(text).toContain('  - +3 more domains');
  });

  it('renders the OK / STRETCHED level lines', () => {
    expect(renderLoadSection(computeLoad(pointsNoFlags(8), NOW, { coverageComplete: true }), { includeCandidates: false })).toContain('- level: OK — 8 points (capacity 40)');
    expect(renderLoadSection(computeLoad(pointsNoFlags(33), NOW, { coverageComplete: true }), { includeCandidates: false })).toContain('- level: STRETCHED — 33 points (capacity 40)');
  });
});

describe('loadLoadInput (mocked prisma)', () => {
  function mockPrisma() {
    return {
      project: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', title: 'Podcast relaunch', status: 'active', domain: 'business', updatedAt: NOW }]) },
      task: { findMany: vi.fn().mockResolvedValue([{ id: 't1', status: 'pending', deadline: null, projectLinks: [{ project: { id: 'p1', domain: 'business', deletedAt: null } }, { project: { id: 'p0', domain: 'x', deletedAt: NOW } }] }]) },
      commitment: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', deadline: null, linkedProjectId: null, project: null }]) },
      decision: { count: vi.fn().mockResolvedValue(2) },
    } as any;
  }

  it('every read is user-scoped with deletedAt: null and no take; review count uses outcomeRating null + reviewAt lte now', async () => {
    const prisma = mockPrisma();
    const input = await loadLoadInput('user-fixture', prisma, NOW);
    for (const fn of [prisma.project.findMany, prisma.task.findMany, prisma.commitment.findMany, prisma.decision.count]) {
      expect(fn).toHaveBeenCalledTimes(1);
      const arg = fn.mock.calls[0][0];
      expect(arg.where).toMatchObject({ userId: 'user-fixture', deletedAt: null });
      expect(arg).not.toHaveProperty('take');
    }
    expect(prisma.project.findMany.mock.calls[0][0].where.status).toEqual({ notIn: [...COGNITIVE_LOAD.closedProjectStatuses] });
    expect(prisma.task.findMany.mock.calls[0][0].where.status).toEqual({ notIn: [...COGNITIVE_LOAD.closedTaskStatuses] });
    expect(prisma.commitment.findMany.mock.calls[0][0].where.status).toBe('OPEN');
    expect(prisma.decision.count.mock.calls[0][0].where).toEqual({ userId: 'user-fixture', deletedAt: null, outcomeRating: null, reviewAt: { not: null, lte: NOW } });

    expect(input).toEqual({
      projects: [{ id: 'p1', title: 'Podcast relaunch', status: 'active', domain: 'business' }],
      tasks: [{ id: 't1', status: 'pending', deadline: null, projects: [{ id: 'p1', domain: 'business', deleted: false }, { id: 'p0', domain: 'x', deleted: true }] }],
      commitments: [{ id: 'c1', deadline: null, project: null }],
      awaitingReview: 2,
    });
  });
});
