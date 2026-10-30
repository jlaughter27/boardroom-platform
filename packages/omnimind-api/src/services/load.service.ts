import type { PrismaClient } from '@prisma/client';
import { COGNITIVE_LOAD } from '@boardroom/shared';
import type {
  LoadDomainRow,
  LoadFlag,
  LoadLevel,
  LoadSnapshot,
  LoadStopCandidate,
} from '@boardroom/shared';

/**
 * RD-11 — load check (overextension governor).
 *
 * A deterministic count of the founder's open load: active projects, open and
 * overdue commitments, open and overdue tasks, and decisions past their review
 * date — grouped by domain and scored against the fixed, versioned capacity in
 * `COGNITIVE_LOAD` (formula v1). SQL reads + pure arithmetic; no LLM.
 *
 *   loadLoadInput   — 4 user-scoped Prisma reads (deletedAt: null, no `take`)
 *   computeLoad     — PURE: same (input, now, opts) → deep-equal snapshot,
 *                     independent of input array order
 *   renderLoadSection — PURE: the `## Current load` markdown, no timestamps
 *
 * Coverage: tasks and commitments logged through MCP tools are tag memories,
 * not entity rows (until M1-B1/B3), so the counts are a LOWER bound. While
 * `coverageComplete` is false the level can read STRETCHED or OVER (an
 * undercount can only understate) but never OK — it reads UNKNOWN instead.
 */

const DAY_MS = 86_400_000;
const UNASSIGNED = 'unassigned';
const MINISTRY = 'ministry';

export interface LoadInput {
  projects: Array<{ id: string; title: string; status: string; domain: string }>;
  tasks: Array<{
    id: string;
    status: string;
    deadline: Date | null;
    projects: Array<{ id: string; domain: string; deleted: boolean }>;
  }>;
  commitments: Array<{
    id: string;
    deadline: Date | null;
    project: { id: string; domain: string; deleted: boolean } | null;
  }>;
  awaitingReview: number;
}

export interface ComputeLoadOptions {
  /** Defaults to `COGNITIVE_LOAD.coverageComplete`. */
  coverageComplete?: boolean;
}

export interface RenderLoadOptions {
  /** Pause candidates carry project titles: on for the core block, off for the weekly memo. */
  includeCandidates: boolean;
}

// ── Input loader ──

export async function loadLoadInput(userId: string, prisma: PrismaClient, now: Date): Promise<LoadInput> {
  const [projects, tasks, commitments, awaitingReview] = await Promise.all([
    prisma.project.findMany({
      where: { userId, deletedAt: null, status: { notIn: [...COGNITIVE_LOAD.closedProjectStatuses] } },
      select: { id: true, title: true, status: true, domain: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, status: { notIn: [...COGNITIVE_LOAD.closedTaskStatuses] } },
      select: {
        id: true,
        status: true,
        deadline: true,
        projectLinks: { select: { project: { select: { id: true, domain: true, deletedAt: true } } } },
      },
    }),
    prisma.commitment.findMany({
      // RD-12: delegations (owedBy STAKEHOLDER) are work others owe the founder;
      // they never count toward his own load.
      where: { userId, deletedAt: null, status: 'OPEN', owedBy: 'USER' },
      select: { id: true, deadline: true, linkedProjectId: true, project: { select: { id: true, domain: true, deletedAt: true } } },
    }),
    prisma.decision.count({
      where: { userId, deletedAt: null, outcomeRating: null, reviewAt: { not: null, lte: now } },
    }),
  ]);

  return {
    projects: projects.map(p => ({ id: p.id, title: p.title, status: p.status, domain: p.domain })),
    tasks: tasks.map(t => ({
      id: t.id,
      status: t.status,
      deadline: t.deadline,
      projects: t.projectLinks.map(l => ({ id: l.project.id, domain: l.project.domain, deleted: l.project.deletedAt !== null })),
    })),
    commitments: commitments.map(c => ({
      id: c.id,
      deadline: c.deadline,
      project: c.project ? { id: c.project.id, domain: c.project.domain, deleted: c.project.deletedAt !== null } : null,
    })),
    awaitingReview,
  };
}

// ── Pure computation ──

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();
/** Longest domain label rendered into the system block (code points). */
const DOMAIN_MAX_CHARS = 40;
/** Slice by code point so a cap never leaves a lone surrogate (the Anthropic API rejects those). */
const capChars = (s: string, max: number): string => Array.from(s).slice(0, max).join('');
/** One line, lowercased, capped: a domain string is free text and lands verbatim in the cached system block. */
const normDomain = (s: string | null | undefined): string => capChars(norm(s).replace(/\s+/g, ' '), DOMAIN_MAX_CHARS) || UNASSIGNED;
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const closedProject = new Set<string>(COGNITIVE_LOAD.closedProjectStatuses);
const closedTask = new Set<string>(COGNITIVE_LOAD.closedTaskStatuses);

