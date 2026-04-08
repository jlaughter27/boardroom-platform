import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { validateBody } from '../middleware/validate';
import * as userProfileService from '../services/user-profile.service';

const RiskProfileSchema = z.object({
  financial: z.number().min(0).max(1),
  technical: z.number().min(0).max(1),
  people: z.number().min(0).max(1),
  strategic: z.number().min(0).max(1),
});

const UpdateProfileSchema = z.object({
  role: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  decisionFrequency: z.string().max(100).optional(),
  riskProfile: RiskProfileSchema.optional(),
  valueHierarchy: z.array(z.string()).optional(),
  cognitivePatterns: z.unknown().optional(),
  decisionHistorySummary: z.string().max(5000).nullable().optional(),
  onboardingComplete: z.boolean().optional(),
  dashboardLayout: z.unknown().optional(),
}).strict();

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
router.patch('/', validateBody(UpdateProfileSchema), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const profile = await userProfileService.updateProfile(userId, req.body, prisma);
    res.json(profile);
  } catch (err) { next(err); }
});

export const userProfileRouter: IRouter = router;
