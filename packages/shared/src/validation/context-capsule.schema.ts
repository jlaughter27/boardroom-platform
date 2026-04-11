// ContextCapsule Zod schemas — matches packages/shared/src/types/context-capsule.types.ts

import { z } from 'zod';

// ── Entity Type Schema ──

export const ContextCapsuleEntityTypeSchema = z.enum(['project', 'person', 'goal', 'task', 'decision'])
  .describe('Type of entity this capsule summarizes');

// ── Full ContextCapsule Schema ──

export const ContextCapsuleSchema = z.object({
  id: z.string().describe('Unique capsule identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  entityType: ContextCapsuleEntityTypeSchema.describe('Type of entity'),
  entityId: z.string().describe('ID of the entity being summarized'),
  summary: z.string().describe('Comprehensive summary of the entity'),
  openRisks: z.array(z.string()).describe('Active risks associated with this entity'),
  unresolvedQuestions: z.array(z.string()).describe('Open questions needing attention'),
  activeStakeholders: z.array(z.string()).describe('People actively involved with this entity'),
  recentChanges: z.array(z.string()).describe('Recent updates or changes'),
  generatedAt: z.coerce.date().describe('When this capsule was generated'),
  staleAfter: z.coerce.date().describe('When this capsule should be regenerated'),
});

export type ContextCapsuleInput = z.infer<typeof ContextCapsuleSchema>;

// ── Create ContextCapsule Request Schema ──

export const CreateContextCapsuleRequestSchema = z.object({
  entityType: ContextCapsuleEntityTypeSchema.describe('Type of entity'),
  entityId: z.string().min(1).describe('ID of the entity being summarized'),
  summary: z.string().min(1).describe('Comprehensive summary of the entity'),
  openRisks: z.array(z.string()).optional().describe('Active risks associated with this entity'),
  unresolvedQuestions: z.array(z.string()).optional().describe('Open questions needing attention'),
  activeStakeholders: z.array(z.string()).optional().describe('People actively involved with this entity'),
  recentChanges: z.array(z.string()).optional().describe('Recent updates or changes'),
  staleAfter: z.coerce.date().describe('When this capsule should be regenerated'),
});

export type CreateContextCapsuleRequestInput = z.infer<typeof CreateContextCapsuleRequestSchema>;

// ── Update ContextCapsule Request Schema ──

export const UpdateContextCapsuleRequestSchema = z.object({
  summary: z.string().min(1).optional().describe('Comprehensive summary of the entity'),
  openRisks: z.array(z.string()).optional().describe('Active risks associated with this entity'),
  unresolvedQuestions: z.array(z.string()).optional().describe('Open questions needing attention'),
  activeStakeholders: z.array(z.string()).optional().describe('People actively involved with this entity'),
  recentChanges: z.array(z.string()).optional().describe('Recent updates or changes'),
  staleAfter: z.coerce.date().optional().describe('When this capsule should be regenerated'),
});

export type UpdateContextCapsuleRequestInput = z.infer<typeof UpdateContextCapsuleRequestSchema>;