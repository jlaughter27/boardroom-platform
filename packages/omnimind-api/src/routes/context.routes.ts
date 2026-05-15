import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';
import { assembleContextForPersona } from '../services/context-assembler.service';
import type { PersonaId } from '@boardroom/shared';
import { ContextForPersonaBodySchema } from '@boardroom/shared';
import { validateBody } from '../middleware/validate';

const router: IRouter = Router();

// POST /context/for-persona
router.post('/for-persona', validateBody(ContextForPersonaBodySchema), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({
        error: 'validation_failed',
        details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }],
      });
      return;
    }

    const { query, persona, maxItems, includeEntities } = req.body as {
      query: string;
      persona: PersonaId;
      maxItems?: number;
      includeEntities?: string[];
    };

    const result = await assembleContextForPersona(userId, query, persona, prisma, {
      maxItems,
      includeEntities,
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

// NOTE: POST /context/session-summary was a Phase 1 stub (501). Removed rather
// than shipping a dead endpoint. Re-add with a real implementation when
// session summary extraction is built (see audit plan §5, item #5).

export const contextRouter: IRouter = router;
