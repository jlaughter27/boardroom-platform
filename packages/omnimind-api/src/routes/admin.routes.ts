import { Router, type IRouter, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { HttpError } from '../middleware/error-handler';
import { summarizeRecentSessions } from '../services/session-summarizer.service';

// NOTE: this router is mounted behind `requireAdminKey` (F-104) in index.ts.
const router: IRouter = Router();

function wantsAllTenants(req: Request): boolean {
  return (
    typeof req.query.includeAllTenants === 'string' &&
    req.query.includeAllTenants.toLowerCase() === 'true'
  );
}

/**
 * Resolve the tenant filter for an admin route.
 *
 * Default: scope to `req.agentContext.tenantId` so an admin call from
 * tenant A can't see tenant B's data unless explicitly requested.
 *
 * Override: pass `?includeAllTenants=true` to view across all tenants.
 *
 * F-104 (2026-10-02): when NO agent context is attached (BoardRoom AI, curl)
 * the query no longer silently defaults to all tenants. The caller must opt
 * in explicitly with `?includeAllTenants=true`, otherwise 400.
 *
 * Returns null only for an explicit cross-tenant opt-in.
 */
function resolveTenantFilter(req: Request): string | null {
  if (wantsAllTenants(req)) return null;
  const ctxTenant = req.agentContext?.tenantId;
  if (ctxTenant) return ctxTenant;
  throw new HttpError(400, {
    code: 'tenant_scope_required',
    message: 'No agent context on this request; pass ?includeAllTenants=true to run a cross-tenant admin query',
  });
}


// GET /admin/stats — aggregate counts (tenant-scoped by default, ?includeAllTenants=true for global)
router.get('/stats', async (req, res, next) => {
  try {
    const tenantId = resolveTenantFilter(req);
    const memoryWhere = tenantId ? { deletedAt: null, tenantId } : { deletedAt: null };
    const summaryWhere = tenantId
      ? { sourceType: 'SESSION_SUMMARY' as any, deletedAt: null, tenantId }
      : { sourceType: 'SESSION_SUMMARY' as any, deletedAt: null };
    const agentWhere = tenantId ? { tenantId } : {};
    const tenantWhere = tenantId ? { id: tenantId } : {};
    const auditWhere = tenantId ? { tenantId } : {};

    const [
      memoryCount,
      agentCount,
      tenantCount,
      auditCount,
      summaryCount,
      recentAudit,
    ] = await Promise.all([
      prisma.memoryEntry.count({ where: memoryWhere }),
      prisma.agent.count({ where: agentWhere }),
      prisma.tenant.count({ where: tenantWhere }),
      prisma.mcpAuditLog.count({ where: auditWhere }),
      prisma.memoryEntry.count({ where: summaryWhere }),
      prisma.mcpAuditLog.findMany({
        where: auditWhere,
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      }),
    ]);

    res.json({
      memories: memoryCount,
      agents: agentCount,
      tenants: tenantCount,
      auditEntries: auditCount,
      sessionSummaries: summaryCount,
      lastActivity: recentAudit[0]?.createdAt ?? null,
    });
  } catch (err) { next(err); }
});

// GET /admin/agents — list agents (tenant-scoped by default)
router.get('/agents', async (req, res, next) => {
  try {
    const tenantId = resolveTenantFilter(req);
    const agents = await prisma.agent.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tenantId: true,
        scopes: true,
        sourceWeight: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
    res.json({ agents });
  } catch (err) { next(err); }
});

// GET /admin/audit — paginated audit log (tenant-scoped by default)
router.get('/audit', async (req, res, next) => {
  try {
    const QuerySchema = z.object({
      agentId: z.string().optional(),
      tenantId: z.string().optional(),
      toolName: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    });
    const q = QuerySchema.parse(req.query);
    const contextTenant = resolveTenantFilter(req);

    // Explicit q.tenantId wins; otherwise default to the agent's tenant unless includeAllTenants.
    const effectiveTenantId = q.tenantId ?? contextTenant ?? undefined;

    const where = {
      ...(q.agentId && { agentId: q.agentId }),
      ...(effectiveTenantId && { tenantId: effectiveTenantId }),
      ...(q.toolName && { toolName: q.toolName }),
    };

    const [entries, total] = await Promise.all([
      prisma.mcpAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
      }),
      prisma.mcpAuditLog.count({ where }),
    ]);

    res.json({ entries, total, offset: q.offset, limit: q.limit });
  } catch (err) { next(err); }
});

// GET /admin/memories — paginated memories (tenant-scoped by default)
router.get('/memories', async (req, res, next) => {
  try {
    const QuerySchema = z.object({
      agentId: z.string().optional(),
      tenantId: z.string().optional(),
      domain: z.string().optional(),
      sourceType: z.string().optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    });
    const query = QuerySchema.parse(req.query);
    const contextTenant = resolveTenantFilter(req);
    const effectiveTenantId = query.tenantId ?? contextTenant ?? undefined;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.agentId) where.agentId = query.agentId;
    if (effectiveTenantId) where.tenantId = effectiveTenantId;
    if (query.domain) where.domain = query.domain;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { content: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [memories, total] = await Promise.all([
      prisma.memoryEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          title: true,
          content: true,
          domain: true,
          sourceType: true,
          agentId: true,
          tenantId: true,
          importance: true,
          tags: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.memoryEntry.count({ where }),
    ]);

    res.json({ memories, total, offset: query.offset, limit: query.limit });
  } catch (err) { next(err); }
});

