// Shared OAuth state signer/verifier for Wave 3 Track E (UX-1.2).
// Same signed-JWT + nonce pattern as Wave 2 Track A's google-calendar.service.ts,
// generalized so any OAuth provider (Google login, GitHub login, calendar,
// gmail) can use it without cross-importing.
//
// Follow-up: move the nonce store to Redis/OmniMind when we scale beyond
// one Railway instance — a callback may land on a different node.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

function getStateSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. OAuth state cannot be signed.');
  }
  return secret;
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const issuedNonces = new Map<string, number>(); // nonce -> expires-at (epoch ms)

function gcNonces(): void {
  const now = Date.now();
  for (const [nonce, expiresAt] of issuedNonces) {
    if (expiresAt <= now) issuedNonces.delete(nonce);
  }
}

interface OAuthStatePayload {
  // For login (no user yet), userId is null/undefined. For
  // connect-existing-account flows (calendar/gmail), it's the authed user.
  userId?: string | null;
  provider: string;
  nonce: string;
}

export function signLoginState(provider: string): string {
  gcNonces();
  const nonce = crypto.randomBytes(16).toString('hex');
  issuedNonces.set(nonce, Date.now() + OAUTH_STATE_TTL_SECONDS * 1000);
  const payload: OAuthStatePayload = { userId: null, provider, nonce };
  return jwt.sign(payload, getStateSecret(), { expiresIn: OAUTH_STATE_TTL_SECONDS });
}

/**
 * Verify state signed by signLoginState. Returns the provider name on
 * success, null on failure (expired, malformed, wrong provider, replay).
 * Nonce is consumed on success — replay yields null on the second call.
 */
export function verifyLoginState(state: string | undefined, provider: string): boolean {
  if (!state) return false;
  let payload: OAuthStatePayload;
  try {
    payload = jwt.verify(state, getStateSecret()) as OAuthStatePayload;
  } catch {
    return false;
  }
  if (payload.provider !== provider) return false;
  gcNonces();
  if (!issuedNonces.has(payload.nonce)) return false;
  issuedNonces.delete(payload.nonce);
  return true;
}

// Test helper — clears the nonce map between cases.
export function __resetOAuthNoncesForTest(): void {
  issuedNonces.clear();
}
