import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityPenetrationTestService, SecurityTestResult, SecurityTestSuiteResult } from '../../../src/services/security-penetration-test.service';
import { prisma } from '../../../src/lib/db';
import { logger } from '../../../src/lib/logger';

// Create comprehensive hoisted mocks
const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  memoryEntry: {
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Mock dependencies
vi.mock('../../../src/lib/db', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: mockLogger,
}));

describe('security-penetration-test.service.ts', () => {
  let service: SecurityPenetrationTestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SecurityPenetrationTestService();
  });

  describe('SecurityPenetrationTestService', () => {
    describe('runSecurityTestSuite', () => {
      it('should run all security tests and return comprehensive results', async () => {
        // Mock individual test results
        const mockTestResults: SecurityTestResult[] = [
          {
            testName: 'RLS Enforcement Test',
            category: 'RLS',
            severity: 'CRITICAL',
            status: 'PASSED',
            description: 'Verifies RLS policies are properly enforced',
          },
          {
            testName: 'Cross-User Data Access Test',
            category: 'RLS',
            severity: 'HIGH',
            status: 'FAILED',
            description: 'Tests if users can access other users data',
            recommendation: 'Strengthen RLS filter conditions',
            evidence: { userId: 'test-user-1', accessedUserId: 'test-user-2' },
          },
        ];

        // Mock the first 2 test methods
        vi.spyOn(service as any, 'testRLSEnforcement').mockResolvedValue(mockTestResults[0]);
        vi.spyOn(service as any, 'testCrossUserDataAccess').mockResolvedValue(mockTestResults[1]);
        
        // Mock remaining tests to return quickly
        const quickResult = {
          testName: 'Quick Test',
          category: 'RLS' as const,
          severity: 'LOW' as const,
          status: 'PASSED' as const,
          description: 'Quick test',
        };
        
        const otherTests = [
          'testRLSBypassAttempts', 'testAuthenticationBypass', 'testPrivilegeEscalation',
          'testSQLInjectionVectors', 'testRawQuerySanitization', 'testPIIExposure',
          'testEmbeddingDataLeak', 'testCrossUserEntityLinking', 'testAuditLogIntegrity',
          'testTamperDetection'
        ];
        
        otherTests.forEach(testName => {
          vi.spyOn(service as any, testName).mockResolvedValue(quickResult);
        });

        const result = await service.runSecurityTestSuite();

        expect(result.suiteName).toBe('Mem0 Security Penetration Test Suite');
        expect(result.timestamp).toBeInstanceOf(Date);
        expect(result.totalTests).toBe(12);
        expect(result.passedTests).toBe(11); // 1 failed, 11 passed
        expect(result.failedTests).toBe(1);
        expect(result.criticalFindings).toBe(0); // Failed test is HIGH severity
        expect(result.highFindings).toBe(1);
        expect(result.testResults).toHaveLength(12);
        expect(result.testResults).toEqual(expect.arrayContaining(mockTestResults));

        expect(mockLogger.info).toHaveBeenCalledWith('Starting security penetration test suite');
        expect(mockLogger.info).toHaveBeenCalledWith('Security test suite completed', {
          totalTests: 12,
          passedTests: 11,
          failedTests: 1,
          criticalFindings: 0,
          highFindings: 1,
          mediumFindings: 0,
          lowFindings: 0,
        });
      });

      it('should handle test failures gracefully and continue execution', async () => {
        vi.spyOn(service as any, 'testRLSEnforcement').mockRejectedValue(new Error('Database timeout'));
        
        // Mock other tests to pass
        const quickResult = {
          testName: 'Quick Test',
          category: 'RLS' as const,
          severity: 'LOW' as const,
          status: 'PASSED' as const,
          description: 'Quick test',
        };
        
        const otherTests = [
          'testCrossUserDataAccess', 'testRLSBypassAttempts', 'testAuthenticationBypass',
          'testPrivilegeEscalation', 'testSQLInjectionVectors', 'testRawQuerySanitization',
          'testPIIExposure', 'testEmbeddingDataLeak', 'testCrossUserEntityLinking',
          'testAuditLogIntegrity', 'testTamperDetection'
        ];
        
        otherTests.forEach(testName => {
          vi.spyOn(service as any, testName).mockResolvedValue(quickResult);
        });

        const result = await service.runSecurityTestSuite();

        expect(result.totalTests).toBe(12);
        expect(result.failedTests).toBe(1); // One test failed due to error
        expect(mockLogger.error).toHaveBeenCalledWith('Security test failed', expect.any(Error));
      });
    });

    describe('testRLSEnforcement', () => {
      it('should pass when RLS policies are properly enforced', async () => {
        // Mock database responses
        mockPrisma.memoryEntry.findUnique.mockResolvedValue(null); // User cannot access other user's data
        mockPrisma.memoryEntry.create.mockResolvedValue({ id: 'test-id', userId: 'test-user' });

        const result = await (service as any).testRLSEnforcement();

        expect(result.testName).toBe('RLS Enforcement Test');
        expect(result.category).toBe('RLS');
        expect(result.severity).toBe('CRITICAL');
        expect(result.status).toBe('PASSED');
        expect(result.description).toContain('RLS policies');
      });

      it('should fail when RLS policies are not enforced', async () => {
        // Mock that user CAN access other user's data (RLS failure)
        mockPrisma.memoryEntry.findUnique.mockResolvedValue({ 
          id: 'other-user-memory', 
          userId: 'other-user',
          content: 'Sensitive data'
        });

        const result = await (service as any).testRLSEnforcement();

        expect(result.status).toBe('FAILED');
        expect(result.recommendation).toBeDefined();
        expect(result.evidence).toBeDefined();
      });
    });

    describe('testCrossUserDataAccess', () => {
      it('should detect cross-user data access attempts', async () => {
        // Mock that user can access their own data but not others
        mockPrisma.memoryEntry.findUnique
          .mockResolvedValueOnce({ id: 'own-memory', userId: 'test-user' }) // Own data
          .mockResolvedValueOnce(null); // Other user's data (correctly blocked)

        const result = await (service as any).testCrossUserDataAccess();

        expect(result.testName).toBe('Cross-User Data Access Test');
        expect(result.category).toBe('RLS');
        expect(result.severity).toBe('HIGH');
        expect(result.status).toBe('PASSED');
      });

      it('should fail when cross-user data access is possible', async () => {
        // Mock that user CAN access other user's data
        mockPrisma.memoryEntry.findUnique
          .mockResolvedValueOnce({ id: 'own-memory', userId: 'test-user' })
          .mockResolvedValueOnce({ id: 'other-memory', userId: 'other-user' }); // Should be blocked but isn't

        const result = await (service as any).testCrossUserDataAccess();

        expect(result.status).toBe('FAILED');
        expect(result.evidence).toHaveProperty('userId');
        expect(result.evidence).toHaveProperty('accessedUserId');
      });
    });

    describe('testSQLInjectionVectors', () => {
      it('should test SQL injection attempts and report findings', async () => {
        // Mock that SQL injection attempts are blocked
        mockPrisma.$queryRaw.mockRejectedValue(new Error('Invalid SQL syntax'));
        mockPrisma.$executeRaw.mockRejectedValue(new Error('Invalid SQL syntax'));

        const result = await (service as any).testSQLInjectionVectors();

        expect(result.testName).toBe('SQL Injection Vectors Test');
        expect(result.category).toBe('SQLI');
        expect(result.severity).toBe('CRITICAL');
        expect(result.description).toContain('SQL injection');
      });

      it('should detect successful SQL injection attempts', async () => {
        // Mock that SQL injection succeeds (security failure)
        mockPrisma.$queryRaw.mockResolvedValue([{ sensitive_data: 'leaked' }]);

        const result = await (service as any).testSQLInjectionVectors();

        expect(result.status).toBe('FAILED');
        expect(result.severity).toBe('CRITICAL');
        expect(result.recommendation).toContain('sanitize');
      });
    });

    describe('testPIIExposure', () => {
      it('should test for PII data exposure in queries', async () => {
        // Mock database responses
        mockPrisma.memoryEntry.findMany.mockResolvedValue([
          { id: 'test-1', content: 'Non-sensitive content' },
          { id: 'test-2', content: 'Another non-sensitive entry' },
        ]);

        const result = await (service as any).testPIIExposure();

        expect(result.testName).toBe('PII Exposure Test');
        expect(result.category).toBe('DATA_LEAK');
        expect(result.severity).toBe('HIGH');
        expect(result.description).toContain('PII');
      });

      it('should detect PII in query results', async () => {
        // Mock that PII is exposed in results
        mockPrisma.memoryEntry.findMany.mockResolvedValue([
          { id: 'test-1', content: 'Email: user@example.com, SSN: 123-45-6789' },
        ]);

        const result = await (service as any).testPIIExposure();

        expect(result.status).toBe('FAILED');
        expect(result.evidence).toHaveProperty('piiDetected');
        expect(result.recommendation).toContain('mask');
      });
    });

    describe('testAuditLogIntegrity', () => {
      it('should verify audit log integrity and tamper detection', async () => {
        // Mock audit log checks
        mockPrisma.$queryRaw.mockResolvedValue([
          { log_id: '1', user_id: 'test-user', action: 'CREATE', timestamp: new Date() },
        ]);

        const result = await (service as any).testAuditLogIntegrity();

        expect(result.testName).toBe('Audit Log Integrity Test');
        expect(result.category).toBe('AUDIT');
        expect(result.severity).toBe('MEDIUM');
        expect(result.description).toContain('audit log');
      });

      it('should detect audit log tampering', async () => {
        // Mock inconsistent audit logs (potential tampering)
        mockPrisma.$queryRaw.mockResolvedValue([
          { log_id: '1', user_id: null, action: 'DELETE', timestamp: new Date('2020-01-01') }, // Suspicious entry
        ]);

        const result = await (service as any).testAuditLogIntegrity();

        expect(result.status).toBe('FAILED');
        expect(result.evidence).toHaveProperty('anomaliesDetected');
      });
    });
  });
});