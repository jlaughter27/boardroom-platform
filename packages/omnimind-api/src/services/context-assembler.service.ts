import type { PrismaClient } from '@prisma/client';
import type { PersonaId } from '@boardroom/shared';
import { estimateTokens, MemoryClass } from '@boardroom/shared';
import { structuredFilter } from '../retrieval/structured-filter';
import { fulltextSearch } from '../retrieval/fulltext-search';
import { trigramSearch } from '../retrieval/trigram-search';
import { semanticSearch } from '../retrieval/semantic-search';
import { rankAndDeduplicate } from '../retrieval/ranker';
import { packageForPersona, personaLimits, type RetrievalContextPackage } from '../retrieval/context-packager';
import { generateEmbeddingWithRetry as generateEmbedding } from './embedding.service';
import type { ScoredResult } from '../retrieval/structured-filter';
import type { RetrievalLayer } from '../retrieval/forgetting-curve';
import { getCommitmentNudges, renderCommitmentLines } from './commitment.service';
import { logger } from '../lib/logger';

/** Phase 6: at most this many entity capsules are injected per persona call. */
export const MAX_CAPSULES_PER_CALL = 3;
/** R-O-06: prepended items (capsules, commitments) may never squeeze the ranked list below this. */
export const MIN_RANKED_ITEMS = 3;
/** R-O-06: per-capsule text caps so three capsules cannot eat the whole token budget. */
export const CAPSULE_SUMMARY_MAX_CHARS = 600;
export const CAPSULE_LIST_MAX_ENTRIES = 3;
const CAPSULE_LIST_ENTRY_MAX_CHARS = 160;

/** Normalise a caller-supplied memoryClass; unknown values are ignored (logged), never 422. */
export function normalizeMemoryClass(raw?: string | null): MemoryClass | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if ((Object.values(MemoryClass) as string[]).includes(upper)) return upper as MemoryClass;
  logger.warn('[context] ignoring unknown memoryClass', { memoryClass: raw });
  return undefined;
}


