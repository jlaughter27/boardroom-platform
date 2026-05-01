import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import crypto from 'crypto';

export interface CacheOptions {
  ttlSeconds?: number; // Time to live in seconds
  namespace?: string; // Cache namespace for isolation
  staleWhileRevalidate?: boolean; // Allow stale cache while refreshing
  maxAge?: number; // Maximum cache age
  bypass?: boolean; // Bypass cache entirely
}

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  createdAt: Date;
  expiresAt: Date;
  hits: number;
  lastAccessed: Date;
  metadata?: {
    queryHash?: string;
    userId?: string;
    resultCount?: number;
    searchTimeMs?: number;
    cacheLevel?: 'memory' | 'redis' | 'database';
  };
}

export interface CacheStats {
  totalEntries: number;
  memoryEntries: number;
  redisEntries: number;
  databaseEntries: number;
  hitRate: number;
  missRate: number;
  averageAccessTimeMs: number;
  memoryUsageMB: number;
  evictions: number;
  staleEntries: number;
  namespaceStats: Record<string, {
    entries: number;
    hitRate: number;
    averageTtlSeconds: number;
  }>;
}

export interface SearchQueryCacheKey {
  userId: string;
  queryText: string;
  queryEmbedding?: number[];
  limit?: number;
  vectorWeight?: number;
  graphWeight?: number;
  bm25Weight?: number;
  filters?: Record<string, any>;
}

