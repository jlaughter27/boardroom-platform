import type { PrismaClient } from '@prisma/client';
import type { PersonaId } from '@boardroom/shared';
import { structuredFilter } from '../retrieval/structured-filter';
import { fulltextSearch } from '../retrieval/fulltext-search';
import { trigramSearch } from '../retrieval/trigram-search';
import { semanticSearch } from '../retrieval/semantic-search';
import { rankAndDeduplicate } from '../retrieval/ranker';
import { packageForPersona, type ContextPackage } from '../retrieval/context-packager';
import { generateEmbeddingWithRetry as generateEmbedding } from './embedding.service';
import type { ScoredResult } from '../retrieval/structured-filter';

export async function assembleContextForPersona(
  userId: string,
  query: string,
  persona: PersonaId,
  prisma: PrismaClient,
  options?: {
    maxItems?: number;
    includeEntities?: string[];
  }
): Promise<ContextPackage> {
  const includeEntities = options?.includeEntities ?? ['memories', 'people', 'goals', 'projects', 'decisions'];

  // Generate query embedding for semantic search
  const queryEmbedding = await generateEmbedding(query);

  // Run all retrieval layers in parallel
  const [structured, fts, trigram, semantic] = await Promise.all([
    includeEntities.includes('memories') ? structuredFilter(userId, query, { limit: 20 }, prisma) : [],
    includeEntities.includes('memories') ? fulltextSearch(userId, query, { limit: 20 }, prisma) : [],
    includeEntities.includes('memories') ? trigramSearch(userId, query, { limit: 20 }, prisma) : [],
    queryEmbedding ? semanticSearch(userId, queryEmbedding, { limit: 20 }, prisma) : Promise.resolve([]),
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

  // Merge with entity results
  const allResults = [...rankedMemories, ...entityResults];

  // Package for the specific persona
  return packageForPersona(allResults, persona, totalCandidates, layersUsed);
}
