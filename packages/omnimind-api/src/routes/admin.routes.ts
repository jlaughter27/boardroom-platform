import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { summarizeRecentSessions } from '../services/session-summarizer.service';

const router: IRouter = Router();

// GET /admin/stats — aggregate counts across tenants
router.get('/stats', async (_req, res, next) => {
  try {
    const [
      memoryCount,
      agentCount,
      tenantCount,
      auditCount,
      summaryCount,
      recentAudit,
    ] = await Promise.all([
      prisma.memoryEntry.count({ where: { deletedAt: null } }),
      prisma.agent.count(),
      prisma.tenant.count(),
      prisma.mcpAuditLog.count(),
      prisma.memoryEntry.count({ where: { sourceType: 'SESSION_SUMMARY' as any, deletedAt: null } }),
      prisma.mcpAuditLog.findMany({
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

// GET /admin/agents — list all agents with last-seen
router.get('/agents', async (_req, res, next) => {
  try {
    const agents = await prisma.agent.findMany({
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

// GET /admin/audit — paginated audit log with agent/tenant filters
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

    const where = {
      ...(q.agentId && { agentId: q.agentId }),
      ...(q.tenantId && { tenantId: q.tenantId }),
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

// GET /admin/memories — paginated memories with agent/tenant/domain filters
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

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.agentId) where.agentId = query.agentId;
    if (query.tenantId) where.tenantId = query.tenantId;
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

// GET /admin/contradictions — contradiction alerts across all users
router.get('/contradictions', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
    const offset = parseInt(req.query.offset as string ?? '0', 10);

    const [alerts, total] = await Promise.all([
      prisma.contradictionAlert.findMany({
        where: { resolvedAt: null },
        orderBy: { detectedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.contradictionAlert.count({ where: { resolvedAt: null } }),
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

// GET /admin/duplicates — list memory pairs with cosine similarity above threshold
router.get('/duplicates', async (req, res, next) => {
  try {
    const threshold = Math.max(0, Math.min(1, parseFloat((req.query.threshold as string) ?? '0.85')));
    const pairs = await prisma.$queryRaw<Array<{
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

// POST /admin/duplicates/merge — keep newer memory, archive older
router.post('/duplicates/merge', async (req, res, next) => {
  try {
    const { keepId, archiveId, userId } = req.body as { keepId: string; archiveId: string; userId: string };
    if (!keepId || !archiveId || !userId) {
      res.status(400).json({ error: 'keepId, archiveId, and userId are required' });
      return;
    }

    // Soft-delete the archived entry
    await prisma.memoryEntry.updateMany({
      where: { id: archiveId, userId, deletedAt: null },
      data: { deletedAt: new Date(), status: 'ARCHIVED' as any },
    });

    logger.info({ keepId, archiveId }, '[admin] Duplicate merge: archived older memory');
    res.json({ status: 'ok', kept: keepId, archived: archiveId });
  } catch (err) { next(err); }
});

// POST /admin/decay/run — trigger importance decay manually
router.post('/decay/run', async (_req, res, next) => {
  try {
    const { runImportanceDecay } = await import('../services/importance-decay.service');
    const result = await runImportanceDecay();
    res.json({ status: 'ok', ...result });
  } catch (err) { next(err); }
});

export default router;
