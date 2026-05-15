// OAuth login routes (Wave 3 Track E, UX-1.2).
// Routes:
//   GET  /auth/oauth/google          → redirect to Google consent
//   GET  /auth/oauth/google/callback → exchange code, issue JWT, redirect /
//   GET  /auth/oauth/github          → redirect to GitHub consent
//   GET  /auth/oauth/github/callback → exchange code, issue JWT, redirect /
//
// State protection: signed-JWT + nonce (10-min TTL), nonce consumed on
// callback. Replay = reject. Same pattern as Wave 2 Track A's calendar OAuth.
//
// Account-linking: if a user already exists with the same email, the OAuth
// provider ID is linked to that user — we never create duplicate accounts.

import { Router } from 'express';
import type { IRouter } from 'express';
import { createToken } from '../middleware/auth';
import { omnimindClient } from '../services/omnimind-client';
import * as googleAuth from '../services/google-auth.service';
import * as githubAuth from '../services/github-auth.service';
import { logger } from '../lib/logger';

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

router.get('/google', (_req, res) => {
  const url = googleAuth.getAuthUrl();
  if (!url) {
    res.status(503).json({ error: 'not_configured', message: 'Google OAuth not configured on this server.' });
    return;
  }
  res.redirect(url);
});

router.get('/google/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code) {
      res.redirect('/login?oauth_error=missing_code');
      return;
    }
    if (!googleAuth.verifyLoginState(state, 'google-login')) {
      // Never log the raw state — it's a signed JWT.
      logger.warn('Google OAuth state verification failed');
      res.redirect('/login?oauth_error=invalid_state');
      return;
    }

    const profile = await googleAuth.exchangeCodeForProfile(code);
    const { user } = await omnimindClient.oauthLookupOrCreate({
      provider: 'google',
      providerUserId: profile.sub,
      email: profile.email,
      name: profile.name,
    });

    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    logger.error('Google OAuth callback failed', { error: (err as Error).message });
    // Send the user back to login with a generic error — never expose the cause.
    res.redirect('/login?oauth_error=google_failed');
    void next; // satisfy unused lint without forwarding to global handler
  }
});

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

router.get('/github', (_req, res) => {
  const url = githubAuth.getAuthUrl();
  if (!url) {
    res.status(503).json({ error: 'not_configured', message: 'GitHub OAuth not configured on this server.' });
    return;
  }
  res.redirect(url);
});

router.get('/github/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code) {
      res.redirect('/login?oauth_error=missing_code');
      return;
    }
    if (!githubAuth.verifyLoginState(state, 'github-login')) {
      logger.warn('GitHub OAuth state verification failed');
      res.redirect('/login?oauth_error=invalid_state');
      return;
    }

    const profile = await githubAuth.exchangeCodeForProfile(code);
    const { user } = await omnimindClient.oauthLookupOrCreate({
      provider: 'github',
      providerUserId: profile.id,
      email: profile.email,
      name: profile.name,
    });

    const token = createToken({ userId: user.id, email: user.email, teamId: user.teamId });
    res.cookie('boardroom_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    logger.error('GitHub OAuth callback failed', { error: (err as Error).message });
    res.redirect('/login?oauth_error=github_failed');
    void next;
  }
});

// Lightweight introspection — does this server have OAuth configured?
// Lets the client decide whether to render the "Continue with X" buttons.
router.get('/providers', (_req, res) => {
  res.json({
    google: googleAuth.isConfigured(),
    github: githubAuth.isConfigured(),
  });
});

export const oauthLoginRouter = router;
