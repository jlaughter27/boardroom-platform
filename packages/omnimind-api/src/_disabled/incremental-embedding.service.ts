import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { generateEmbedding } from './embedding.service';

/**
 * Incremental embedding update service
 * Optimizes embedding generation by:
 * 1. Only updating when content changes significantly
 * 2. Batching updates
 * 3. Using content hashing to detect changes
 */

// Content change threshold (Jaccard similarity)
const CHANGE_THRESHOLD = 0.85;
// Batch size for updates
const BATCH_SIZE = 10;

interface PendingEmbedding {
  memoryId: string;
  content: string;
  contentHash: string;
}

// In-memory queue for batching
const pendingQueue: PendingEmbedding[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Generate content hash for change detection
 */
function generateContentHash(content: string): string {
  // Simple hash - in production use proper hashing
  return content.slice(0, 100) + content.length.toString();
}

/**
 * Calculate content similarity (Jaccard)
 */
function calculateContentSimilarity(text1: string, text2: string): number {
  const set1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const set2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

/**
 * Check if embedding needs update
 */
export async function shouldUpdateEmbedding(
  memoryId: string,
  newContent: string,
  prisma: PrismaClient
): Promise<{ needsUpdate: boolean; reason: string }> {
  type MemoryForUpdateCheck = { content: string; embedding: number[] | null; updatedAt: Date };
  const [memory] = await prisma.$queryRaw<MemoryForUpdateCheck[]>`
    SELECT content, embedding, "updatedAt"
    FROM memory_entries
    WHERE id = ${memoryId}
    LIMIT 1
  `;

  if (!memory) {
    return { needsUpdate: false, reason: 'memory_not_found' };
  }

  // No existing embedding - needs update
  if (!memory.embedding) {
    return { needsUpdate: true, reason: 'no_existing_embedding' };
  }

  // Content unchanged - skip
  if (memory.content === newContent) {
    return { needsUpdate: false, reason: 'content_unchanged' };
  }

  // Check similarity
  const similarity = calculateContentSimilarity(memory.content, newContent);

  if (similarity >= CHANGE_THRESHOLD) {
    return {
      needsUpdate: false,
      reason: `content_similarity_${Math.round(similarity * 100)}%`,
    };
  }

  return {
    needsUpdate: true,
    reason: `content_changed_similarity_${Math.round(similarity * 100)}%`,
  };
}

/**
 * Queue embedding for incremental update
 */
export async function queueEmbeddingUpdate(
  memoryId: string,
  content: string
): Promise<void> {
  const contentHash = generateContentHash(content);

  // Check if already queued
  const existingIndex = pendingQueue.findIndex(p => p.memoryId === memoryId);
  if (existingIndex >= 0) {
    // Update existing entry
    pendingQueue[existingIndex] = { memoryId, content, contentHash };
  } else {
    // Add new entry
    pendingQueue.push({ memoryId, content, contentHash });
  }

  // Schedule batch processing
  scheduleBatchProcessing();

  logger.info('Embedding update queued', {
    memoryId,
    queueSize: pendingQueue.length,
  });
}

/**
 * Schedule batch processing with debouncing
 */
function scheduleBatchProcessing(): void {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  // Process immediately if queue is full
  if (pendingQueue.length >= BATCH_SIZE) {
    void processEmbeddingBatch();
    return;
  }

  // Otherwise wait 5 seconds for more items
  batchTimeout = setTimeout(() => {
    void processEmbeddingBatch();
  }, 5000);
}

/**
 * Process batch of pending embeddings
 */
async function processEmbeddingBatch(): Promise<void> {
  if (pendingQueue.length === 0) return;

  // Take batch from queue
  const batch = pendingQueue.splice(0, BATCH_SIZE);

  logger.info('Processing embedding batch', {
    batchSize: batch.length,
    remainingQueue: pendingQueue.length,
  });

  // Import prisma dynamically to avoid circular dependency
  const { prisma } = await import('../lib/db');

  // Process each item
  for (const item of batch) {
    try {
      // Generate embedding
      const embedding = await generateEmbedding(item.content);

      if (!embedding) {
        logger.warn('Failed to generate embedding', { memoryId: item.memoryId });
        continue;
      }

      // Update memory using raw query (embedding is pgvector type not in Prisma client)
      await prisma.$executeRaw`
        UPDATE memory_entries
        SET embedding = ${embedding}::vector(1536),
            metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{embeddingUpdatedAt}',
              to_jsonb(${new Date().toISOString()}),
              true
            )
        WHERE id = ${item.memoryId}
      `;

      logger.info('Embedding updated', { memoryId: item.memoryId });
    } catch (err) {
      logger.error('Failed to update embedding', {
        memoryId: item.memoryId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // Schedule more if queue not empty
  if (pendingQueue.length > 0) {
    scheduleBatchProcessing();
  }
}

/**
 * Force immediate processing of all pending embeddings
 */
export async function flushEmbeddingQueue(): Promise<{ processed: number }> {
  const processed = pendingQueue.length;
  await processEmbeddingBatch();

  // Continue processing until queue is empty
  while (pendingQueue.length > 0) {
    await processEmbeddingBatch();
  }

  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }

  return { processed };
}

/**
 * Get queue status
 */
export function getEmbeddingQueueStatus(): {
  pending: number;
  batchSize: number;
  hasScheduledJob: boolean;
} {
  return {
    pending: pendingQueue.length,
    batchSize: BATCH_SIZE,
    hasScheduledJob: batchTimeout !== null,
  };
}

/**
 * Backfill embeddings for memories without them
 */
export async function backfillEmbeddings(
  userId: string,
  prisma: PrismaClient,
  options?: {
    limit?: number;
    batchSize?: number;
  }
): Promise<{ processed: number; errors: number }> {
  const limit = options?.limit ?? 100;
  const batchSize = options?.batchSize ?? 5;

  // Find memories without embeddings using raw query
  type MemoryForBackfill = { id: string; content: string; title: string };
  const memories = await prisma.$queryRaw<MemoryForBackfill[]>`
    SELECT id, content, title
    FROM memory_entries
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND embedding IS NULL
    ORDER BY importance DESC
    LIMIT ${limit}
  `;

  let processed = 0;
  let errors = 0;

  // Process in small batches
  for (let i = 0; i < memories.length; i += batchSize) {
    const batch = memories.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (memory: MemoryForBackfill) => {
        try {
          const embedding = await generateEmbedding(`${memory.title} ${memory.content}`);

          if (embedding) {
            // Use raw query for pgvector embedding update
            await prisma.$executeRaw`
              UPDATE memory_entries
              SET embedding = ${embedding}::vector(1536),
                  metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{embeddingUpdatedAt}',
                    to_jsonb(${new Date().toISOString()}),
                    true
                  )
              WHERE id = ${memory.id}
            `;
            processed++;
          } else {
            errors++;
          }
        } catch (err) {
          errors++;
          logger.error('Backfill failed for memory', {
            memoryId: memory.id,
            error: err instanceof Error ? err.message : 'Unknown',
          });
        }
      })
    );

    // Small delay between batches
    if (i + batchSize < memories.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  logger.info('Backfill complete', {
    userId: userId.substring(0, 10),
    processed,
    errors,
    total: memories.length,
  });

  return { processed, errors };
}