export async function assembleContextForPersona(
  userId: string,
  query: string,
  persona: PersonaId,
  prisma: PrismaClient,
  options?: {
    maxItems?: number;
    includeEntities?: string[];
    /** Tenant scope forwarded to retrieval layers. */
    tenantId?: string;
    /** Admin escape hatch — skip tenant filter entirely. */
    includeAllTenants?: boolean;
    /** Phase 6: temporal validity — retrieve what was believed at this instant. */
    asOf?: Date;
    /** Phase 6 (Critic): lift the forgetting-curve cutoff in all four layers. */
    includeArchived?: boolean;
    /** Phase 6 (Critic): restrict memory layers to one MemoryClass, e.g. 'DECISION'. */
    memoryClass?: string;
  }
): Promise<RetrievalContextPackage> {
  const includeEntities = options?.includeEntities ?? ['memories', 'people', 'goals', 'projects', 'decisions'];
  const asOf = options?.asOf;
  const includeArchived = options?.includeArchived ?? false;
  const memoryClass = normalizeMemoryClass(options?.memoryClass);


  // Generate query embedding for semantic search
  const queryEmbedding = await generateEmbedding(query);

  // Retrieval layers default to tenant-scoped. If neither tenantId nor
  // includeAllTenants is provided, they return 0 results (safe default).
  // F-204: layers that throw degrade to [] but report here so the package
  // can be flagged `degraded` instead of silently looking like "no matches".
  const degradedLayers: RetrievalLayer[] = [];
  const retrievalScope = {
    tenantId: options?.tenantId,
    includeAllTenants: options?.includeAllTenants,
    asOf,
    includeArchived,
    memoryClass,
    onLayerError: (layer: RetrievalLayer) => {
      if (!degradedLayers.includes(layer)) degradedLayers.push(layer);
    },
  };


  // Run all retrieval layers in parallel
  const [structured, fts, trigram, semantic] = await Promise.all([
    includeEntities.includes('memories') ? structuredFilter(userId, query, { limit: 20, ...retrievalScope }, prisma) : [],
    includeEntities.includes('memories') ? fulltextSearch(userId, query, { limit: 20, ...retrievalScope }, prisma) : [],
    includeEntities.includes('memories') ? trigramSearch(userId, query, { limit: 20, ...retrievalScope }, prisma) : [],
    queryEmbedding ? semanticSearch(userId, queryEmbedding, { limit: 20, ...retrievalScope }, prisma) : Promise.resolve([]),
  ]);

  // Also search entity tables
  const entityResults: ScoredResult[] = [];

  if (includeEntities.includes('people')) {
    const people = await prisma.person.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { role: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 5,
    });
    entityResults.push(
      ...people.map(p => ({
        id: p.id,
        type: 'person' as const,
        content: `${p.name}${p.role ? ` (${p.role})` : ''}${p.notes ? `: ${p.notes}` : ''}`,
        title: p.name,
        relevanceScore: 0.8,
        source: 'structured' as const,
        whyIncluded: `Person matching "${query}"`,
        tags: p.domains,
        importance: p.importance,
        lastAccessedAt: p.lastContactAt,
      }))
    );
  }

  if (includeEntities.includes('goals')) {
    const goals = await prisma.goal.findMany({
      where: {
        userId,
        deletedAt: null,
        title: { contains: query, mode: 'insensitive' },
      },
      take: 5,
    });
    entityResults.push(
      ...goals.map(g => ({
        id: g.id,
        type: 'goal' as const,
        content: `Goal: ${g.title} (${g.status})${g.deadline ? ` — due ${g.deadline.toISOString().split('T')[0]}` : ''}`,
        title: g.title,
        relevanceScore: 0.7,
        source: 'structured' as const,
        whyIncluded: `Goal matching "${query}"`,
      }))
    );
  }

  if (includeEntities.includes('projects')) {
    const projects = await prisma.project.findMany({
      where: {
        userId,
        deletedAt: null,
        title: { contains: query, mode: 'insensitive' },
      },
      take: 5,
    });
    entityResults.push(
      ...projects.map(p => ({
        id: p.id,
        type: 'project' as const,
        content: `Project: ${p.title} (${p.status})${p.deadline ? ` — due ${p.deadline.toISOString().split('T')[0]}` : ''}`,
        title: p.title,
        relevanceScore: 0.7,
        source: 'structured' as const,
        whyIncluded: `Project matching "${query}"`,
      }))
    );
  }

  if (includeEntities.includes('decisions')) {
    const decisions = await prisma.decision.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { question: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 5,
    });
    entityResults.push(
      ...decisions.map(d => ({
        id: d.id,
        type: 'decision' as const,
        content: `Decision: ${d.title} — ${d.question}${d.chosenPath ? ` → ${d.chosenPath}` : ' (pending)'}`,
        title: d.title,
        relevanceScore: 0.75,
        source: 'structured' as const,
        whyIncluded: `Decision matching "${query}"`,
      }))
    );
  }

  // Track which layers returned results
  const layersUsed: string[] = [];
  if (structured.length > 0) layersUsed.push('structured');
  if (fts.length > 0) layersUsed.push('fts');
  if (trigram.length > 0) layersUsed.push('trigram');
  if (semantic.length > 0) layersUsed.push('semantic');

  const totalCandidates = structured.length + fts.length + trigram.length + semantic.length + entityResults.length;

  // Rank and deduplicate memory results
  const rankedMemories = rankAndDeduplicate(
    [
      { layer: 'structured', results: structured },
      { layer: 'fts', results: fts },
      { layer: 'trigram', results: trigram },
      { layer: 'semantic', results: semantic },
    ],
    30
  );

  // WS-3: reinforce recall — bump recall_count for every memory we actually
  // surfaced to the persona. Fire-and-forget; failure here must not block the
  // assembly response. This is what makes the exponential-decay formula's
  // (1 + recall_count * 0.2) reinforcement term meaningful.
  const memoryIdsHit = rankedMemories
    .filter(r => r.type === 'memory')
    .map(r => r.id);
  if (memoryIdsHit.length > 0) {
    void reinforceRecall(prisma, memoryIdsHit);
  }

  // Merge with entity results
  const allResults = [...rankedMemories, ...entityResults];

  // Phase 6: entity capsules (≤3) for the goals/projects/people this question
  // touches, injected right after the core block (which BoardRoom prepends as
  // a cached system block) — i.e. at the top of the retrieved items.
  const capsuleItems = await loadCapsuleItems(userId, entityResults, prisma);

  // Phase 6: the Doer gets "Open commitments" lines (SQL only) prepended.
  const commitmentItems = persona === 'doer' ? await loadDoerCommitmentItems(userId, prisma) : [];

  // R-O-06 (CLAUDE.md rule 7): prepended items count against the persona's
  // maxItems and token budget. Reserve their slots/tokens BEFORE packaging the
  // ranked results, keeping at least MIN_RANKED_ITEMS slots for retrieval and
  // dropping trailing prepended items that would not fit the budget at all.
  const limits = personaLimits(persona);
  const callerMax = options?.maxItems && options.maxItems > 0 ? Math.min(options.maxItems, limits.maxItems) : limits.maxItems;
  const prepended: PackagedItem[] = [];
  let prependedTokens = 0;
  for (const item of [...commitmentItems, ...capsuleItems]) {
    const t = estimateTokens(item.content);
    const slotsLeft = callerMax - prepended.length - MIN_RANKED_ITEMS;
    if (slotsLeft <= 0 || prependedTokens + t > limits.tokenBudget) {
      logger.info('[context] dropping prepended item — persona budget exhausted', { persona, id: item.id });
      continue;
    }
    prepended.push(item);
    prependedTokens += t;
  }

  const pkg = packageForPersona(allResults, persona, totalCandidates, layersUsed, {
    degradedLayers,
    maxItems: Math.max(MIN_RANKED_ITEMS, callerMax - prepended.length),
    tokenBudget: Math.max(0, limits.tokenBudget - prependedTokens),
  });
  if (prepended.length === 0) return pkg;
  return {
    ...pkg,
    items: [...prepended, ...pkg.items],
    tokenEstimate: pkg.tokenEstimate + prependedTokens,
  };
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const clipList = (xs: string[]): string[] => xs.slice(0, CAPSULE_LIST_MAX_ENTRIES).map(x => clip(x, CAPSULE_LIST_ENTRY_MAX_CHARS));

