// GitHub OAuth LOGIN service (Wave 3 Track E, UX-1.2).
// No SDK — GitHub's OAuth surface is tiny enough to hit directly.

import { signLoginState, verifyLoginState } from './oauth-state';

const CLIENT_ID = () => process.env.GITHUB_OAUTH_CLIENT_ID;
const CLIENT_SECRET = () => process.env.GITHUB_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = () =>
  process.env.GITHUB_OAUTH_REDIRECT_URI ?? 'http://localhost:3001/auth/oauth/github/callback';

export function isConfigured(): boolean {
  return !!(CLIENT_ID() && CLIENT_SECRET());
}

export function getAuthUrl(): string | null {
  if (!isConfigured()) return null;
  const params = new URLSearchParams({
    client_id: CLIENT_ID() as string,
    redirect_uri: REDIRECT_URI(),
    scope: 'read:user user:email',
    state: signLoginState('github-login'),
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface GitHubProfile {
  id: string;
  email: string;
  name: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** Exchange the auth code for a profile. Handles GitHub's no-public-email case. */
export async function exchangeCodeForProfile(code: string): Promise<GitHubProfile> {
  // 1. Code → access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      code,
      redirect_uri: REDIRECT_URI(),
    }),
  });
  if (!tokenRes.ok) throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenBody.access_token) throw new Error(`GitHub token exchange: ${tokenBody.error ?? 'no access_token'}`);
  const accessToken = tokenBody.access_token;

  // 2. /user — get id + name
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`);
  const userBody = (await userRes.json()) as { id: number; login: string; name: string | null; email: string | null };

  let email = userBody.email;
  // 3. If no public email, resolve via /user/emails
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (!emailsRes.ok) throw new Error(`GitHub /user/emails failed: ${emailsRes.status}`);
    const emails = (await emailsRes.json()) as GitHubEmail[];
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (!primary) throw new Error('GitHub OAuth: no verified email on account');
    email = primary.email;
  }

  return {
    id: String(userBody.id),
    email,
    name: userBody.name ?? userBody.login,
  };
}

export { verifyLoginState };
