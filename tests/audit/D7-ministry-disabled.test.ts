/**
 * D7 — Ministry Domain Disabled Test
 *
 * Ministry writes must be refused with 503 MINISTRY_DEFERRED at both the
 * API service layer and the MCP tool layer. Deferred to Phase 6+.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemory, updateMemory } from '../../packages/omnimind-api/src/services/memory.service';
import { HttpError } from '../../packages/omnimind-api/src/middleware/error-handler';
import { memoryWriteTool } from '../../packages/omnimind-mcp/src/tools/memory.tool';
import type { AgentContext } from '../../packages/omnimind-mcp/src/types';
import type { OmniMindClient } from '../../packages/omnimind-mcp/src/lib/client';

// --- memory.service.ts tests ---

const mockPrisma = {
  memoryEntry: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
} as any;

vi.mock('../../packages/omnimind-api/src/memory/validation/pipeline', () => ({
  runValidationPipeline: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

vi.mock('../../packages/omnimind-api/src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../packages/omnimind-api/src/lib/crypto', () => ({
  encrypt: vi.fn((s: string) => s),
  decrypt: vi.fn((s: string) => s),
}));

describe('D7 — Ministry domain disabled', () => {
  describe('memory.service.ts — createMemory', () => {
    it('throws HttpError 503 MINISTRY_DEFERRED for domain=ministry', async () => {
      await expect(
        createMemory(
          'user-1',
          { title: 'test', content: 'pastoral note', domain: 'ministry', sourceType: 'MCP_AGENT' },
          mockPrisma
        )
      ).rejects.toThrow(HttpError);

      try {
        await createMemory(
          'user-1',
          { title: 'test', content: 'pastoral note', domain: 'ministry', sourceType: 'MCP_AGENT' },
          mockPrisma
        );
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).body.code).toBe('MINISTRY_DEFERRED');
      }
    });

    it('allows non-ministry domains through', async () => {
      mockPrisma.memoryEntry.create.mockResolvedValue({
        id: 'mem-1', title: 'test', content: 'business note', domain: 'business',
        tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business',
        createdAt: new Date(), updatedAt: new Date(), version: 1,
        memoryClass: 'SEMANTIC', confidence: 'MEDIUM', status: 'DRAFT',
        sector: '', sourceRef: null, sourceWeight: 1.0, metadata: {},
        encryptedContent: null, encryptionKeyId: null, encryptionAlgorithm: null,
        userId: 'user-1', deletedAt: null, lastAccessedAt: null,
      });

      const result = await createMemory(
        'user-1',
        { title: 'test', content: 'business note', domain: 'business', sourceType: 'MCP_AGENT' },
        mockPrisma
      );
      expect(result.success).toBe(true);
    });
  });

  describe('memory.service.ts — updateMemory', () => {
    it('throws HttpError 503 MINISTRY_DEFERRED when updating a ministry memory', async () => {
      mockPrisma.memoryEntry.findFirst.mockResolvedValue({
        id: 'mem-2', domain: 'ministry', deletedAt: null,
      });

      await expect(
        updateMemory('user-1', 'mem-2', { content: 'updated' }, mockPrisma)
      ).rejects.toThrow(HttpError);

      try {
        await updateMemory('user-1', 'mem-2', { content: 'updated' }, mockPrisma);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).statusCode).toBe(503);
        expect((err as HttpError).body.code).toBe('MINISTRY_DEFERRED');
      }
    });
  });

  // --- MCP tool layer ---

  describe('memory_write MCP tool', () => {
    const mockClient = {
      createMemory: vi.fn(),
      updateMemory: vi.fn(),
      searchMemories: vi.fn(),
      getMemory: vi.fn(),
      logAudit: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
    } as unknown as OmniMindClient;

    const ctx: AgentContext = {
      agentId: 'claude-code-josh',
      tenantId: 'josh-business',
      scopes: ['memory:write'],
      sourceWeight: 1.0,
    };

    beforeEach(() => vi.clearAllMocks());

    it('returns MINISTRY_DEFERRED error without calling the API', async () => {
      const tool = memoryWriteTool(mockClient, ctx);
      const result = await tool.execute({
        content: 'pastoral data',
        domain: 'ministry',
        tags: [],
        importance: 0.5,
        userId: 'user-1',
        skipExtraction: true,
      });

      expect((result as any).error).toBe('MINISTRY_DEFERRED');
      expect(mockClient.createMemory).not.toHaveBeenCalled();
    });
  });
});
