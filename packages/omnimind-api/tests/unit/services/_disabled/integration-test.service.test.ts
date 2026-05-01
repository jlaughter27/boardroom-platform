import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IntegrationTestService, integrationTestService, IntegrationTestResult, TestSuiteResult } from '../../../src/services/integration-test.service';
import { prisma } from '../../../src/lib/db';
import { logger } from '../../../src/lib/logger';

// Create comprehensive hoisted mocks
const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  memoryEntry: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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

describe('integration-test.service.ts', () => {
  let service: IntegrationTestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IntegrationTestService();
  });

  describe('IntegrationTestService', () => {
    describe('runFullIntegrationSuite', () => {
      it('should run all integration tests and return comprehensive results', async () => {
        // Mock all individual test results
        const mockTestResults: IntegrationTestResult[] = [
          {
            testName: 'Database Connectivity & RLS Policies',
            status: 'PASSED',
            durationMs: 150,
            details: { databaseConnected: true, rlsEnforced: true },
          },
          {
            testName: 'Entity Extraction Pipeline',
            status: 'PASSED',
            durationMs: 200,
            details: { memoryCreated: true, testDataCleaned: true },
          },
          {
            testName: 'Relationship Building',
            status: 'SKIPPED',
            durationMs: 100,
            details: { relationshipTablesFound: 0, tableNames: [] },
          },
          {
            testName: 'Hybrid Search Functionality',
            status: 'PASSED',
            durationMs: 180,
            details: { hybridSearchFunctionExists: true },
          },
          {
            testName: 'Graph Traversal Queries',
            status: 'SKIPPED',
            durationMs: 120,
            details: { graphTraversalFunctionExists: false },
          },
          {
            testName: 'Search Caching',
            status: 'PASSED',
            durationMs: 160,
            details: { cacheTablesFound: 1, tableNames: ['search_cache'] },
          },
          {
            testName: 'Query Understanding',
            status: 'PASSED',
            durationMs: 140,
            details: { intentTablesFound: 2, tableNames: ['query_intents', 'search_intents'] },
          },
          {
            testName: 'Search Analytics',
            status: 'PASSED',
            durationMs: 130,
            details: { analyticsTablesFound: 1, tableNames: ['search_analytics'] },
          },
        ];

        // Mock individual test methods
        vi.spyOn(service as any, 'testDatabaseConnectivity').mockResolvedValue(mockTestResults[0]);
        vi.spyOn(service as any, 'testEntityExtractionPipeline').mockResolvedValue(mockTestResults[1]);
        vi.spyOn(service as any, 'testRelationshipBuilding').mockResolvedValue(mockTestResults[2]);
        vi.spyOn(service as any, 'testHybridSearch').mockResolvedValue(mockTestResults[3]);
        vi.spyOn(service as any, 'testGraphTraversal').mockResolvedValue(mockTestResults[4]);
        vi.spyOn(service as any, 'testSearchCaching').mockResolvedValue(mockTestResults[5]);
        vi.spyOn(service as any, 'testQueryUnderstanding').mockResolvedValue(mockTestResults[6]);
        vi.spyOn(service as any, 'testSearchAnalytics').mockResolvedValue(mockTestResults[7]);

        const result = await service.runFullIntegrationSuite();

        expect(result).toEqual({
          suiteName: 'Mem0 Integration Test Suite',
          timestamp: expect.any(Date),
          totalTests: 8,
          passedTests: 6,
          failedTests: 0,
          skippedTests: 2,
          totalDurationMs: expect.any(Number),
          testResults: mockTestResults,
        });

        expect(mockLogger.info).toHaveBeenCalledWith('Starting Mem0 integration test suite');
        expect(mockLogger.info).toHaveBeenCalledWith('Integration test suite completed', {
          totalTests: 8,
          passedTests: 6,
          failedTests: 0,
          durationMs: expect.any(Number),
        });
      });

      it('should handle test failures gracefully', async () => {
        const mockTestResults: IntegrationTestResult[] = [
          {
            testName: 'Database Connectivity & RLS Policies',
            status: 'FAILED',
            durationMs: 150,
            error: 'Database connection timeout',
          },
          {
            testName: 'Entity Extraction Pipeline',
            status: 'PASSED',
            durationMs: 200,
            details: { memoryCreated: true, testDataCleaned: true },
          },
        ];

        vi.spyOn(service as any, 'testDatabaseConnectivity').mockResolvedValue(mockTestResults[0]);
        vi.spyOn(service as any, 'testEntityExtractionPipeline').mockResolvedValue(mockTestResults[1]);
        // Mock other tests to return quickly
        vi.spyOn(service as any, 'testRelationshipBuilding').mockResolvedValue({ 
          testName: 'Relationship Building', 
          status: 'SKIPPED', 
          durationMs: 10 
        } as IntegrationTestResult);
        vi.spyOn(service as any, 'testHybridSearch').mockResolvedValue({ 
          testName: 'Hybrid Search Functionality', 
          status: 'SKIPPED', 
          durationMs: 10 
        } as IntegrationTestResult);
        vi.spyOn(service as any, 'testGraphTraversal').mockResolvedValue({ 
          testName: 'Graph Traversal Queries', 
          status: 'SKIPPED', 
          durationMs: 10 
        } as IntegrationTestResult);
        vi.spyOn(service as any, 'testSearchCaching').mockResolvedValue({ 
          testName: 'Search Caching', 
          status: 'SKIPPED', 
          durationMs: 10 
        } as IntegrationTestResult);
        vi.spyOn(service as any, 'testQueryUnderstanding').mockResolvedValue({ 
          testName: 'Query Understanding', 
          status: 'SKIPPED', 
          durationMs: 10 
        } as IntegrationTestResult);
        vi.spyOn(service as any, 'testSearchAnalytics').mockResolvedValue({ 
          testName: 'Search Analytics', 
          status: 'SKIPPED', 
          durationMs: 10 
        } as IntegrationTestResult);

        const result = await service.runFullIntegrationSuite();

        expect(result.failedTests).toBe(1);
        expect(result.passedTests).toBe(1);
        expect(result.skippedTests).toBe(6);
        expect(result.testResults[0].error).toBe('Database connection timeout');
      });
    });

    describe('testDatabaseConnectivity', () => {
      it('should pass when database is connected and RLS is enforced', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ test: 1 }]);
        mockPrisma.memoryEntry.findMany.mockResolvedValue([]); // Empty array simulates RLS filtering

        const result = await (service as any).testDatabaseConnectivity();

        expect(result).toEqual({
          testName: 'Database Connectivity & RLS Policies',
          status: 'PASSED',
          durationMs: expect.any(Number),
          details: {
            databaseConnected: true,
            rlsEnforced: true,
          },
        });

        expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.anything());
        expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith({
          take: 1,
        });
      });

      it('should fail when database query fails', async () => {
        mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

        const result = await (service as any).testDatabaseConnectivity();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Connection refused');
      });

      it('should fail when RLS is not enforced (returns data without userId)', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ test: 1 }]);
        mockPrisma.memoryEntry.findMany.mockResolvedValue([
          { id: 'test-id', content: 'test', userId: null } // Missing userId
        ]);

        const result = await (service as any).testDatabaseConnectivity();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('RLS policies not properly enforced');
      });
    });

    describe('testEntityExtractionPipeline', () => {
      it('should pass when memory can be created and deleted', async () => {
        const mockMemory = { id: 'test-memory-id', userId: 'test-user-integration' };
        mockPrisma.memoryEntry.create.mockResolvedValue(mockMemory);
        mockPrisma.memoryEntry.delete.mockResolvedValue(mockMemory);

        const result = await (service as any).testEntityExtractionPipeline();

        expect(result.status).toBe('PASSED');
        expect(result.details).toEqual({
          memoryCreated: true,
          testDataCleaned: true,
        });

        expect(mockPrisma.memoryEntry.create).toHaveBeenCalledWith({
          data: {
            userId: 'test-user-integration',
            content: 'John works at Google as a software engineer. He knows Mary who works at Microsoft.',
            domain: 'test',
            embedding: expect.any(Array),
          },
        });

        expect(mockPrisma.memoryEntry.delete).toHaveBeenCalledWith({
          where: { id: 'test-memory-id' },
        });
      });

      it('should fail when memory creation fails', async () => {
        mockPrisma.memoryEntry.create.mockRejectedValue(new Error('Database constraint violation'));

        const result = await (service as any).testEntityExtractionPipeline();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Database constraint violation');
      });

      it('should fail when created memory has no id', async () => {
        mockPrisma.memoryEntry.create.mockResolvedValue({}); // No id property
        mockPrisma.memoryEntry.delete.mockResolvedValue({});

        const result = await (service as any).testEntityExtractionPipeline();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Failed to create test memory');
      });
    });

    describe('testRelationshipBuilding', () => {
      it('should pass when relationship tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          { table_name: 'entity_relationships' },
          { table_name: 'relationship_types' },
        ]);

        const result = await (service as any).testRelationshipBuilding();

        expect(result.status).toBe('PASSED');
        expect(result.details).toEqual({
          relationshipTablesFound: 2,
          tableNames: ['entity_relationships', 'relationship_types'],
        });
      });

      it('should be skipped when no relationship tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        const result = await (service as any).testRelationshipBuilding();

        expect(result.status).toBe('SKIPPED');
        expect(result.details.relationshipTablesFound).toBe(0);
      });

      it('should fail when database query fails', async () => {
        mockPrisma.$queryRaw.mockRejectedValue(new Error('Permission denied'));

        const result = await (service as any).testRelationshipBuilding();

        expect(result.status).toBe('FAILED');
        expect(result.error).toContain('Permission denied');
      });
    });

    describe('testHybridSearch', () => {
      it('should pass when hybrid_search function exists', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ routine_name: 'hybrid_search' }]);

        const result = await (service as any).testHybridSearch();

        expect(result.status).toBe('PASSED');
        expect(result.details).toEqual({
          hybridSearchFunctionExists: true,
        });
      });

      it('should be skipped when hybrid_search function does not exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        const result = await (service as any).testHybridSearch();

        expect(result.status).toBe('SKIPPED');
        expect(result.details.hybridSearchFunctionExists).toBe(false);
      });
    });

    describe('testSearchCaching', () => {
      it('should pass when cache tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          { table_name: 'search_cache' },
          { table_name: 'cache_metrics' },
        ]);

        const result = await (service as any).testSearchCaching();

        expect(result.status).toBe('PASSED');
        expect(result.details).toEqual({
          cacheTablesFound: 2,
          tableNames: ['search_cache', 'cache_metrics'],
        });
      });

      it('should be skipped when no cache tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        const result = await (service as any).testSearchCaching();

        expect(result.status).toBe('SKIPPED');
        expect(result.details.cacheTablesFound).toBe(0);
      });
    });

    describe('testQueryUnderstanding', () => {
      it('should pass when intent/query tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          { table_name: 'query_intents' },
          { table_name: 'search_patterns' },
        ]);

        const result = await (service as any).testQueryUnderstanding();

        expect(result.status).toBe('PASSED');
        expect(result.details).toEqual({
          intentTablesFound: 2,
          tableNames: ['query_intents', 'search_patterns'],
        });
      });

      it('should be skipped when no intent/query tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        const result = await (service as any).testQueryUnderstanding();

        expect(result.status).toBe('SKIPPED');
        expect(result.details.intentTablesFound).toBe(0);
      });
    });

    describe('testSearchAnalytics', () => {
      it('should pass when analytics tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          { table_name: 'search_analytics' },
          { table_name: 'click_analytics' },
        ]);

        const result = await (service as any).testSearchAnalytics();

        expect(result.status).toBe('PASSED');
        expect(result.details).toEqual({
          analyticsTablesFound: 2,
          tableNames: ['search_analytics', 'click_analytics'],
        });
      });

      it('should be skipped when no analytics tables exist', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        const result = await (service as any).testSearchAnalytics();

        expect(result.status).toBe('SKIPPED');
        expect(result.details.analyticsTablesFound).toBe(0);
      });
    });

    describe('generateMarkdownReport', () => {
      it('should generate a comprehensive markdown report', () => {
        const testResult: TestSuiteResult = {
          suiteName: 'Mem0 Integration Test Suite',
          timestamp: new Date('2026-04-14T07:30:00Z'),
          totalTests: 8,
          passedTests: 6,
          failedTests: 1,
          skippedTests: 1,
          totalDurationMs: 1250,
          testResults: [
            {
              testName: 'Database Connectivity & RLS Policies',
              status: 'PASSED',
              durationMs: 150,
              details: { databaseConnected: true, rlsEnforced: true },
            },
            {
              testName: 'Entity Extraction Pipeline',
              status: 'FAILED',
              durationMs: 200,
              error: 'Memory creation failed',
            },
          ],
        };

        const report = service.generateMarkdownReport(testResult);

        expect(report).toContain('# Mem0 Integration Test Report');
        expect(report).toContain('**Suite:** Mem0 Integration Test Suite');
        expect(report).toContain('| Total Tests | 8 |');
        expect(report).toContain('| Passed | 6');
        expect(report).toContain('| Failed | 1 |');
        expect(report).toContain('| Skipped | 1 |');
        expect(report).toContain('Database Connectivity & RLS Policies');
        expect(report).toContain('Entity Extraction Pipeline');
        expect(report).toContain('Memory creation failed');
      });

      it('should show all tests passed emoji when all tests pass', () => {
        const testResult: TestSuiteResult = {
          suiteName: 'Mem0 Integration Test Suite',
          timestamp: new Date(),
          totalTests: 3,
          passedTests: 3,
          failedTests: 0,
          skippedTests: 0,
          totalDurationMs: 500,
          testResults: [],
        };

        const report = service.generateMarkdownReport(testResult);

        expect(report).toContain('| Passed | 3 ✅ |');
        expect(report).toContain('**Overall Status:** ✅ ALL TESTS PASSED');
      });
    });
  });

  describe('integrationTestService singleton', () => {
    it('should export a singleton instance', () => {
      expect(integrationTestService).toBeInstanceOf(IntegrationTestService);
      expect(integrationTestService).toBe(integrationTestService); // Same instance
    });

    it('should have accessible methods on singleton', () => {
      expect(typeof integrationTestService.runFullIntegrationSuite).toBe('function');
      expect(typeof integrationTestService.generateMarkdownReport).toBe('function');
    });
  });
});