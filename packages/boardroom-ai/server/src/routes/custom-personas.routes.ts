// Proxy routes for OmniMind custom personas CRUD
// BoardRoom client calls these; they forward to OmniMind with x-user-id

import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// GET /custom-personas — list user's custom personas
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getCustomPersonas(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /custom-personas — create
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createCustomPersona(req.auth!.userId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /custom-personas/:id — update
router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateCustomPersona(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /custom-personas/:id — delete
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.deleteCustomPersona(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

export const customPersonasRouter: IRouter = router;
