import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeDomain } from '../lib/memory-crypto';

/**
 * Phase 6 (A2) — "unlinked mentions" (Obsidian-style).
 *
 * A memory whose title or content names a Person (name ≥3 chars), Project or
 * Goal (title) but has no MemoryEntityLink to that entity. One SQL pass:
 *
 *   newest 500 live memories of the user (tenant-scoped when an agent
 *   context is present)  ×  candidate entities (VALUES list)
 *   matched with a word-boundary, case-insensitive regex (`~*` + `\m…\M`)
 *   minus pairs that already have a MemoryEntityLink (compared on
 *   `lower(entity_type)` so legacy mixed-case rows still count — R-O-13).
 *
 * Ministry rows match on `title` only: their `content` column holds the
 * encryption placeholder / ciphertext (O-111), never plaintext, so the SQL
 * blanks it and the snippet is title-only.
 */

export const UNLINKED_MENTIONS_MAX_LIMIT = 200;
export const UNLINKED_MENTIONS_DEFAULT_LIMIT = 50;
/** Only the newest N memories are scanned — keeps the regex join bounded. */
export const UNLINKED_MENTIONS_MEMORY_WINDOW = 500;
/** Candidate entities per request (people + projects + goals), newest first. */
const MAX_CANDIDATES = 400;
const MIN_LABEL_LENGTH = 3;
const SNIPPET_MAX = 160;

export type MentionEntityType = 'person' | 'project' | 'goal';

export interface UnlinkedMention {
  memoryId: string;
  memoryTitle: string;
  entityType: MentionEntityType;
  entityId: string;
  entityLabel: string;
  snippet: string;
}

export interface UnlinkedMentionsOptions {
  limit?: number;
  /** Tenant scope for memories (agent context). Absent → all of the user's memories. */
  tenantId?: string;
}

interface Candidate { entityType: MentionEntityType; entityId: string; label: string; pattern: string }

interface MentionRow {
  memory_id: string;
  memory_title: string;
  domain: string;
  content: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
}

