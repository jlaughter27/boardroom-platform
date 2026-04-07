import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateCustomPersonaRequestSchema, UpdateCustomPersonaRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';

const router: IRouter = Router();

// Helper to generate a personaId slug from the name
function toPersonaId(name: string): string {
  return `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

// GET /custom-personas — list user's custom personas
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const personas = await prisma.customPersona.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(personas);
  } catch (err) { next(err); }
});

// POST /custom-personas — create (max 3 per user)
router.post('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateCustomPersonaRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    // Enforce max 3 per user
    const count = await prisma.customPersona.count({ where: { userId } });
    if (count >= 3) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'limit', message: 'Maximum 3 custom personas' }] });
      return;
    }

    const data = parseResult.data;
    const personaId = toPersonaId(data.name);

    const persona = await prisma.customPersona.create({
      data: {
        userId,
        name: data.name,
        personaId,
        systemPrompt: data.systemPrompt,
        modelTier: data.modelTier ?? 'haiku',
        maxOutputTokens: data.maxOutputTokens ?? 1500,
        toolPermissions: data.toolPermissions ?? [],
        description: data.description ?? null,
        icon: data.icon ?? null,
      },
    });

    res.status(201).json(persona);
  } catch (err) { next(err); }
});

// PATCH /custom-personas/:id — update
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateCustomPersonaRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    // Verify ownership
    const existing = await prisma.customPersona.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Custom persona not found' }); return; }

    const data = parseResult.data;
    const updateData: Record<string, unknown> = { ...data };

    // If name changes, regenerate personaId
    if (data.name) {
      updateData.personaId = toPersonaId(data.name);
    }

    const persona = await prisma.customPersona.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json(persona);
  } catch (err) { next(err); }
});

// DELETE /custom-personas/:id — hard delete
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    // Verify ownership
    const existing = await prisma.customPersona.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Custom persona not found' }); return; }

    await prisma.customPersona.delete({ where: { id: req.params.id } });
    res.json({ status: 'deleted' });
  } catch (err) { next(err); }
});

export const customPersonasRouter: IRouter = router;
