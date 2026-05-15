// Ported from boardroom-ai/server/src/auth.ts (April 2026)
// JWT + httpOnly cookie authentication middleware

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { omnimindClient } from '../services/omnimind-client';

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

export const createToken = (payload: AuthPayload): string => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
};

export const verifyToken = (token: string): AuthPayload | null => {
  try {
    return jwt.verify(token, getJwtSecret()) as AuthPayload;
  } catch {
    return null;
  }
};

// passwordChangedAt cache — avoid hitting OmniMind on every request.
// Short TTL means at most 60s of session-invalidation lag after a reset.
interface PwdEntry { pwdAt: number; cachedAt: number }
const PWD_CACHE_TTL_MS = 60_000;
const pwdChangedCache = new Map<string, PwdEntry>();

export function __resetPwdChangedCacheForTest(): void {
  pwdChangedCache.clear();
}

async function loadPasswordChangedAt(userId: string): Promise<number> {
  const cached = pwdChangedCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < PWD_CACHE_TTL_MS) return cached.pwdAt;
  try {
    const r = await omnimindClient.getPasswordChangedAt(userId);
    const pwdAt = r.passwordChangedAt ? Math.floor(new Date(r.passwordChangedAt).getTime() / 1000) : 0;
    pwdChangedCache.set(userId, { pwdAt, cachedAt: Date.now() });
    return pwdAt;
  } catch {
    // Fail-open on OmniMind blip — don't lock everyone out.
    return 0;
  }
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.cookies?.boardroom_token as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }

  // Decode with iat so we can compare against passwordChangedAt.
  let decoded: AuthPayload & { iat?: number };
  try {
    decoded = jwt.verify(token, getJwtSecret()) as AuthPayload & { iat?: number };
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    return;
  }

  const tokenIat = decoded.iat ?? 0;
  loadPasswordChangedAt(decoded.userId)
    .then((pwdAt) => {
      if (pwdAt > 0 && tokenIat < pwdAt) {
        res.clearCookie('boardroom_token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
        res.status(401).json({ error: 'unauthorized', message: 'Session invalidated (password changed). Please sign in again.' });
        return;
      }
      req.auth = { userId: decoded.userId, email: decoded.email, teamId: decoded.teamId };
      next();
    })
    .catch(() => {
      req.auth = { userId: decoded.userId, email: decoded.email, teamId: decoded.teamId };
      next();
    });
};
