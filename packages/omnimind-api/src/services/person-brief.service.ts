import type { PrismaClient } from '@prisma/client';
import {
  MEETING_BRIEF_CONFIG,
  normalizeName,
  nameTokens,
} from '@boardroom/shared';
import type {
  PersonBrief,
  PersonBriefCounts,
  PersonBriefDecision,
  PersonBriefMemory,
  PersonBriefTheyOwe,
  PersonBriefYouOwe,
  PersonBriefsAttendeeMatch,
  PersonBriefsRequestInput,
  PersonBriefsResponse,
  PersonBriefsTitleMatch,
} from '@boardroom/shared';
import { logger } from '../lib/logger';
import { normalizeDomain, tryDecryptMemory } from '../lib/memory-crypto';
import { getCapsules } from './reflection.service';

/**
 * RD-13 — meeting prep briefs (`POST /people/briefs`).
 *
 * Deterministic and on demand: BoardRoom sends attendee name candidates and
 * normalized event-title tokens (never e-mails or raw titles); this service
 * matches them to live `Person` rows with exact / first+last-token / title
 * tiers only (no fuzzy tier — a wrong person in a pastoral context does real
 * damage) and builds one brief per matched person from existing rows:
 * open commitments (you owe), tasks owned by them (they owe), related
 * decisions, explicitly linked memories and the nightly person capsule.
 *
 * No LLM call, nothing persisted, nothing cached. Every query is user-scoped
 * and batched over the matched people. Each section is total (D6): a failure
 * logs at error level, leaves that section empty and sets `partial: true`, so
 * one bad section can never answer 5xx and trip BoardRoom's circuit breaker.
 * Names, tokens and titles are never logged — counts only.
 */

const DAY_MS = 86_400_000;
const CFG = MEETING_BRIEF_CONFIG;

interface LivePerson {
  id: string;
  name: string;
  role: string | null;
  relationshipToUser: string | null;
  importance: number;
  lastContactAt: Date | null;
  norm: string;
  toks: string[];
}

/**
 * Whole-label, case-insensitive, Unicode-aware mention matcher: the label must
 * not touch a letter or digit on either side (`José` matches "José Ortega"
 * but not "Joséa"). Whitespace inside the label matches any whitespace run.
 * The existing ASCII `jsMentionRegex` (unlinked-mentions) is left unchanged.
 */
export function unicodeMentionRegex(label: string): RegExp {
  const escaped = label
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Template headline — e.g. "You owe Sarah 1 overdue · Sarah owes you 2 · last touch 12d ago". */
export function buildHeadline(
  name: string,
  counts: Pick<PersonBriefCounts, 'youOwe' | 'youOweOverdue' | 'theyOwe'>,
  lastInteractionAt: Date | null,
  now: Date,
): string {
  const first = name.trim().split(/\s+/)[0] || name;
  const parts: string[] = [];
  if (counts.youOweOverdue > 0) parts.push(`You owe ${first} ${counts.youOweOverdue} overdue`);
  else if (counts.youOwe > 0) parts.push(`You owe ${first} ${counts.youOwe}`);
  if (counts.theyOwe > 0) parts.push(`${first} owes you ${counts.theyOwe}`);
  if (lastInteractionAt) {
    const d = Math.max(0, Math.floor((now.getTime() - lastInteractionAt.getTime()) / DAY_MS));
    parts.push(d === 0 ? 'last touch today' : `last touch ${d}d ago`);
  } else {
    parts.push('no recorded interaction');
  }
  return parts.join(' · ');
}

function isContiguousSubsequence(needle: string[], hay: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function maxDate(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d.getTime() > best.getTime())) best = d;
  return best;
}

interface Resolution {
  attendeeMatches: PersonBriefsAttendeeMatch[];
  titleMatches: PersonBriefsTitleMatch[];
  matched: number;
  ambiguous: number;
}