/** The task's primary project: the non-deleted linked project with the smallest id. */
function primaryProject(task: LoadInput['tasks'][number]): { id: string; domain: string } | null {
  const live = task.projects.filter(p => !p.deleted).sort(byId);
  return live[0] ?? null;
}

function emptyRow(domain: string): LoadDomainRow {
  return { domain, activeProjects: 0, openCommitments: 0, overdueCommitments: 0, openTasks: 0, overdueTasks: 0, points: 0 };
}

export function computeLoad(input: LoadInput, now: Date, opts: ComputeLoadOptions = {}): LoadSnapshot {
  const coverageComplete = opts.coverageComplete ?? COGNITIVE_LOAD.coverageComplete;
  const w = COGNITIVE_LOAD.weights;
  const nowMs = now.getTime();
  const weekEndMs = nowMs + 7 * DAY_MS;
  const isOverdue = (d: Date | null): boolean => d !== null && d.getTime() < nowMs;

  const rows = new Map<string, LoadDomainRow>();
  const row = (domain: string): LoadDomainRow => {
    let r = rows.get(domain);
    if (!r) { r = emptyRow(domain); rows.set(domain, r); }
    return r;
  };

  // Projects
  const activeProjects = [...input.projects].filter(p => !closedProject.has(norm(p.status))).sort(byId);
  for (const p of activeProjects) row(normDomain(p.domain)).activeProjects += 1;

  // Tasks
  const openTasks = [...input.tasks].filter(t => !closedTask.has(norm(t.status))).sort(byId);
  const tasksByProject = new Map<string, number>();
  let dueThisWeek = 0;
  for (const t of openTasks) {
    const primary = primaryProject(t);
    const r = row(primary ? normDomain(primary.domain) : UNASSIGNED);
    r.openTasks += 1;
    if (isOverdue(t.deadline)) r.overdueTasks += 1;
    if (t.deadline !== null) {
      const ms = t.deadline.getTime();
      if (ms >= nowMs && ms <= weekEndMs) dueThisWeek += 1;
    }
    if (primary) tasksByProject.set(primary.id, (tasksByProject.get(primary.id) ?? 0) + 1);
  }

  // Commitments
  const commitments = [...input.commitments].sort(byId);
  const commitmentsByProject = new Map<string, number>();
  for (const c of commitments) {
    const live = c.project && !c.project.deleted ? c.project : null;
    const r = row(live ? normDomain(live.domain) : UNASSIGNED);
    r.openCommitments += 1;
    if (isOverdue(c.deadline)) r.overdueCommitments += 1;
    if (live) commitmentsByProject.set(live.id, (commitmentsByProject.get(live.id) ?? 0) + 1);
  }

  // Points
  for (const r of rows.values()) {
    r.points = w.project * r.activeProjects
      + w.commitment * r.openCommitments
      + w.overdueCommitmentExtra * r.overdueCommitments
      + w.task * r.openTasks
      + w.overdueTaskExtra * r.overdueTasks;
  }
  const domains = [...rows.values()].sort((a, b) => b.points - a.points || (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  const sum = (k: keyof Omit<LoadDomainRow, 'domain'>): number => domains.reduce((n, r) => n + r[k], 0);
  const awaitingReview = Math.max(0, input.awaitingReview);
  const totals = {
    activeProjects: sum('activeProjects'),
    openCommitments: sum('openCommitments'),
    overdueCommitments: sum('overdueCommitments'),
    openTasks: sum('openTasks'),
    overdueTasks: sum('overdueTasks'),
    dueThisWeek,
    awaitingReview,
  };
  const points = sum('points') + w.awaitingReview * awaitingReview;

  // Flags — fixed emission order
  const flags: LoadFlag[] = [];
  const T = totals.openTasks;
  if (T > COGNITIVE_LOAD.maxActiveTasksBeforeWarning) {
    flags.push({ type: 'overloaded', severity: T > COGNITIVE_LOAD.maxActiveTasksBeforeWarning * 1.5 ? 'critical' : 'warning', count: T });
  }
  const overdue = totals.overdueTasks + totals.overdueCommitments;
  if (overdue > COGNITIVE_LOAD.maxOverdueBeforeAlert) {
    flags.push({ type: 'too_many_overdue', severity: 'critical', count: overdue });
  }
  if (dueThisWeek > COGNITIVE_LOAD.maxDeadlinesThisWeekBeforeWarning) {
    flags.push({ type: 'deadline_cluster', severity: 'warning', count: dueThisWeek });
  }
  const sprawl = domains
    .filter(r => r.domain !== UNASSIGNED && r.activeProjects > COGNITIVE_LOAD.maxActiveProjectsPerDomain)
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  for (const r of sprawl) flags.push({ type: 'domain_sprawl', severity: 'warning', count: r.activeProjects, domain: r.domain });

  // Level
  const base: LoadLevel = points >= COGNITIVE_LOAD.overAtPoints ? 'over' : points >= COGNITIVE_LOAD.stretchedAtPoints ? 'stretched' : 'ok';
  const lvl: LoadLevel = base === 'ok' && flags.length > 0 ? 'stretched' : base;
  const level: LoadLevel = lvl === 'ok' && !coverageComplete ? 'unknown' : lvl;

  // Stop candidates — active, domain-assigned, non-ministry projects; fewest open items first
  const eligible: LoadStopCandidate[] = activeProjects
    .filter(p => { const d = normDomain(p.domain); return d !== MINISTRY && d !== UNASSIGNED; })
    .map(p => ({
      projectId: p.id,
      title: p.title,
      domain: normDomain(p.domain),
      openTasks: tasksByProject.get(p.id) ?? 0,
      openCommitments: commitmentsByProject.get(p.id) ?? 0,
    }))
    .sort((a, b) =>
      (a.openTasks + a.openCommitments) - (b.openTasks + b.openCommitments)
      || a.title.localeCompare(b.title)
      || (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0));
  const stopCandidates = eligible.slice(0, COGNITIVE_LOAD.maxStopCandidates);

  return {
    formulaVersion: COGNITIVE_LOAD.formulaVersion,
    level,
    points,
    capacity: COGNITIVE_LOAD.capacityPoints,
    coverageComplete,
    totals,
    domains,
    flags,
    stopCandidates,
    omittedCandidates: eligible.length - stopCandidates.length,
  };
}

// ── Pure renderer ──

const oneLine = (t: string): string => capChars(t.replace(/\s+/g, ' ').trim(), COGNITIVE_LOAD.candidateTitleMaxChars);

function levelLine(s: LoadSnapshot): string {
  const cap = `capacity ${s.capacity}`;
  if (s.level === 'unknown') return `- level: UNKNOWN — records show ${s.points} points (${cap}); spare capacity cannot be confirmed`;
  return `- level: ${s.level.toUpperCase()} — ${s.points} points (${cap})`;
}

function flagText(f: LoadFlag): string {
  if (f.type === 'domain_sprawl') return `domain_sprawl (${f.domain}: ${f.count} active projects)`;
  return `${f.type} (${f.count})`;
}

/**
 * The `## Current load` section. Deterministic, no timestamps, no trailing
 * newline. Titles appear only in the (opt-in) pause-candidate block, and never
 * for ministry or unassigned projects.
 */
export function renderLoadSection(s: LoadSnapshot, opts: RenderLoadOptions): string {
  const lines: string[] = [
    `## Current load (computed from your records; formula v${s.formulaVersion})`,
    levelLine(s),
    '- by domain (active projects / open commitments, overdue / open tasks, overdue / points):',
  ];
  if (s.domains.length === 0) lines.push('  - (none recorded)');
  for (const d of s.domains.slice(0, COGNITIVE_LOAD.maxDomainRows)) {
    lines.push(`  - ${d.domain}: ${d.activeProjects} / ${d.openCommitments}, ${d.overdueCommitments} / ${d.openTasks}, ${d.overdueTasks} / ${d.points}`);
  }
  if (s.domains.length > COGNITIVE_LOAD.maxDomainRows) lines.push(`  - +${s.domains.length - COGNITIVE_LOAD.maxDomainRows} more domains`);
  if (s.totals.awaitingReview > 0) lines.push(`- decisions past their review date: ${s.totals.awaitingReview}`);
  lines.push(`- flags: ${s.flags.length > 0 ? s.flags.map(flagText).join(', ') : 'none'}`);
  if (!s.coverageComplete) lines.push('- not counted: tasks and commitments logged through MCP tools, so the real load is at least this');
  if (opts.includeCandidates && s.stopCandidates.length > 0) {
    lines.push('- active projects you could pause (fewest open items first):');
    for (const c of s.stopCandidates) {
      lines.push(`  - ${oneLine(c.title)} (${c.domain}; ${c.openTasks} open tasks, ${c.openCommitments} open commitments)`);
    }
    if (s.omittedCandidates > 0) lines.push(`  - +${s.omittedCandidates} more not listed`);
  }
  return lines.join('\n');
}
