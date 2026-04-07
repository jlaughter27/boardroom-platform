// Ported from boardroom-ai/server/src/auth.ts (April 2026)
// JWT + httpOnly cookie authentication middleware

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

let _jwtSecret: string | undefined;
function getJwtSecret(): string {
  if (!_jwtSecret) {
    _jwtSecret = process.env.JWT_SECRET;
    if (!_jwtSecret) throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  }
  return _jwtSecret;
}
const TOKEN_EXPIRY = '7d';

export interface AuthPayload {
  userId: string;
  email: string;
  teamId: string;
}

export interface AuthRequest extends Request {
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
