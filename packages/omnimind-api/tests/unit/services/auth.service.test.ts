import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUser, getUserByEmail, getUserById } from '../../../src/services/auth.service';
import { prisma } from '../../../src/lib/db';

// Mock the prisma module
vi.mock('../../../src/lib/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    team: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerUser', () => {
    it('should create a new user with personal team', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
        createdAt: new Date(),
      };
      
      const mockTeam = { id: 'team-456' };
      
      // Mock transaction
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return await callback({
          user: {
            create: vi.fn().mockResolvedValue(mockUser),
          },
          team: {
            create: vi.fn().mockResolvedValue(mockTeam),
          },
        });
      });
      
      const result = await registerUser({
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
      });
      
      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed-password',
        teamId: 'team-456',
        createdAt: mockUser.createdAt,
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw CONFLICT error when email already exists', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({
        id: 'existing-user',
        email: 'test@example.com',
      });
      
      await expect(
        registerUser({
          email: 'test@example.com',
          passwordHash: 'hashed-password',
          name: 'Test User',
        })
      ).rejects.toThrow('Email already registered');
      
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });
  });

  describe('getUserByEmail', () => {
    it('should return user with team membership', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
        createdAt: new Date(),
        teamMemberships: [
          { teamId: 'team-456' },
        ],
      };
      
      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      
      const result = await getUserByEmail('test@example.com');
      
      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed-password',
        teamId: 'team-456',
        createdAt: mockUser.createdAt,
      });
      
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        include: {
          teamMemberships: {
            take: 1,
            orderBy: { id: 'asc' },
          },
        },
      });
    });

    it('should return null when user not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      
      const result = await getUserByEmail('nonexistent@example.com');
      
      expect(result).toBeNull();
    });

    it('should handle user without team membership', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
        createdAt: new Date(),
        teamMemberships: [],
      };
      
      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      
      const result = await getUserByEmail('test@example.com');
      
      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed-password',
        teamId: '',
        createdAt: mockUser.createdAt,
      });
    });
  });

  describe('getUserById', () => {
    it('should return user without passwordHash', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
        teamMemberships: [
          { teamId: 'team-456' },
        ],
      };
      
      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      
      const result = await getUserById('user-123');
      
      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        teamId: 'team-456',
        createdAt: mockUser.createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
      
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        include: {
          teamMemberships: {
            take: 1,
            orderBy: { id: 'asc' },
          },
        },
      });
    });

    it('should return null when user not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      
      const result = await getUserById('nonexistent-id');
      
      expect(result).toBeNull();
    });
  });
});