// GET /admin/contradictions — unresolved contradiction alerts.
// F-210: ContradictionAlert is keyed by user, not tenant. Default to the
// caller's user scope (x-user-id, or ?userId=); a cross-user listing requires
// an explicit ?includeAllTenants=true opt-in.
router.get('/contradictions', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset as string ?? '0', 10) || 0;

    const headerUser = req.headers['x-user-id'];
    const userId =
      (typeof req.query.userId === 'string' && req.query.userId) ||
      (typeof headerUser === 'string' && headerUser) ||
      null;

    let where: { resolvedAt: null; userId?: string };
    if (userId) {
      where = { resolvedAt: null, userId };
    } else if (wantsAllTenants(req)) {
      where = { resolvedAt: null };
    } else {
      throw new HttpError(400, {
        code: 'user_scope_required',
        message: 'Provide x-user-id (or ?userId=) to scope contradictions, or opt into ?includeAllTenants=true for all users',
      });
    }

    const [alerts, total] = await Promise.all([
      prisma.contradictionAlert.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.contradictionAlert.count({ where }),
    ]);

    res.json({ alerts, total, offset, limit });
  } catch (err) { next(err); }
});


// POST /admin/summarize — trigger session summarizer manually
router.post('/summarize', async (_req, res, next) => {
  try {
    logger.info('[admin] Manual session summarizer triggered');
    await summarizeRecentSessions(prisma);
    res.json({ status: 'ok', message: 'Session summarizer run complete' });
  } catch (err) { next(err); }
});

// GET /admin/duplicates — list memory pairs with cosine similarity above threshold.
// WS-6 F-102 — tenant-scoped by default; ?includeAllTenants=true requires
// explicit opt-in (and is still bounded by the caller's API key auth).
router.get('/duplicates', async (req, res, next) => {
  try {
    const threshold = Math.max(0, Math.min(1, parseFloat((req.query.threshold as string) ?? '0.85')));
    const tenantId = resolveTenantFilter(req);

    const pairs = tenantId
      ? await prisma.$queryRaw<Array<{
          a_id: string; a_title: string; a_created: Date;
          b_id: string; b_title: string; b_created: Date;
          cosine: number;
        }>>`
          SELECT
            a.id       AS a_id,
            a.title    AS a_title,
            a.created_at AS a_created,
            b.id       AS b_id,
            b.title    AS b_title,
            b.created_at AS b_created,
            1 - (a.embedding <=> b.embedding) AS cosine
          FROM "memory_entries" a
          JOIN "memory_entries" b
            ON a.id < b.id
           AND a.user_id = b.user_id
           AND a.tenant_id = b.tenant_id
          WHERE a.embedding IS NOT NULL
            AND b.embedding IS NOT NULL
            AND a.deleted_at IS NULL
            AND b.deleted_at IS NULL
            AND a.tenant_id = ${tenantId}
            AND 1 - (a.embedding <=> b.embedding) > ${threshold}
          ORDER BY cosine DESC
          LIMIT 100
        `
      : await prisma.$queryRaw<Array<{
          a_id: string; a_title: string; a_created: Date;
          b_id: string; b_title: string; b_created: Date;
          cosine: number;
        }>>`
          SELECT
            a.id       AS a_id,
            a.title    AS a_title,
            a.created_at AS a_created,
            b.id       AS b_id,
            b.title    AS b_title,
            b.created_at AS b_created,
            1 - (a.embedding <=> b.embedding) AS cosine
          FROM "memory_entries" a
          JOIN "memory_entries" b
            ON a.id < b.id
           AND a.user_id = b.user_id
          WHERE a.embedding IS NOT NULL
            AND b.embedding IS NOT NULL
            AND a.deleted_at IS NULL
            AND b.deleted_at IS NULL
            AND 1 - (a.embedding <=> b.embedding) > ${threshold}
          ORDER BY cosine DESC
          LIMIT 100
        `;
    res.json({ pairs, threshold });
  } catch (err) { next(err); }
});

// POST /admin/duplicates/merge — keep newer memory, archive older.
// WS-6 F-102 — verify the archive target belongs to the caller's tenant before
// any soft-delete. Cross-tenant merges are refused with 404 (deliberate — don't
// reveal existence of memories in other tenants).
router.post('/duplicates/merge', async (req, res, next) => {
  try {
    const { keepId, archiveId, userId } = req.body as { keepId: string; archiveId: string; userId: string };
    if (!keepId || !archiveId || !userId) {
      res.status(400).json({ error: 'keepId, archiveId, and userId are required' });
      return;
    }

    // F-104: same opt-in rule as the read routes — no agent context means the
    // caller must say ?includeAllTenants=true to touch rows outside a tenant.
    const callerTenant = resolveTenantFilter(req);

    const targetWhere: Record<string, unknown> = { id: archiveId, userId, deletedAt: null };
    if (callerTenant) targetWhere.tenantId = callerTenant;


    const target = await prisma.memoryEntry.findFirst({ where: targetWhere });
    if (!target) {
      // Don't distinguish "not found" from "wrong tenant" — same response in both.
      res.status(404).json({ error: 'not_found', message: 'Memory not found' });
      return;
    }

    await prisma.memoryEntry.updateMany({
      where: { id: archiveId, userId, deletedAt: null },
      data: { deletedAt: new Date(), status: 'ARCHIVED' as any },
    });

    logger.info('[admin] Duplicate merge: archived older memory', { keepId, archiveId, tenantId: callerTenant });
    res.json({ status: 'ok', kept: keepId, archived: archiveId });
  } catch (err) { next(err); }
});

// POST /admin/decay/run — trigger importance decay manually
router.post('/decay/run', async (_req, res, next) => {
  try {
    const { runImportanceDecay } = await import('../services/importance-decay.service.js');
    const result = await runImportanceDecay();
    res.json({ status: 'ok', ...result });
  } catch (err) { next(err); }
});

export default router;
