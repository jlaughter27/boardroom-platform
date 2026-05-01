import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RollbackValidationService, RollbackTestResult, RollbackValidationResult } from '../../../src/services/rollback-validation.service';
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

describe('rollback-validation.service.ts', () => {
  let service: RollbackValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RollbackValidationService();
  });

  describe('RollbackValidationService', () => {
    describe('runRollbackValidationSuite', () => {
      it('should run all rollback validation tests and return comprehensive results', async () => {
        // Mock individual test results for first 3 tests
        const mockTestResults: RollbackTestResult[] = [
          {
            testName: 'Schema Migration Rollback',
            scenario: 'SCHEMA',
            status: 'PASSED',
            durationMs: 250,
            rollbackTimeMs: 150,
            dataIntegrity: true,
            serviceAvailability: true,
            metrics: {
              backupTimeMs: 50,
              migrationApplied: true,
              rollbackSuccessful: true,
              originalSchemaRestored: false,
            },
          },
          {
            testName: 'Index Modification Rollback',
            scenario: 'SCHEMA',
            status: 'PASSED',
            durationMs: 180,
            rollbackTimeMs: 120,
            dataIntegrity: true,
            serviceAvailability: true,
            metrics: {
              backupTimeMs: 40,
              indexCreated: true,
              indexRemoved: true,
              originalIndexesRestored: false,
            },
          },
          {
            testName: 'Table Alteration Rollback',
            scenario: 'SCHEMA',
            status: 'PASSED',
            durationMs: 300,
            rollbackTimeMs: 200,
            dataIntegrity: true,
            serviceAvailability: true,
            metrics: {
              testTableCreated: true,
              testRowsInserted: 3,
              tableRemoved: true,
            },
          },
        ];

        // Mock the first 3 test methods
        vi.spyOn(service as any, 'testSchemaMigrationRollback').mockResolvedValue(mockTestResults[0]);
        vi.spyOn(service as any, 'testIndexModificationRollback').mockResolvedValue(mockTestResults[1]);
        vi.spyOn(service as any, 'testTableAlterationRollback').mockResolvedValue(mockTestResults[2]);
        
        // Mock remaining tests to return quickly
        const quickResult = {
          testName: 'Quick Test',
          scenario: 'SCHEMA' as const,
          status: 'SKIPPED' as const,
          durationMs: 10,
          rollbackTimeMs: 0,
          dataIntegrity: true,
          serviceAvailability: true,
        };
        
        vi.spyOn(service as any, 'testDataMigrationRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testBulkOperationRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testDataCorruptionRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testFeatureFlagRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testAPIVersionRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testConfigurationRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testRLSPolicyRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testAuthenticationRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testAuditLogRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testCacheRollback').mockResolvedValue(quickResult);
        vi.spyOn(service as any, 'testSearchAlgorithmRollback').mockResolvedValue(quickResult);

        const result = await service.runRollbackValidationSuite();

        expect(result).toEqual({
          suiteName: 'Mem0 Rollback Procedure Validation Suite',
          timestamp: expect.any(Date),
          totalTests: 14,
          passedTests: 3,
          failedTests: 0,
          averageRollbackTimeMs: expect.any(Number),
          worstCaseRollbackTimeMs: expect.any(Number),
          testResults: expect.arrayContaining(mockTestResults),
        });

        expect(mockLogger.info).toHaveBeenCalledWith('Starting Mem0 rollback validation suite');
        expect(mockLogger.info).toHaveBeenCalledWith('Rollback validation suite completed', {
          totalTests: 14,
          passedTests: 3,
          failedTests: 0,
          avgRollbackTimeMs: expect.any(String),
          worstCaseRollbackTimeMs: expect.any(Number),
        });
      });

      it('should handle test failures and calculate rollback times correctly', async () => {
        const mockTestResults: RollbackTestResult[] = [
          {
            testName: 'Schema Migration Rollback',
            scenario: 'SCHEMA',
            status: 'FAILED',
            durationMs: 250,
            rollbackTimeMs: 0,
            dataIntegrity: false,
            serviceAvailability: false,
            error: 'Database connection failed',
          },
          {
            testName: 'Index Modification Rollback',
            scenario: 'SCHEMA',
            status: 'PASSED',
            durationMs: 180,
            rollbackTimeMs: 120,
            dataIntegrity: true,
            serviceAvailability: true,
            metrics: { indexCreated: true, indexRemoved: true },
          },
        ];

        vi.spyOn(service as any, 'testSchemaMigrationRollback').mockResolvedValue(mockTestResults[0]);
        vi.spyOn(service as any, 'testIndexModificationRollback').mockResolvedValue(mockTestResults[1]);
        
        // Mock remaining tests
        const quickResult = {
          testName: 'Quick Test',
          scenario: 'SCHEMA' as const,
          status: 'SKIPPED' as const,
          durationMs: 10,
          rollbackTimeMs: 0,
          dataIntegrity: true,
          serviceAvailability: true,
        };
        
        // Mock all other tests
        const otherTests = [
          'testTableAlterationRollback', 'testDataMigrationRollback', 'testBulkOperationRollback',
          'testDataCorruptionRollback', 'testFeatureFlagRollback', 'testAPIVersionRollback',
          'testConfigurationRollback', 'testRLSPolicyRollback', 'testAuthenticationRollback',
          'testAuditLogRollback', 'testCacheRollback', 'testSearchAlgorithmRollback'
        ];
        
        otherTests.forEach(testName => {
          vi.spyOn(service as any, testName).mockResolvedValue(quickResult);
        });

        const result = await service.runRollbackValidationSuite();

        expect(result.failedTests).toBe(1);
        expect(result.passedTests).toBe(1);
        expect(result.averageRollbackTimeMs).toBe(120); // Only one successful rollback
        expect(result.worstCaseRollbackTimeMs).toBe(120);
        expect(result.testResults[0].error).toBe('Database connection failed');
      });
    });

    describe('testSchemaMigrationRollback', () => {
      it('should pass when schema migration can be rolled back successfully', async () => {
        // Mock backupCurrentSchema to return a backup object
        vi.spyOn(service as any, 'backupCurrentSchema').mockResolvedValue({ backupId: 'test-backup' });
        vi.spyOn(service as any, 'checkColumnExists').mockResolvedValue(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        vi.spyOn(service as any, 'verifyDataIntegrity').mockResolvedValue(true);
        vi.spyOn(service as any, 'verifyServiceAvailability').mockResolvedValue(true);
        vi.spyOn(service as any, 'restoreSchemaFromBackup').mockResolvedValue(undefined);

        mockPrisma.$executeRaw.mockResolvedValue(1); // Simulate successful SQL execution

        const result = await (service as any).testSchemaMigrationRollback();

        expect(result.status).toBe('PASSED');
        expect(result.scenario).toBe('SCHEMA');
        expect(result.dataIntegrity).toBe(true);
        expect(result.serviceAvailability).toBe(true);
        expect(result.rollbackTimeMs).toBeGreaterThan(0);
        expect(result.metrics).toEqual({
          backupTimeMs: expect.any(Number),
          migrationApplied: true,
          rollbackSuccessful: true,
          originalSchemaRestored: false,
        });

        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/ALTER TABLE memory_entries/));
      });

      it('should fail when schema migration fails to apply', async () => {
        vi.spyOn(service as any, 'backupCurrentSchema').mockResolvedValue({ backupId: 'test-backup' });
        vi.spyOn(service as any, 'checkColumnExists').mockResolvedValue(false); // Column doesn't exist after migration
        vi.spyOn(service as any, 'restoreSchemaFromBackup').mockResolvedValue(undefined);

        mockPrisma.$executeRaw.mockResolvedValue(1);

        const result = await (service as any).testSchemaMigrationRollback();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Schema migration failed to apply');
      });

      it('should restore from backup when rollback fails', async () => {
        vi.spyOn(service as any, 'backupCurrentSchema').mockResolvedValue({ backupId: 'test-backup' });
        vi.spyOn(service as any, 'checkColumnExists')
          .mockResolvedValue(true) // Column exists after migration
          .mockResolvedValueOnce(true) // First check: column exists
          .mockResolvedValueOnce(true); // Second check: column still exists (rollback failed)
        vi.spyOn(service as any, 'verifyDataIntegrity').mockResolvedValue(true);
        vi.spyOn(service as any, 'verifyServiceAvailability').mockResolvedValue(true);
        vi.spyOn(service as any, 'restoreSchemaFromBackup').mockResolvedValue(undefined);

        mockPrisma.$executeRaw.mockResolvedValue(1);

        const result = await (service as any).testSchemaMigrationRollback();

        expect(result.status).toBe('FAILED');
        expect(result.metrics?.originalSchemaRestored).toBe(true);
      });
    });

    describe('testIndexModificationRollback', () => {
      it('should pass when index modification can be rolled back successfully', async () => {
        vi.spyOn(service as any, 'backupIndexes').mockResolvedValue({ indexes: ['idx_test'] });
        vi.spyOn(service as any, 'checkIndexExists').mockResolvedValue(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        vi.spyOn(service as any, 'verifyDataIntegrity').mockResolvedValue(true);
        vi.spyOn(service as any, 'verifyServiceAvailability').mockResolvedValue(true);
        vi.spyOn(service as any, 'restoreIndexesFromBackup').mockResolvedValue(undefined);

        mockPrisma.$executeRaw.mockResolvedValue(1);

        const result = await (service as any).testIndexModificationRollback();

        expect(result.status).toBe('PASSED');
        expect(result.scenario).toBe('SCHEMA');
        expect(result.dataIntegrity).toBe(true);
        expect(result.serviceAvailability).toBe(true);
        expect(result.metrics).toEqual({
          backupTimeMs: expect.any(Number),
          indexCreated: true,
          indexRemoved: true,
          originalIndexesRestored: false,
        });

        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/CREATE INDEX/));
        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/DROP INDEX/));
      });

      it('should fail when index creation fails', async () => {
        vi.spyOn(service as any, 'backupIndexes').mockResolvedValue({ indexes: ['idx_test'] });
        vi.spyOn(service as any, 'checkIndexExists').mockResolvedValue(false); // Index doesn't exist after creation
        vi.spyOn(service as any, 'restoreIndexesFromBackup').mockResolvedValue(undefined);

        mockPrisma.$executeRaw.mockResolvedValue(1);

        const result = await (service as any).testIndexModificationRollback();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Index creation failed');
      });
    });

    describe('testTableAlterationRollback', () => {
      it('should pass when test table can be created and dropped successfully', async () => {
        vi.spyOn(service as any, 'checkTableExists')
          .mockResolvedValue(false) // Table doesn't exist initially
          .mockResolvedValueOnce(false) // First check
          .mockResolvedValueOnce(false); // Final check after drop
        vi.spyOn(service as any, 'getRowCount').mockResolvedValue(3);
        vi.spyOn(service as any, 'verifyDataIntegrity').mockResolvedValue(true);
        vi.spyOn(service as any, 'verifyServiceAvailability').mockResolvedValue(true);

        mockPrisma.$executeRaw
          .mockResolvedValueOnce(1) // CREATE TABLE
          .mockResolvedValueOnce(3) // INSERT rows
          .mockResolvedValueOnce(1); // DROP TABLE

        const result = await (service as any).testTableAlterationRollback();

        expect(result.status).toBe('PASSED');
        expect(result.scenario).toBe('SCHEMA');
        expect(result.dataIntegrity).toBe(true);
        expect(result.serviceAvailability).toBe(true);
        expect(result.metrics).toEqual({
          testTableCreated: true,
          testRowsInserted: 3,
          tableRemoved: true,
        });

        // Use more flexible matching since SQL strings include formatting
        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/CREATE TABLE rollback_test_table/));
        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO rollback_test_table/));
        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/DROP TABLE IF EXISTS rollback_test_table/));
      });

      it('should clean up existing test table before starting', async () => {
        vi.spyOn(service as any, 'checkTableExists')
          .mockResolvedValue(true) // Table exists initially
          .mockResolvedValueOnce(true) // First check
          .mockResolvedValueOnce(false); // Final check after drop
        vi.spyOn(service as any, 'getRowCount').mockResolvedValue(3);
        vi.spyOn(service as any, 'verifyDataIntegrity').mockResolvedValue(true);
        vi.spyOn(service as any, 'verifyServiceAvailability').mockResolvedValue(true);

        mockPrisma.$executeRaw
          .mockResolvedValueOnce(1) // DROP existing table
          .mockResolvedValueOnce(1) // CREATE TABLE
          .mockResolvedValueOnce(3) // INSERT rows
          .mockResolvedValueOnce(1); // DROP TABLE

        const result = await (service as any).testTableAlterationRollback();

        expect(result.status).toBe('PASSED');
        expect(result.metrics).toEqual({
          testTableCreated: false, // Because table existed initially
          testRowsInserted: 3,
          tableRemoved: true,
        });
        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/DROP TABLE IF EXISTS rollback_test_table/));
      });

      it('should fail when test data insertion fails', async () => {
        vi.spyOn(service as any, 'checkTableExists').mockResolvedValue(false);
        vi.spyOn(service as any, 'getRowCount').mockResolvedValue(2); // Only 2 rows inserted instead of 3

        mockPrisma.$executeRaw
          .mockResolvedValueOnce(1) // CREATE TABLE
          .mockResolvedValueOnce(2) // INSERT rows (returns 2)
          .mockResolvedValueOnce(1); // DROP TABLE cleanup

        const result = await (service as any).testTableAlterationRollback();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Test data insertion failed');
        
        // Should clean up on failure
        expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(expect.stringMatching(/DROP TABLE IF EXISTS rollback_test_table/));
      });
    });
  });
});