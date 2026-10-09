import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { z } from 'zod';
import { KnowledgeGraphQuerySchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import { getBacklinks, getKnowledgeGraph, parseNodeId } from '../services/knowledge-graph.service';
import {
  LINKABLE_ENTITY_TYPES,
  UNLINKED_MENTIONS_MAX_LIMIT,
  findUnlinkedMentions,
  linkMention,
} from '../services/unlinked-mentions.service';

const router: IRouter = Router();

/**
 * GET /graph — knowledge-graph projection for the Obsidian-style graph view.
 *
 * Query: types=goal,project,… · domain=business · memoryLimit=150 · includeArchived=false
 * Response: KnowledgeGraph (nodes, edges, stats, generatedAt) — see shared/types/graph.types.ts
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
      return;
    }

    const parsed = KnowledgeGraphQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const graph = await getKnowledgeGraph(
      userId,
      { ...parsed.data, tenantId: req.agentContext?.tenantId },
      prisma,
    );
    res.json(graph);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Phase 6 (A2) — backlinks + unlinked mentions
// ---------------------------------------------------------------------------

/**
 * GET /graph/backlinks/:nodeId — `nodeId` = `type:refId`.
 * Response: { node: KnowledgeGraphNode, backlinks: Array<{ node, edge }> }
 * Every edge incident to the node (both directions; `edge.source`/`edge.target`
 * give the direction). Memory backlinks are tenant-scoped under an agent context.
 */
router.get('/backlinks/:nodeId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
      return;
    }
    if (!parseNodeId(req.params.nodeId)) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'nodeId', message: 'nodeId must be <type>:<refId> with type in goal|project|task|person|decision|commitment|memory' }],
      });
      return;
    }

    const result = await getBacklinks(
      userId,
      req.params.nodeId,
      {
        tenantId: req.agentContext?.tenantId,
        includeArchived: typeof req.query.includeArchived === 'string' && req.query.includeArchived.toLowerCase() === 'true',
      },
      prisma,
    );
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Node not found' }); return; }
    res.json(result);
  } catch (err) { next(err); }
});

const UnlinkedMentionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(UNLINKED_MENTIONS_MAX_LIMIT).optional(),
});

/**
 * GET /graph/unlinked-mentions?limit=50
 * Response: { items: Array<{ memoryId, memoryTitle, entityType, entityId, entityLabel, snippet }> }
 */
router.get('/unlinked-mentions', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
      return;
    }
    const parsed = UnlinkedMentionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const result = await findUnlinkedMentions(
      userId,
      { limit: parsed.data.limit, tenantId: req.agentContext?.tenantId },
      prisma,
    );
    res.json(result);
  } catch (err) { next(err); }
});

const LinkMentionBodySchema = z.object({
  memoryId: z.string().min(1),
  entityType: z.enum(LINKABLE_ENTITY_TYPES as unknown as [string, ...string[]]),
  entityId: z.string().min(1),
});

/**
 * POST /graph/unlinked-mentions/link — body { memoryId, entityType, entityId }
 * Creates the `relates_to` MemoryEntityLink. 201 created / 200 already linked / 404.
 */
router.post('/unlinked-mentions/link', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
      return;
    }
    const parsed = LinkMentionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const result = await linkMention(
      userId,
      { memoryId: parsed.data.memoryId, entityType: parsed.data.entityType as typeof LINKABLE_ENTITY_TYPES[number], entityId: parsed.data.entityId },
      { tenantId: req.agentContext?.tenantId },
      prisma,
    );
    if (!result.ok) {
      res.status(404).json({ error: 'not_found', message: result.reason === 'memory_not_found' ? 'Memory not found' : 'Entity not found' });
      return;
    }
    res.status(result.created ? 201 : 200).json(result.link);
  } catch (err) { next(err); }
});

export const knowledgeGraphRouter = router;
