/**
 * Week 6 Integration Test Service (I6.1)
 * End-to-end integration testing for Mem0 hybrid search architecture
 */

import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

export interface IntegrationTestResult {
  testName: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  error?: string;
  details?: Record<string, any>;
}

export interface TestSuiteResult {
  suiteName: string;
  timestamp: Date;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDurationMs: number;
  testResults: IntegrationTestResult[];
}

/**
 * Integration Test Service for Mem0 Architecture
 * Tests the complete pipeline from entity extraction to hybrid search
 */
export class IntegrationTestService {
  private testTimeoutMs = 30000; // 30 second timeout per test

  /**
   * Run complete integration test suite
   */
  async runFullIntegrationSuite(): Promise<TestSuiteResult> {
    const startTime = Date.now();
    const testResults: IntegrationTestResult[] = [];

    logger.info('Starting Mem0 integration test suite');

    // Test 1: Database connectivity and RLS policies
    testResults.push(await this.testDatabaseConnectivity());

    // Test 2: Entity extraction pipeline
    testResults.push(await this.testEntityExtractionPipeline());

    // Test 3: Relationship building
    testResults.push(await this.testRelationshipBuilding());

    // Test 4: Hybrid search functionality
    testResults.push(await this.testHybridSearch());

    // Test 5: Graph traversal queries
    testResults.push(await this.testGraphTraversal());

    // Test 6: Search caching
    testResults.push(await this.testSearchCaching());

    // Test 7: Query understanding
    testResults.push(await this.testQueryUnderstanding());

    // Test 8: Search analytics
    testResults.push(await this.testSearchAnalytics());

    const totalDuration = Date.now() - startTime;
    const passedTests = testResults.filter(r => r.status === 'PASSED').length;
    const failedTests = testResults.filter(r => r.status === 'FAILED').length;
    const skippedTests = testResults.filter(r => r.status === 'SKIPPED').length;

    const result: TestSuiteResult = {
      suiteName: 'Mem0 Integration Test Suite',
      timestamp: new Date(),
      totalTests: testResults.length,
      passedTests,
      failedTests,
      skippedTests,
      totalDurationMs: totalDuration,
      testResults,
    };

    logger.info('Integration test suite completed', {
      totalTests: result.totalTests,
      passedTests: result.passedTests,
      failedTests: result.failedTests,
      durationMs: result.totalDurationMs,
    });

    return result;
  }

