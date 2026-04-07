import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';
import { assembleContextForPersona } from '../services/context-assembler.service';
import type { PersonaId } from '@boardroom/shared';

const router: IRouter = Router();

// POST /context/for-persona
router.post('/for-persona', async (req, res, next) => {
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

    if (!query || !persona) {
      res.status(422).json({
        error: 'validation_failed',
        details: [
          ...(!query ? [{ field: 'query', message: 'query is required' }] : []),
          ...(!persona ? [{ field: 'persona', message: 'persona is required' }] : []),
        ],
      });
      return;
    }

    const result = await assembleContextForPersona(userId, query, persona, prisma, {
      maxItems,
      includeEntities,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /context/session-summary — STUB for Phase 1
router.post('/session-summary', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    message: 'Session summary extraction will be available in Phase 1',
  });
});

export const contextRouter: IRouter = router;
