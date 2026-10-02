// Memory types — TASK-004 (DeepSeek)
// Implement from: packages/omnimind-api/prisma/schema.prisma (Memory model) and docs/02-reference/MASTER-FRAMEWORK.md §4 Data Model.

export enum MemoryClass {
  WORKING = 'WORKING',
  EPISODIC = 'EPISODIC',
  SEMANTIC = 'SEMANTIC',
  DECISION = 'DECISION',
}

export enum MemoryStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  SUPERSEDED = 'SUPERSEDED',
  ARCHIVED = 'ARCHIVED',
  REJECTED = 'REJECTED',
}

export enum Confidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  SPECULATIVE = 'SPECULATIVE',
}

export enum SourceType {
  MANUAL = 'MANUAL',
  BOARDROOM_SESSION = 'BOARDROOM_SESSION',
  API_IMPORT = 'API_IMPORT',
  AGENT_EXTRACTED = 'AGENT_EXTRACTED',
  MCP_AGENT = 'MCP_AGENT',
  SESSION_SUMMARY = 'SESSION_SUMMARY',
}

export interface Memory {
  id: string;
  userId: string;
  title: string;
  content: string;
  domain: string;
  sector: string;
  tags: string[];
  memoryClass: MemoryClass;
  importance: number;
  confidence: Confidence;
  status: MemoryStatus;
  validAt: Date;
  invalidAt: Date | null;
  supersededBy: string | null;
  sourceType: SourceType;
  sourceRef: string | null;
  sourceWeight: number;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;

  // ── Multi-agent / tenant columns (Prisma: agent_id, tenant_id) ──
  // Optional here for backward compatibility with pre-MCP callers that build
  // Memory objects by hand; every row returned by OmniMind carries them.
  /** Agent that wrote this row ('boardroom-ai' for non-MCP writes). Prisma: `agentId` (NOT NULL). */
  agentId?: string;
  /** Tenant namespace (`josh-personal` | `josh-business` | `tgfc-ministry`). Prisma: `tenantId`. */
  tenantId?: string;
  /** Soft-delete marker. Rows with a non-null value are excluded from every read. Prisma: `deletedAt`. */
  deletedAt?: Date | null;
  /** Incremented on every successful retrieval; feeds the decay formula. Prisma: `recallCount`. */
  recallCount?: number;
  /** Embedding model used for `embedding` (OpenAI by default, bge for ministry). Prisma: `embeddingModel`. */
  embeddingModel?: string;
  /** Key id used for AES-256-GCM at-rest encryption (ministry rows). Prisma: `encryptionKeyId`. */
  encryptionKeyId?: string | null;
  /** Encryption algorithm label, default 'aes-256-gcm'. Prisma: `encryptionAlgorithm`. */
  encryptionAlgorithm?: string | null;
}

/**
 * Wire form of a Memory as returned by the OmniMind REST API (JSON): every
 * Date becomes an ISO-8601 string. This is the type HTTP clients (the MCP
 * server, BoardRoom's omnimind-client) should use instead of maintaining a
 * parallel record shape. Fields that are optional on `Memory` stay optional.
 */
export interface MemoryApiRecord {
  id: string;
  userId: string;
  title: string;
  content: string;
  domain: string;
  sector: string;
  tags: string[];
  memoryClass: MemoryClass;
  importance: number;
  confidence: Confidence;
  status: MemoryStatus;
  validAt: string;
  invalidAt: string | null;
  supersededBy: string | null;
  sourceType: SourceType;
  sourceRef: string | null;
  sourceWeight: number;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  agentId?: string;
  tenantId?: string;
  deletedAt?: string | null;
  recallCount?: number;
  embeddingModel?: string;
  encryptionKeyId?: string | null;
  encryptionAlgorithm?: string | null;
}

export interface MemoryProposal {
  action: 'ADD' | 'UPDATE' | 'DELETE' | 'LINK';
  title: string;
  content: string;
  domain: string;
  tags: string[];
  memoryClass: MemoryClass;
  importance: number;
  confidence: Confidence;
  sourceType: SourceType;
  sourceRef: string | null;
  targetId?: string;
  relatedEntityIds?: string[];
  metadata?: Record<string, unknown>;
}