type PackagedItem = RetrievalContextPackage['items'][number];

/**
 * Capsules for entities linked to the question: the goal/project/person
 * entity rows the title match surfaced. Capped at MAX_CAPSULES_PER_CALL,
 * freshest first. Stale capsules (past `staleAfter`) are still used but
 * flagged in `whyIncluded` so the persona can discount them.
 */
async function loadCapsuleItems(userId: string, entityResults: ScoredResult[], prisma: PrismaClient): Promise<PackagedItem[]> {
  const refs = entityResults
    .filter(r => r.type === 'goal' || r.type === 'project' || r.type === 'person')
    .map(r => ({ entityType: r.type, entityId: r.id }));
  if (refs.length === 0) return [];
  try {
    const capsules = await prisma.contextCapsule.findMany({
      where: { userId, OR: refs },
      orderBy: { generatedAt: 'desc' },
      take: MAX_CAPSULES_PER_CALL,
    });
    const now = Date.now();
    return capsules.map(c => {
      const stale = c.staleAfter.getTime() < now;
      // R-O-06: bounded text — summary ≤600 chars, ≤3 entries per list.
      const parts = [`Capsule (${c.entityType}) — ${clip(c.summary, CAPSULE_SUMMARY_MAX_CHARS)}`];
      if (c.openRisks.length) parts.push(`Open risks: ${clipList(c.openRisks).join('; ')}`);
      if (c.unresolvedQuestions.length) parts.push(`Unresolved: ${clipList(c.unresolvedQuestions).join('; ')}`);
      if (c.recentChanges.length) parts.push(`Recent changes: ${clipList(c.recentChanges).join('; ')}`);
      if (c.activeStakeholders.length) parts.push(`Stakeholders: ${clipList(c.activeStakeholders).join(', ')}`);
      return {
        type: c.entityType as PackagedItem['type'],
        id: c.entityId,
        content: parts.join('\n'),
        relevanceScore: 0.95,
        source: 'structured' as const,
        whyIncluded: `Reflection capsule v${c.version} for linked ${c.entityType}${stale ? ' (stale — regenerate)' : ''}`,
      };
    });
  } catch (err) {
    logger.warn('[context] capsule lookup failed — continuing without capsules', { error: (err as Error).message });
    return [];
  }
}

async function loadDoerCommitmentItems(userId: string, prisma: PrismaClient): Promise<PackagedItem[]> {
  try {
    const nudges = await getCommitmentNudges(userId, prisma);
    const lines = renderCommitmentLines(nudges);
    if (lines.length === 0) return [];
    return [{
      type: 'decision',
      id: `commitments:${userId}`,
      content: `Open commitments:\n${lines.join('\n')}`,
      relevanceScore: 1.0,
      source: 'structured',
      whyIncluded: 'Open commitments due within 3 days or overdue (Doer context)',
    }];
  } catch (err) {
    logger.warn('[context] commitment nudges lookup failed — continuing', { error: (err as Error).message });
    return [];
  }
}


/**
 * WS-3: Increment `recall_count` and refresh `last_accessed_at` for every
 * memory ID surfaced by the retrieval pipeline. Errors are swallowed —
 * reinforcement is a quality signal, not a correctness invariant.
 */
async function reinforceRecall(prisma: PrismaClient, memoryIds: string[]): Promise<void> {
  try {
    await prisma.memoryEntry.updateMany({
      where: { id: { in: memoryIds }, deletedAt: null },
      data: {
        recallCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });
  } catch {
    // Swallow — reinforcement is best-effort.
  }
}
