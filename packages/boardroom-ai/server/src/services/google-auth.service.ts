// Google OAuth LOGIN service (Wave 3 Track E, UX-1.2).
//
// Separate from google-calendar.service.ts: login uses openid/email/profile
// scopes and produces a BoardRoom JWT cookie, while calendar uses
// calendar.readonly and stores an OAuthToken row. Keeping them separate
// avoids consent-screen scope sprawl and lets each be re-consented independently.

import { google } from 'googleapis';
import { signLoginState, verifyLoginState } from './oauth-state';

const CLIENT_ID = () => process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = () => process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = () =>
  process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://localhost:3001/auth/oauth/google/callback';

export function isConfigured(): boolean {
  return !!(CLIENT_ID() && CLIENT_SECRET());
}

function client() {
  return new google.auth.OAuth2(CLIENT_ID(), CLIENT_SECRET(), REDIRECT_URI());
}

export function getAuthUrl(): string | null {
  if (!isConfigured()) return null;
  const c = client();
  return c.generateAuthUrl({
    access_type: 'online', // we don't need refresh tokens for login-only
    scope: ['openid', 'email', 'profile'],
    state: signLoginState('google-login'),
    prompt: 'select_account',
  });
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Exchange auth code for a profile. Throws on failure. */
export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const c = client();
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new Error('Google OAuth: no id_token in response');

  // Verify the id_token signature and decode the payload.
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID() });
  const payload = ticket.getPayload();
  if (!payload) throw new Error('Google OAuth: empty id_token payload');
  if (!payload.sub || !payload.email) throw new Error('Google OAuth: id_token missing sub/email');
  if (!payload.email_verified) throw new Error('Google OAuth: email not verified by Google');

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: !!payload.email_verified,
    name: payload.name ?? payload.email.split('@')[0],
  };
}

export { verifyLoginState };
