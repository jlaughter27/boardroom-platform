import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemory, updateMemory } from '../../../src/services/memory.service';
import { runValidationPipeline } from '../../../src/memory/validation/pipeline';
import { embedMemory, generateEmbeddingWithRetry } from '../../../src/services/embedding.service';

vi.mock('../../../src/memory/validation/pipeline');
vi.mock('../../../src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue(null),
  getEmbeddingStatus: vi.fn().mockResolvedValue('ready'),
}));
vi.mock('../../../src/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

/**
 * H2 (adversarial e2e 2026-10-30): POST /memories stored ministry content
 * (201 + an OpenAI embedding_outbox row) for every spelling below, and an MCP
 * write in the tgfc-ministry tenant with no domain landed as `general`.
 * The service gate must refuse all of them BEFORE any row or outbox entry.
 */
const SPELLINGS = [
  'ministry​',
  '​ministry',
  'mіnistry',
  'ministry/pastoral',
  'ministries',
  'tgfc-ministry',
];

function makePrisma() {
  return {
    memoryEntry: {
      create: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    embeddingOutbox: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  } as any;
}

const base = { title: 't', content: 'invented pastoral note', sourceType: 'MANUAL', dedup: false };

describe('ministry data-sovereignty gate (H2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runValidationPipeline).mockResolvedValue({ valid: true, errors: [], durationMs: 1 } as any);
  });

  it.each(SPELLINGS)('createMemory refuses domain %j with MINISTRY_DEFERRED and enqueues nothing', async (domain) => {
    const prisma = makePrisma();
    await expect(createMemory('user-1', { ...base, domain }, prisma)).rejects.toMatchObject({
      statusCode: 503,
      body: { code: 'MINISTRY_DEFERRED' },
      refusal: true, // Lane F — sent with x-omnimind-refusal: 1, never trips BoardRoom's breaker
    });
    expect(prisma.memoryEntry.create).not.toHaveBeenCalled();
    expect(prisma.embeddingOutbox.upsert).not.toHaveBeenCalled();
    expect(generateEmbeddingWithRetry).not.toHaveBeenCalled();
  });

  it('createMemory refuses ANY domain when the effective tenant is tgfc-ministry', async () => {
    const prisma = makePrisma();
    const ctx = { agentId: 'mcp-token:pastor-1', tenantId: 'tgfc-ministry', sourceWeight: 1 };
    await expect(createMemory('user-1', { ...base, domain: 'general' }, ctx, prisma)).rejects.toMatchObject({
      statusCode: 503,
      body: { code: 'MINISTRY_DEFERRED' },
    });
    expect(prisma.memoryEntry.create).not.toHaveBeenCalled();
    expect(prisma.embeddingOutbox.upsert).not.toHaveBeenCalled();
    expect(generateEmbeddingWithRetry).not.toHaveBeenCalled();
  });

  it('createMemory honours OMNIMIND_MINISTRY_TENANT_ID', async () => {
    const prev = process.env.OMNIMIND_MINISTRY_TENANT_ID;
    process.env.OMNIMIND_MINISTRY_TENANT_ID = 'church-tenant';
    try {
      const prisma = makePrisma();
      const ctx = { agentId: 'a', tenantId: 'church-tenant', sourceWeight: 1 };
      await expect(createMemory('user-1', { ...base, domain: 'business' }, ctx, prisma)).rejects.toMatchObject({ statusCode: 503 });
      expect(prisma.memoryEntry.create).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.OMNIMIND_MINISTRY_TENANT_ID;
      else process.env.OMNIMIND_MINISTRY_TENANT_ID = prev;
    }
  });

  it('createMemory still stores a business memory in a business tenant (outbox enqueued)', async () => {
    const prisma = makePrisma();
    const ctx = { agentId: 'a', tenantId: 'josh-business', sourceWeight: 1 };
    const r = await createMemory('user-1', { ...base, domain: 'business' }, ctx, prisma);
    expect(r.success).toBe(true);
    expect(prisma.memoryEntry.create).toHaveBeenCalledTimes(1);
    expect(prisma.memoryEntry.create.mock.calls[0][0].data.domain).toBe('business');
    expect(prisma.embeddingOutbox.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(SPELLINGS)('updateMemory refuses changing a domain to %j', async (domain) => {
    const prisma = makePrisma();
    prisma.memoryEntry.findFirst.mockResolvedValue({ id: 'm1', domain: 'business', tenantId: null });
    await expect(updateMemory('user-1', 'm1', { domain }, prisma)).rejects.toMatchObject({ statusCode: 503 });
    expect(prisma.memoryEntry.update).not.toHaveBeenCalled();
    expect(embedMemory).not.toHaveBeenCalled();
  });

  it.each(['ministry/pastoral', '  MINISTRY ', 'ministry​', 'ministries'])(
    'updateMemory refuses editing an existing row stored as %j (legacy spelling)',
    async (domain) => {
      const prisma = makePrisma();
      prisma.memoryEntry.findFirst.mockResolvedValue({ id: 'm1', domain, tenantId: null });
      await expect(updateMemory('user-1', 'm1', { content: 'edited' }, prisma)).rejects.toMatchObject({ statusCode: 503 });
      expect(prisma.memoryEntry.update).not.toHaveBeenCalled();
    }
  );

  it('updateMemory refuses editing a row that lives in the ministry tenant, whatever its domain', async () => {
    const prisma = makePrisma();
    prisma.memoryEntry.findFirst.mockResolvedValue({ id: 'm1', domain: 'general', tenantId: 'tgfc-ministry' });
    await expect(updateMemory('user-1', 'm1', { content: 'edited' }, prisma)).rejects.toMatchObject({ statusCode: 503 });
    expect(prisma.memoryEntry.update).not.toHaveBeenCalled();
  });

  it('updateMemory refuses when the caller tenant is the ministry tenant', async () => {
    const prisma = makePrisma();
    prisma.memoryEntry.findFirst.mockResolvedValue({ id: 'm1', domain: 'general', tenantId: 'tgfc-ministry' });
    const ctx = { agentId: 'a', tenantId: 'tgfc-ministry', sourceWeight: 1 };
    await expect(updateMemory('user-1', 'm1', { title: 'x' }, ctx, prisma)).rejects.toMatchObject({ statusCode: 503 });
  });
});
