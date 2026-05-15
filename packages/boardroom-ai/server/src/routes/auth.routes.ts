import { Router } from 'express';
import type { IRouter } from 'express';
import { hashPassword, createToken, authMiddleware, type AuthRequest } from '../middleware/auth';
import { isAdminUser } from '../middleware/require-admin';
import { loginLimiter, registerLimiter } from '../middleware/auth-rate-limiter';
import { validateBody } from '../middleware/validate';
import { RegisterBodySchema, LoginBodySchema } from '@boardroom/shared';
import { omnimindClient } from '../services/omnimind-client';

const OMNIMIND_URL = process.env.OMNIMIND_API_URL ?? 'http://localhost:3333';
const getApiKey = () => {
  const key = process.env.OMNIMIND_API_KEY;
  if (!key) throw new Error('FATAL: OMNIMIND_API_KEY is not set');
  return key;
};

const router: IRouter = Router();

// POST /auth/register
router.post('/register', registerLimiter, validateBody(RegisterBodySchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    const passwordHash = await hashPassword(password);
    const user = await omnimindClient.registerUser(email, passwordHash, name);
    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(201).json({ userId: user.id, name: user.name });
  } catch (err: unknown) {
    const error = err as Error & { status?: number; upstream?: { error?: string } };
    if (error.status === 409 || error.upstream?.error === 'conflict') {
      res.status(409).json({
        error: 'validation_failed',
        details: [{ field: 'email', message: 'Email already registered' }],
      });
      return;
    }
    next(err);
  }
});

// POST /auth/login — delegates credential verification to OmniMind /auth/verify
// so that passwordHash never travels over the wire.
router.post('/login', loginLimiter, validateBody(LoginBodySchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Call OmniMind's /auth/verify endpoint (server-side bcrypt compare)
    const verifyRes = await fetch(`${OMNIMIND_URL}/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey(),
      },
      body: JSON.stringify({ email, password }),
    });

    if (verifyRes.status === 401) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid email or password' });
      return;
    }

    if (!verifyRes.ok) {
      const errBody = await verifyRes.json().catch(() => ({ error: 'upstream_error' }));
      throw Object.assign(new Error(`OmniMind POST /auth/verify: ${verifyRes.status}`), {
        status: verifyRes.status,
        upstream: errBody,
      });
    }

    const user = (await verifyRes.json()) as { id: string; email: string; name: string; teamId: string };
    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ userId: user.id, name: user.name });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('boardroom_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ status: 'ok' });
});

// GET /auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await omnimindClient.getUserById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      isAdmin: isAdminUser(user.id),
    });
  } catch (err) { next(err); }
});

// DELETE /auth/account — self-serve account deletion (soft-delete via OmniMind)
router.delete('/account', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.auth!.userId;
    await omnimindClient.deleteUser(userId);
    res.clearCookie('boardroom_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ status: 'deleted' });
  } catch (err) { next(err); }
});

export const authRouter = router;