/** Deterministic tiers only: exact → first+last token → title (full name, then unique first name on small meetings). */
export function resolvePeople(people: LivePerson[], body: PersonBriefsRequestInput): Resolution {
  const byNorm = new Map<string, LivePerson[]>();
  const firstFreq = new Map<string, LivePerson[]>();
  for (const p of people) {
    if (!p.norm) continue;
    byNorm.set(p.norm, [...(byNorm.get(p.norm) ?? []), p]);
    const f = p.toks[0];
    if (f) firstFreq.set(f, [...(firstFreq.get(f) ?? []), p]);
  }

  let matched = 0;
  let ambiguous = 0;
  const attendeeMatches: PersonBriefsAttendeeMatch[] = body.attendees.map(a => {
    const c = normalizeName(a.name);
    const exact = c ? byNorm.get(c) ?? [] : [];
    if (exact.length === 1) { matched += 1; return { key: a.key, personId: exact[0].id, ambiguous: false, method: 'exact' }; }
    if (exact.length > 1) { ambiguous += 1; return { key: a.key, personId: null, ambiguous: true, method: null }; }
    const ct = nameTokens(c);
    if (ct.length >= 2) {
      const first = ct[0];
      const last = ct[ct.length - 1];
      const hits = people.filter(p => p.toks.length >= 2 && p.toks[0] === first && p.toks[p.toks.length - 1] === last);
      if (hits.length === 1) { matched += 1; return { key: a.key, personId: hits[0].id, ambiguous: false, method: 'name_tokens' }; }
      if (hits.length > 1) { ambiguous += 1; return { key: a.key, personId: null, ambiguous: true, method: null }; }
    }
    return { key: a.key, personId: null, ambiguous: false, method: null };
  });

  const titleMatches: PersonBriefsTitleMatch[] = [];
  for (const e of body.events) {
    const T = e.titleTokens;
    const full = people.filter(p => p.toks.length >= 2 && isContiguousSubsequence(p.toks, T));
    const normCount = new Map<string, number>();
    for (const p of full) normCount.set(p.norm, (normCount.get(p.norm) ?? 0) + 1);
    const seen = new Set<string>();
    for (const p of full) {
      if ((normCount.get(p.norm) ?? 0) > 1 || seen.has(p.id)) continue;
      seen.add(p.id);
      titleMatches.push({ key: e.key, personId: p.id, method: 'title_full' });
    }
    if (e.smallMeeting) {
      for (const t of T) {
        if (t.length < 3) continue;
        const owners = firstFreq.get(t) ?? [];
        if (owners.length !== 1 || seen.has(owners[0].id)) continue;
        seen.add(owners[0].id);
        titleMatches.push({ key: e.key, personId: owners[0].id, method: 'title_first_name' });
      }
    }
  }

  return { attendeeMatches, titleMatches, matched, ambiguous };
}

function emptyCounts(): PersonBriefCounts {
  return { memories: 0, youOwe: 0, youOweOverdue: 0, theyOwe: 0, decisions: 0 };
}

