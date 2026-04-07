import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';
import * as userProfileService from '../services/user-profile.service';

const router: IRouter = Router();

// GET /user-profile — returns profile (creates default if needed)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const profile = await userProfileService.getOrCreateProfile(userId, prisma);
    res.json(profile);
  } catch (err) { next(err); }
});

// PATCH /user-profile — partial update
router.patch('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const profile = await userProfileService.updateProfile(userId, req.body, prisma);
    res.json(profile);
  } catch (err) { next(err); }
});

export const userProfileRouter: IRouter = router;
