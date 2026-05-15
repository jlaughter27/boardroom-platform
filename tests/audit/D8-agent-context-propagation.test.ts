/**
 * D8 — Agent Context Propagation Audit Test
 *
 * Verifies the fix for Hermes findings Bugs #1, #2, #3, #5, #7: agent context
 * (`agentId`, `tenantId`, `sourceWeight`) must propagate from the request
 * layer through the service layer onto the persisted DB row.
 *
 * This test exercises the service-layer surface with mocked Prisma. The
 * higher-level E2E test (planned for WS-5) will verify the same invariants
 * against a real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMemory,
  updateMemory,
} from '../../packages/omnimind-api/src/services/memory.service';
import type { AgentContext } from '../../packages/omnimind-api/src/middleware/agent-context';

vi.mock('../../packages/omnimind-api/src/memory/validation/pipeline', () => ({
  runValidationPipeline: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

vi.mock('../../packages/omnimind-api/src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  // No dedup hit by default — return null so createMemory takes the create path.
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../packages/omnimind-api/src/lib/crypto', () => ({
  encrypt: vi.fn((s: string) => s),
  decrypt: vi.fn((s: string) => s),
}));

function makeMockPrisma() {
  return {
    memoryEntry: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  } as any;
}

const hermesContext: AgentContext = {
  agentId: 'hermes-test',
  tenantId: 'josh-business',
  sourceWeight: 0.9,
};

describe('D8 — Agent context propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createMemory writes agentId, tenantId, sourceWeight from context onto the DB row', async () => {
    const prisma = makeMockPrisma();
    prisma.memoryEntry.create.mockResolvedValue({
      id: 'mem-new', title: 't', content: 'c', domain: 'business',
      agentId: 'hermes-test', tenantId: 'josh-business', sourceWeight: 0.9,
    });

    const result = await createMemory(
      'user-1',
      {
        title: 'Hermes round-trip',
        content: 'Hermes wrote this',
        domain: 'business',
        sourceType: 'MCP_AGENT',
      },
      hermesContext,
      prisma
    );

    expect(result.success).toBe(true);
    expect(prisma.memoryEntry.create).toHaveBeenCalledTimes(1);

    const callData = prisma.memoryEntry.create.mock.calls[0][0].data;
    expect(callData.agentId).toBe('hermes-test');
    expect(callData.tenantId).toBe('josh-business');
    // sourceWeight from context (0.9) wins over the static SOURCE_WEIGHTS table value.
    expect(callData.sourceWeight).toBe(0.9);
  });

  it('createMemory without agent context leaves agentId unset (BoardRoom AI fallback)', async () => {
    const prisma = makeMockPrisma();
    prisma.memoryEntry.create.mockResolvedValue({ id: 'mem-1' });

    await createMemory(
      'user-1',
      {
        title: 'no-mcp write',
        content: 'no-mcp content',
        domain: 'business',
        sourceType: 'MANUAL',
      },
      undefined,
      prisma
    );

    const callData = prisma.memoryEntry.create.mock.calls[0][0].data;
    // No agentId on data => Prisma uses the schema default (null).
    expect(callData.agentId).toBeUndefined();
    expect(callData.tenantId).toBeUndefined();
    // sourceWeight still resolved via the static lookup (MANUAL = 1.0 per SOURCE_WEIGHTS).
    expect(typeof callData.sourceWeight).toBe('number');
  });

  it('createMemory accepts legacy (userId, input, prisma) signature for backward compat', async () => {
    const prisma = makeMockPrisma();
    prisma.memoryEntry.create.mockResolvedValue({ id: 'mem-legacy' });

    const result = await createMemory(
      'user-1',
      {
        title: 'legacy',
        content: 'no agent context',
        domain: 'business',
        sourceType: 'MANUAL',
      },
      prisma  // legacy: prisma passed as 3rd arg
    );

    expect(result.success).toBe(true);
    expect(prisma.memoryEntry.create).toHaveBeenCalledTimes(1);
  });

  it('updateMemory propagates agentId, tenantId, sourceWeight onto the update payload', async () => {
    const prisma = makeMockPrisma();
    prisma.memoryEntry.findFirst.mockResolvedValue({
      id: 'mem-1', userId: 'user-1', domain: 'business',
      agentId: 'old-agent', tenantId: 'josh-business',
    });
    prisma.memoryEntry.update.mockResolvedValue({
      id: 'mem-1', content: 'updated',
      agentId: 'hermes-test', tenantId: 'josh-business', sourceWeight: 0.9,
    });

    await updateMemory(
      'user-1',
      'mem-1',
      { content: 'updated content', tags: ['hermes'] },
      hermesContext,
      prisma
    );

    expect(prisma.memoryEntry.update).toHaveBeenCalledTimes(1);
    const data = prisma.memoryEntry.update.mock.calls[0][0].data;
    expect(data.agentId).toBe('hermes-test');
    expect(data.tenantId).toBe('josh-business');
    expect(data.sourceWeight).toBe(0.9);
  });

  it('updateMemory ownership check includes tenantId when context is present (cross-tenant defense)', async () => {
    const prisma = makeMockPrisma();
    prisma.memoryEntry.findFirst.mockResolvedValue(null); // simulates tenant mismatch

    const result = await updateMemory(
      'user-1',
      'mem-1',
      { content: 'attempt cross-tenant edit' },
      { agentId: 'hermes-test', tenantId: 'josh-personal', sourceWeight: 1.0 },
      prisma
    );

    expect(result).toBeNull();
    // Ownership query should include tenantId scope
    const whereArg = prisma.memoryEntry.findFirst.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe('josh-personal');
    expect(prisma.memoryEntry.update).not.toHaveBeenCalled();
  });

  it('dedup branch in createMemory propagates context onto the supersede update (Bug #3 fix)', async () => {
    // Force the dedup path: embed returns a vector, findNearDuplicate returns a hit.
    const { generateEmbeddingWithRetry } = await import(
      '../../packages/omnimind-api/src/services/embedding.service'
    );
    (generateEmbeddingWithRetry as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Array(1536).fill(0.01)
    );

    const prisma = makeMockPrisma();
    // findNearDuplicate uses $queryRaw — return a dupe hit.
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'mem-existing', importance: 0.5, tags: ['old'] },
    ]);
    // updateMemory's ownership check
    prisma.memoryEntry.findFirst.mockResolvedValueOnce({
      id: 'mem-existing', userId: 'user-1', domain: 'business',
    });
    prisma.memoryEntry.update.mockResolvedValue({
      id: 'mem-existing',
    });

    await createMemory(
      'user-1',
      {
        title: 'paraphrase',
        content: 'paraphrase of an existing fact',
        domain: 'business',
        sourceType: 'MCP_AGENT',
      },
      hermesContext,
      prisma
    );

    expect(prisma.memoryEntry.update).toHaveBeenCalledTimes(1);
    const updateData = prisma.memoryEntry.update.mock.calls[0][0].data;
    // Before the fix: these were missing. After: must be present.
    expect(updateData.agentId).toBe('hermes-test');
    expect(updateData.tenantId).toBe('josh-business');
    expect(updateData.sourceWeight).toBe(0.9);
  });
});
