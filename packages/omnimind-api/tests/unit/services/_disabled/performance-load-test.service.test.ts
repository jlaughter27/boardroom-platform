import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceLoadTestService, PerformanceTestResult, LoadTestScenario, LoadTestResult } from '../../../src/services/performance-load-test.service';
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

describe('performance-load-test.service.ts', () => {
  let service: PerformanceLoadTestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PerformanceLoadTestService();
  });

  describe('PerformanceLoadTestService', () => {
    describe('runLoadTestSuite', () => {
      it('should run all load test scenarios and return comprehensive results', async () => {
        // Mock the runScenario method to return test results
        const mockScenarioResults: LoadTestResult[] = [
          {
            scenario: {
              name: 'Baseline Single User',
              concurrentUsers: 1,
              durationSeconds: 30,
              thinkTimeMs: 1000,
              operationsPerUser: 10,
            },
            timestamp: new Date(),
            totalOperations: 10,
            totalDurationMs: 30000,
            avgThroughput: 0.33,
            avgSuccessRate: 100,
            testResults: [
              {
                testName: 'Search Performance',
                operation: 'SEARCH',
                durationMs: 5000,
                throughput: 2,
                p50LatencyMs: 100,
                p95LatencyMs: 200,
                p99LatencyMs: 300,
                successRate: 100,
                errorCount: 0,
                sampleSize: 10,
                metrics: { queriesPerSecond: 2 },
              },
            ],
          },
        ];

        vi.spyOn(service as any, 'runScenario').mockResolvedValue(mockScenarioResults[0]);

        const results = await service.runLoadTestSuite();

        expect(results).toHaveLength(4); // 4 scenarios
        expect(results[0]).toEqual(mockScenarioResults[0]);
        expect(mockLogger.info).toHaveBeenCalledWith('Starting Mem0 performance load test suite');
        expect(mockLogger.info).toHaveBeenCalledWith('Performance load test suite completed', {
          totalScenarios: 4,
          totalOperations: expect.any(Number),
        });
      });

      it('should handle errors in individual scenarios gracefully', async () => {
        vi.spyOn(service as any, 'runScenario')
          .mockResolvedValueOnce({
            scenario: { name: 'Baseline Single User' },
            timestamp: new Date(),
            totalOperations: 10,
            totalDurationMs: 30000,
            avgThroughput: 0.33,
            avgSuccessRate: 100,
            testResults: [],
          })
          .mockRejectedValueOnce(new Error('Database timeout'))
          .mockResolvedValueOnce({
            scenario: { name: 'High Load' },
            timestamp: new Date(),
            totalOperations: 20,
            totalDurationMs: 60000,
            avgThroughput: 0.33,
            avgSuccessRate: 95,
            testResults: [],
          })
          .mockResolvedValueOnce({
            scenario: { name: 'Spike Load' },
            timestamp: new Date(),
            totalOperations: 15,
            totalDurationMs: 90000,
            avgThroughput: 0.17,
            avgSuccessRate: 90,
            testResults: [],
          });

        const results = await service.runLoadTestSuite();

        expect(results).toHaveLength(3); // One scenario failed
        expect(mockLogger.error).toHaveBeenCalledWith('Scenario failed', expect.any(Error));
      });
    });

    describe('runScenario', () => {
      it('should execute a load test scenario and return results', async () => {
        const scenario: LoadTestScenario = {
          name: 'Test Scenario',
          concurrentUsers: 2,
          durationSeconds: 10,
          thinkTimeMs: 500,
          operationsPerUser: 5,
        };

        // Mock individual test methods
        vi.spyOn(service as any, 'testSearchPerformance').mockResolvedValue({
          testName: 'Search Performance',
          operation: 'SEARCH',
          durationMs: 2000,
          throughput: 5,
          p50LatencyMs: 50,
          p95LatencyMs: 100,
          p99LatencyMs: 150,
          successRate: 100,
          errorCount: 0,
          sampleSize: 10,
          metrics: { queriesPerSecond: 5 },
        });

        vi.spyOn(service as any, 'testExtractionPerformance').mockResolvedValue({
          testName: 'Extraction Performance',
          operation: 'EXTRACTION',
          durationMs: 3000,
          throughput: 3.33,
          p50LatencyMs: 75,
          p95LatencyMs: 125,
          p99LatencyMs: 175,
          successRate: 95,
          errorCount: 1,
          sampleSize: 20,
          metrics: { extractionsPerSecond: 3.33 },
        });

        const result = await (service as any).runScenario(scenario);

        expect(result.scenario).toEqual(scenario);
        expect(result.timestamp).toBeInstanceOf(Date);
        expect(result.totalOperations).toBeGreaterThan(0);
        expect(result.totalDurationMs).toBeGreaterThan(0);
        expect(result.avgThroughput).toBeGreaterThan(0);
        expect(result.avgSuccessRate).toBeGreaterThanOrEqual(0);
        expect(result.testResults).toHaveLength(2);
      });

      it('should handle test failures within a scenario', async () => {
        const scenario: LoadTestScenario = {
          name: 'Test Scenario',
          concurrentUsers: 2,
          durationSeconds: 10,
          thinkTimeMs: 500,
          operationsPerUser: 5,
        };

        vi.spyOn(service as any, 'testSearchPerformance').mockRejectedValue(new Error('Search timeout'));
        vi.spyOn(service as any, 'testExtractionPerformance').mockResolvedValue({
          testName: 'Extraction Performance',
          operation: 'EXTRACTION',
          durationMs: 3000,
          throughput: 3.33,
          p50LatencyMs: 75,
          p95LatencyMs: 125,
          p99LatencyMs: 175,
          successRate: 95,
          errorCount: 1,
          sampleSize: 20,
          metrics: { extractionsPerSecond: 3.33 },
        });

        const result = await (service as any).runScenario(scenario);

        expect(result.testResults).toHaveLength(1); // Only one test succeeded
        expect(result.avgSuccessRate).toBeLessThan(100);
      });
    });

    describe('testSearchPerformance', () => {
      it('should measure search performance under load', async () => {
        // Mock database responses
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'test-id', content: 'test content' }]);

        const result = await (service as any).testSearchPerformance(10, 5000);

        expect(result.testName).toBe('Search Performance');
        expect(result.operation).toBe('SEARCH');
        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.throughput).toBeGreaterThan(0);
        expect(result.successRate).toBeGreaterThanOrEqual(0);
        expect(result.sampleSize).toBe(10);
        expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.stringMatching(/hybrid_search/));
      });

      it('should calculate latency percentiles correctly', async () => {
        // Mock with varying response times
        mockPrisma.$queryRaw
          .mockResolvedValueOnce([{ id: 'test-1' }])
          .mockResolvedValueOnce([{ id: 'test-2' }])
          .mockResolvedValueOnce([{ id: 'test-3' }]);

        const result = await (service as any).testSearchPerformance(3, 1000);

        expect(result.p50LatencyMs).toBeGreaterThanOrEqual(0);
        expect(result.p95LatencyMs).toBeGreaterThanOrEqual(result.p50LatencyMs);
        expect(result.p99LatencyMs).toBeGreaterThanOrEqual(result.p95LatencyMs);
      });

      it('should handle search errors and update error count', async () => {
        mockPrisma.$queryRaw.mockRejectedValue(new Error('Database error'));

        const result = await (service as any).testSearchPerformance(5, 1000);

        expect(result.errorCount).toBeGreaterThan(0);
        expect(result.successRate).toBeLessThan(100);
      });
    });

    describe('testExtractionPerformance', () => {
      it('should measure entity extraction performance', async () => {
        const testMemory = {
          id: 'test-memory-id',
          userId: 'load-test-user-extraction',
          content: 'Test content for extraction performance testing',
          domain: 'load-test',
          embedding: new Array(1536).fill(0),
        };

        mockPrisma.memoryEntry.create.mockResolvedValue(testMemory);
        mockPrisma.memoryEntry.delete.mockResolvedValue(testMemory);

        const result = await (service as any).testExtractionPerformance(5, 3000);

        expect(result.testName).toBe('Extraction Performance');
        expect(result.operation).toBe('EXTRACTION');
        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.throughput).toBeGreaterThan(0);
        expect(result.sampleSize).toBe(5);

        expect(mockPrisma.memoryEntry.create).toHaveBeenCalledTimes(5);
        expect(mockPrisma.memoryEntry.delete).toHaveBeenCalledTimes(5);
      });

      it('should clean up test data even on failure', async () => {
        mockPrisma.memoryEntry.create.mockRejectedValue(new Error('Database constraint'));
        mockPrisma.memoryEntry.delete.mockResolvedValue({});

        const result = await (service as any).testExtractionPerformance(3, 1000);

        expect(result.errorCount).toBeGreaterThan(0);
        expect(mockPrisma.memoryEntry.delete).toHaveBeenCalled(); // Should attempt cleanup
      });
    });
  });
});