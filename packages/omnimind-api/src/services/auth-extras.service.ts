// Auth-extras service — supports Wave 3 Track E (UX-1.2 SSO, UX-1.3 password
// reset, UX-1.4 email verification). Kept separate from auth.service.ts so
// the original surface (register/login/verify/get/delete) remains untouched.

import { prisma } from '../lib/db';
import type { AuthUser, SafeUser } from './auth.service';
import { toSafeUser } from './auth.service';

/**
 * Find a user by an OAuth provider's stable subject ID.
 * `provider` is 'google' or 'github'. Returns null if no match.
 */
export async function findUserByProvider(
  provider: 'google' | 'github',
  providerUserId: string,
): Promise<AuthUser | null> {
  const where = provider === 'google'
    ? { googleId: providerUserId }
    : { githubId: providerUserId };

  const user = await prisma.user.findFirst({
    where,
    include: { teamMemberships: { take: 1, orderBy: { id: 'asc' } } },
  });
  if (!user) return null;
  if ((user as { deletedAt?: Date | null }).deletedAt) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    passwordHash: user.passwordHash,
    teamId: user.teamMemberships[0]?.teamId ?? '',
    createdAt: user.createdAt,
  };
}

/**
 * Link an OAuth provider ID to an existing user. Used in the account-linking
 * case (user has password AND signs in via Google with same email).
 */
export async function linkProvider(
  userId: string,
  provider: 'google' | 'github',
  providerUserId: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: provider === 'google'
      ? { googleId: providerUserId }
      : { githubId: providerUserId },
  });
}

/**
 * Lookup-or-create flow for OAuth login. The contract:
 *   1. If we have a user with that providerUserId → return them.
 *   2. Else if we have a user with that email (existing password user) →
 *      link the provider to that user (never create a duplicate). Return them.
 *   3. Else create a new user + default team. Mark email verified — OAuth
 *      providers have already verified the email.
 */
export async function findOrCreateOAuthUser(input: {
  provider: 'google' | 'github';
  providerUserId: string;
  email: string;
  name: string;
}): Promise<{ user: SafeUser; created: boolean; linked: boolean }> {
  // 1. Provider-id match
  const byProvider = await findUserByProvider(input.provider, input.providerUserId);
  if (byProvider) return { user: toSafeUser(byProvider), created: false, linked: false };

  // 2. Email match — link to existing account
  const byEmail = await prisma.user.findUnique({
    where: { email: input.email },
    include: { teamMemberships: { take: 1, orderBy: { id: 'asc' } } },
  });
  if (byEmail && !(byEmail as { deletedAt?: Date | null }).deletedAt) {
    await linkProvider(byEmail.id, input.provider, input.providerUserId);
    return {
      user: {
        id: byEmail.id,
        email: byEmail.email,
        name: byEmail.name,
        teamId: byEmail.teamMemberships[0]?.teamId ?? '',
        createdAt: byEmail.createdAt,
      },
      created: false,
      linked: true,
    };
  }

  // 3. Create new user + personal team. OAuth providers verify email — mark verified.
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        // Password is unset for pure-OAuth signups. Store a sentinel so the
        // bcrypt compare in verifyCredentials always fails. The user can
        // run the forgot-password flow to set a real password later.
        passwordHash: 'OAUTH_ONLY',
        name: input.name,
        emailVerifiedAt: now,
        ...(input.provider === 'google' ? { googleId: input.providerUserId } : { githubId: input.providerUserId }),
      } as { email: string; passwordHash: string; name: string; emailVerifiedAt: Date; googleId?: string; githubId?: string },
    });
    const team = await tx.team.create({
      data: {
        name: `${input.name}'s Team`,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    return { user, teamId: team.id };
  });

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      teamId: result.teamId,
      createdAt: result.user.createdAt,
    },
    created: true,
    linked: false,
  };
}

/**
 * Update a user's password (post-reset). Bumps passwordChangedAt so JWTs
 * issued before this moment are rejected by BoardRoom's auth middleware.
 * Returns true on success, false if the user doesn't exist or is deleted.
 */
export async function setPassword(userId: string, newHash: string): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) return false;
  if ((existing as { deletedAt?: Date | null }).deletedAt) return false;
  const now = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash, passwordChangedAt: now } as { passwordHash: string; passwordChangedAt: Date },
  });
  return true;
}

/** Mark a user's email as verified (UX-1.4). Idempotent. */
export async function markEmailVerified(userId: string): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) return false;
  if ((existing as { deletedAt?: Date | null }).deletedAt) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() } as { emailVerifiedAt: Date },
  });
  return true;
}

/** Return the password-changed timestamp for a user, or null. */
export async function getPasswordChangedAt(userId: string): Promise<Date | null> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return (u as { passwordChangedAt?: Date | null }).passwordChangedAt ?? null;
}

/** Return the email-verified timestamp for a user, or null. */
export async function getEmailVerifiedAt(userId: string): Promise<Date | null> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return (u as { emailVerifiedAt?: Date | null }).emailVerifiedAt ?? null;
}
