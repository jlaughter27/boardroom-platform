import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMemory,
  getMemory,
  searchMemories,
  updateMemory,
  archiveMemory,
  validateMemoryInput,
} from '../../../src/services/memory.service';
import { runValidationPipeline } from '../../../src/memory/validation/pipeline';
import { embedMemory, generateEmbeddingWithRetry } from '../../../src/services/embedding.service';
import { SOURCE_WEIGHTS } from '@boardroom/shared';

// Mock dependencies
vi.mock('../../../src/memory/validation/pipeline');
// WS-7: vi.mock without a factory turns every export into undefined, which
// breaks `generateEmbeddingWithRetry(...).catch(...)` in createMemory.
// Provide a factory that returns Promise-shaped resolves.
vi.mock('../../../src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue(null),
  getEmbeddingStatus: vi.fn().mockResolvedValue('ready'),
}));
vi.mock('../../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Memory Service', () => {
  const mockPrisma = {
    memoryEntry: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  } as any;
  
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embedMemory).mockResolvedValue(undefined);
    vi.mocked(runValidationPipeline).mockResolvedValue({
      valid: true,
      errors: [],
      durationMs: 10,
    });
  });

  describe('createMemory', () => {
    const validInput = {
      title: 'Test Memory',
      content: 'Test content',
      domain: 'business',
      sourceType: 'MANUAL',
      tags: ['test'],
      memoryClass: 'SEMANTIC',
      importance: 0.7,
      confidence: 'HIGH',
      sourceRef: null,
      metadata: { custom: 'data' },
    };
    
    it('should create memory with validation', async () => {
      const mockMemory = {
        id: 'mem-123',
        userId: 'user-1',
        ...validInput,
        sourceWeight: SOURCE_WEIGHTS.MANUAL,
        status: 'DRAFT',
        version: 1,
        createdAt: new Date(),
      };
      
      mockPrisma.memoryEntry.create.mockResolvedValue(mockMemory);
      
      const result = await createMemory('user-1', validInput, mockPrisma);
      
      expect(runValidationPipeline).toHaveBeenCalledWith(
        validInput,
        'user-1',
        'business',
        mockPrisma
      );
      // WS-7: WS-1 added agentId propagation. Non-MCP callers default to
      // 'boardroom-ai' (the service-layer counterpart to the migration's
      // 'legacy' DB default). Update assertion to match the live signature.
      expect(mockPrisma.memoryEntry.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          title: 'Test Memory',
          content: 'Test content',
          domain: 'business',
          sourceType: 'MANUAL',
          sector: '',
          tags: ['test'],
          memoryClass: 'SEMANTIC',
          importance: 0.7,
          confidence: 'HIGH',
          sourceRef: null,
          sourceWeight: SOURCE_WEIGHTS.MANUAL,
          status: 'DRAFT',
          metadata: { custom: 'data' },
          agentId: 'boardroom-ai',
        },
      });
      expect(embedMemory).toHaveBeenCalledWith('mem-123');
      expect(result).toEqual({
        success: true,
        data: {
          id: 'mem-123',
          status: 'created',
          validation: { syncPassed: true, errors: [] },
        },
      });
    });

    it('should return validation errors when validation fails', async () => {
      vi.mocked(runValidationPipeline).mockResolvedValue({
        valid: false,
        errors: [{ field: 'title', message: 'Required' }],
        durationMs: 5,
      });
      
      const result = await createMemory('user-1', validInput, mockPrisma);
      
      expect(result).toEqual({
        success: false,
        errors: [{ field: 'title', message: 'Required' }],
      });
      expect(mockPrisma.memoryEntry.create).not.toHaveBeenCalled();
    });

    it('should use default values for optional fields', async () => {
      const inputWithoutOptional = {
        title: 'Test',
        content: 'Content',
        domain: 'business',
        sourceType: 'MANUAL',
      };
      
      const mockMemory = {
        id: 'mem-123',
        userId: 'user-1',
        ...inputWithoutOptional,
        sourceWeight: SOURCE_WEIGHTS.MANUAL,
        status: 'DRAFT',
      };
      
      mockPrisma.memoryEntry.create.mockResolvedValue(mockMemory);
      
      await createMemory('user-1', inputWithoutOptional, mockPrisma);
      
      // WS-7: WS-1 added agentId propagation (see comment above).
      expect(mockPrisma.memoryEntry.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          title: 'Test',
          content: 'Content',
          domain: 'business',
          sourceType: 'MANUAL',
          sector: '',
          tags: [],
          memoryClass: 'SEMANTIC',
          importance: 0.5,
          confidence: 'MEDIUM',
          sourceRef: null,
          sourceWeight: SOURCE_WEIGHTS.MANUAL,
          status: 'DRAFT',
          metadata: {},
          agentId: 'boardroom-ai',
        },
      });
    });

    it('should use source weight based on sourceType', async () => {
      // WS-7: 'EMAIL' is no longer a valid SourceType — WS-4.2 introduced
      // strict validation. Use MCP_AGENT, which is in the canonical set and
      // has its own distinct sourceWeight.
      const input = {
        ...validInput,
        sourceType: 'MCP_AGENT',
      };

      mockPrisma.memoryEntry.create.mockResolvedValue({ id: 'mem-123' });

      await createMemory('user-1', input, mockPrisma);

      expect(mockPrisma.memoryEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceWeight: SOURCE_WEIGHTS.MCP_AGENT,
          }),
        })
      );
    });
  });

  describe('getMemory', () => {
    it('should return memory when found', async () => {
      // WS-7: include `domain` so the service's decryptMemory() pass through
      // normalizeDomain() doesn't crash on undefined.
      const mockMemory = {
        id: 'mem-123',
        userId: 'user-1',
        title: 'Test',
        domain: 'business',
        content: 'Test content',
        encryptedContent: null,
      };

      mockPrisma.memoryEntry.findFirst.mockResolvedValue(mockMemory);
      
      const result = await getMemory('user-1', 'mem-123', mockPrisma);
      
      expect(mockPrisma.memoryEntry.findFirst).toHaveBeenCalledWith({
        where: { id: 'mem-123', userId: 'user-1', deletedAt: null },
      });
      expect(result).toBe(mockMemory);
    });

    it('should return null when memory not found', async () => {
      mockPrisma.memoryEntry.findFirst.mockResolvedValue(null);
      
      const result = await getMemory('user-1', 'nonexistent', mockPrisma);
      
      expect(result).toBeNull();
    });
  });

  describe('searchMemories', () => {
    it('should search with default parameters', async () => {
      // WS-7: searchMemories passes each row through decryptMemory(),
      // which calls normalizeDomain(mem.domain). Include `domain` on each.
      const mockItems = [
        { id: 'mem-1', domain: 'business', content: 'c1', encryptedContent: null },
        { id: 'mem-2', domain: 'business', content: 'c2', encryptedContent: null },
      ];
      const mockTotal = 2;
      
      mockPrisma.memoryEntry.findMany.mockResolvedValue(mockItems);
      mockPrisma.memoryEntry.count.mockResolvedValue(mockTotal);
      
      const result = await searchMemories('user-1', {}, mockPrisma);
      
      expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          status: { not: 'ARCHIVED' },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
      expect(result).toEqual({
        items: mockItems,
        total: mockTotal,
        offset: 0,
        limit: 20,
      });
    });

    it('should apply filters', async () => {
      const filters = {
        q: 'search term',
        domain: 'business',
        tags: ['tag1', 'tag2'],
        memoryClass: 'SEMANTIC',
        status: 'DRAFT',
        since: '2024-01-01',
        sortBy: 'title',
        sortOrder: 'asc',
        limit: 50,
        offset: 10,
      };
      
      mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
      mockPrisma.memoryEntry.count.mockResolvedValue(0);
      
      await searchMemories('user-1', filters, mockPrisma);
      
      expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          domain: 'business',
          memoryClass: 'SEMANTIC',
          status: 'DRAFT',
          createdAt: { gte: new Date('2024-01-01') },
          tags: { hasEvery: ['tag1', 'tag2'] },
          OR: [
            { title: { contains: 'search term', mode: 'insensitive' } },
            { content: { contains: 'search term', mode: 'insensitive' } },
          ],
        },
        orderBy: { title: 'asc' },
        take: 50,
        skip: 10,
      });
    });

    it('should cap limit at 100', async () => {
      mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
      mockPrisma.memoryEntry.count.mockResolvedValue(0);
      
      await searchMemories('user-1', { limit: 200 }, mockPrisma);
      
      expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });
  });

  describe('updateMemory', () => {
    it('should update memory when found', async () => {
      // WS-7: include `domain` for normalizeDomain in service's update path.
      const existingMemory = {
        id: 'mem-123',
        userId: 'user-1',
        version: 1,
        domain: 'business',
        content: 'existing',
        encryptedContent: null,
      };

      const updatedMemory = {
        ...existingMemory,
        title: 'Updated',
        version: 2,
      };
      
      mockPrisma.memoryEntry.findFirst.mockResolvedValue(existingMemory);
      mockPrisma.memoryEntry.update.mockResolvedValue(updatedMemory);
      
      const result = await updateMemory('user-1', 'mem-123', { title: 'Updated' }, mockPrisma);
      
      expect(mockPrisma.memoryEntry.findFirst).toHaveBeenCalledWith({
        where: { id: 'mem-123', userId: 'user-1', deletedAt: null },
      });
      expect(mockPrisma.memoryEntry.update).toHaveBeenCalledWith({
        where: { id: 'mem-123' },
        data: {
          title: 'Updated',
          version: { increment: 1 },
        },
      });
      expect(embedMemory).toHaveBeenCalledWith('mem-123');
      expect(result).toBe(updatedMemory);
    });

    it('should return null when memory not found', async () => {
      mockPrisma.memoryEntry.findFirst.mockResolvedValue(null);
      
      const result = await updateMemory('user-1', 'nonexistent', { title: 'Updated' }, mockPrisma);
      
      expect(result).toBeNull();
      expect(mockPrisma.memoryEntry.update).not.toHaveBeenCalled();
    });

    it('should trigger embedding when content or title changed', async () => {
      // WS-7: include `domain` for normalizeDomain.
      const existingMemory = {
        id: 'mem-123',
        userId: 'user-1',
        version: 1,
        domain: 'business',
        content: 'existing',
        encryptedContent: null,
      };
      mockPrisma.memoryEntry.findFirst.mockResolvedValue(existingMemory);
      mockPrisma.memoryEntry.update.mockResolvedValue({ ...existingMemory, version: 2 });
      
      await updateMemory('user-1', 'mem-123', { content: 'New content' }, mockPrisma);
      expect(embedMemory).toHaveBeenCalledWith('mem-123');
      
      vi.clearAllMocks();
      await updateMemory('user-1', 'mem-123', { title: 'New title' }, mockPrisma);
      expect(embedMemory).toHaveBeenCalledWith('mem-123');
      
      vi.clearAllMocks();
      await updateMemory('user-1', 'mem-123', { tags: ['new'] }, mockPrisma);
      expect(embedMemory).not.toHaveBeenCalled();
    });
  });

  describe('archiveMemory', () => {
    it('should archive memory when found', async () => {
      const existingMemory = {
        id: 'mem-123',
        userId: 'user-1',
      };
      
      mockPrisma.memoryEntry.findFirst.mockResolvedValue(existingMemory);
      mockPrisma.memoryEntry.update.mockResolvedValue({});
      
      const result = await archiveMemory('user-1', 'mem-123', mockPrisma);
      
      expect(mockPrisma.memoryEntry.findFirst).toHaveBeenCalledWith({
        where: { id: 'mem-123', userId: 'user-1', deletedAt: null },
      });
      expect(mockPrisma.memoryEntry.update).toHaveBeenCalledWith({
        where: { id: 'mem-123' },
        data: {
          status: 'ARCHIVED',
          deletedAt: expect.any(Date),
        },
      });
      expect(result).toEqual({
        id: 'mem-123',
        status: 'archived',
      });
    });

    it('should return null when memory not found', async () => {
      mockPrisma.memoryEntry.findFirst.mockResolvedValue(null);
      
      const result = await archiveMemory('user-1', 'nonexistent', mockPrisma);
      
      expect(result).toBeNull();
      expect(mockPrisma.memoryEntry.update).not.toHaveBeenCalled();
    });
  });

  describe('validateMemoryInput', () => {
    it('should call validation pipeline', async () => {
      const input = { title: 'Test' };
      const validationResult = {
        valid: true,
        errors: [],
        durationMs: 5,
      };
      
      vi.mocked(runValidationPipeline).mockResolvedValue(validationResult);
      
      const result = await validateMemoryInput('user-1', input, 'business', mockPrisma);
      
      expect(runValidationPipeline).toHaveBeenCalledWith(input, 'user-1', 'business', mockPrisma);
      expect(result).toBe(validationResult);
    });
  });
});
