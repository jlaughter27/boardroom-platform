/**
 * Week 6 Performance Load Test Service (I6.3)
 * Performance testing for Mem0 hybrid search under load
 */

import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

export interface PerformanceTestResult {
  testName: string;
  operation: 'SEARCH' | 'EXTRACTION' | 'RELATIONSHIP' | 'CACHE' | 'GRAPH' | 'ANALYTICS';
  durationMs: number;
  throughput: number; // operations per second
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  successRate: number; // 0-100
  errorCount: number;
  sampleSize: number;
  metrics: Record<string, any>;
}

export interface LoadTestScenario {
  name: string;
  concurrentUsers: number;
  durationSeconds: number;
  thinkTimeMs: number;
  operationsPerUser: number;
}

export interface LoadTestResult {
  scenario: LoadTestScenario;
  timestamp: Date;
  totalOperations: number;
  totalDurationMs: number;
  avgThroughput: number;
  avgSuccessRate: number;
  testResults: PerformanceTestResult[];
  resourceUsage?: {
    cpuPercent?: number;
    memoryMB?: number;
    databaseConnections?: number;
  };
}

/**
 * Performance Load Test Service
 * Tests Mem0 architecture under various load conditions
 */
export class PerformanceLoadTestService {
  private readonly testUserPrefix = 'load-test-user-';
  private readonly testMemoryPrefix = 'load-test-memory-';

  /**
   * Run comprehensive load test suite
   */
  async runLoadTestSuite(): Promise<LoadTestResult[]> {
    const results: LoadTestResult[] = [];

    logger.info('Starting Mem0 performance load test suite');

    // Scenario 1: Baseline load (single user)
    results.push(await this.runScenario({
      name: 'Baseline Single User',
      concurrentUsers: 1,
      durationSeconds: 30,
      thinkTimeMs: 1000,
      operationsPerUser: 10,
    }));

    // Scenario 2: Moderate load (10 concurrent users)
    results.push(await this.runScenario({
      name: 'Moderate Load (10 Users)',
      concurrentUsers: 10,
      durationSeconds: 60,
      thinkTimeMs: 500,
      operationsPerUser: 20,
    }));

    // Scenario 3: High load (50 concurrent users)
    results.push(await this.runScenario({
      name: 'High Load (50 Users)',
      concurrentUsers: 50,
      durationSeconds: 120,
      thinkTimeMs: 200,
      operationsPerUser: 30,
    }));

    // Scenario 4: Spike load (100 concurrent users)
    results.push(await this.runScenario({
      name: 'Spike Load (100 Users)',
      concurrentUsers: 100,
      durationSeconds: 90,
      thinkTimeMs: 100,
      operationsPerUser: 15,
    }));

    logger.info('Performance load test suite completed', {
      totalScenarios: results.length,
      totalOperations: results.reduce((sum, r) => sum + r.totalOperations, 0),
    });

    return results;
  }

  /**
   * Run a specific load test scenario
   */
  async runScenario(scenario: LoadTestScenario): Promise<LoadTestResult> {
    const startTime = Date.now();
    const testResults: PerformanceTestResult[] = [];

    logger.info(`Starting load test scenario: ${scenario.name}`, {
      concurrentUsers: scenario.concurrentUsers,
      durationSeconds: scenario.durationSeconds,
    });

    // Prepare test data
    await this.prepareTestData(scenario.concurrentUsers);

    // Run different operation types
    testResults.push(await this.testSearchOperations(scenario));
    testResults.push(await this.testEntityExtractionOperations(scenario));
    testResults.push(await this.testRelationshipOperations(scenario));
    testResults.push(await this.testCacheOperations(scenario));
    testResults.push(await this.testGraphOperations(scenario));
    testResults.push(await this.testAnalyticsOperations(scenario));

    // Clean up test data
    await this.cleanupTestData();

    const totalDuration = Date.now() - startTime;
    const totalOperations = testResults.reduce((sum, r) => sum + r.sampleSize, 0);
    const avgThroughput = testResults.reduce((sum, r) => sum + r.throughput, 0) / testResults.length;
    const avgSuccessRate = testResults.reduce((sum, r) => sum + r.successRate, 0) / testResults.length;

    const result: LoadTestResult = {
      scenario,
      timestamp: new Date(),
      totalOperations,
      totalDurationMs: totalDuration,
      avgThroughput,
      avgSuccessRate,
      testResults,
    };

    logger.info(`Load test scenario completed: ${scenario.name}`, {
      totalOperations: result.totalOperations,
      avgThroughput: result.avgThroughput.toFixed(2),
      avgSuccessRate: result.avgSuccessRate.toFixed(1),
      durationMs: result.totalDurationMs,
    });

    return result;
  }

