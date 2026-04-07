import { prisma } from '../lib/db';

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

/**
 * Register a new user with a default personal team (transactional).
 * Returns the created user with their team ID.
 */
export async function registerUser(input: RegisterUserInput): Promise<AuthUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    const err = Object.assign(new Error('Email already registered'), { code: 'CONFLICT' });
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
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

/**
 * Look up a user by email. Returns user with team membership or null.
 */
export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { email },
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
