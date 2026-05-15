import { Router } from 'express';
import type { IRouter } from 'express';
import { hashPassword, createToken, authMiddleware, type AuthRequest } from '../middleware/auth';
import { isAdminUser } from '../middleware/require-admin';
import { loginLimiter, registerLimiter } from '../middleware/auth-rate-limiter';
import { validateBody } from '../middleware/validate';
import { RegisterBodySchema, LoginBodySchema } from '@boardroom/shared';
import { omnimindClient } from '../services/omnimind-client';
import { signResetToken, signVerifyToken, verifyKindToken } from '../services/auth-tokens.service';
import { sendTransactional } from '../services/mailer.service';
import { logger } from '../lib/logger';

const OMNIMIND_URL = process.env.OMNIMIND_API_URL ?? 'http://localhost:3333';
const getApiKey = () => {
  const key = process.env.OMNIMIND_API_KEY;
  if (!key) throw new Error('FATAL: OMNIMIND_API_KEY is not set');
  return key;
};

const router: IRouter = Router();

function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3001';
}

// POST /auth/register
router.post('/register', registerLimiter, validateBody(RegisterBodySchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    const passwordHash = await hashPassword(password);
    const user = await omnimindClient.registerUser(email, passwordHash, name);
    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    // UX-1.4: send verification email (soft mode by default — user can use the
    // app immediately; banner nudges them to verify).
    try {
      const verifyToken = signVerifyToken(user.id);
      const link = `${appUrl()}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
      await sendTransactional({
        to: user.email,
        subject: 'Verify your BoardRoom AI email',
        text: [
          `Welcome to BoardRoom AI, ${user.name}.`,
          '',
          'Confirm your email so we can keep your account secure:',
          link,
          '',
          'This link expires in 24 hours. If you didn\'t sign up, you can ignore this email.',
        ].join('\n'),
      });
    } catch (mailErr) {
      // Don't fail registration if email send hiccups.
      logger.warn('Verify-email send failed at registration', { userId: user.id, error: (mailErr as Error).message });
    }
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
    // UX-1.4: include emailVerified so the client can show the soft banner.
    let emailVerified = false;
    try {
      const v = await omnimindClient.getEmailVerifiedAt(user.id);
      emailVerified = !!v.emailVerifiedAt;
    } catch {
      // Tolerate downstream blip — default to false (banner will show).
    }
    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      isAdmin: isAdminUser(user.id),
      emailVerified,
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

// ---------------------------------------------------------------------------
// UX-1.3 — Forgot password / reset
// ---------------------------------------------------------------------------

// POST /auth/forgot-password  body: { email }
// ALWAYS returns 200 — no email-enumeration leak. If the user exists, we
// send a reset link; if not, we silently no-op.
router.post('/forgot-password', loginLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      // Same uniform 200 so the client can't probe by malformed input.
      res.json({ status: 'ok' });
      return;
    }
    const user = await omnimindClient.getUserByEmailForReset(email).catch(() => null);
    if (user) {
      try {
        const token = signResetToken(user.id);
        const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
        await sendTransactional({
          to: user.email,
          subject: 'Reset your BoardRoom AI password',
          text: [
            `Hi ${user.name},`,
            '',
            'A password reset was requested for your BoardRoom AI account.',
            'Open this link in the next 15 minutes to set a new password:',
            link,
            '',
            'If you didn\'t request this, you can safely ignore this email — your password will not change.',
          ].join('\n'),
        });
      } catch (mailErr) {
        // Log but don't surface — uniform 200.
        logger.warn('Password-reset email send failed', { userId: user.id, error: (mailErr as Error).message });
      }
    }
    // Uniform 200 regardless of email existence.
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// POST /auth/reset-password  body: { token, password }
// Verifies token, hashes+stores new password, invalidates existing sessions
// via passwordChangedAt bump.
router.post('/reset-password', loginLimiter, async (req, res, next) => {
  try {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'invalid_token', message: 'Token is required.' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'invalid_password', message: 'Password must be at least 8 characters.' });
      return;
    }
    const userId = verifyKindToken(token, 'pwreset');
    if (!userId) {
      res.status(400).json({ error: 'invalid_token', message: 'This reset link is invalid or expired.' });
      return;
    }
    const newHash = await hashPassword(password);
    await omnimindClient.setPassword(userId, newHash);

    // Clear the cookie — user must re-login. Their old JWT will be rejected
    // by authMiddleware anyway thanks to the passwordChangedAt comparison.
    res.clearCookie('boardroom_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// UX-1.4 — Email verification
// ---------------------------------------------------------------------------

// GET /auth/verify-email?token=...   → redirect to /?verified=1 on success
router.get('/verify-email', async (req, res) => {
  const token = req.query.token as string | undefined;
  const userId = verifyKindToken(token, 'verifyemail');
  if (!userId) {
    res.redirect('/login?verify_error=invalid_token');
    return;
  }
  try {
    await omnimindClient.markEmailVerified(userId);
    res.redirect('/?verified=1');
  } catch (err) {
    logger.warn('markEmailVerified failed', { userId, error: (err as Error).message });
    res.redirect('/login?verify_error=server');
  }
});

// POST /auth/resend-verification — authed users only
router.post('/resend-verification', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.auth!.userId;
    const user = await omnimindClient.getUserById(userId);
    if (!user) { res.status(404).json({ error: 'not_found' }); return; }
    const token = signVerifyToken(userId);
    const link = `${appUrl()}/auth/verify-email?token=${encodeURIComponent(token)}`;
    await sendTransactional({
      to: user.email,
      subject: 'Verify your BoardRoom AI email',
      text: [
        `Hi ${user.name},`,
        '',
        'Here\'s a fresh email verification link (valid for 24 hours):',
        link,
      ].join('\n'),
    });
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

export const authRouter = router;
