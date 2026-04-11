import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface DuplicateGroup {
  canonicalId: string;
  canonicalTitle: string;
  duplicates: Array<{
    id: string;
    title: string;
    similarity: number;
    createdAt: Date;
  }>;
  avgSimilarity: number;
}

// Similarity thresholds for deduplication
const DEDUP_THRESHOLDS = {
  exact: 0.98,      // Near-exact match
  high: 0.92,       // High similarity - likely duplicate
  medium: 0.85,     // Medium - review recommended
  min: 0.75,        // Minimum to consider
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Find duplicate memories using semantic similarity
 * Groups memories by content similarity
 */
export async function findDuplicateGroups(
  userId: string,
  prisma: PrismaClient,
  options?: {
    since?: Date;
    minSimilarity?: number;
    limit?: number;
  }
): Promise<DuplicateGroup[]> {
  const since = options?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const minSimilarity = options?.minSimilarity ?? DEDUP_THRESHOLDS.medium;
  const limit = options?.limit ?? 500;

  // Get memories with embeddings using raw query (embedding is pgvector type not exposed in Prisma client)
  type MemoryWithEmbedding = {
    id: string;
    title: string;
    content: string;
    embedding: number[] | null;
    importance: number;
    createdAt: Date;
    confidence: number;
  };

  const memories = await prisma.$queryRaw<MemoryWithEmbedding[]>`
    SELECT id, title, content, embedding, importance, "createdAt", confidence
    FROM memory_entries
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND embedding IS NOT NULL
      AND "createdAt" >= ${since}
    ORDER BY importance DESC
    LIMIT ${limit}
  `;

  const groups: DuplicateGroup[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    if (processed.has(memory.id) || !memory.embedding) continue;

    const embedding = memory.embedding as number[];
    const duplicates: DuplicateGroup['duplicates'] = [];

    // Compare against all unprocessed memories
    for (let j = i + 1; j < memories.length; j++) {
      const candidate = memories[j];
      if (processed.has(candidate.id) || !candidate.embedding) continue;

      const candidateEmbedding = candidate.embedding as number[];
      const similarity = cosineSimilarity(embedding, candidateEmbedding);

      if (similarity >= minSimilarity) {
        duplicates.push({
          id: candidate.id,
          title: candidate.title,
          similarity: Math.round(similarity * 100) / 100,
          createdAt: candidate.createdAt,
        });
        processed.add(candidate.id);
      }
    }

    // Only create group if duplicates found
    if (duplicates.length > 0) {
      duplicates.sort((a, b) => b.similarity - a.similarity);
      const avgSimilarity = duplicates.reduce((sum, d) => sum + d.similarity, 0) / duplicates.length;

      groups.push({
        canonicalId: memory.id,
        canonicalTitle: memory.title,
        duplicates,
        avgSimilarity: Math.round(avgSimilarity * 100) / 100,
      });
      processed.add(memory.id);
    }
  }

  logger.info('Duplicate detection complete', {
    userId: userId.substring(0, 10),
    memoriesScanned: memories.length,
    groupsFound: groups.length,
    totalDuplicates: groups.reduce((sum, g) => sum + g.duplicates.length, 0),
  });

  return groups.sort((a, b) => b.avgSimilarity - a.avgSimilarity);
}

/**
 * Check if a new memory would be a duplicate
 * Used before creating new memories
 */
export async function checkDuplicate(
  userId: string,
  title: string,
  content: string,
  prisma: PrismaClient
): Promise<{
  isDuplicate: boolean;
  confidence: number;
  existingMemory?: { id: string; title: string };
}> {
  // Search for similar memories using raw query for embedding
  const candidates = await prisma.$queryRaw<{ id: string; title: string; content: string; embedding: number[] | null }[]>`
    SELECT id, title, content, embedding
    FROM memory_entries
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND embedding IS NOT NULL
    LIMIT 20
  `;

  // Simple text-based check (faster than embedding generation)
  const textToCheck = `${title} ${content}`.toLowerCase();
  let bestMatch: { id: string; title: string; similarity: number } | null = null;

  for (const candidate of candidates) {
    if (!candidate.embedding) continue;

    const candidateText = `${candidate.title} ${candidate.content}`.toLowerCase();

    // Quick Jaccard similarity
    const set1 = new Set(textToCheck.split(/\s+/).filter(w => w.length > 3));
    const set2 = new Set(candidateText.split(/\s+/).filter(w => w.length > 3));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    const similarity = intersection.size / union.size;

    if (similarity > DEDUP_THRESHOLDS.high) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {
          id: candidate.id,
          title: candidate.title,
          similarity,
        };
      }
    }
  }

  if (bestMatch && bestMatch.similarity >= DEDUP_THRESHOLDS.exact) {
    return {
      isDuplicate: true,
      confidence: bestMatch.similarity,
      existingMemory: { id: bestMatch.id, title: bestMatch.title },
    };
  }

  return {
    isDuplicate: false,
    confidence: bestMatch?.similarity ?? 0,
    existingMemory: bestMatch
      ? { id: bestMatch.id, title: bestMatch.title }
      : undefined,
  };
}

/**
 * Merge duplicate memories
 * Archives duplicates and merges tags/links into canonical
 */
export async function mergeDuplicates(
  userId: string,
  canonicalId: string,
  duplicateIds: string[],
  prisma: PrismaClient
): Promise<{ merged: number; errors: string[] }> {
  const errors: string[] = [];
  let merged = 0;

  for (const dupId of duplicateIds) {
    try {
      // Get duplicate details
      const duplicate = await prisma.memoryEntry.findFirst({
        where: { id: dupId, userId },
        include: { entityLinks: true },
      });

      if (!duplicate) {
        errors.push(`Duplicate ${dupId} not found`);
        continue;
      }

      // Merge entity links to canonical
      for (const link of duplicate.entityLinks) {
        await prisma.memoryEntityLink.create({
          data: {
            memoryId: canonicalId,
            entityType: link.entityType,
            entityId: link.entityId,
            linkType: link.linkType || 'relates_to',
          },
        }).catch(() => {
          // Link may already exist, ignore
        });
      }

      // Archive the duplicate
      await prisma.memoryEntry.update({
        where: { id: dupId },
        data: {
          status: 'ARCHIVED',
          metadata: {
            ...(duplicate.metadata as object),
            archivedReason: 'duplicate_merged',
            canonicalId,
          },
        },
      });

      merged++;
    } catch (err) {
      errors.push(`Failed to merge ${dupId}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  logger.info('Duplicate merge complete', {
    userId: userId.substring(0, 10),
    canonicalId,
    merged,
    errors: errors.length,
  });

  return { merged, errors };
}
