import { logger } from './logger';

// Redis client instance (singleton)
let redis: any = null;
let isConnected = false;

/**
 * Initialize Redis client dynamically
 * Falls back to null if ioredis not available or REDIS_URL not set
 */
async function initRedis(): Promise<void> {
  if (redis || !process.env.REDIS_URL) return;

  try {
    const Redis = await import('ioredis');
    redis = new Redis.default(process.env.REDIS_URL, {
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    redis.on('connect', () => {
      isConnected = true;
      logger.info('Redis client connected');
    });

    redis.on('error', (err: Error) => {
      logger.error('Redis connection error', { error: err.message });
      isConnected = false;
    });

    redis.on('close', () => {
      isConnected = false;
      logger.warn('Redis connection closed');
    });
  } catch (err) {
    logger.warn('ioredis not available, Redis features disabled', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

// Initialize on module load
void initRedis();

/**
 * Get Redis client instance
 * Returns null if Redis is not available
 */
export async function getRedisClient(): Promise<any | null> {
  if (!redis && process.env.REDIS_URL) {
    await initRedis();
  }
  return redis;
}

/**
 * Check if Redis is connected and ready
 */
export function isRedisReady(): boolean {
  return isConnected && redis !== null;
}

/**
 * Proposal storage key helper
 */
export function getProposalKey(sessionId: string): string {
  return `boardroom:proposals:${sessionId}`;
}

/**
 * Store proposals in Redis with TTL
 * Falls back to in-memory if Redis unavailable
 */
export async function storeProposals(
  sessionId: string,
  proposals: unknown[]
): Promise<void> {
  const client = await getRedisClient();
  const key = getProposalKey(sessionId);

  if (client && isConnected) {
    try {
      // Store with 24-hour TTL (in seconds)
      await client.setex(key, 24 * 60 * 60, JSON.stringify(proposals));
      logger.info('Proposals stored in Redis', { sessionId, count: proposals.length });
      return;
    } catch (err) {
      logger.error('Failed to store proposals in Redis, falling back to memory', {
        sessionId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Fallback: in-memory storage (original behavior)
  inMemoryFallback.set(sessionId, proposals);
  logger.warn('Using in-memory proposal storage (Redis unavailable)', { sessionId });
}

/**
 * Retrieve proposals from Redis
 * Falls back to in-memory if Redis unavailable
 */
export async function retrieveProposals(sessionId: string): Promise<unknown[] | null> {
  const client = await getRedisClient();
  const key = getProposalKey(sessionId);

  if (client && isConnected) {
    try {
      const data = await client.get(key);
      if (data) {
        logger.info('Proposals retrieved from Redis', { sessionId });
        return JSON.parse(data);
      }
      return null;
    } catch (err) {
      logger.error('Failed to retrieve proposals from Redis, trying memory fallback', {
        sessionId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Fallback: in-memory storage
  return inMemoryFallback.get(sessionId) ?? null;
}

/**
 * Delete proposals from storage
 */
export async function deleteProposals(sessionId: string): Promise<void> {
  const client = await getRedisClient();
  const key = getProposalKey(sessionId);

  if (client && isConnected) {
    try {
      await client.del(key);
      logger.info('Proposals deleted from Redis', { sessionId });
    } catch (err) {
      logger.error('Failed to delete proposals from Redis', {
        sessionId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Always clean up memory fallback
  inMemoryFallback.delete(sessionId);
}

// In-memory fallback storage (for when Redis is unavailable)
const inMemoryFallback = new Map<string, unknown[]>();

/**
 * Get storage health status
 */
export async function getStorageStatus(): Promise<{
  type: 'redis' | 'memory';
  healthy: boolean;
}> {
  if (isConnected && redis) {
    try {
      await redis.ping();
      return { type: 'redis', healthy: true };
    } catch {
      return { type: 'redis', healthy: false };
    }
  }
  return { type: 'memory', healthy: true };
}
