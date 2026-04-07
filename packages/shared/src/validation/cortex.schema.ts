// Cortex Zod schemas — matches packages/shared/src/types/cortex.types.ts

import { z } from 'zod';
import { PatternType, ContradictionStatus } from '../types/cortex.types';

// ── Enum Schemas ──

export const PatternTypeSchema = z.nativeEnum(PatternType)
  .describe('Type of thinking pattern detected');

export const ContradictionStatusSchema = z.nativeEnum(ContradictionStatus)
  .describe('Current status of a contradiction alert');

// ── Thinking Pattern Schema ──

export const ThinkingPatternSchema = z.object({
  id: z.string().describe('Unique pattern identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  pattern: z.string().describe('Description of the detected thinking pattern'),
  patternType: PatternTypeSchema.describe('Classification of the pattern'),
  evidenceCount: z.number().int().describe('Number of evidence instances supporting this pattern'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
  firstDetected: z.coerce.date().describe('When this pattern was first detected'),
  lastDetected: z.coerce.date().describe('When this pattern was most recently detected'),
  trend: z.enum(['improving', 'stable', 'worsening']).nullable().describe('Trend direction of the pattern'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type ThinkingPatternInput = z.infer<typeof ThinkingPatternSchema>;

// ── Contradiction Alert Schema ──

export const ContradictionAlertSchema = z.object({
  id: z.string().describe('Unique alert identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  description: z.string().describe('Description of the contradiction'),
  entityA: z.object({
    type: z.string().describe('Entity type (e.g. decision, memory)'),
    id: z.string().describe('Entity identifier'),
    title: z.string().describe('Entity title'),
  }).describe('First entity in the contradiction'),
  entityB: z.object({
    type: z.string().describe('Entity type (e.g. decision, memory)'),
    id: z.string().describe('Entity identifier'),
    title: z.string().describe('Entity title'),
  }).describe('Second entity in the contradiction'),
  severity: z.enum(['low', 'medium', 'high']).describe('Severity level of the contradiction'),
  status: ContradictionStatusSchema.describe('Current resolution status'),
  detectedAt: z.coerce.date().describe('When the contradiction was detected'),
  resolvedAt: z.coerce.date().nullable().describe('When the contradiction was resolved'),
  resolution: z.string().nullable().describe('How the contradiction was resolved'),
});

export type ContradictionAlertInput = z.infer<typeof ContradictionAlertSchema>;

// ── Weekly Memo Schema ──

export const WeeklyMemoSchema = z.object({
  id: z.string().describe('Unique memo identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  weekStart: z.coerce.date().describe('Start of the week covered by this memo'),
  weekEnd: z.coerce.date().describe('End of the week covered by this memo'),
  decisionsMade: z.number().int().describe('Total decisions made this week'),
  decisionsByCategory: z.record(z.string(), z.number()).describe('Decision count by category'),
  patternsNoticed: z.array(z.string()).describe('Thinking patterns noticed this week'),
  activeContradictions: z.array(z.string()).describe('Active contradiction descriptions'),
  upcomingPressurePoints: z.array(z.string()).describe('Upcoming deadlines and pressure points'),
  thinkingQualityScore: z.number().min(0).max(100).describe('Overall thinking quality score 0-100'),
  scoreChange: z.number().describe('Change in thinking quality score from last week'),
  recommendedFocus: z.array(z.string()).describe('Recommended focus areas for next week'),
  fullMemoText: z.string().describe('Full rendered memo text'),
  generatedAt: z.coerce.date().describe('When this memo was generated'),
});

export type WeeklyMemoInput = z.infer<typeof WeeklyMemoSchema>;

// ── Outcome Review Nudge Schema ──

export const OutcomeReviewNudgeSchema = z.object({
  id: z.string().describe('Unique nudge identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  decisionId: z.string().describe('Decision to review'),
  decisionTitle: z.string().describe('Title of the decision to review'),
  nudgeType: z.enum(['30_day', '90_day']).describe('Review interval type'),
  scheduledFor: z.coerce.date().describe('When this nudge is scheduled'),
  sentAt: z.coerce.date().nullable().describe('When the nudge was sent'),
  completedAt: z.coerce.date().nullable().describe('When the review was completed'),
  status: z.enum(['pending', 'sent', 'completed', 'skipped']).describe('Current nudge status'),
});

export type OutcomeReviewNudgeInput = z.infer<typeof OutcomeReviewNudgeSchema>;
