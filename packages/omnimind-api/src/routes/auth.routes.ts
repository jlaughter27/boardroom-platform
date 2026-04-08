import { Router } from 'express';
import type { Router as IRouter } from 'express';
import * as authService from '../services/auth.service';
import { logger } from '../lib/logger';

const router: IRouter = Router();

// POST /auth/register — create user + default team
router.post('/register', async (req, res, next) => {
  try {
    const { email, passwordHash, name } = req.body;
    if (!email || !passwordHash || !name) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'body', message: 'email, passwordHash, and name required' }],
      });
      return;
    }

    const user = await authService.registerUser({ email, passwordHash, name });
    logger.info('User registered', { userId: user.id, email: user.email });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      teamId: user.teamId,
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { code?: string }).code === 'CONFLICT') {
      res.status(409).json({ error: 'conflict', message: 'Email already registered' });
      return;
    }
    next(err);
  }
});

// POST /auth/login — look up user by email (BoardRoom verifies password)
router.post('/login', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'email', message: 'email is required' }],
      });
      return;
    }

    const user = await authService.getUserByEmail(email);
    if (!user) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }

    const { passwordHash, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) { next(err); }
});

// POST /auth/verify — server-side credential verification (passwordHash never leaves OmniMind)
router.post('/verify', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'validation_failed', message: 'email and password are required' });
      return;
    }
    const user = await authService.verifyCredentials(email, password);
    if (!user) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }
    res.json(user);
  } catch (err) { next(err); }
});

// GET /auth/user/:id — look up user by ID
router.get('/user/:id', async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      teamId: user.teamId,
    });
  } catch (err) { next(err); }
});

export const authRouter: IRouter = router;
