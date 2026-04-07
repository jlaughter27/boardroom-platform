import { Router } from 'express';
import type { IRouter } from 'express';
import { hashPassword, verifyPassword, createToken, authMiddleware, type AuthRequest } from '../middleware/auth';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'body', message: 'email, password, and name required' }],
      });
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = await omnimindClient.registerUser(email, passwordHash, name);
    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
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

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'body', message: 'email and password required' }],
      });
      return;
    }
    const user = await omnimindClient.getUserByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid email or password' });
      return;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid email or password' });
      return;
    }
    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ userId: user.id, name: user.name });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('boardroom_token');
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
    res.json({ userId: user.id, email: user.email, name: user.name });
  } catch (err) { next(err); }
});

export const authRouter = router;
