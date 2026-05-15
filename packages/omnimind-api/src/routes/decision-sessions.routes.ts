import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';

const router: IRouter = Router();

const CreateDecisionSessionSchema = z.object({
  id: z.string().min(1).optional(),
  question: z.string().min(1),
  mode: z.string().min(1).optional(),
  roomId: z.string().nullable().optional(),
});

const UpdateDecisionSessionSchema = z.object({
  question: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  personaResponses: z.record(z.unknown()).optional(),
  ceoSynthesis: z.unknown().optional(),
});

function requireUser(req: any, res: any): string | null {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
    return null;
  }
  return userId;
}

// POST /decision-sessions — create (id is optional; caller may supply its own)
router.post('/', async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const parsed = CreateDecisionSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const created = await prisma.decisionSession.create({
      data: {
        ...(parsed.data.id ? { id: parsed.data.id } : {}),
        userId,
        question: parsed.data.question,
        mode: parsed.data.mode ?? null,
        roomId: parsed.data.roomId ?? null,
        personaResponses: {},
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /decision-sessions — list
router.get('/', async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10) || 20, 100);
    const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

    const where = { userId, deletedAt: null };
    const [items, total] = await Promise.all([
      prisma.decisionSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.decisionSession.count({ where }),
    ]);

    res.json({ items, total, offset, limit });
  } catch (err) { next(err); }
});

// GET /decision-sessions/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const session = await prisma.decisionSession.findFirst({
      where: { id: req.params.id, userId, deletedAt: null },
    });
    if (!session) { res.status(404).json({ error: 'not_found', message: 'Decision session not found' }); return; }
    res.json(session);
  } catch (err) { next(err); }
});

// PATCH /decision-sessions/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const parsed = UpdateDecisionSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const existing = await prisma.decisionSession.findFirst({
      where: { id: req.params.id, userId, deletedAt: null },
    });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Decision session not found' }); return; }

    const data: Record<string, unknown> = {};
    if (parsed.data.question !== undefined) data.question = parsed.data.question;
    if (parsed.data.mode !== undefined) data.mode = parsed.data.mode;
    if (parsed.data.personaResponses !== undefined) data.personaResponses = parsed.data.personaResponses as object;
    if (parsed.data.ceoSynthesis !== undefined) {
      data.ceoSynthesis = parsed.data.ceoSynthesis === null
        ? null
        : typeof parsed.data.ceoSynthesis === 'string'
          ? parsed.data.ceoSynthesis
          : JSON.stringify(parsed.data.ceoSynthesis);
    }

    const updated = await prisma.decisionSession.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /decision-sessions/:id — soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const existing = await prisma.decisionSession.findFirst({
      where: { id: req.params.id, userId, deletedAt: null },
    });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Decision session not found' }); return; }

    await prisma.decisionSession.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    res.json({ id: req.params.id, status: 'deleted' });
  } catch (err) { next(err); }
});

export const decisionSessionsRouter: IRouter = router;
