/**
 * Direct-Prisma assertion helpers for E2E tests.
 *
 * The whole point of these tests is to assert against the DB row, not the
 * tool response. The MCP tool can say "created" while the row has
 * `agent_id IS NULL` — that's exactly Bug #1. So every assertion in the 5
 * critical tests reaches past the API and asks the DB directly.
 *
 * Helpers are typed against the Prisma client so future schema changes
 * surface as type errors in tests, not runtime crashes.
 */

import type { PrismaClient } from '@prisma/client';

export interface MemoryRow {
  id: string;
  agentId: string;
  tenantId: string;
  sourceWeight: number;
  sourceType: string;
  domain: string;
  content: string;
  title: string;
}

export async function getMemoryRow(
  prisma: PrismaClient,
  id: string
): Promise<MemoryRow | null> {
  const row = await prisma.memoryEntry.findUnique({
    where: { id },
    select: {
      id: true,
      agentId: true,
      tenantId: true,
      sourceWeight: true,
      sourceType: true,
      domain: true,
      content: true,
      title: true,
    },
  });
  return row ?? null;
}

/**
 * Returns all memories matching a content substring. Used to verify a write
 * actually landed at the row level — by content, since the MCP tool returns
 * IDs but we may want to look up by the deterministic marker we wrote.
 */
export async function findMemoriesByContentMarker(
  prisma: PrismaClient,
  marker: string
): Promise<MemoryRow[]> {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      content: { contains: marker },
      deletedAt: null,
    },
    select: {
      id: true,
      agentId: true,
      tenantId: true,
      sourceWeight: true,
      sourceType: true,
      domain: true,
      content: true,
      title: true,
    },
  });
  return rows;
}

/**
 * Returns true iff a row has the expected value at the given field.
 *
 * We expose the per-field check (rather than letting callers fish in
 * `getMemoryRow().agentId`) because the assertion failures we want are about
 * specific SEAM bugs:
 *   - agent_id NULL → assertMemoryFieldValue(id, 'agentId', 'test-code-1.0')
 *   - sourceWeight 0.85 (fallback) instead of 0.9 → assertMemoryFieldValue(id, 'sourceWeight', 0.9)
 * Phrasing the assertion in those exact terms makes test failures self-explanatory.
 */
export async function assertMemoryFieldValue<K extends keyof MemoryRow>(
  prisma: PrismaClient,
  id: string,
  field: K,
  expected: MemoryRow[K]
): Promise<void> {
  const row = await getMemoryRow(prisma, id);
  if (!row) {
    throw new Error(`Memory ${id} not found in DB`);
  }
  if (row[field] !== expected) {
    throw new Error(
      `Memory ${id}.${String(field)} expected ${JSON.stringify(expected)} but got ${JSON.stringify(row[field])}`
    );
  }
}

export interface OutboxRow {
  id: string;
  memoryId: string;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  succeededAt: Date | null;
  createdAt: Date;
}

export async function getOutboxRow(
  prisma: PrismaClient,
  memoryId: string
): Promise<OutboxRow | null> {
  const row = await prisma.embeddingOutbox.findUnique({
    where: { memoryId },
  });
  return row ?? null;
}

/**
 * Poll for an outbox row keyed by memoryId. Useful because the MCP write path
 * is fire-and-forget for the outbox insert + first embed attempt — the test
 * write may return before the outbox row is persisted.
 */
export async function waitForOutboxRow(
  prisma: PrismaClient,
  memoryId: string,
  timeoutMs = 5000
): Promise<OutboxRow> {
  const deadline = Date.now() + timeoutMs;
  let last: OutboxRow | null = null;
  while (Date.now() < deadline) {
    last = await getOutboxRow(prisma, memoryId);
    if (last) return last;
    await sleep(100);
  }
  throw new Error(
    `Outbox row for memory ${memoryId} did not appear within ${timeoutMs}ms`
  );
}

/**
 * Did this memory get its embedding generated? Stored as `embedding IS NOT NULL`
 * on `memory_entries`. We use a raw query because Prisma can't read the
 * `Unsupported('vector')` column directly.
 */
export async function hasEmbedding(
  prisma: PrismaClient,
  memoryId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ has_embedding: boolean }>>`
    SELECT (embedding IS NOT NULL) AS has_embedding
    FROM "memory_entries"
    WHERE id = ${memoryId}
    LIMIT 1
  `;
  return rows[0]?.has_embedding === true;
}

export interface AuditRow {
  id: string;
  agentId: string;
  tenantId: string;
  toolName: string;
  durationMs: number;
  createdAt: Date;
}

export async function getAuditTrail(
  prisma: PrismaClient,
  agentId: string
): Promise<AuditRow[]> {
  const rows = await prisma.mcpAuditLog.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      agentId: true,
      tenantId: true,
      toolName: true,
      durationMs: true,
      createdAt: true,
    },
  });
  return rows;
}

/**
 * Count memory rows belonging to a given tenant. Crucial for tenant-isolation
 * assertions: if a B-tenant search returns A-tenant results, the count will
 * mismatch.
 */
export async function countMemoriesByTenant(
  prisma: PrismaClient,
  tenantId: string
): Promise<number> {
  return prisma.memoryEntry.count({
    where: { tenantId, deletedAt: null },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
