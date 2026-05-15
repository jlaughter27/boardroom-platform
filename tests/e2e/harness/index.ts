/**
 * E2E harness barrel. Import everything test files need from one place.
 */

export {
  setupHarness,
  teardownHarness,
  resetDatabase,
  type Harness,
  type HarnessConfig,
} from './setup';

export {
  startMcpClient,
  type McpHandle,
  type StartMcpOptions,
  type RawToolResult,
} from './mcp-client';

export {
  getAgent,
  seedTestAgents,
  TEST_USER_ID,
  TEST_USER_EMAIL,
  TEST_AGENTS,
  type TestAgent,
} from './agent-context-factory';

export {
  getMemoryRow,
  findMemoriesByContentMarker,
  assertMemoryFieldValue,
  getOutboxRow,
  waitForOutboxRow,
  hasEmbedding,
  getAuditTrail,
  countMemoriesByTenant,
  type MemoryRow,
  type OutboxRow,
  type AuditRow,
} from './db-assertions';
