// B-101 — Admin gate. Admin = authenticated user whose email appears in the
// ADMIN_EMAILS env var (comma-separated, case-insensitive). Read lazily so
// tests and hot-reloaded envs take effect.

import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { omnimindClient } from '../services/omnimind-client';

function adminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(
    raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  );
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminAllowlist().has(email.trim().toLowerCase());
}

/**
 * Resolve the caller's admin status. Prefers the email baked into the JWT;
 * falls back to an OmniMind lookup when the payload lacks one (older tokens).
 */
export async function resolveIsAdmin(auth: AuthRequest['auth']): Promise<boolean> {
  if (!auth) return false;
  if (auth.email) return isAdminEmail(auth.email);
  try {
    const user = await omnimindClient.getUserById(auth.userId);
    return isAdminEmail(user?.email);
  } catch {
    return false;
  }
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }
  const ok = await resolveIsAdmin(req.auth);
  if (!ok) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}