/** Build the response for `POST /people/briefs`. Total: never throws for a section failure. */
export async function buildPersonBriefs(
  userId: string,
  body: PersonBriefsRequestInput,
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PersonBriefsResponse> {
  const started = Date.now();
  let partial = false;
  const fail = (section: string, err: unknown) => {
    partial = true;
    logger.error('[person-briefs] section failed', { userId, section, error: (err as Error)?.message });
  };

  // ── Resolution ─────────────────────────────────────────────────────────────
  let people: LivePerson[] = [];
  try {
    const rows = await prisma.person.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true, role: true, relationshipToUser: true, importance: true, lastContactAt: true },
    });
    people = rows.map(r => ({ ...r, norm: normalizeName(r.name), toks: nameTokens(r.name) }));
  } catch (err) {
    fail('people', err);
  }

  const { attendeeMatches, titleMatches, matched, ambiguous } = resolvePeople(people, body);
  const P = [...new Set([
    ...attendeeMatches.map(m => m.personId).filter((id): id is string => !!id),
    ...titleMatches.map(m => m.personId),
  ])];
  const byId = new Map(people.map(p => [p.id, p]));
  const pset = new Set(P);

  const memoriesBy = new Map<string, PersonBriefMemory[]>();
  const memoryNewest = new Map<string, Date>();
  const youOweBy = new Map<string, Array<PersonBriefYouOwe & { createdAt: Date; deadlineDate: Date | null }>>();
  const theyOweBy = new Map<string, Array<PersonBriefTheyOwe & { priority: number; deadlineDate: Date | null }>>();
  const decisionsBy = new Map<string, Map<string, PersonBriefDecision & { createdAt: Date }>>();
  const capsuleBy = new Map<string, PersonBrief['capsule']>();

  if (P.length > 0) {
    // ── recentMemories: explicitly linked only (no mention fill) ──────────────
    try {
      const links = await prisma.memoryEntityLink.findMany({
        where: {
          entityType: { equals: 'person', mode: 'insensitive' },
          entityId: { in: P },
          memory: { userId, deletedAt: null },
        },
        select: { memoryId: true, entityId: true },
      });
      const personsByMemory = new Map<string, Set<string>>();
      for (const l of links) {
        if (!pset.has(l.entityId)) continue;
        const s = personsByMemory.get(l.memoryId) ?? new Set<string>();
        s.add(l.entityId);
        personsByMemory.set(l.memoryId, s);
      }
      const ids = [...personsByMemory.keys()];
      if (ids.length > 0) {
        const rows = await prisma.memoryEntry.findMany({
          where: {
            id: { in: ids }, userId, deletedAt: null,
            status: { not: 'ARCHIVED' },
            OR: [{ invalidAt: null }, { invalidAt: { gt: now } }],
            NOT: { domain: { equals: 'ministry', mode: 'insensitive' } },
          },
          orderBy: { validAt: 'desc' },
          take: CFG.scanTake.linkedMemories,
          select: { id: true, title: true, content: true, domain: true, encryptedContent: true, validAt: true, createdAt: true },
        });
        const usable = rows
          .filter(m => normalizeDomain(m.domain) !== 'ministry')
          .map(m => tryDecryptMemory(m))
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .map(m => ({ m, at: m.validAt ?? m.createdAt }))
          .sort((a, b) => b.at.getTime() - a.at.getTime());
        for (const { m, at } of usable) {
          for (const pid of personsByMemory.get(m.id) ?? []) {
            const list = memoriesBy.get(pid) ?? [];
            list.push({ id: m.id, title: m.title, excerpt: m.content.slice(0, CFG.excerptMaxChars), at: at.toISOString() });
            memoriesBy.set(pid, list);
            if (!memoryNewest.has(pid)) memoryNewest.set(pid, at);
          }
        }
      }
    } catch (err) {
      fail('recentMemories', err);
      memoriesBy.clear();
      memoryNewest.clear();
    }

    // ── youOwe: Commitment rows only (stakeholderId = "I owe them") ────────────
    try {
      const rows = await prisma.commitment.findMany({
        where: { userId, deletedAt: null, status: 'OPEN', stakeholderId: { in: P } },
        select: { id: true, description: true, deadline: true, createdAt: true, stakeholderId: true },
      });
      for (const c of rows) {
        if (!c.stakeholderId || !pset.has(c.stakeholderId)) continue;
        const list = youOweBy.get(c.stakeholderId) ?? [];
        list.push({
          id: c.id,
          description: c.description,
          deadline: c.deadline ? c.deadline.toISOString() : null,
          overdue: c.deadline !== null && c.deadline.getTime() < now.getTime(),
          createdAt: c.createdAt,
          deadlineDate: c.deadline,
        });
        youOweBy.set(c.stakeholderId, list);
      }
      for (const list of youOweBy.values()) {
        list.sort((a, b) => {
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          const ad = a.deadlineDate?.getTime() ?? Infinity;
          const bd = b.deadlineDate?.getTime() ?? Infinity;
          if (ad !== bd) return ad - bd;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
      }
    } catch (err) {
      fail('youOwe', err);
      youOweBy.clear();
    }

    // ── theyOwe: open tasks whose free-text owner names the person ─────────────
    try {
      const rows = await prisma.task.findMany({
        where: { userId, deletedAt: null, owner: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: CFG.scanTake.tasks,
        select: { id: true, title: true, owner: true, status: true, deadline: true, priority: true },
      });
      const closed = new Set<string>(CFG.closedTaskStatuses);
      const firstCount = new Map<string, number>();
      for (const p of people) if (p.toks[0]) firstCount.set(p.toks[0], (firstCount.get(p.toks[0]) ?? 0) + 1);
      for (const t of rows) {
        if (closed.has((t.status ?? '').trim().toLowerCase())) continue;
        const ownerNorm = normalizeName(t.owner ?? '');
        if (!ownerNorm) continue;
        const ownerToks = nameTokens(ownerNorm);
        for (const pid of P) {
          const p = byId.get(pid);
          if (!p) continue;
          const hit = ownerNorm === p.norm
            || (ownerToks.length === 1 && ownerToks[0] === p.toks[0] && firstCount.get(p.toks[0]) === 1);
          if (!hit) continue;
          const list = theyOweBy.get(pid) ?? [];
          list.push({
            id: t.id, title: t.title, status: t.status,
            deadline: t.deadline ? t.deadline.toISOString() : null,
            priority: t.priority, deadlineDate: t.deadline,
          });
          theyOweBy.set(pid, list);
        }
      }
      for (const list of theyOweBy.values()) {
        list.sort((a, b) => {
          const ad = a.deadlineDate?.getTime() ?? Infinity;
          const bd = b.deadlineDate?.getTime() ?? Infinity;
          if (ad !== bd) return ad - bd;
          return b.priority - a.priority;
        });
      }
    } catch (err) {
      fail('theyOwe', err);
      theyOweBy.clear();
    }

    // ── decisions: via a live linked project, then via a full-name mention ─────
    try {
      const add = (pid: string, d: { id: string; title: string; status: string; createdAt: Date }, via: 'project' | 'mention') => {
        const m = decisionsBy.get(pid) ?? new Map<string, PersonBriefDecision & { createdAt: Date }>();
        const prev = m.get(d.id);
        if (!prev || (prev.via === 'mention' && via === 'project')) {
          m.set(d.id, { id: d.id, title: d.title, status: String(d.status), at: d.createdAt.toISOString(), via, createdAt: d.createdAt });
        }
        decisionsBy.set(pid, m);
      };

      const ppl = await prisma.projectPersonLink.findMany({
        where: { personId: { in: P }, project: { userId, deletedAt: null } },
        select: { personId: true, projectId: true },
      });
      const personsByProject = new Map<string, Set<string>>();
      for (const l of ppl) {
        const s = personsByProject.get(l.projectId) ?? new Set<string>();
        s.add(l.personId);
        personsByProject.set(l.projectId, s);
      }
      const projectIds = [...personsByProject.keys()];
      if (projectIds.length > 0) {
        const viaProject = await prisma.decision.findMany({
          where: { userId, deletedAt: null, projectLinks: { some: { projectId: { in: projectIds } } } },
          select: { id: true, title: true, status: true, createdAt: true, projectLinks: { select: { projectId: true } } },
        });
        for (const d of viaProject) {
          for (const link of d.projectLinks) {
            for (const pid of personsByProject.get(link.projectId) ?? []) add(pid, d, 'project');
          }
        }
      }

      const mentionable = P
        .map(pid => byId.get(pid))
        .filter((p): p is LivePerson => !!p && p.name.trim().length >= 3)
        .map(p => ({ id: p.id, re: unicodeMentionRegex(p.name) }));
      if (mentionable.length > 0) {
        const recent = await prisma.decision.findMany({
          where: { userId, deletedAt: null, createdAt: { gte: new Date(now.getTime() - CFG.decisionLookbackDays * DAY_MS) } },
          orderBy: { createdAt: 'desc' },
          take: CFG.scanTake.decisions,
          select: { id: true, title: true, question: true, chosenPath: true, status: true, createdAt: true },
        });
        for (const d of recent) {
          const text = `${d.title}\n${d.question}\n${d.chosenPath ?? ''}`;
          for (const { id, re } of mentionable) if (re.test(text)) add(id, d, 'mention');
        }
      }
    } catch (err) {
      fail('decisions', err);
      decisionsBy.clear();
    }

    // ── capsule: newest nightly person capsule (already Zod-validated) ─────────
    try {
      const capsules = await getCapsules(userId, P.map(id => ({ entityType: 'person' as const, entityId: id })), prisma);
      for (const c of capsules) {
        if (capsuleBy.has(c.entityId)) continue; // ordered generatedAt desc → first is newest
        capsuleBy.set(c.entityId, {
          summary: c.summary.slice(0, CFG.capsuleMaxChars),
          generatedAt: c.generatedAt.toISOString(),
          stale: c.staleAfter.getTime() < now.getTime(),
        });
      }
    } catch (err) {
      fail('capsule', err);
      capsuleBy.clear();
    }
  }

  // ── Assemble ────────────────────────────────────────────────────────────────
  const briefs: Record<string, PersonBrief> = {};
  for (const pid of P) {
    const p = byId.get(pid);
    if (!p) continue;
    const memories = memoriesBy.get(pid) ?? [];
    const youOwe = youOweBy.get(pid) ?? [];
    const theyOwe = theyOweBy.get(pid) ?? [];
    const decisions = [...(decisionsBy.get(pid)?.values() ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const counts: PersonBriefCounts = {
      ...emptyCounts(),
      memories: memories.length,
      youOwe: youOwe.length,
      youOweOverdue: youOwe.filter(c => c.overdue).length,
      theyOwe: theyOwe.length,
      decisions: decisions.length,
    };
    const newestCommitment = youOwe.reduce<Date | null>((best, c) => maxDate(best, c.createdAt), null);
    const lastInteraction = maxDate(p.lastContactAt, memoryNewest.get(pid), newestCommitment);
    briefs[pid] = {
      personId: pid,
      name: p.name,
      role: p.role,
      relationshipToUser: p.relationshipToUser,
      headline: buildHeadline(p.name, counts, lastInteraction, now),
      lastInteractionAt: lastInteraction ? lastInteraction.toISOString() : null,
      capsule: capsuleBy.get(pid) ?? null,
      recentMemories: memories.slice(0, CFG.caps.memories),
      youOwe: youOwe.slice(0, CFG.caps.youOwe).map(({ id, description, deadline, overdue }) => ({ id, description, deadline, overdue })),
      theyOwe: theyOwe.slice(0, CFG.caps.theyOwe).map(({ id, title, deadline, status }) => ({ id, title, deadline, status })),
      decisions: decisions.slice(0, CFG.caps.decisions).map(({ id, title, status, at, via }) => ({ id, title, status, at, via })),
      counts,
    };
  }

  logger.info('[person-briefs] built', {
    userId,
    attendees: body.attendees.length,
    events: body.events.length,
    matched,
    ambiguous,
    titleMatched: titleMatches.length,
    people: P.length,
    partial,
    ms: Date.now() - started,
  });

  return { generatedAt: now.toISOString(), partial, attendeeMatches, titleMatches, briefs };
}

/** Route-level fallback when something escapes the service (D6): 200, partial, no briefs. */
export function emptyPersonBriefs(body: Pick<PersonBriefsRequestInput, 'attendees'>, now: Date = new Date()): PersonBriefsResponse {
  return {
    generatedAt: now.toISOString(),
    partial: true,
    attendeeMatches: body.attendees.map(a => ({ key: a.key, personId: null, ambiguous: false, method: null })),
    titleMatches: [],
    briefs: {},
  };
}
