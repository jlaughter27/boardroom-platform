import { prisma } from '../lib/db';
import bcrypt from 'bcryptjs';
import { normalizeEmail } from '@boardroom/shared';

export interface RegisterUserInput {
  email: string;
  passwordHash: string;
  name: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  teamId: string;
  createdAt: Date;
}

/** AuthUser without the passwordHash — safe to return over the wire. */
export type SafeUser = Omit<AuthUser, 'passwordHash'>;

/** Strip passwordHash from an AuthUser. */
export function toSafeUser(user: AuthUser): SafeUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

/**
 * Verify email + password server-side. Returns SafeUser if valid, null otherwise.
 * This keeps the passwordHash inside OmniMind — it never leaves the service.
 */
export async function verifyCredentials(email: string, password: string): Promise<SafeUser | null> {
  const user = await getUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  return toSafeUser(user);
}

/**
 * Register a new user with a default personal team (transactional).
 * Returns the created user with their team ID.
 */
export async function registerUser(input: RegisterUserInput): Promise<AuthUser> {
  // Security fix C1: new accounts are stored as lower(trim(email)) and the
  // existence check is case-insensitive, so a case variant of an existing
  // address (including legacy mixed-case rows) is a 409, never a second account.
  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    const err = Object.assign(new Error('Email already registered'), { code: 'CONFLICT' });
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: input.passwordHash,
        name: input.name,
      },
    });

    const team = await tx.team.create({
      data: {
        name: `${input.name}'s Team`,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });

    return { user, teamId: team.id };
  });

  return {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    passwordHash: result.user.passwordHash,
    teamId: result.teamId,
    createdAt: result.user.createdAt,
  };
}

const withFirstTeam = {
  teamMemberships: {
    take: 1,
    orderBy: { id: 'asc' as const },
  },
};

/**
 * Look up a user by email, case-insensitively (security fix C1). Rows written
 * before the fix may be mixed-case, so the exact (trimmed) address wins first;
 * otherwise the oldest case-insensitive match. Returns user with team membership or null.
 */
export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  const trimmed = email.trim();
  const user =
    (await prisma.user.findUnique({ where: { email: trimmed }, include: withFirstTeam }))
    ?? (await prisma.user.findFirst({
      where: { email: { equals: normalizeEmail(trimmed), mode: 'insensitive' } },
      include: withFirstTeam,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));

  if (!user) return null;

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
 * Look up a user by ID. Returns user with team membership or null.
 */
export async function getUserById(id: string): Promise<Omit<AuthUser, 'passwordHash'> | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      teamMemberships: {
        take: 1,
        orderBy: { id: 'asc' },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    teamId: user.teamMemberships[0]?.teamId ?? '',
    createdAt: user.createdAt,
  };
}
