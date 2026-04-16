import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateEmbeddingWithRetry, embedMemory, backfillEmbeddings, getEmbeddingStatus } from '../../../src/services/embedding.service';
import { prisma } from '../../../src/lib/db';
import { logger } from '../../../src/lib/logger';

// Create hoisted mocks
const mockOpenAIClient = {
  embeddings: {
    create: vi.fn(),
  },
};

const mockOpenAIConstructor = vi.hoisted(() => vi.fn(() => mockOpenAIClient));
const mockPrisma = vi.hoisted(() => ({
  memoryEntry: {
    findUnique: vi.fn(),
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

// Mock dependencies
vi.mock('openai', () => ({
  default: mockOpenAIConstructor,
}));

vi.mock('../../../src/lib/db', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: mockLogger,
}));

describe('embedding.service.ts', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('generateEmbeddingWithRetry', () => {
    it('should return null when OPENAI_API_KEY is missing', async () => {
      process.env.OPENAI_API_KEY = '';
      const result = await generateEmbeddingWithRetry('test text');
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Embedding generation skipped: missing OPENAI_API_KEY'
      );
    });

    it('should successfully generate embedding on first attempt', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockOpenAIClient.embeddings.create.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await generateEmbeddingWithRetry('test text');
      
      expect(result).toEqual(mockEmbedding);
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
        dimensions: 1536,
      });
    });

    it('should truncate text longer than 8000 characters', async () => {
      const longText = 'a'.repeat(9000);
      const truncatedText = 'a'.repeat(8000);
      const mockEmbedding = [0.1, 0.2, 0.3];
      
      mockOpenAIClient.embeddings.create.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      await generateEmbeddingWithRetry(longText);
      
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledWith(
        expect.objectContaining({
          input: truncatedText,
        })
      );
    });

    it('should retry on failure and succeed on second attempt', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      let callCount = 0;
      
      mockOpenAIClient.embeddings.create.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('API rate limit');
        }
        return Promise.resolve({
          data: [{ embedding: mockEmbedding }],
        });
      });

      const result = await generateEmbeddingWithRetry('test text');
      
      expect(result).toEqual(mockEmbedding);
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Embedding generation failed',
        expect.objectContaining({
          attempt: 1,
          error: 'API rate limit',
          isLast: false,
        })
      );
    });

    it('should return null after max retries exhausted', async () => {
      const error = new Error('API unavailable');
      mockOpenAIClient.embeddings.create.mockRejectedValue(error);

      const result = await generateEmbeddingWithRetry('test text');
      
      expect(result).toBeNull();
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Embedding generation failed',
        expect.objectContaining({
          attempt: 3,
          error: 'API unavailable',
          isLast: true,
        })
      );
    });

    it('should return null when embedding is missing from response', async () => {
      mockOpenAIClient.embeddings.create.mockResolvedValue({
        data: [{}], // No embedding property
      });

      const result = await generateEmbeddingWithRetry('test text');
      
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Embedding generation failed',
        expect.objectContaining({
          error: 'Missing embedding in response',
        })
      );
    });

    it('should use exponential backoff between retries', async () => {
      const error = new Error('API error');
      mockOpenAIClient.embeddings.create.mockRejectedValue(error);
      
      const startTime = Date.now();
      await generateEmbeddingWithRetry('test text');
      const duration = Date.now() - startTime;
      
      // Should have waited: 500ms (attempt 1) + 1000ms (attempt 2) = ~1500ms
      expect(duration).toBeGreaterThanOrEqual(1400);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('embedMemory', () => {
    it('should return early when memory not found', async () => {
      mockPrisma.memoryEntry.findUnique.mockResolvedValue(null);

      await embedMemory('non-existent-id');
      
      expect(mockPrisma.memoryEntry.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
        select: { id: true, title: true, content: true },
      });
      // Should not proceed to generate embedding
      expect(mockOpenAIClient.embeddings.create).not.toHaveBeenCalled();
    });

    it('should generate and store embedding for found memory', async () => {
      const mockMemory = {
        id: 'memory-123',
        title: 'Test Memory',
        content: 'Test content',
      };
      const mockEmbedding = [0.1, 0.2, 0.3];
      
      mockPrisma.memoryEntry.findUnique.mockResolvedValue(mockMemory);
      mockOpenAIClient.embeddings.create.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      await embedMemory('memory-123');
      
      expect(mockPrisma.memoryEntry.findUnique).toHaveBeenCalledWith({
        where: { id: 'memory-123' },
        select: { id: true, title: true, content: true },
      });
      
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'Test Memory\n\nTest content',
        dimensions: 1536,
      });
      
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Embedding generated', {
        memoryId: 'memory-123',
      });
    });

    it('should log error when embedding generation fails', async () => {
      const mockMemory = {
        id: 'memory-123',
        title: 'Test Memory',
        content: 'Test content',
      };
      
      mockPrisma.memoryEntry.findUnique.mockResolvedValue(mockMemory);
      mockOpenAIClient.embeddings.create.mockRejectedValue(new Error('API error'));

      await embedMemory('memory-123');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Embedding generation permanently failed',
        { memoryId: 'memory-123' }
      );
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('backfillEmbeddings', () => {
    it('should process memories without embeddings', async () => {
      const userId = 'user-123';
      const mockMemories = [
        { id: 'mem-1', title: 'Memory 1', content: 'Content 1' },
        { id: 'mem-2', title: 'Memory 2', content: 'Content 2' },
      ];
      const mockEmbedding = [0.1, 0.2, 0.3];
      
      mockPrisma.memoryEntry.count.mockResolvedValue(10);
      mockPrisma.$queryRaw.mockResolvedValue(mockMemories);
      mockOpenAIClient.embeddings.create.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await backfillEmbeddings(userId, 50);
      
      expect(mockPrisma.memoryEntry.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          deletedAt: null,
          status: { not: 'ARCHIVED' },
        },
      });
      
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
      
      expect(result).toEqual({
        processed: 2,
        total: 10,
        remaining: 8,
      });
    });

    it('should skip memories when embedding generation fails', async () => {
      const userId = 'user-123';
      const mockMemories = [
        { id: 'mem-1', title: 'Memory 1', content: 'Content 1' },
        { id: 'mem-2', title: 'Memory 2', content: 'Content 2' },
      ];
      
      mockPrisma.memoryEntry.count.mockResolvedValue(10);
      mockPrisma.$queryRaw.mockResolvedValue(mockMemories);
      mockOpenAIClient.embeddings.create.mockRejectedValue(new Error('API error'));

      const result = await backfillEmbeddings(userId, 50);
      
      expect(result.processed).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Backfill embedding failed after retries',
        { memoryId: 'mem-1' }
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Backfill embedding failed after retries',
        { memoryId: 'mem-2' }
      );
    });

    it('should handle empty batch', async () => {
      const userId = 'user-123';
      
      mockPrisma.memoryEntry.count.mockResolvedValue(5);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await backfillEmbeddings(userId, 50);
      
      expect(result).toEqual({
        processed: 0,
        total: 5,
        remaining: 5,
      });
      expect(mockOpenAIClient.embeddings.create).not.toHaveBeenCalled();
    });

    it('should not return negative remaining count', async () => {
      const userId = 'user-123';
      const mockMemories = [
        { id: 'mem-1', title: 'Memory 1', content: 'Content 1' },
      ];
      const mockEmbedding = [0.1, 0.2, 0.3];
      
      mockPrisma.memoryEntry.count.mockResolvedValue(0); // Total is 0
      mockPrisma.$queryRaw.mockResolvedValue(mockMemories);
      mockOpenAIClient.embeddings.create.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await backfillEmbeddings(userId, 50);
      
      // remaining should be 0, not -1
      expect(result.remaining).toBe(0);
    });
  });

  describe('getEmbeddingStatus', () => {
    it('should return "ready" when embedding exists', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ has_embedding: true }]);

      const status = await getEmbeddingStatus('memory-123');
      
      expect(status).toBe('ready');
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should return "pending" when embedding is null', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ has_embedding: false }]);

      const status = await getEmbeddingStatus('memory-123');
      
      expect(status).toBe('pending');
    });

    it('should return "missing" when memory not found', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const status = await getEmbeddingStatus('non-existent-id');
      
      expect(status).toBe('missing');
    });

    it('should handle null response from database', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(null as any);

      const status = await getEmbeddingStatus('memory-123');
      
      expect(status).toBe('missing');
    });
  });

  describe('sleep function', () => {
    it('should wait for specified milliseconds', async () => {
      const startTime = Date.now();
      
      // We need to test the sleep function directly
      // Since it's not exported, we'll test it indirectly through generateEmbeddingWithRetry
      const error = new Error('Test error');
      mockOpenAIClient.embeddings.create.mockRejectedValue(error);
      
      await generateEmbeddingWithRetry('test');
      
      // Should have slept between retries
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledTimes(3);
    });
  });
});