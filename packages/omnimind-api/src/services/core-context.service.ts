import type { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { estimateTokens } from '@boardroom/shared';
import type { CoreContextResponse } from '@boardroom/shared';
import { logger } from '../lib/logger';

/**
 * Phase 6 — core-memory tier (research §1, contract §Core context).
 *
 * Renders UserProfile + top-N active goals (level ≤ 1, N = 8, with linked
 * project titles) + open commitments due ≤ 14 days (with person names) +
 * standing constraints into a DETERMINISTIC markdown block: sorted keys,
 * stable ordering, and **no timestamps inside the block** — BoardRoom puts it
 * in a `cache_control` system block, and any byte change busts the prefix
 * cache. Relative deadlines are therefore rendered as absolute YYYY-MM-DD
 * dates (which only change when the data changes), never as "in 3 days".
 *
 * Cached in-process for 60 s per (user, tenant); `invalidateCoreContext(userId)`
 * drops every tenant variant and is called from the goal / project /
 * commitment / profile write paths.
 */

export const CORE_CONTEXT_MAX_GOALS = 8;
export const CORE_CONTEXT_COMMITMENT_HORIZON_DAYS = 14;
const TTL_MS = parseInt(process.env.CORE_CONTEXT_TTL_MS ?? '60000', 10);

export interface CoreContextGoal {
  id: string;
  title: string;
  level: number;
  status: string;
  /** YYYY-MM-DD or null */
  deadline: string | null;
  domain: string;
  projects: string[];
}

export interface CoreContextCommitment {
  id: string;
  description: string;
  /** YYYY-MM-DD or null */
  deadline: string | null;
  personName: string | null;
}

export interface CoreContextProfile {
  role: string | null;
  industry: string | null;
  decisionFrequency: string | null;
  riskProfile: Record<string, number>;
  valueHierarchy: string[];
}

export interface CoreContextInput {
  profile: CoreContextProfile | null;
  goals: CoreContextGoal[];
  commitments: CoreContextCommitment[];
  constraints: string[];
}

const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const byTitle = <T extends { title: string; id: string }>(a: T, b: T) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/**
 * Pure renderer. Same input → same string. Exported for unit tests.
 */
export function renderCoreBlock(input: CoreContextInput): string {
  const lines: string[] = ['# Core context'];

  lines.push('', '## Profile');
  if (input.profile) {
    const p = input.profile;
    const entries: Array<[string, string]> = [];
    if (p.role) entries.push(['role', p.role]);
    if (p.industry) entries.push(['industry', p.industry]);
    if (p.decisionFrequency) entries.push(['decision_frequency', p.decisionFrequency]);
    const risk = Object.keys(p.riskProfile).sort().map(k => `${k}=${Number(p.riskProfile[k]).toFixed(2)}`);
    if (risk.length > 0) entries.push(['risk_profile', risk.join(', ')]);
    if (p.valueHierarchy.length > 0) entries.push(['values', p.valueHierarchy.join(' > ')]);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) lines.push('- (no profile details yet)');
    for (const [k, v] of entries) lines.push(`- ${k}: ${v}`);
  } else {
    lines.push('- (no profile yet)');
  }

  lines.push('', `## Active goals (top ${CORE_CONTEXT_MAX_GOALS})`);
  const goals = [...input.goals].sort((a, b) => a.level - b.level || byTitle(a, b)).slice(0, CORE_CONTEXT_MAX_GOALS);
  if (goals.length === 0) lines.push('- (none)');
  for (const g of goals) {
    const meta: string[] = [`level ${g.level}`];
    if (g.domain) meta.push(g.domain);
    if (g.deadline) meta.push(`due ${g.deadline}`);
    lines.push(`- ${g.title} (${meta.join(', ')})`);
    const projects = [...g.projects].sort((a, b) => a.localeCompare(b));
    if (projects.length > 0) lines.push(`  - projects: ${projects.join('; ')}`);
  }

  lines.push('', `## Open commitments (due within ${CORE_CONTEXT_COMMITMENT_HORIZON_DAYS} days)`);
  const commitments = [...input.commitments].sort((a, b) =>
    (a.deadline ?? '9999-99-99').localeCompare(b.deadline ?? '9999-99-99') || a.description.localeCompare(b.description) || a.id.localeCompare(b.id),
  );
  if (commitments.length === 0) lines.push('- (none)');
  for (const c of commitments) {
    const who = c.personName ? ` to ${c.personName}` : '';
    const due = c.deadline ? ` — due ${c.deadline}` : '';
    lines.push(`- ${c.description}${who}${due}`);
  }

  lines.push('', '## Standing constraints');
  const constraints = [...new Set(input.constraints.map(s => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (constraints.length === 0) lines.push('- (none recorded)');
  for (const c of constraints) lines.push(`- ${c}`);

  return lines.join('\n') + '\n';
}

export function hashBlock(block: string): string {
  return createHash('sha256').update(block).digest('hex');
}

export interface CoreContextOptions {
  /** R-O-05: agent tenant — constraint memories are scoped to it when present. */
  tenantId?: string;
}

export async function loadCoreContextInput(
  userId: string,
  prisma: PrismaClient,
  now: Date = new Date(),
  opts: CoreContextOptions = {},
): Promise<CoreContextInput> {
  const horizon = new Date(now.getTime() + CORE_CONTEXT_COMMITMENT_HORIZON_DAYS * 86_400_000);

  const [profile, goals, commitments, constraintMemories] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.goal.findMany({
      where: { userId, deletedAt: null, status: 'active', level: { lte: 1 } },
      include: { projectLinks: { include: { project: { select: { title: true, deletedAt: true, status: true } } } } },
      orderBy: [{ level: 'asc' }, { title: 'asc' }],
      take: CORE_CONTEXT_MAX_GOALS * 2, // over-fetch; renderer sorts + slices deterministically
    }),
    prisma.commitment.findMany({
      where: { userId, deletedAt: null, status: 'OPEN', deadline: { not: null, lte: horizon } },
      include: { stakeholder: { select: { name: true } } },
      orderBy: { deadline: 'asc' },
      take: 20,
    }),
    prisma.memoryEntry.findMany({
      where: {
        userId, deletedAt: null, status: { not: 'ARCHIVED' }, tags: { has: 'constraint' }, invalidAt: null, domain: { not: 'ministry' },
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
      select: { title: true },
      orderBy: { title: 'asc' },
      take: 10,
    }),
  ]);

  const riskProfile = (profile?.riskProfile && typeof profile.riskProfile === 'object' && !Array.isArray(profile.riskProfile))
    ? Object.fromEntries(Object.entries(profile.riskProfile as Record<string, unknown>).filter(([, v]) => typeof v === 'number') as Array<[string, number]>)
    : {};

  return {
    profile: profile
      ? {
          role: profile.role,
          industry: profile.industry,
          decisionFrequency: profile.decisionFrequency,
          riskProfile,
          valueHierarchy: profile.valueHierarchy,
        }
      : null,
    goals: goals.map(g => ({
      id: g.id,
      title: g.title,
      level: g.level,
      status: g.status,
      deadline: ymd(g.deadline),
      domain: g.domain,
      projects: g.projectLinks
        .filter(l => !l.project.deletedAt && l.project.status !== 'archived')
        .map(l => l.project.title),
    })),
    commitments: commitments.map(c => ({
      id: c.id,
      description: c.description,
      deadline: ymd(c.deadline),
      personName: c.stakeholder?.name ?? null,
    })),
    constraints: constraintMemories.map(m => m.title),
  };
}

// ── 60 s per-user (× tenant) cache + invalidation ──

interface CacheEntry { value: CoreContextResponse; expiresAt: number }
const cache = new Map<string, CacheEntry>();

/** R-O-05: one cache slot per (user, tenant) — a BoardRoom (no tenant) block must never be served to an agent. */
export const coreContextCacheKey = (userId: string, tenantId?: string | null): string => `${userId}:${tenantId ?? '*'}`;

export async function getCoreContext(userId: string, prisma: PrismaClient, opts: CoreContextOptions = {}): Promise<CoreContextResponse> {
  const key = coreContextCacheKey(userId, opts.tenantId);
  const hit = cache.get(key);
  const nowMs = Date.now();
  if (hit && hit.expiresAt > nowMs) return hit.value;

  const input = await loadCoreContextInput(userId, prisma, new Date(nowMs), opts);
  const block = renderCoreBlock(input);
  const value: CoreContextResponse = {
    block,
    tokensEstimate: estimateTokens(block),
    hash: hashBlock(block),
    generatedAt: new Date(nowMs).toISOString(),
  };
  cache.set(key, { value, expiresAt: nowMs + TTL_MS });
  return value;
}

/**
 * Drop every cached block for a user (all tenant variants). Called from goal /
 * project / commitment / profile write paths (routes in this lane; A2 calls it
 * from entity.service).
 */
export function invalidateCoreContext(userId: string | undefined | null): void {
  if (!userId) return;
  const prefix = `${userId}:`;
  let dropped = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix) && cache.delete(key)) dropped += 1;
  }
  if (dropped > 0) {
    logger.info('[core-context] cache invalidated', { userId, variants: dropped });
  }
}

export function __resetCoreContextCacheForTest(): void {
  cache.clear();
}
