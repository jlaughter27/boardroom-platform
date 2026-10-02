import type { PrismaClient, ContextCapsule } from '@prisma/client';
import { MODEL_IDS, ReflectionLLMOutputSchema } from '@boardroom/shared';
import type { ReflectableEntityType, ReflectionLLMOutput } from '@boardroom/shared';
import { logger } from '../lib/logger';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { createMessage, extractText, parseJsonFromText } from '../lib/anthropic';
import { tryDecryptMemory } from '../lib/memory-crypto';
import { HttpError } from '../middleware/error-handler';

/**
 * Phase 6 — per-entity reflection → ContextCapsule (research §1 "episodic
 * summaries → per-entity reflection job"; contract §Reflection / capsules).
 *
 * Trigger rule (generative-agents style): re-reflect an entity only when the
 * summed importance of memories linked to it since the capsule was generated
 * crosses `REFLECTION_THRESHOLD` (default 0.8). Entities without a capsule
 * reflect as soon as they have any linked activity. Cost therefore scales
 * with activity, not with entity count.
 *
 * Ministry-domain memories are excluded from the LLM input (data sovereignty:
 * their content never leaves the local boundary — same rule as embeddings).
 */

export const CAPSULE_STALE_AFTER_DAYS = 14;
export const REFLECTION_LOOKBACK_DAYS = 7;
const MAX_MEMORIES = 30;

export function reflectionThreshold(): number {
  const raw = parseFloat(process.env.REFLECTION_THRESHOLD ?? '0.8');
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.8;
}

export interface ShouldReflectArgs {
  /** Σ importance of memories linked since capsule.generatedAt (or ever, when no capsule). */
  importanceSinceCapsule: number;
  hasCapsule: boolean;
  threshold: number;
}

/** Pure threshold rule. Exported for unit tests. */
export function shouldReflect({ importanceSinceCapsule, hasCapsule, threshold }: ShouldReflectArgs): boolean {
  if (!(importanceSinceCapsule > 0)) return false;
  if (!hasCapsule) return true;
  return importanceSinceCapsule >= threshold;
}

export interface ReflectionCandidate {
  userId: string;
  entityType: ReflectableEntityType;
  entityId: string;
  importanceSum: number;
  hasCapsule: boolean;
}

interface CandidateRow {
  user_id: string;
  entity_type: string;
  entity_id: string;
  importance_sum: number | null;
  has_capsule: boolean | null;
}

/**
 * Entities with memories linked in the last `lookbackDays` whose new-memory
 * importance (since the capsule, if any) passes `shouldReflect`.
 */
export async function findReflectionCandidates(
  prisma: PrismaClient,
  opts: { lookbackDays?: number; threshold?: number; now?: Date } = {},
): Promise<ReflectionCandidate[]> {
  const now = opts.now ?? new Date();
  const threshold = opts.threshold ?? reflectionThreshold();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? REFLECTION_LOOKBACK_DAYS) * 86_400_000);

  const rows = await prisma.$queryRaw<CandidateRow[]>`
    SELECT m.user_id,
           l.entity_type,
           l.entity_id,
           SUM(m.importance)::float            AS importance_sum,
           BOOL_OR(cc.id IS NOT NULL)          AS has_capsule
    FROM memory_entity_links l
    JOIN memory_entries m ON m.id = l.memory_id
    LEFT JOIN context_capsules cc
      ON cc.user_id = m.user_id AND cc.entity_type = l.entity_type AND cc.entity_id = l.entity_id
    WHERE l.entity_type IN ('goal', 'project', 'person')
      AND m.deleted_at IS NULL
      AND m.status != 'ARCHIVED'
      AND m.domain != 'ministry'
      AND m.created_at >= ${since}
      AND (cc.generated_at IS NULL OR m.created_at > cc.generated_at)
    GROUP BY m.user_id, l.entity_type, l.entity_id
  `;

  const out: ReflectionCandidate[] = [];
  for (const r of rows) {
    const importanceSum = Number(r.importance_sum ?? 0);
    const hasCapsule = Boolean(r.has_capsule);
    if (!shouldReflect({ importanceSinceCapsule: importanceSum, hasCapsule, threshold })) {
      // Record activity on the existing capsule so the UI can show "N.N importance pending".
      if (hasCapsule) {
        void prisma.contextCapsule.updateMany({
          where: { userId: r.user_id, entityType: r.entity_type, entityId: r.entity_id },
          data: { importanceSeen: importanceSum },
        }).catch(() => { /* best-effort */ });
      }
      continue;
    }
    out.push({
      userId: r.user_id,
      entityType: r.entity_type as ReflectableEntityType,
      entityId: r.entity_id,
      importanceSum,
      hasCapsule,
    });
  }
  return out;
}

