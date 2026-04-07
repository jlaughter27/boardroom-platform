import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';

const router: IRouter = Router();

// GET /subscription — get by userId (returns null if none)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    res.json(subscription);
  } catch (err) { next(err); }
});

// POST /subscription — create
router.post('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const { stripeCustomerId, stripeSubscriptionId, status, plan, priceMonthly, trialEndsAt, currentPeriodEnd } = req.body;

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        status: status ?? 'TRIALING',
        plan: plan ?? 'pro',
        priceMonthly: priceMonthly ?? 0,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
        currentPeriodEnd: new Date(currentPeriodEnd),
      },
    });

    res.status(201).json(subscription);
  } catch (err) { next(err); }
});

// PATCH /subscription — update by userId
router.patch('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const existing = await prisma.subscription.findUnique({ where: { userId } });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Subscription not found' }); return; }

    const data: Record<string, unknown> = {};
    if (req.body.status !== undefined) data.status = req.body.status;
    if (req.body.plan !== undefined) data.plan = req.body.plan;
    if (req.body.priceMonthly !== undefined) data.priceMonthly = req.body.priceMonthly;
    if (req.body.trialEndsAt !== undefined) data.trialEndsAt = req.body.trialEndsAt ? new Date(req.body.trialEndsAt) : null;
    if (req.body.currentPeriodEnd !== undefined) data.currentPeriodEnd = new Date(req.body.currentPeriodEnd);
    if (req.body.canceledAt !== undefined) data.canceledAt = req.body.canceledAt ? new Date(req.body.canceledAt) : null;
    if (req.body.stripeCustomerId !== undefined) data.stripeCustomerId = req.body.stripeCustomerId;
    if (req.body.stripeSubscriptionId !== undefined) data.stripeSubscriptionId = req.body.stripeSubscriptionId;

    const subscription = await prisma.subscription.update({
      where: { userId },
      data,
    });

    res.json(subscription);
  } catch (err) { next(err); }
});

// DELETE /subscription — cancel (soft — set canceledAt)
router.delete('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const existing = await prisma.subscription.findUnique({ where: { userId } });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Subscription not found' }); return; }

    const subscription = await prisma.subscription.update({
      where: { userId },
      data: { canceledAt: new Date(), status: 'CANCELED' },
    });

    res.json(subscription);
  } catch (err) { next(err); }
});

export const subscriptionRouter: IRouter = router;
