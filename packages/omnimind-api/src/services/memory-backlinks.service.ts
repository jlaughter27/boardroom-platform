import type { PrismaClient } from '@prisma/client';
import {
  MEMORY_BACKLINKS_MAX_ROWS,
  isMinistryDomain,
  isMinistryTenant,
  type MemoryBacklink,
  type MemoryBacklinksResponse,
} from '@boardroom/shared';

/**
 * Link rows store `entityType` lower-cased (POST /memories/:id/links and the
 * batch route normalise it); legacy rows may be mixed-case. Listing the spellings
 * keeps the `(entity_type, entity_id)` index usable (a case-insensitive match
 * would not).
 */
const MEMORY_ENTITY_TYPES = ['memory', 'Memory', 'MEMORY'];

/**
 * Memories that link TO `memoryId` (GET /memories/:id/backlinks, RD-1).
 *
 * Scoping matches the link routes: the target must be the user's and live (and
 * in `tenantId` when the caller is an agent); a source memory is listed only
 * when it is the user's, live, not ARCHIVED (unless `includeArchived`) and in
 * the same tenant — a backlink never crosses tenants. Returns null when the
 * target is not visible (→ 404).
 *
 * M5 (2026-10-30): a ministry source memory is never listed — not its title,
 * not its id — whatever the spelling of its domain (case, padding,
 * `ministry/*`, lookalikes; shared `isMinistryDomain`), and a source in the
 * ministry tenant is never listed to a caller outside that tenant.
 */
export async function getMemoryBacklinks(
  userId: string,
  memoryId: string,
  opts: { tenantId?: string; includeArchived?: boolean },
  prisma: PrismaClient,
): Promise<MemoryBacklinksResponse | null> {
  const tenant = opts.tenantId ? { tenantId: opts.tenantId } : {};
  const target = await prisma.memoryEntry.findFirst({
    where: { id: memoryId, userId, deletedAt: null, ...tenant },
    select: { id: true },
  });
  if (!target) return null;

  const links = await prisma.memoryEntityLink.findMany({
    where: { entityType: { in: MEMORY_ENTITY_TYPES }, entityId: memoryId },
    select: { memoryId: true, linkType: true },
    take: MEMORY_BACKLINKS_MAX_ROWS,
  });
  const truncated = links.length >= MEMORY_BACKLINKS_MAX_ROWS;

  const typesBySource = new Map<string, string[]>();
  for (const l of links) {
    if (l.memoryId === memoryId) continue; // self-links are refused on write; ignore any legacy row
    const types = typesBySource.get(l.memoryId) ?? [];
    if (!types.includes(l.linkType)) types.push(l.linkType);
    typesBySource.set(l.memoryId, types);
  }
  if (typesBySource.size === 0) return { items: [], truncated };

  const sources = await prisma.memoryEntry.findMany({
    where: {
      id: { in: [...typesBySource.keys()] },
      userId,
      deletedAt: null,
      ...tenant,
      ...(opts.includeArchived ? {} : { status: { not: 'ARCHIVED' as const } }),
      NOT: { domain: { equals: 'ministry', mode: 'insensitive' as const } },
    },
    select: { id: true, title: true, domain: true, status: true, tenantId: true },
  });

  const ministryTenantId = process.env.OMNIMIND_MINISTRY_TENANT_ID || undefined;
  const callerInMinistryTenant = isMinistryTenant(opts.tenantId, ministryTenantId);
  const visible = sources.filter((m) =>
    !isMinistryDomain(m.domain) && (callerInMinistryTenant || !isMinistryTenant(m.tenantId, ministryTenantId)));

  const items: MemoryBacklink[] = visible.map((m) => ({
    memoryId: m.id,
    title: m.title,
    domain: m.domain ?? null,
    status: String(m.status),
    linkTypes: typesBySource.get(m.id) ?? [],
  }));
  items.sort((a, b) => a.title.localeCompare(b.title) || a.memoryId.localeCompare(b.memoryId));
  return { items, truncated };
}