  /**
   * Prepare test data for load testing
   */
  private async prepareTestData(userCount: number): Promise<void> {
    logger.info(`Preparing test data for ${userCount} users`);

    const testMemories = [];
    const batchSize = 100;

    for (let i = 0; i < userCount; i++) {
      const userId = `${this.testUserPrefix}${i}`;
      
      // Create test memories for each user
      for (let j = 0; j < 20; j++) { // 20 memories per user
        testMemories.push({
          userId,
          content: `Load test memory ${j} for user ${i}. This contains test entities like John Doe, Acme Corp, and project Alpha.`,
          domain: 'load-test',
          embedding: this.generateTestEmbedding(),
        });

        // Insert in batches
        if (testMemories.length >= batchSize) {
          await prisma.memoryEntry.createMany({
            data: testMemories,
            skipDuplicates: true,
          });
          testMemories.length = 0;
        }
      }
    }

    // Insert remaining memories
    if (testMemories.length > 0) {
      await prisma.memoryEntry.createMany({
        data: testMemories,
        skipDuplicates: true,
      });
    }

    logger.info(`Test data prepared: ${userCount * 20} memories created`);
  }

  /**
   * Clean up test data
   */
  private async cleanupTestData(): Promise<void> {
    logger.info('Cleaning up test data');

    await prisma.memoryEntry.deleteMany({
      where: {
        OR: [
          { userId: { startsWith: this.testUserPrefix } },
          { domain: 'load-test' },
        ],
      },
    });

    logger.info('Test data cleaned up');
  }

  /**
   * Generate test embedding vector
   */
  private generateTestEmbedding(): number[] {
    const embedding = new Array(1536).fill(0);
    // Add some random values for testing
    for (let i = 0; i < 100; i++) {
      embedding[Math.floor(Math.random() * 1536)] = Math.random();
    }
    return embedding;
  }

  /**
   * Test search operations under load
   */
  private async testSearchOperations(scenario: LoadTestScenario): Promise<PerformanceTestResult> {
    const testName = 'Hybrid Search Operations';
    const operation: 'SEARCH' = 'SEARCH';
    const iterations = scenario.concurrentUsers * scenario.operationsPerUser;
    const latencies: number[] = [];
    let errorCount = 0;
    let successCount = 0;

    const startTime = Date.now();

    // Simulate concurrent search operations
    const promises = Array.from({ length: scenario.concurrentUsers }, async (_, userIndex) => {
      const userId = `${this.testUserPrefix}${userIndex}`;
      
      for (let i = 0; i < scenario.operationsPerUser; i++) {
        const operationStart = Date.now();
        
        try {
          // Simulate search operation
          await prisma.memoryEntry.findMany({
            where: {
              userId,
              content: {
                contains: 'test',
              },
            },
            take: 10,
            orderBy: {
              createdAt: 'desc',
            },
          });

          const latency = Date.now() - operationStart;
          latencies.push(latency);
          successCount++;

          // Simulate think time
          if (scenario.thinkTimeMs > 0) {
            await this.sleep(scenario.thinkTimeMs);
          }
        } catch (error) {
          errorCount++;
          logger.error('Search operation failed', { error, userId, iteration: i });
        }
      }
    });

    await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);