// ── Single-entity reflection ──

interface EntityHeader { title: string; detail: string }

async function loadEntityHeader(
  userId: string, entityType: ReflectableEntityType, entityId: string, prisma: PrismaClient,
): Promise<EntityHeader | null> {
  if (entityType === 'goal') {
    const g = await prisma.goal.findFirst({ where: { id: entityId, userId, deletedAt: null } });
    return g ? { title: g.title, detail: `Goal · status ${g.status} · level ${g.level}${g.deadline ? ` · due ${g.deadline.toISOString().slice(0, 10)}` : ''}${g.successMetrics.length ? ` · metrics: ${g.successMetrics.join('; ')}` : ''}` } : null;
  }
  if (entityType === 'project') {
    const p = await prisma.project.findFirst({ where: { id: entityId, userId, deletedAt: null } });
    return p ? { title: p.title, detail: `Project · status ${p.status}${p.deadline ? ` · due ${p.deadline.toISOString().slice(0, 10)}` : ''}${p.successMetrics.length ? ` · metrics: ${p.successMetrics.join('; ')}` : ''}` } : null;
  }
  const person = await prisma.person.findFirst({ where: { id: entityId, userId, deletedAt: null } });
  return person ? { title: person.name, detail: `Person${person.role ? ` · ${person.role}` : ''}${person.relationshipToUser ? ` · ${person.relationshipToUser}` : ''}${person.notes ? ` · notes: ${person.notes.slice(0, 300)}` : ''}` } : null;
}

