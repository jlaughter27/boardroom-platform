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
  // NOTE(0.25.3): `role` is the professional role string on UserProfile (PM, engineer, …),
  // NOT an authZ role. Auth-level privileges live on User and are NOT updatable through
  // this route. The denylist below enforces that intent at runtime.
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

// Phase 0.25.3 — explicit privilege-field denylist (defense in depth).
// `.strict()` above already rejects unknown keys with 422; this list returns
// 400 with a dedicated error code so the security intent is observable in
// logs/grep and is robust to future schema drift.
const PRIVILEGE_DENYLIST: readonly string[] = [
  'id',
  'userId',
  'email',
  'subscription',
  'subscriptionTier',
  'isAdmin',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'passwordHash',
] as const;

function rejectPrivilegeFields(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (!req.body || typeof req.body !== 'object') return next();
  const offending = PRIVILEGE_DENYLIST.filter((f) =>
    Object.prototype.hasOwnProperty.call(req.body, f),
  );
  if (offending.length > 0) {
    res.status(400).json({
      error: 'privilege_escalation_blocked',
      message: 'Attempt to update privilege fields was rejected',
      fields: offending,
    });
    return;
  }
  next();
}

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
// Phase 0.25.3: rejectPrivilegeFields runs BEFORE Zod so privilege attempts return 400
// (audit spec requirement) instead of the schema's default 422.
router.patch('/', rejectPrivilegeFields, validateBody(UpdateProfileSchema), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const profile = await userProfileService.updateProfile(userId, req.body, prisma);
    res.json(profile);
  } catch (err) { next(err); }
});

export const userProfileRouter: IRouter = router;