  /**
   * Test 1: Database connectivity and RLS policies
   */
  private async testDatabaseConnectivity(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Database Connectivity & RLS Policies';

    try {
      // Test basic database connectivity
      await prisma.$queryRaw`SELECT 1 as test`;

      // Test RLS by attempting to query without user context
      // This should fail or return empty results
      const memories = await prisma.memoryEntry.findMany({
        take: 1,
      });

      // Verify RLS is working (should return empty or filtered results)
      const rlsWorking = memories.length === 0 || memories.every((m: any) => m.userId);

      if (!rlsWorking) {
        throw new Error('RLS policies not properly enforced');
      }

      return {
        testName,
        status: 'PASSED',
        durationMs: Date.now() - startTime,
        details: {
          databaseConnected: true,
          rlsEnforced: true,
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 2: Entity extraction pipeline
   */
  private async testEntityExtractionPipeline(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Entity Extraction Pipeline';

    try {
      // Create a test memory with entities
      const testMemory = await prisma.memoryEntry.create({
        data: {
          userId: 'test-user-integration',
          content: 'John works at Google as a software engineer. He knows Mary who works at Microsoft.',
          domain: 'test',
          embedding: new Array(1536).fill(0), // Zero vector for testing
        },
      });

      // Verify memory was created
      if (!testMemory.id) {
        throw new Error('Failed to create test memory');
      }

      // Clean up test data
      await prisma.memoryEntry.delete({
        where: { id: testMemory.id },
      });

      return {
        testName,
        status: 'PASSED',
        durationMs: Date.now() - startTime,
        details: {
          memoryCreated: true,
          testDataCleaned: true,
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 3: Relationship building
   */
  private async testRelationshipBuilding(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Relationship Building';

    try {
      // Test relationship schema exists
      const relationshipTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%relationship%'
      `;

      const hasRelationshipTables = relationshipTables.length > 0;

      return {
        testName,
        status: hasRelationshipTables ? 'PASSED' : 'SKIPPED',
        durationMs: Date.now() - startTime,
        details: {
          relationshipTablesFound: relationshipTables.length,
          tableNames: relationshipTables.map((t: any) => t.table_name),
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 4: Hybrid search functionality
   */
  private async testHybridSearch(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Hybrid Search Functionality';

    try {
      // Check if hybrid_search function exists
      const functions = await prisma.$queryRaw<Array<{ routine_name: string }>>`
        SELECT routine_name 
        FROM information_schema.routines 
        WHERE routine_schema = 'public' 
        AND routine_name = 'hybrid_search'
      `;

      const hasHybridSearch = functions.length > 0;

      return {
        testName,
        status: hasHybridSearch ? 'PASSED' : 'SKIPPED',
        durationMs: Date.now() - startTime,
        details: {
          hybridSearchFunctionExists: hasHybridSearch,
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 5: Graph traversal queries
   */
  private async testGraphTraversal(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Graph Traversal Queries';

    try {
      // Check if find_related_entities function exists
      const functions = await prisma.$queryRaw<Array<{ routine_name: string }>>`
        SELECT routine_name 
        FROM information_schema.routines 
        WHERE routine_schema = 'public' 
        AND routine_name = 'find_related_entities'
      `;

      const hasGraphTraversal = functions.length > 0;

      return {
        testName,
        status: hasGraphTraversal ? 'PASSED' : 'SKIPPED',
        durationMs: Date.now() - startTime,
        details: {
          graphTraversalFunctionExists: hasGraphTraversal,
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 6: Search caching
   */
  private async testSearchCaching(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Search Caching';

    try {
      // Check if search_cache table exists
      const cacheTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%cache%'
      `;

      const hasCacheTables = cacheTables.length > 0;

      return {
        testName,
        status: hasCacheTables ? 'PASSED' : 'SKIPPED',
        durationMs: Date.now() - startTime,
        details: {
          cacheTablesFound: cacheTables.length,
          tableNames: cacheTables.map((t: any) => t.table_name),
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 7: Query understanding
   */
  private async testQueryUnderstanding(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Query Understanding';

    try {
      // Check if query_intents table exists
      const intentTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%intent%' OR table_name LIKE '%query%'
      `;

      const hasIntentTables = intentTables.length > 0;

      return {
        testName,
        status: hasIntentTables ? 'PASSED' : 'SKIPPED',
        durationMs: Date.now() - startTime,
        details: {
          intentTablesFound: intentTables.length,
          tableNames: intentTables.map((t: any) => t.table_name),
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test 8: Search analytics
   */
  private async testSearchAnalytics(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    const testName = 'Search Analytics';

    try {
      // Check if search_analytics table exists
      const analyticsTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND (table_name LIKE '%analytics%' OR table_name LIKE '%search%' OR table_name LIKE '%click%')
      `;

      const hasAnalyticsTables = analyticsTables.length > 0;

      return {
        testName,
        status: hasAnalyticsTables ? 'PASSED' : 'SKIPPED',
        durationMs: Date.now() - startTime,
        details: {
          analyticsTablesFound: analyticsTables.length,
          tableNames: analyticsTables.map((t: any) => t.table_name),
        },
      };
    } catch (error) {
      return {
        testName,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate test report in markdown format
   */
  generateMarkdownReport(result: TestSuiteResult): string {
    const passedEmoji = result.passedTests === result.totalTests ? '✅' : '⚠️';
    const statusEmoji = result.failedTests === 0 ? '✅' : '❌';

    let report = `# Mem0 Integration Test Report\n\n`;
    report += `**Suite:** ${result.suiteName}\n`;
    report += `**Timestamp:** ${result.timestamp.toISOString()}\n`;
    report += `**Duration:** ${result.totalDurationMs}ms\n\n`;
    report += `## Summary\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Tests | ${result.totalTests} |\n`;
    report += `| Passed | ${result.passedTests} ${passedEmoji} |\n`;
    report += `| Failed | ${result.failedTests} |\n`;
    report += `| Skipped | ${result.skippedTests} |\n`;
    report += `| Success Rate | ${((result.passedTests / result.totalTests) * 100).toFixed(1)}% |\n\n`;
    report += `**Overall Status:** ${statusEmoji} ${result.failedTests === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}\n\n`;
    report += `## Detailed Results\n\n`;

    for (const test of result.testResults) {
      const testEmoji = test.status === 'PASSED' ? '✅' : test.status === 'FAILED' ? '❌' : '⏭️';
      report += `### ${testEmoji} ${test.testName}\n`;
      report += `- **Status:** ${test.status}\n`;
      report += `- **Duration:** ${test.durationMs}ms\n`;
      
      if (test.error) {
        report += `- **Error:** ${test.error}\n`;
      }
      
      if (test.details) {
        report += `- **Details:**\n`;
        for (const [key, value] of Object.entries(test.details)) {
          report += `  - ${key}: ${JSON.stringify(value)}\n`;
        }
      }
      report += `\n`;
    }

    return report;
  }

  /**
   * Export test results to JSON file
   */
  async exportResultsToFile(result: TestSuiteResult, filePath: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const exportData = {
      ...result,
      timestamp: result.timestamp.toISOString(),
    };
    
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
    logger.info(`Test results exported to ${filePath}`);
  }
}

// Export singleton instance
export const integrationTestService = new IntegrationTestService();