/** Escape every POSIX ARE metacharacter so an entity label is matched literally. */
export function escapeRegex(s: string): string {
  return s.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/**
 * Word-boundary, case-insensitive (`~*`) pattern for a label. Runs of
 * whitespace in the label match any whitespace in the text.
 */
export function mentionPattern(label: string): string {
  const escaped = escapeRegex(label.trim()).replace(/\s+/g, '\\s+');
  return `\\m${escaped}\\M`;
}

/** JS mirror of the SQL regex, used to cut the snippet around the match. */
function jsMentionRegex(label: string): RegExp {
  const escaped = label.trim().replace(/[\\^$.|?*+()[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/**
 * ≤160-char window around the first match of `label` in `text` (title first,
 * then content). Falls back to the start of the title when no JS match is
 * found (SQL and JS word-boundary semantics differ at the edges).
 */
export function buildSnippet(title: string, content: string, label: string, max = SNIPPET_MAX): string {
  const re = jsMentionRegex(label);
  for (const text of [title, content]) {
    if (!text) continue;
    const m = re.exec(text);
    if (!m) continue;
    const half = Math.floor((max - m[0].length) / 2);
    let start = Math.max(0, m.index - half);
    let end = Math.min(text.length, start + max);
    if (end - start < max) start = Math.max(0, end - max);
    let out = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) out = `…${out}`;
    if (end < text.length) out = `${out}…`;
    return out.length > max + 2 ? out.slice(0, max + 1) + '…' : out;
  }
  const t = title.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function loadCandidates(userId: string, prisma: PrismaClient): Promise<Candidate[]> {
  const alive = { userId, deletedAt: null } as const;
  const [people, projects, goals] = await Promise.all([
    prisma.person.findMany({ where: alive, select: { id: true, name: true }, orderBy: { createdAt: 'desc' }, take: MAX_CANDIDATES }),
    prisma.project.findMany({ where: alive, select: { id: true, title: true }, orderBy: { createdAt: 'desc' }, take: MAX_CANDIDATES }),
    prisma.goal.findMany({ where: alive, select: { id: true, title: true }, orderBy: { createdAt: 'desc' }, take: MAX_CANDIDATES }),
  ]);

  const out: Candidate[] = [];
  const push = (entityType: MentionEntityType, entityId: string, raw: string) => {
    const label = raw.trim();
    if (label.length < MIN_LABEL_LENGTH) return;
    out.push({ entityType, entityId, label, pattern: mentionPattern(label) });
  };
  for (const p of people) push('person', p.id, p.name);
  for (const p of projects) push('project', p.id, p.title);
  for (const g of goals) push('goal', g.id, g.title);
  return out.slice(0, MAX_CANDIDATES);
}

export async function findUnlinkedMentions(
  userId: string,
  opts: UnlinkedMentionsOptions,
  prisma: PrismaClient,
): Promise<{ items: UnlinkedMention[] }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? UNLINKED_MENTIONS_DEFAULT_LIMIT), 1), UNLINKED_MENTIONS_MAX_LIMIT);
  const candidates = await loadCandidates(userId, prisma);
  if (candidates.length === 0) return { items: [] };

  const values = Prisma.join(
    candidates.map(c => Prisma.sql`(${c.entityType}::text, ${c.entityId}::text, ${c.label}::text, ${c.pattern}::text)`),
  );
  const tenantFilter = opts.tenantId ? Prisma.sql`AND tenant_id = ${opts.tenantId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<MentionRow[]>`
    WITH cands(entity_type, entity_id, entity_label, pattern) AS (VALUES ${values}),
    recent AS (
      SELECT id, title, domain, content, created_at
      FROM memory_entries
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
        AND status <> 'ARCHIVED'
        ${tenantFilter}
      ORDER BY created_at DESC
      LIMIT ${UNLINKED_MENTIONS_MEMORY_WINDOW}
    )
    SELECT m.id AS memory_id,
           m.title AS memory_title,
           m.domain,
           CASE WHEN lower(m.domain) = 'ministry' THEN '' ELSE m.content END AS content,
           c.entity_type, c.entity_id, c.entity_label
    FROM recent m
    JOIN cands c
      ON (m.title ~* c.pattern OR (lower(m.domain) <> 'ministry' AND m.content ~* c.pattern))
    WHERE NOT EXISTS (
      SELECT 1 FROM memory_entity_links l
      WHERE l.memory_id = m.id AND lower(l.entity_type) = c.entity_type AND l.entity_id = c.entity_id
    )
    ORDER BY m.created_at DESC, c.entity_type, c.entity_label
    LIMIT ${limit}
  `;

  const items: UnlinkedMention[] = rows.map(r => {
    const ministry = normalizeDomain(r.domain) === 'ministry';
    return {
      memoryId: r.memory_id,
      memoryTitle: r.memory_title,
      entityType: r.entity_type as MentionEntityType,
      entityId: r.entity_id,
      entityLabel: r.entity_label,
      snippet: buildSnippet(r.memory_title, ministry ? '' : r.content, r.entity_label),
    };
  });
  return { items };
}

// ── Link one mention ────────────────────────────────────────────────────────

export type LinkableEntityType = 'person' | 'project' | 'goal' | 'task' | 'decision' | 'commitment';
export const LINKABLE_ENTITY_TYPES: readonly LinkableEntityType[] = ['person', 'project', 'goal', 'task', 'decision', 'commitment'];

export interface LinkMentionInput {
  memoryId: string;
  entityType: LinkableEntityType;
  entityId: string;
}

export type LinkMentionResult =
  | { ok: true; created: boolean; link: { id: string; memoryId: string; entityType: string; entityId: string; linkType: string } }
  | { ok: false; reason: 'memory_not_found' | 'entity_not_found' };

/** R-O-13: every entity type the legacy `POST /memories/:id/links` route accepts (lower-cased). */
export type LegacyLinkEntityType = LinkableEntityType | 'memory';
export const LEGACY_LINK_ENTITY_TYPES: readonly LegacyLinkEntityType[] = [...LINKABLE_ENTITY_TYPES, 'memory'];

/** Lower-case + validate a caller-supplied entityType; null when unknown. */
export function normalizeLinkEntityType(raw: unknown): LegacyLinkEntityType | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  return (LEGACY_LINK_ENTITY_TYPES as readonly string[]).includes(t) ? (t as LegacyLinkEntityType) : null;
}

/** True when the entity is the user's and live. Exported so the legacy links route reuses one lookup (R-O-13). */
export async function entityExists(prisma: PrismaClient, userId: string, type: LegacyLinkEntityType, id: string): Promise<boolean> {
  const where = { id, userId, deletedAt: null } as const;
  const select = { id: true } as const;
  switch (type) {
    case 'person': return !!(await prisma.person.findFirst({ where, select }));
    case 'project': return !!(await prisma.project.findFirst({ where, select }));
    case 'goal': return !!(await prisma.goal.findFirst({ where, select }));
    case 'task': return !!(await prisma.task.findFirst({ where, select }));
    case 'decision': return !!(await prisma.decision.findFirst({ where, select }));
    case 'commitment': return !!(await prisma.commitment.findFirst({ where, select }));
    case 'memory': return !!(await prisma.memoryEntry.findFirst({ where, select }));
    default: return false;
  }
}

/**
 * Creates the `relates_to` MemoryEntityLink for an unlinked mention. The memory
 * must be the user's (and in the agent's tenant when present); the entity must
 * be the user's and live. Idempotent on the link's unique tuple.
 */
export async function linkMention(
  userId: string,
  input: LinkMentionInput,
  opts: { tenantId?: string },
  prisma: PrismaClient,
): Promise<LinkMentionResult> {
  const memory = await prisma.memoryEntry.findFirst({
    where: { id: input.memoryId, userId, deletedAt: null, ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) },
    select: { id: true },
  });
  if (!memory) return { ok: false, reason: 'memory_not_found' };
  if (!(await entityExists(prisma, userId, input.entityType, input.entityId))) return { ok: false, reason: 'entity_not_found' };

  const linkType = 'relates_to';
  const key = { memoryId: input.memoryId, entityType: input.entityType, entityId: input.entityId, linkType };
  const existing = await prisma.memoryEntityLink.findUnique({ where: { memoryId_entityType_entityId_linkType: key } });
  if (existing) return { ok: true, created: false, link: existing };

  const link = await prisma.memoryEntityLink.upsert({
    where: { memoryId_entityType_entityId_linkType: key },
    create: key,
    update: {},
  });
  return { ok: true, created: true, link };
}
