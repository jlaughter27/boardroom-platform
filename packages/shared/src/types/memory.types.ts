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