async function loadRelated(
  userId: string, entityType: ReflectableEntityType, entityId: string, prisma: PrismaClient,
): Promise<string[]> {
  const lines: string[] = [];
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'no date');

  if (entityType === 'project') {
    const [decisions, commitments, people] = await Promise.all([
      prisma.decision.findMany({ where: { userId, deletedAt: null, projectLinks: { some: { projectId: entityId } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.commitment.findMany({ where: { userId, deletedAt: null, linkedProjectId: entityId, status: 'OPEN' }, include: { stakeholder: { select: { name: true } } }, take: 10 }),
      prisma.projectPersonLink.findMany({ where: { projectId: entityId }, include: { person: { select: { name: true, role: true, deletedAt: true } } } }),
    ]);
    for (const d of decisions) lines.push(`DECISION ${ymd(d.createdAt)} "${d.title}" status=${d.status}${d.chosenPath ? ` chosen="${d.chosenPath}"` : ''}${d.outcome ? ` outcome="${d.outcome}" (${d.outcomeRating}/5)` : ''}`);
    for (const c of commitments) lines.push(`COMMITMENT open "${c.description}"${c.stakeholder ? ` to ${c.stakeholder.name}` : ''} due ${ymd(c.deadline)}`);
    for (const l of people) if (!l.person.deletedAt) lines.push(`PERSON ${l.person.name}${l.role ? ` (${l.role})` : l.person.role ? ` (${l.person.role})` : ''}`);
  } else if (entityType === 'goal') {
    const links = await prisma.goalProjectLink.findMany({ where: { goalId: entityId }, include: { project: true } });
    for (const l of links) if (!l.project.deletedAt) lines.push(`PROJECT "${l.project.title}" status=${l.project.status}${l.project.deadline ? ` due ${ymd(l.project.deadline)}` : ''}`);
  } else {
    const [commitments, projects] = await Promise.all([
      prisma.commitment.findMany({ where: { userId, deletedAt: null, stakeholderId: entityId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.projectPersonLink.findMany({ where: { personId: entityId }, include: { project: { select: { title: true, status: true, deletedAt: true } } } }),
    ]);
    for (const c of commitments) lines.push(`COMMITMENT ${c.status} "${c.description}" due ${ymd(c.deadline)}`);
    for (const l of projects) if (!l.project.deletedAt) lines.push(`PROJECT "${l.project.title}" status=${l.project.status}${l.role ? ` role=${l.role}` : ''}`);
  }
  return lines;
}

export interface ReflectionResult {
  capsule: ContextCapsule;
  sourceMemoryIds: string[];
}

/**
 * Reflect one entity now and upsert its capsule. Throws HttpError(404) when
 * the entity is not visible to the user.
 */
export async function reflectEntity(
  userId: string,
  entityType: ReflectableEntityType,
  entityId: string,
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ContextCapsule> {
  const header = await loadEntityHeader(userId, entityType, entityId, prisma);
  if (!header) throw new HttpError(404, { code: 'not_found', message: `${entityType} not found` });

  const links = await prisma.memoryEntityLink.findMany({ where: { entityType, entityId }, select: { memoryId: true } });
  const memoryIds = links.map(l => l.memoryId);

  const rawMemories = memoryIds.length
    ? await prisma.memoryEntry.findMany({
        where: {
          id: { in: memoryIds }, userId, deletedAt: null,
          status: { not: 'ARCHIVED' },
          domain: { not: 'ministry' },
        },
        orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
        take: MAX_MEMORIES,
        select: { id: true, title: true, content: true, domain: true, encryptedContent: true, importance: true, createdAt: true, invalidAt: true, status: true },
      })
    : [];

  const memories = rawMemories
    .map(m => tryDecryptMemory(m))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const existing = await prisma.contextCapsule.findUnique({
    where: { userId_entityType_entityId: { userId, entityType, entityId } },
  });

  const related = await loadRelated(userId, entityType, entityId, prisma);

  const memoryLines = memories.map(m => {
    const flag = m.invalidAt && m.invalidAt <= now ? ' [superseded]' : m.status === 'SUPERSEDED' ? ' [superseded]' : '';
    return `- (${m.createdAt.toISOString().slice(0, 10)}, importance ${m.importance.toFixed(2)})${flag} ${m.title}: ${m.content.slice(0, 400)}`;
  });

  const userMessage = [
    `# Entity: ${header.title}`,
    header.detail,
    '',
    existing ? `## Previous capsule (${existing.generatedAt.toISOString().slice(0, 10)})\n${existing.summary}` : '## Previous capsule\n(none)',
    '',
    `## Linked memories (${memories.length}, newest first)`,
    memoryLines.length ? memoryLines.join('\n') : '(none)',
    '',
    '## Related records',
    related.length ? related.join('\n') : '(none)',
  ].join('\n');

  const response = await createMessage(
    {
      model: MODEL_IDS.haiku,
      max_tokens: 1500,
      system: [{ type: 'text', text: loadSystemPrompt('cortex-reflection'), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      output_config: { effort: 'medium' },
    },
    { purpose: 'reflection', userId },
  );

  const text = extractText(response);
  if (!text) throw new Error('Empty reflection response');
  const output: ReflectionLLMOutput = ReflectionLLMOutputSchema.parse(parseJsonFromText(text));

  const staleAfter = new Date(now.getTime() + CAPSULE_STALE_AFTER_DAYS * 86_400_000);
  const sourceMemoryIds = memories.map(m => m.id);
  const fields = {
    summary: output.summary,
    openRisks: output.openRisks,
    unresolvedQuestions: output.unresolvedQuestions,
    recentChanges: output.recentChanges,
    activeStakeholders: output.activeStakeholders,
    generatedAt: now,
    staleAfter,
    sourceMemoryIds,
    importanceSeen: 0,
  };

  const capsule = existing
    ? await prisma.contextCapsule.update({ where: { id: existing.id }, data: { ...fields, version: { increment: 1 } } })
    : await prisma.contextCapsule.create({ data: { userId, entityType, entityId, ...fields, version: 1 } });

  logger.info('[reflection] capsule written', { userId, entityType, entityId, version: capsule.version, memories: sourceMemoryIds.length });
  return capsule;
}

export async function getCapsules(
  userId: string,
  refs: Array<{ entityType: ReflectableEntityType; entityId: string }>,
  prisma: PrismaClient,
): Promise<ContextCapsule[]> {
  if (refs.length === 0) return [];
  return prisma.contextCapsule.findMany({
    where: { userId, OR: refs.map(r => ({ entityType: r.entityType, entityId: r.entityId })) },
    orderBy: { generatedAt: 'desc' },
  });
}

/** One scheduler tick: find candidates, reflect each, never let one failure stop the pass. */
export async function runReflectionPass(prisma: PrismaClient): Promise<{ candidates: number; reflected: number; failed: number }> {
  const candidates = await findReflectionCandidates(prisma);
  let reflected = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await reflectEntity(c.userId, c.entityType, c.entityId, prisma);
      reflected += 1;
    } catch (err) {
      failed += 1;
      logger.error('[reflection] entity reflection failed', { ...c, error: (err as Error).message });
    }
  }
  return { candidates: candidates.length, reflected, failed };
}