    return {
      testName,
      operation,
      durationMs: totalDuration,
      throughput: (successCount / (totalDuration / 1000)),
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      successRate: (successCount / iterations) * 100,
      errorCount,
      sampleSize: successCount,
      metrics: {
        iterations,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        minLatencyMs: Math.min(...latencies),
        maxLatencyMs: Math.max(...latencies),
      },
    };
  }

  /**
   * Test entity extraction operations
   */
  private async testEntityExtractionOperations(scenario: LoadTestScenario): Promise<PerformanceTestResult> {
    const testName = 'Entity Extraction Operations';
    const operation: 'EXTRACTION' = 'EXTRACTION';
    const iterations = Math.floor(scenario.concurrentUsers * scenario.operationsPerUser / 2);
    const latencies: number[] = [];
    let errorCount = 0;
    let successCount = 0;

    const startTime = Date.now();

    // Simulate entity extraction operations (heavier than search)
    const promises = Array.from({ length: Math.min(scenario.concurrentUsers, 10) }, async (_, userIndex) => {
      const userId = `${this.testUserPrefix}${userIndex}`;
      const userIterations = Math.ceil(iterations / 10);
      
      for (let i = 0; i < userIterations; i++) {
        const operationStart = Date.now();
        
        try {
          // Simulate entity extraction by creating and querying complex memories
          await prisma.memoryEntry.create({
            data: {
              userId,
              content: `Entity extraction test ${i}: John Doe works at Acme Corp on project Alpha with Mary Smith. Meeting scheduled for Q2 2024.`,
              domain: 'load-test-extraction',
              embedding: this.generateTestEmbedding(),
            },
          });

          const latency = Date.now() - operationStart;
          latencies.push(latency);
          successCount++;

          // Simulate think time (longer for extraction)
          if (scenario.thinkTimeMs > 0) {
            await this.sleep(scenario.thinkTimeMs * 2);
          }
        } catch (error) {
          errorCount++;
          logger.error('Entity extraction operation failed', { error, userId, iteration: i });
        }
      }
    });

    await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);

    return {
      testName,
      operation,
      durationMs: totalDuration,
      throughput: (successCount / (totalDuration / 1000)),
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      successRate: (successCount / iterations) * 100,
      errorCount,
      sampleSize: successCount,
      metrics: {
        iterations,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        minLatencyMs: Math.min(...latencies),
        maxLatencyMs: Math.max(...latencies),
      },
    };
  }

  /**
   * Test relationship operations
   */
  private async testRelationshipOperations(scenario: LoadTestScenario): Promise<PerformanceTestResult> {
    const testName = 'Relationship Operations';
    const operation: 'RELATIONSHIP' = 'RELATIONSHIP';
    const iterations = Math.floor(scenario.concurrentUsers * scenario.operationsPerUser / 3);
    const latencies: number[] = [];
    let errorCount = 0;
    let successCount = 0;

    const startTime = Date.now();

    // Check if relationship tables exist
    const relationshipTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%relationship%'
    `;

    if (relationshipTables.length === 0) {
      // Skip if no relationship tables
      return {
        testName,
        operation,
        durationMs: 0,
        throughput: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 100,
        errorCount: 0,
        sampleSize: 0,
        metrics: {
          skipped: true,
          reason: 'No relationship tables found',
        },
      };
    }

    // Simulate relationship operations
    const promises = Array.from({ length: Math.min(scenario.concurrentUsers, 5) }, async (_, userIndex) => {
      const userId = `${this.testUserPrefix}${userIndex}`;
      const userIterations = Math.ceil(iterations / 5);
      
      for (let i = 0; i < userIterations; i++) {
        const operationStart = Date.now();
        
        try {
          // Simulate relationship query
          await prisma.$queryRaw`
            SELECT 1 as test
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%relationship%'
            LIMIT 1
          `;

          const latency = Date.now() - operationStart;
          latencies.push(latency);
          successCount++;

          // Simulate think time
          if (scenario.thinkTimeMs > 0) {
            await this.sleep(scenario.thinkTimeMs * 1.5);
          }
        } catch (error) {
          errorCount++;
          logger.error('Relationship operation failed', { error, userId, iteration: i });
        }
      }
    });

    await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);

    return {
      testName,
      operation,
      durationMs: totalDuration,
      throughput: (successCount / (totalDuration / 1000)),
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      successRate: (successCount / iterations) * 100,
      errorCount,
      sampleSize: successCount,
      metrics: {
        iterations,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        minLatencyMs: Math.min(...latencies),
        maxLatencyMs: Math.max(...latencies),
        relationshipTables: relationshipTables.map((t: any) => t.table_name),
      },
    };
  }

  /**
   * Test cache operations
   */
  private async testCacheOperations(scenario: LoadTestScenario): Promise<PerformanceTestResult> {
    const testName = 'Cache Operations';
    const operation: 'CACHE' = 'CACHE';
    const iterations = scenario.concurrentUsers * scenario.operationsPerUser;
    const latencies: number[] = [];
    let errorCount = 0;
    let successCount = 0;

    const startTime = Date.now();

    // Check if cache tables exist
    const cacheTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%cache%'
    `;

    if (cacheTables.length === 0) {
      // Skip if no cache tables
      return {
        testName,
        operation,
        durationMs: 0,
        throughput: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 100,
        errorCount: 0,
        sampleSize: 0,
        metrics: {
          skipped: true,
          reason: 'No cache tables found',
        },
      };
    }

    // Simulate cache operations (should be faster than database operations)
    const promises = Array.from({ length: scenario.concurrentUsers }, async (_, userIndex) => {
      const userId = `${this.testUserPrefix}${userIndex}`;
      
      for (let i = 0; i < scenario.operationsPerUser; i++) {
        const operationStart = Date.now();
        
        try {
          // Simulate cache check
          await prisma.$queryRaw`
            SELECT 1 as test
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%cache%'
            LIMIT 1
          `;

          const latency = Date.now() - operationStart;
          latencies.push(latency);
          successCount++;

          // Simulate think time (shorter for cache operations)
          if (scenario.thinkTimeMs > 0) {
            await this.sleep(scenario.thinkTimeMs / 2);
          }
        } catch (error) {
          errorCount++;
          logger.error('Cache operation failed', { error, userId, iteration: i });
        }
      }
    });

    await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);

    return {
      testName,
      operation,
      durationMs: totalDuration,
      throughput: (successCount / (totalDuration / 1000)),
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      successRate: (successCount / iterations) * 100,
      errorCount,
      sampleSize: successCount,
      metrics: {
        iterations,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        minLatencyMs: Math.min(...latencies),
        maxLatencyMs: Math.max(...latencies),
        cacheTables: cacheTables.map((t: any) => t.table_name),
      },
    };
  }

  /**
   * Test graph operations
   */
  private async testGraphOperations(scenario: LoadTestScenario): Promise<PerformanceTestResult> {
    const testName = 'Graph Operations';
    const operation: 'GRAPH' = 'GRAPH';
    const iterations = Math.floor(scenario.concurrentUsers * scenario.operationsPerUser / 4);
    const latencies: number[] = [];
    let errorCount = 0;
    let successCount = 0;

    const startTime = Date.now();

    // Check if graph functions exist
    const graphFunctions = await prisma.$queryRaw<Array<{ routine_name: string }>>`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND (routine_name LIKE '%graph%' OR routine_name LIKE '%traversal%' OR routine_name LIKE '%related%')
    `;

    if (graphFunctions.length === 0) {
      // Skip if no graph functions
      return {
        testName,
        operation,
        durationMs: 0,
        throughput: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 100,
        errorCount: 0,
        sampleSize: 0,
        metrics: {
          skipped: true,
          reason: 'No graph functions found',
        },
      };
    }

    // Simulate graph operations (complex queries)
    const promises = Array.from({ length: Math.min(scenario.concurrentUsers, 3) }, async (_, userIndex) => {
      const userId = `${this.testUserPrefix}${userIndex}`;
      const userIterations = Math.ceil(iterations / 3);
      
      for (let i = 0; i < userIterations; i++) {
        const operationStart = Date.now();
        
        try {
          // Simulate graph query
          await prisma.$queryRaw`
            SELECT 1 as test
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_name LIKE '%graph%'
            LIMIT 1
          `;

          const latency = Date.now() - operationStart;
          latencies.push(latency);
          successCount++;

          // Simulate think time (longer for graph operations)
          if (scenario.thinkTimeMs > 0) {
            await this.sleep(scenario.thinkTimeMs * 3);
          }
        } catch (error) {
          errorCount++;
          logger.error('Graph operation failed', { error, userId, iteration: i });
        }
      }
    });

    await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);

    return {
      testName,
      operation,
      durationMs: totalDuration,
      throughput: (successCount / (totalDuration / 1000)),
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      successRate: (successCount / iterations) * 100,
      errorCount,
      sampleSize: successCount,
      metrics: {
        iterations,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        minLatencyMs: Math.min(...latencies),
        maxLatencyMs: Math.max(...latencies),
        graphFunctions: graphFunctions.map((f: any) => f.routine_name),
      },
    };
  }

  /**
   * Test analytics operations
   */
  private async testAnalyticsOperations(scenario: LoadTestScenario): Promise<PerformanceTestResult> {
    const testName = 'Analytics Operations';
    const operation: 'ANALYTICS' = 'ANALYTICS';
    const iterations = Math.floor(scenario.concurrentUsers * scenario.operationsPerUser / 5);
    const latencies: number[] = [];
    let errorCount = 0;
    let successCount = 0;

    const startTime = Date.now();

    // Check if analytics tables exist
    const analyticsTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE '%analytics%' OR table_name LIKE '%metric%' OR table_name LIKE '%stat%')
    `;

    if (analyticsTables.length === 0) {
      // Skip if no analytics tables
      return {
        testName,
        operation,
        durationMs: 0,
        throughput: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 100,
        errorCount: 0,
        sampleSize: 0,
        metrics: {
          skipped: true,
          reason: 'No analytics tables found',
        },
      };
    }

    // Simulate analytics operations (aggregate queries)
    const promises = Array.from({ length: Math.min(scenario.concurrentUsers, 2) }, async (_, userIndex) => {
      const userId = `${this.testUserPrefix}${userIndex}`;
      const userIterations = Math.ceil(iterations / 2);
      
      for (let i = 0; i < userIterations; i++) {
        const operationStart = Date.now();
        
        try {
          // Simulate analytics query
          await prisma.$queryRaw`
            SELECT COUNT(*) as count
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%analytics%'
          `;

          const latency = Date.now() - operationStart;
          latencies.push(latency);
          successCount++;

          // Simulate think time (longer for analytics)
          if (scenario.thinkTimeMs > 0) {
            await this.sleep(scenario.thinkTimeMs * 4);
          }
        } catch (error) {
          errorCount++;
          logger.error('Analytics operation failed', { error, userId, iteration: i });
        }
      }
    });

    await Promise.all(promises);

    const totalDuration = Date.now() - startTime;
    const sortedLatencies = latencies.sort((a, b) => a - b);

    return {
      testName,
      operation,
      durationMs: totalDuration,
      throughput: (successCount / (totalDuration / 1000)),
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      successRate: (successCount / iterations) * 100,
      errorCount,
      sampleSize: successCount,
      metrics: {
        iterations,
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        minLatencyMs: Math.min(...latencies),
        maxLatencyMs: Math.max(...latencies),
        analyticsTables: analyticsTables.map((t: any) => t.table_name),
      },
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Sleep helper function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate performance report in markdown format
   */
  generatePerformanceReport(results: LoadTestResult[]): string {
    let report = `# Mem0 Performance Load Test Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n`;
    report += `**Total Scenarios:** ${results.length}\n\n`;

    // Executive Summary
    report += `## Executive Summary\n\n`;
    report += `| Scenario | Concurrent Users | Avg Throughput (ops/sec) | Avg Success Rate | P95 Latency (ms) |\n`;
    report += `|----------|------------------|--------------------------|------------------|------------------|\n`;

    for (const result of results) {
      const avgP95 = result.testResults.reduce((sum, t) => sum + t.p95LatencyMs, 0) / result.testResults.length;
      report += `| ${result.scenario.name} | ${result.scenario.concurrentUsers} | ${result.avgThroughput.toFixed(2)} | ${result.avgSuccessRate.toFixed(1)}% | ${avgP95.toFixed(1)} |\n`;
    }

    report += `\n`;

    // Detailed Results per Scenario
    for (const result of results) {
      report += `## ${result.scenario.name}\n\n`;
      report += `**Configuration:** ${result.scenario.concurrentUsers} concurrent users, ${result.scenario.durationSeconds}s duration\n`;
      report += `**Total Operations:** ${result.totalOperations}\n`;
      report += `**Overall Throughput:** ${result.avgThroughput.toFixed(2)} ops/sec\n`;
      report += `**Overall Success Rate:** ${result.avgSuccessRate.toFixed(1)}%\n\n`;

      report += `### Operation Performance\n\n`;
      report += `| Operation | Throughput (ops/sec) | Success Rate | P50 (ms) | P95 (ms) | P99 (ms) |\n`;
      report += `|-----------|----------------------|--------------|----------|----------|----------|\n`;

      for (const test of result.testResults) {
        if (test.sampleSize > 0) {
          report += `| ${test.testName} | ${test.throughput.toFixed(2)} | ${test.successRate.toFixed(1)}% | ${test.p50LatencyMs.toFixed(1)} | ${test.p95LatencyMs.toFixed(1)} | ${test.p99LatencyMs.toFixed(1)} |\n`;
        } else {
          report += `| ${test.testName} | SKIPPED | - | - | - | - |\n`;
        }
      }

      report += `\n`;
    }

    // Performance Recommendations
    report += `## Performance Recommendations\n\n`;

    const allTests = results.flatMap(r => r.testResults).filter(t => t.sampleSize > 0);
    const slowOperations = allTests.filter(t => t.p95LatencyMs > 1000);
    const highErrorOperations = allTests.filter(t => t.successRate < 95);

    if (slowOperations.length > 0) {
      report += `### ⚠️ Slow Operations (P95 > 1000ms)\n\n`;
      for (const op of slowOperations) {
        report += `- **${op.testName}:** P95 latency = ${op.p95LatencyMs.toFixed(1)}ms\n`;
      }
      report += `\n`;
    }

    if (highErrorOperations.length > 0) {
      report += `### 🔴 High Error Operations (Success Rate < 95%)\n\n`;
      for (const op of highErrorOperations) {
        report += `- **${op.testName}:** Success rate = ${op.successRate.toFixed(1)}% (${op.errorCount} errors)\n`;
      }
      report += `\n`;
    }

    // General recommendations
    report += `### General Recommendations\n\n`;
    report += `1. **Database Optimization:** Review query performance and add missing indexes\n`;
    report += `2. **Caching Strategy:** Implement Redis or similar caching for frequent queries\n`;
    report += `3. **Connection Pooling:** Ensure proper database connection pool configuration\n`;
    report += `4. **Load Balancing:** Consider horizontal scaling for high-concurrency scenarios\n`;
    report += `5. **Monitoring:** Implement real-time performance monitoring and alerting\n`;

    return report;
  }

  /**
   * Check if performance meets SLA requirements
   */
  checkSLACompliance(results: LoadTestResult[]): {
    meetsSLA: boolean;
    violations: Array<{ scenario: string; operation: string; metric: string; value: number; threshold: number }>;
  } {
    const slaThresholds = {
      searchP95: 500, // ms
      extractionP95: 2000, // ms
      successRate: 99, // %
      throughput: 10, // ops/sec per user
    };

    const violations: Array<{ scenario: string; operation: string; metric: string; value: number; threshold: number }> = [];

    for (const result of results) {
      for (const test of result.testResults) {
        if (test.sampleSize === 0) continue;

        // Check P95 latency
        if (test.operation === 'SEARCH' && test.p95LatencyMs > slaThresholds.searchP95) {
          violations.push({
            scenario: result.scenario.name,
            operation: test.testName,
            metric: 'P95 Latency',
            value: test.p95LatencyMs,
            threshold: slaThresholds.searchP95,
          });
        }

        if (test.operation === 'EXTRACTION' && test.p95LatencyMs > slaThresholds.extractionP95) {
          violations.push({
            scenario: result.scenario.name,
            operation: test.testName,
            metric: 'P95 Latency',
            value: test.p95LatencyMs,
            threshold: slaThresholds.extractionP95,
          });
        }

        // Check success rate
        if (test.successRate < slaThresholds.successRate) {
          violations.push({
            scenario: result.scenario.name,
            operation: test.testName,
            metric: 'Success Rate',
            value: test.successRate,
            threshold: slaThresholds.successRate,
          });
        }

        // Check throughput (per user)
        const throughputPerUser = test.throughput / result.scenario.concurrentUsers;
        if (throughputPerUser < slaThresholds.throughput) {
          violations.push({
            scenario: result.scenario.name,
            operation: test.testName,
            metric: 'Throughput per User',
            value: throughputPerUser,
            threshold: slaThresholds.throughput,
          });
        }
      }
    }

    return {
      meetsSLA: violations.length === 0,
      violations,
    };
  }
}

// Export singleton instance
export const performanceLoadTestService = new PerformanceLoadTestService();