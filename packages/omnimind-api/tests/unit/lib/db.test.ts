import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create hoisted mocks that will be available before module imports
const mockWithRLS = vi.hoisted(() => vi.fn());
const mockCreateSystemClient = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Create a mock Prisma client instance that will be returned by the constructor
const mockPrismaInstance = vi.hoisted(() => ({
  $on: vi.fn(),
}));

// Mock PrismaClient constructor that returns our mock instance
const mockPrismaConstructor = vi.hoisted(() => vi.fn(() => mockPrismaInstance));

// Mock dependencies BEFORE importing the module
vi.mock('../../../src/lib/db-audit', () => ({
  withRLS: mockWithRLS,
  createSystemClient: mockCreateSystemClient,
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: mockPrismaConstructor,
}));

// Now import the module after mocks are set up
import { getPrismaClient, systemPrisma, prisma, attachRLSClient } from '../../../src/lib/db';

// Snapshot the module-load state BEFORE any vi.clearAllMocks() so the
// Prisma event-handler tests can still verify what happened at import time.
const moduleLoadOnCalls = [...(mockPrismaInstance.$on as any).mock.calls];
const moduleLoadCreateSystemClientCalls = [...mockCreateSystemClient.mock.calls];

describe('db.ts', () => {
  let mockRLSClient: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    // Only clear the mocks that need per-test isolation. Do NOT clear
    // mockPrismaInstance.$on or mockCreateSystemClient — their call history
    // from module load is needed by the "Prisma event handlers" tests.
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockWithRLS.mockClear();

    mockRLSClient = {
      $on: vi.fn(),
    };

    // Reset withRLS mock
    mockWithRLS.mockImplementation((_userId: string, _basePrisma: any) => {
      return mockRLSClient;
    });

    mockCreateSystemClient.mockImplementation((basePrisma: any) => basePrisma);

    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('getPrismaClient', () => {
    it('should return RLS client for valid userId', () => {
      const userId = 'user-123';
      const client = getPrismaClient(userId);
      
      expect(mockWithRLS).toHaveBeenCalledWith(userId, expect.any(Object));
      expect(client).toBe(mockRLSClient);
    });

    it('should throw error for empty userId', () => {
      expect(() => getPrismaClient('')).toThrow('userId is required for RLS-scoped Prisma client');
      expect(() => getPrismaClient(null as any)).toThrow('userId is required for RLS-scoped Prisma client');
      expect(() => getPrismaClient(undefined as any)).toThrow('userId is required for RLS-scoped Prisma client');
    });
  });

  describe('systemPrisma', () => {
    it('should be created using createSystemClient', () => {
      // createSystemClient is invoked once at module load with the base Prisma
      // client. We snapshot the call list above since beforeEach no longer
      // wipes it.
      const createSystemClientArgs = moduleLoadCreateSystemClientCalls.map(
        (call) => call[0]
      );
      expect(createSystemClientArgs).toContain(mockPrismaInstance);
    });
  });

  describe('prisma', () => {
    it('should be a PrismaClient instance', () => {
      expect(prisma).toBe(mockPrismaInstance);
      expect(prisma.$on).toBeDefined();
    });
  });

  describe('attachRLSClient middleware', () => {
    it('should attach RLS client when x-user-id header is present', () => {
      const req = {
        headers: {
          'x-user-id': 'user-123',
        },
        path: '/test',
      };
      const res = {};
      const next = vi.fn();
      
      attachRLSClient(req as any, res as any, next);
      
      expect(req.prisma).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('should attach base client and log warning when x-user-id header is missing', () => {
      const req = {
        headers: {},
        path: '/test',
      };
      const res = {};
      const next = vi.fn();
      
      attachRLSClient(req as any, res as any, next);
      
      expect(req.prisma).toBe(prisma);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'RLS middleware: No x-user-id header found',
        { path: '/test' }
      );
      expect(next).toHaveBeenCalled();
    });

    it('should attach base client when x-user-id header is empty string', () => {
      const req = {
        headers: {
          'x-user-id': '',
        },
        path: '/empty',
      };
      const res = {};
      const next = vi.fn();
      
      attachRLSClient(req as any, res as any, next);
      
      expect(req.prisma).toBe(prisma);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'RLS middleware: No x-user-id header found',
        { path: '/empty' }
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Prisma event handlers', () => {
    it('should set up error handler', () => {
      const events = moduleLoadOnCalls.map((call) => call[0]);
      expect(events).toContain('error');
    });

    it('should set up query handler', () => {
      const events = moduleLoadOnCalls.map((call) => call[0]);
      expect(events).toContain('query');
    });

    it('should log errors when Prisma error event fires', () => {
      const errorHandlerCall = moduleLoadOnCalls.find((call) => call[0] === 'error');
      expect(errorHandlerCall).toBeDefined();
      const errorHandler = errorHandlerCall?.[1];
      expect(errorHandler).toBeDefined();

      const error = new Error('Database connection failed');
      errorHandler(error);

      expect(mockLogger.error).toHaveBeenCalledWith('Prisma database error', {
        error: 'Database connection failed',
      });
    });

    it('should log queries in development environment', () => {
      const queryHandlerCall = moduleLoadOnCalls.find((call) => call[0] === 'query');
      expect(queryHandlerCall).toBeDefined();
      const queryHandler = queryHandlerCall?.[1];
      expect(queryHandler).toBeDefined();

      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'development';

        const queryEvent = {
          query: 'SELECT * FROM users',
          params: '["param1"]',
          duration: 150,
        };

        queryHandler(queryEvent);

        expect(mockLogger.debug).toHaveBeenCalledWith('Prisma query', {
          query: 'SELECT * FROM users',
          params: '["param1"]',
          duration: 150,
        });
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('should not log queries in production environment', () => {
      const queryHandlerCall = moduleLoadOnCalls.find((call) => call[0] === 'query');
      expect(queryHandlerCall).toBeDefined();
      const queryHandler = queryHandlerCall?.[1];
      expect(queryHandler).toBeDefined();

      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        const queryEvent = {
          query: 'SELECT * FROM users',
          params: '["param1"]',
          duration: 150,
        };

        queryHandler(queryEvent);

        expect(mockLogger.debug).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});