// Signed-token helpers for password reset (UX-1.3) and email verification (UX-1.4).
// Keep tokens stateless and short-lived. Each token is a JWT signed with
// PASSWORD_RESET_TOKEN_SECRET (or JWT_SECRET as fallback with a kind-prefix
// so tokens can't be cross-used between flows).

import jwt from 'jsonwebtoken';

type TokenKind = 'pwreset' | 'verifyemail';

const PWRESET_TTL_SECONDS = 15 * 60; // 15 minutes
const VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

function getSecret(): string {
  const s = process.env.PASSWORD_RESET_TOKEN_SECRET ?? process.env.JWT_SECRET;
  if (!s) {
    throw new Error('FATAL: PASSWORD_RESET_TOKEN_SECRET (or JWT_SECRET) is not set.');
  }
  return s;
}

interface TokenPayload {
  userId: string;
  kind: TokenKind;
}

export function signResetToken(userId: string): string {
  const payload: TokenPayload = { userId, kind: 'pwreset' };
  return jwt.sign(payload, getSecret(), { expiresIn: PWRESET_TTL_SECONDS });
}

export function signVerifyToken(userId: string): string {
  const payload: TokenPayload = { userId, kind: 'verifyemail' };
  return jwt.sign(payload, getSecret(), { expiresIn: VERIFY_TTL_SECONDS });
}

/**
 * Verify a token, asserting its kind. Returns userId or null. Never throws.
 */
export function verifyKindToken(token: string | undefined, kind: TokenKind): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getSecret()) as TokenPayload;
    if (payload.kind !== kind) return null;
    if (!payload.userId || typeof payload.userId !== 'string') return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export const TTL = { PWRESET_TTL_SECONDS, VERIFY_TTL_SECONDS };
