import { Router } from 'express';
import type { IRouter } from 'express';
import { prisma } from '../lib/db';

const router: IRouter = Router();

// GET /oauth/token/:provider — get token for user+provider
router.get('/token/:provider', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const token = await prisma.oAuthToken.findUnique({
      where: { userId_provider: { userId, provider: req.params.provider } },
    });
    res.json(token);
  } catch (err) { next(err); }
});

// POST /oauth/token — save/update token
router.post('/token', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const { provider, accessToken, refreshToken, expiresAt, scope, calendarId } = req.body;
    const token = await prisma.oAuthToken.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, accessToken, refreshToken, expiresAt: expiresAt ? new Date(expiresAt) : null, scope, calendarId },
      update: { accessToken, refreshToken, expiresAt: expiresAt ? new Date(expiresAt) : null, scope, calendarId },
    });
    res.json(token);
  } catch (err) { next(err); }
});

// DELETE /oauth/token/:provider — remove token
router.delete('/token/:provider', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    await prisma.oAuthToken.deleteMany({ where: { userId, provider: req.params.provider } });
    res.json({ status: 'deleted' });
  } catch (err) { next(err); }
});

export const oauthRouter = router;
