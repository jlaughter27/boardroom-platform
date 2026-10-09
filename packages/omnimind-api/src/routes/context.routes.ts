import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';
import { assembleContextForPersona } from '../services/context-assembler.service';
import { getCoreContext } from '../services/core-context.service';
import { reflectEntity, getCapsules } from '../services/reflection.service';
import type { PersonaId } from '@boardroom/shared';
import { ContextForPersonaBodySchema, ReflectRequestSchema, CapsulesQuerySchema } from '@boardroom/shared';
import { validateBody } from '../middleware/validate';
import { parseAsOf } from '../retrieval/temporal-validity';

const router: IRouter = Router();

const missingUser = (res: import('express').Response) =>
  res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });

// POST /context/for-persona
router.post('/for-persona', validateBody(ContextForPersonaBodySchema), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { missingUser(res); return; }

    const { query, persona, maxItems, includeEntities, asOf, includeArchived, memoryClass } = req.body as {
      query: string;
      persona: PersonaId;
      maxItems?: number;
      includeEntities?: string[];
      asOf?: string;
      includeArchived?: boolean;
      memoryClass?: string;
    };

    const result = await assembleContextForPersona(userId, query, persona, prisma, {
      maxItems,
      includeEntities,
      // Phase 6: temporal validity — "what did we believe at T".
      asOf: parseAsOf(asOf),
      // Phase 6 (lane B): Critic sends includeArchived:true + memoryClass:'DECISION'.
      includeArchived,
      memoryClass,
      // Tenant scope: MCP requests carry x-tenant-id via req.agentContext.
      // Legacy non-MCP callers (BoardRoom AI) have no agentContext — they
      // opt into all-tenants so the existing behavior is preserved.
      tenantId: req.agentContext?.tenantId,
      includeAllTenants: !req.agentContext?.tenantId,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /context/core — Phase 6 deterministic core block (60 s per-user cache)
router.get('/core', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { missingUser(res); return; }
    // R-O-05: constraint memories + cache slot are scoped to the agent tenant when present.
    res.json(await getCoreContext(userId, prisma, { tenantId: req.agentContext?.tenantId }));
  } catch (err) { next(err); }
});

// POST /context/reflect — Phase 6: reflect one entity now → capsule
router.post('/reflect', validateBody(ReflectRequestSchema), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { missingUser(res); return; }
    const { entityType, entityId } = req.body as typeof ReflectRequestSchema._output;
    const capsule = await reflectEntity(userId, entityType, entityId, prisma);
    res.json(capsule);
  } catch (err) { next(err); }
});

// GET /context/capsules?entityIds=goal:x,project:y — Phase 6
router.get('/capsules', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { missingUser(res); return; }
    const q = CapsulesQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: q.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }
    const items = await getCapsules(userId, q.data.entityIds, prisma);
    res.json({ items });
  } catch (err) { next(err); }
});

// NOTE: POST /context/session-summary was a Phase 1 stub (501). Removed rather
// than shipping a dead endpoint. Re-add with a real implementation when
// session summary extraction is built (see audit plan §5, item #5).

export const contextRouter: IRouter = router;