export class SearchCacheService {
  private prisma: PrismaClient;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private stats: {
    hits: number;
    misses: number;
    sets: number;
    evictions: number;
    totalAccessTimeMs: number;
  };
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      totalAccessTimeMs: 0
    };
    
    // Start background cleanup
    this.startCleanupJob();
  }
  
  /**
   * Generate cache key for search query
   */
  generateCacheKey(query: SearchQueryCacheKey): string {
    const { userId, queryText, queryEmbedding, limit, vectorWeight, graphWeight, bm25Weight, filters } = query;
    
    // Create a deterministic string representation
    const queryString = JSON.stringify({
      userId,
      queryText: queryText.toLowerCase().trim(),
      queryEmbeddingHash: queryEmbedding ? 
        crypto.createHash('sha256').update(JSON.stringify(queryEmbedding)).digest('hex').substring(0, 16) : 
        null,
      limit,
      vectorWeight,
      graphWeight,
      bm25Weight,
      filters: filters ? this.normalizeFilters(filters) : null
    });
    
    // Generate SHA-256 hash
    const hash = crypto.createHash('sha256').update(queryString).digest('hex');
    return `search:${hash}`;
  }
  
  /**
   * Normalize filters for consistent cache keys
   */
  private normalizeFilters(filters: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        normalized[key] = [...value].sort();
      } else if (typeof value === 'object' && value !== null) {
        normalized[key] = this.normalizeFilters(value);
      } else {
        normalized[key] = value;
      }
    }
    
    return normalized;
  }
  
  /**
   * Get cached search results with multi-level fallback
   */
  async getSearchResults<T>(
    cacheKey: string,
    options: CacheOptions = {}
  ): Promise<{ cached: boolean; value: T | null; source: 'memory' | 'redis' | 'database' | 'none' }> {
    const startTime = Date.now();
    const { bypass = false } = options;
    
    if (bypass) {
      this.stats.misses++;
      return { cached: false, value: null, source: 'none' };
    }
    
    try {
      // Level 1: Memory cache (fastest)
      const memoryEntry = this.memoryCache.get(cacheKey);
      if (memoryEntry && memoryEntry.expiresAt > new Date()) {
        memoryEntry.hits++;
        memoryEntry.lastAccessed = new Date();
        this.stats.hits++;
        this.stats.totalAccessTimeMs += Date.now() - startTime;
        
        return {
          cached: true,
          value: memoryEntry.value as T,
          source: 'memory'
        };
      }
      
      // Level 2: Redis cache (if configured)
      const redisResult = await this.tryRedisGet<T>(cacheKey);
      if (redisResult.cached) {
        // Populate memory cache from Redis
        this.setMemoryCache(cacheKey, redisResult.value, options);
        this.stats.hits++;
        this.stats.totalAccessTimeMs += Date.now() - startTime;
        
        return {
          cached: true,
          value: redisResult.value,
          source: 'redis'
        };
      }
      
      // Level 3: Database cache (persistent)
      const dbResult = await this.getDatabaseCache<T>(cacheKey);
      if (dbResult.cached) {
        // Populate Redis and memory caches
        await this.setRedisCache(cacheKey, dbResult.value, options);
        this.setMemoryCache(cacheKey, dbResult.value, options);
        this.stats.hits++;
        this.stats.totalAccessTimeMs += Date.now() - startTime;
        
        return {
          cached: true,
          value: dbResult.value,
          source: 'database'
        };
      }
      
      this.stats.misses++;
      this.stats.totalAccessTimeMs += Date.now() - startTime;
      return { cached: false, value: null, source: 'none' };
      
    } catch (error) {
      logger.error('Cache retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        cacheKey
      });
      
      this.stats.misses++;
      return { cached: false, value: null, source: 'none' };
    }
  }
  
  /**
   * Cache search results with multi-level write
   */
  async setSearchResults<T>(
    cacheKey: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    const { ttlSeconds = 300, namespace = 'default' } = options; // Default 5 minutes
    
    try {
      // Level 1: Memory cache
      this.setMemoryCache(cacheKey, value, options);
      
      // Level 2: Redis cache (async, fire and forget)
      this.setRedisCache(cacheKey, value, options).catch(error => {
        logger.warn('Redis cache set failed', { error: error.message, cacheKey });
      });
      
      // Level 3: Database cache (persistent)
      await this.setDatabaseCache(cacheKey, value, {
        ttlSeconds,
        namespace,
        metadata: {
          resultCount: Array.isArray(value) ? value.length : 1,
          cacheLevel: 'database'
        }
      });
      
      this.stats.sets++;
      
    } catch (error) {
      logger.error('Cache set failed', {
        error: error instanceof Error ? error.message : String(error),
        cacheKey
      });
    }
  }
  
  /**
   * Memory cache operations
   */
  private setMemoryCache<T>(key: string, value: T, options: CacheOptions): void {
    const { ttlSeconds = 300 } = options;
    const now = new Date();
    
    const entry: CacheEntry = {
      key,
      value,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      hits: 0,
      lastAccessed: now,
      metadata: {
        cacheLevel: 'memory'
      }
    };
    
    this.memoryCache.set(key, entry);
    
    // Enforce memory limit (evict least recently used if over limit)
    if (this.memoryCache.size > 10000) {
      this.evictMemoryCache();
    }
  }
  
  private evictMemoryCache(): void {
    // Simple LRU eviction: remove entries with oldest lastAccessed
    const entries = Array.from(this.memoryCache.entries());
    entries.sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime());
    
    // Remove 10% of entries
    const toRemove = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.memoryCache.delete(entries[i][0]);
      this.stats.evictions++;
    }
    
    logger.info('Memory cache eviction performed', {
      evictedCount: toRemove,
      remainingCount: this.memoryCache.size
    });
  }
  
  /**
   * Redis cache operations (placeholder - would connect to Redis in production)
   */
  private async tryRedisGet<T>(key: string): Promise<{ cached: boolean; value: T | null }> {
    // In production, this would connect to Redis
    // For now, return false to simulate Redis not being available
    return { cached: false, value: null };
  }
  
  private async setRedisCache<T>(key: string, value: T, options: CacheOptions): Promise<void> {
    // In production, this would connect to Redis
    // For now, just log
    logger.debug('Redis cache set (simulated)', { key, ttlSeconds: options.ttlSeconds });
  }
  
  /**
   * Database cache operations
   */
  private async getDatabaseCache<T>(key: string): Promise<{ cached: boolean; value: T | null }> {
    try {
      const entry = await this.prisma.hybridSearchCache.findUnique({
        where: { queryHash: key }
      });
      
      if (!entry) {
        return { cached: false, value: null };
      }
      
      // Check if expired
      if (entry.expiresAt < new Date()) {
        // Delete expired entry
        await this.prisma.hybridSearchCache.delete({
          where: { queryHash: key }
        });
        return { cached: false, value: null };
      }
      
      // Update cache hit counter
      await this.prisma.hybridSearchCache.update({
        where: { queryHash: key },
        data: { cacheHits: { increment: 1 } }
      });
      
      // Parse cached results
      const value = JSON.parse(entry.results as string);
      return { cached: true, value };
      
    } catch (error) {
      logger.error('Database cache retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        key
      });
      return { cached: false, value: null };
    }
  }
  
  private async setDatabaseCache<T>(
    key: string, 
    value: T, 
    metadata: {
      ttlSeconds: number;
      namespace: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + metadata.ttlSeconds * 1000);
      
      await this.prisma.hybridSearchCache.upsert({
        where: { queryHash: key },
        update: {
          results: JSON.stringify(value),
          expiresAt,
          cacheHits: 0,
          updatedAt: now,
          metadata: metadata.metadata ? JSON.stringify(metadata.metadata) : null
        },
        create: {
          queryHash: key,
          results: JSON.stringify(value),
          expiresAt,
          cacheHits: 0,
          createdAt: now,
          updatedAt: now,
          metadata: metadata.metadata ? JSON.stringify(metadata.metadata) : null
        }
      });
      
    } catch (error) {
      logger.error('Database cache set failed', {
        error: error instanceof Error ? error.message : String(error),
        key
      });
    }
  }
  
  /**
   * Invalidate cache entries by pattern
   */
  async invalidateCache(pattern: string | RegExp): Promise<number> {
    let invalidatedCount = 0;
    
    try {
      // Invalidate memory cache
      for (const [key] of this.memoryCache) {
        if (typeof pattern === 'string' ? key.includes(pattern) : pattern.test(key)) {
          this.memoryCache.delete(key);
          invalidatedCount++;
        }
      }
      
      // Invalidate database cache
      if (typeof pattern === 'string') {
        const result = await this.prisma.hybridSearchCache.deleteMany({
          where: {
            queryHash: { contains: pattern }
          }
        });
        invalidatedCount += result.count;
      }
      
      logger.info('Cache invalidation completed', {
        pattern: typeof pattern === 'string' ? pattern : pattern.toString(),
        invalidatedCount
      });
      
      return invalidatedCount;
      
    } catch (error) {
      logger.error('Cache invalidation failed', {
        error: error instanceof Error ? error.message : String(error),
        pattern
      });
      return invalidatedCount;
    }
  }
  
  /**
   * Invalidate cache by user ID
   */
  async invalidateUserCache(userId: string): Promise<number> {
    return this.invalidateCache(`user:${userId}:`);
  }
  
  /**
   * Invalidate cache by entity
   */
  async invalidateEntityCache(entityId: string): Promise<number> {
    return this.invalidateCache(`entity:${entityId}:`);
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const now = new Date();
    let staleEntries = 0;
    let totalTtlSeconds = 0;
    
    // Analyze memory cache
    for (const entry of this.memoryCache.values()) {
      if (entry.expiresAt < now) {
        staleEntries++;
      }
      totalTtlSeconds += (entry.expiresAt.getTime() - entry.createdAt.getTime()) / 1000;
    }
    
    const averageAccessTimeMs = this.stats.hits > 0 
      ? this.stats.totalAccessTimeMs / this.stats.hits 
      : 0;
    
    const totalAccesses = this.stats.hits + this.stats.misses;
    const hitRate = totalAccesses > 0 ? this.stats.hits / totalAccesses : 0;
    const missRate = totalAccesses > 0 ? this.stats.misses / totalAccesses : 0;
    
    // Estimate memory usage (rough approximation)
    let memoryUsageBytes = 0;
    for (const [key, entry] of this.memoryCache) {
      memoryUsageBytes += key.length * 2; // UTF-16 string
      memoryUsageBytes += JSON.stringify(entry.value).length * 2;
      memoryUsageBytes += 100; // Approximate overhead for Date objects and metadata
    }
    const memoryUsageMB = memoryUsageBytes / (1024 * 1024);
    
    return {
      totalEntries: this.memoryCache.size,
      memoryEntries: this.memoryCache.size,
      redisEntries: 0, // Would come from Redis in production
      databaseEntries: 0, // Would query database count
      hitRate,
      missRate,
      averageAccessTimeMs,
      memoryUsageMB,
      evictions: this.stats.evictions,
      staleEntries,
      namespaceStats: {
        default: {
          entries: this.memoryCache.size,
          hitRate,
          averageTtlSeconds: this.memoryCache.size > 0 ? totalTtlSeconds / this.memoryCache.size : 0
        }
      }
    };
  }
  
  /**
   * Clear all caches
   */
  async clearAllCaches(): Promise<{ memory: number; database: number }> {
    const memoryCount = this.memoryCache.size;
    this.memoryCache.clear();
    
    let databaseCount = 0;
    try {
      const result = await this.prisma.hybridSearchCache.deleteMany({});
      databaseCount = result.count;
    } catch (error) {
      logger.error('Failed to clear database cache', { error: error instanceof Error ? error.message : String(error) });
    }
    
    logger.info('All caches cleared', { memoryCount, databaseCount });
    return { memory: memoryCount, database: databaseCount };
  }
  
  /**
   * Pre-warm cache with frequent queries
   */
  async prewarmCache(userId: string, commonQueries: string[]): Promise<void> {
    logger.info('Starting cache pre-warming', { userId, queryCount: commonQueries.length });
    
    for (const queryText of commonQueries) {
      try {
        const cacheKey = this.generateCacheKey({
          userId,
          queryText,
          limit: 20,
          vectorWeight: 0.4,
          graphWeight: 0.3,
          bm25Weight: 0.3
        });
        
        // Check if already cached
        const cached = await this.getSearchResults(cacheKey);
        if (!cached.cached) {
          // In production, this would execute the search and cache results
          logger.debug('Cache pre-warm entry', { userId, queryText, cacheKey });
        }
        
      } catch (error) {
        logger.warn('Cache pre-warm failed for query', {
          error: error instanceof Error ? error.message : String(error),
          userId,
          queryText
        });
      }
    }
    
    logger.info('Cache pre-warming completed', { userId });
  }
  
  /**
   * Semantic cache: Find similar cached queries
   */
  async findSimilarCachedQueries(
    query: SearchQueryCacheKey,
    similarityThreshold: number = 0.8
  ): Promise<Array<{ cacheKey: string; similarity: number; value: any }>> {
    // In production, this would use embedding similarity
    // For now, return empty array
    return [];
  }
  
  /**
   * Start background cleanup job
   */
  private startCleanupJob(): void {
    // Clean up expired memory cache entries every 5 minutes
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 5 * 60 * 1000);
    
    // Log cache statistics every 15 minutes
    setInterval(() => {
      this.logCacheStats();
    }, 15 * 60 * 1000);
  }
  
  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [key, entry] of this.memoryCache) {
      if (entry.expiresAt < now) {
        this.memoryCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug('Memory cache cleanup completed', { cleanedCount });
    }
    
    // Also clean up expired database entries
    this.cleanupExpiredDatabaseEntries().catch(error => {
      logger.error('Database cache cleanup failed', { error: error instanceof Error ? error.message : String(error) });
    });
  }
  
  private async cleanupExpiredDatabaseEntries(): Promise<number> {
    try {
      const result = await this.prisma.hybridSearchCache.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });
      
      if (result.count > 0) {
        logger.debug('Database cache cleanup completed', { cleanedCount: result.count });
      }
      
      return result.count;
      
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Log cache statistics
   */
  private logCacheStats(): void {
    const stats = this.getCacheStats();
    
    logger.info('Cache statistics', {
      totalEntries: stats.totalEntries,
      hitRate: stats.hitRate.toFixed(3),
      missRate: stats.missRate.toFixed(3),
      averageAccessTimeMs: stats.averageAccessTimeMs.toFixed(2),
      memoryUsageMB: stats.memoryUsageMB.toFixed(2),
      evictions: stats.evictions,
      staleEntries: stats.staleEntries
    });
  }
  
  /**
   * Optimize search query with caching hints
   */
  optimizeSearchQuery(query: SearchQueryCacheKey): {
    useCache: boolean;
    cacheOptions: CacheOptions;
    queryOptimizations: string[];
  } {
    const optimizations: string[] = [];
    let useCache = true;
    const cacheOptions: CacheOptions = { ttlSeconds: 300 }; // Default 5 minutes
    
    // Determine cache TTL based on query characteristics
    if (query.queryText.length < 3) {
      // Very short queries might be too generic
      cacheOptions.ttlSeconds = 60; // 1 minute
      optimizations.push('Short query - reduced cache TTL');
    } else if (query.queryText.length > 100) {
      // Very long queries are likely unique
      cacheOptions.ttlSeconds = 600; // 10 minutes
      optimizations.push('Long query - increased cache TTL');
    }
    
    // Check for real-time data requirements
    const realTimeKeywords = ['now', 'today', 'recent', 'latest', 'current'];
    if (realTimeKeywords.some(keyword => query.queryText.toLowerCase().includes(keyword))) {
      useCache = false;
      optimizations.push('Real-time keyword detected - bypassing cache');
    }
    
    // Check for user-specific filters
    if (query.filters && Object.keys(query.filters).length > 0) {
      cacheOptions.namespace = `user:${query.userId}:filters`;
      optimizations.push('Filtered query - using namespace caching');
    }
    
    return {
      useCache,
      cacheOptions,
      queryOptimizations: optimizations
    };
  }
  
  /**
   * Batch cache multiple search results
   */
  async batchCacheSearchResults(
    queries: Array<{ query: SearchQueryCacheKey; results: any }>,
    options: CacheOptions = {}
  ): Promise<void> {
    logger.info('Batch caching search results', { batchSize: queries.length });
    
    const batchPromises = queries.map(async ({ query, results }) => {
      const cacheKey = this.generateCacheKey(query);
      await this.setSearchResults(cacheKey, results, options);
    });
    
    await Promise.allSettled(batchPromises);
    
    logger.info('Batch caching completed', { 
      batchSize: queries.length,
      successful: queries.length
    });
  }
}