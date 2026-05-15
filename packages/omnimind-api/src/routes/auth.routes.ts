import { Router } from 'express';
import type { Router as IRouter } from 'express';
import * as authService from '../services/auth.service';
import * as authExtras from '../services/auth-extras.service';
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

// DELETE /auth/user/:id — soft-delete the user account (GDPR compliance)
router.delete('/user/:id', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const result = await authService.softDeleteUser(userId);
    if (!result) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    logger.info('User soft-deleted', { userId });
    res.json({ id: userId, status: 'deleted' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Wave 3 Track E — auth-extras endpoints (SSO + password-reset + verify-email)
// All are service-to-service (x-api-key already required by global middleware).
// ---------------------------------------------------------------------------

// POST /auth/oauth/lookup-or-create — body { provider, providerUserId, email, name }
router.post('/oauth/lookup-or-create', async (req, res, next) => {
  try {
    const { provider, providerUserId, email, name } = req.body ?? {};
    if (provider !== 'google' && provider !== 'github') {
      res.status(422).json({ error: 'validation_failed', message: 'provider must be google|github' });
      return;
    }
    if (!providerUserId || !email || !name) {
      res.status(422).json({ error: 'validation_failed', message: 'providerUserId, email, name required' });
      return;
    }
    const result = await authExtras.findOrCreateOAuthUser({ provider, providerUserId, email, name });
    // Don't log email — only userId + provider.
    logger.info('OAuth lookup-or-create', { userId: result.user.id, provider, created: result.created, linked: result.linked });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /auth/user-by-email/:email — used by forgot-password flow.
// Returns { id, email, name, teamId } or 404. NEVER expose this publicly —
// BoardRoom should always return 200 from the forgot-password endpoint so
// email-existence isn't leaked to the world.
router.get('/user-by-email/:email', async (req, res, next) => {
  try {
    const user = await authService.getUserByEmail(decodeURIComponent(req.params.email));
    if (!user) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { passwordHash, ...safe } = user;
    void passwordHash;
    res.json(safe);
  } catch (err) { next(err); }
});

// POST /auth/set-password — body { userId, passwordHash }
// Bumps passwordChangedAt; BoardRoom JWT middleware rejects older iat values.
router.post('/set-password', async (req, res, next) => {
  try {
    const { userId, passwordHash } = req.body ?? {};
    if (!userId || !passwordHash) {
      res.status(422).json({ error: 'validation_failed', message: 'userId and passwordHash required' });
      return;
    }
    const ok = await authExtras.setPassword(userId, passwordHash);
    if (!ok) { res.status(404).json({ error: 'not_found' }); return; }
    logger.info('Password updated', { userId });
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// POST /auth/mark-email-verified — body { userId }
router.post('/mark-email-verified', async (req, res, next) => {
  try {
    const { userId } = req.body ?? {};
    if (!userId) { res.status(422).json({ error: 'validation_failed', message: 'userId required' }); return; }
    const ok = await authExtras.markEmailVerified(userId);
    if (!ok) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// GET /auth/password-changed-at/:userId — returns { passwordChangedAt: ISO | null }
// Used by BoardRoom auth middleware to invalidate stale JWTs.
router.get('/password-changed-at/:userId', async (req, res, next) => {
  try {
    const dt = await authExtras.getPasswordChangedAt(req.params.userId);
    res.json({ passwordChangedAt: dt ? dt.toISOString() : null });
  } catch (err) { next(err); }
});

// GET /auth/email-verified-at/:userId — returns { emailVerifiedAt: ISO | null }
router.get('/email-verified-at/:userId', async (req, res, next) => {
  try {
    const dt = await authExtras.getEmailVerifiedAt(req.params.userId);
    res.json({ emailVerifiedAt: dt ? dt.toISOString() : null });
  } catch (err) { next(err); }
});

export const authRouter: IRouter = router;
