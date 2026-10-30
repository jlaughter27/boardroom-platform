// Ported from boardroom-ai/server/src/auth.ts (April 2026)
// JWT + httpOnly cookie authentication middleware

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

let _jwtSecret: string | undefined;
function getJwtSecret(): string {
  if (!_jwtSecret) {
    _jwtSecret = process.env.JWT_SECRET;
    if (!_jwtSecret) throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  }
  return _jwtSecret;
}

// Test helper: resets the cached JWT secret so tests can mutate process.env
// between cases. Not imported by any runtime code path.
export function __resetJwtSecretForTest(): void {
  _jwtSecret = undefined;
}

const TOKEN_EXPIRY = '7d';

export interface AuthPayload {
  userId: string;
  email: string;
  teamId: string;
}

export interface AuthRequest extends Request<Record<string, string>> {
  auth?: AuthPayload;
}

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 12);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// ---------------------------------------------------------------------------
// Lane G item 1 — logout revocation.
//
// Every token is issued with a random `jti`. POST /auth/logout records the
// token's revocation key in this in-process map until the token's own `exp`,
// and verifyToken() refuses it from then on (authMiddleware, optionalAuth and
// the OAuth callbacks all go through verifyToken). Tokens issued before this
// change have no `jti`; they are keyed on sha256(token) instead, so logging
// out revokes them too.
//
// Deliberately NOT persisted (no table, no migration): BoardRoom runs as ONE
// Railway instance (CLAUDE.md known limitation #7). A restart forgets the list,
// so a token logged out before a redeploy authenticates again until its 7-day
// expiry. Moving to >1 instance needs a shared store (OmniMind) — see
// docs/02-reference/FRAGILE-ZONES.md §5.
// ---------------------------------------------------------------------------
const revokedTokens = new Map<string, number>(); // revocation key → expiry (ms epoch)

interface DecodedToken extends AuthPayload {
  jti?: string;
  exp?: number;
}

function revocationKey(token: string, decoded: DecodedToken): string {
  return decoded.jti ? `jti:${decoded.jti}` : `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function pruneRevoked(now: number): void {
  for (const [key, exp] of revokedTokens) if (exp <= now) revokedTokens.delete(key);
}

// Test helper: clears the revocation list. Not imported by any runtime code path.
export function __resetRevokedTokensForTest(): void {
  revokedTokens.clear();
}

export const createToken = (payload: AuthPayload): string => {
  // Copy only the AuthPayload fields: a decoded token (req.auth) may be passed
  // back in and must not smuggle its old jti / exp / iat into the new token.
  const claims: AuthPayload = { userId: payload.userId, email: payload.email, teamId: payload.teamId };
  return jwt.sign(claims, getJwtSecret(), { expiresIn: TOKEN_EXPIRY, jwtid: randomUUID() });
};

export const verifyToken = (token: string): AuthPayload | null => {
  let decoded: DecodedToken;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as DecodedToken;
  } catch {
    return null;
  }
  const exp = revokedTokens.get(revocationKey(token, decoded));
  if (exp !== undefined) {
    if (exp > Date.now()) return null;
    revokedTokens.delete(revocationKey(token, decoded));
  }
  return decoded;
};

/**
 * Revoke a token until its own expiry. A token that does not verify (garbage,
 * wrong secret, already expired) is a no-op — it cannot authenticate anyway.
 * Returns true when a valid token was revoked.
 */
export const revokeToken = (token: string): boolean => {
  let decoded: DecodedToken;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as DecodedToken;
  } catch {
    return false;
  }
  const now = Date.now();
  pruneRevoked(now);
  const exp = typeof decoded.exp === 'number' ? decoded.exp * 1000 : now + 7 * 24 * 60 * 60 * 1000;
  revokedTokens.set(revocationKey(token, decoded), exp);
  return true;
};

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.cookies?.boardroom_token as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    return;
  }

  req.auth = payload;
  next();
};

/**
 * B-107 — Optional auth: decode the cookie if present and valid, but never
 * reject. Used on OAuth callbacks so the handler can cross-check the signed
 * `state.userId` against the logged-in user without requiring a session
 * (Google's redirect may arrive after the JWT expired).
 */
export const optionalAuthMiddleware = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  const token = req.cookies?.boardroom_token as string | undefined;
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.auth = payload;
  }
  next();
};
