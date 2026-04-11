// UserProfile Zod schemas — matches packages/shared/src/types/user-profile.types.ts

import { z } from 'zod';

// ── Sub-type Schemas ──

export const RiskProfileSchema = z.object({
  financial: z.number().min(0).max(1).describe('Financial risk tolerance (0-1)'),
  technical: z.number().min(0).max(1).describe('Technical risk tolerance (0-1)'),
  people: z.number().min(0).max(1).describe('People/interpersonal risk tolerance (0-1)'),
  strategic: z.number().min(0).max(1).describe('Strategic/business risk tolerance (0-1)'),
});

export type RiskProfileInput = z.infer<typeof RiskProfileSchema>;

export const CognitivePatternSchema = z.object({
  pattern: z.string().describe('Description of the cognitive pattern'),
  evidenceCount: z.number().int().describe('Number of observations supporting this pattern'),
  confidence: z.number().min(0).max(1).describe('Confidence in this pattern (0-1)'),
});

export type CognitivePatternInput = z.infer<typeof CognitivePatternSchema>;

// ── Full UserProfile Schema ──

export const UserProfileSchema = z.object({
  id: z.string().describe('Unique profile identifier (cuid)'),
  userId: z.string().describe('Associated user identifier'),
  role: z.string().nullable().describe('Professional role or title'),
  industry: z.string().nullable().describe('Industry or sector'),
  decisionFrequency: z.string().nullable().describe('Frequency of major decisions'),
  riskProfile: RiskProfileSchema.describe('Risk tolerance profile'),
  valueHierarchy: z.array(z.string()).describe('Ranked values and priorities'),
  cognitivePatterns: z.array(CognitivePatternSchema).describe('Observed cognitive patterns'),
  decisionHistorySummary: z.string().nullable().describe('Summary of past decision patterns'),
  onboardingComplete: z.boolean().describe('Whether onboarding is complete'),
  dashboardLayout: z.any().describe('User dashboard layout configuration'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type UserProfileInput = z.infer<typeof UserProfileSchema>;

// ── Create UserProfile Request Schema ──

export const CreateUserProfileRequestSchema = z.object({
  role: z.string().nullable().optional().describe('Professional role or title'),
  industry: z.string().nullable().optional().describe('Industry or sector'),
  decisionFrequency: z.string().nullable().optional().describe('Frequency of major decisions'),
  riskProfile: RiskProfileSchema.optional().describe('Risk tolerance profile'),
  valueHierarchy: z.array(z.string()).optional().describe('Ranked values and priorities'),
  cognitivePatterns: z.array(CognitivePatternSchema).optional().describe('Observed cognitive patterns'),
  decisionHistorySummary: z.string().nullable().optional().describe('Summary of past decision patterns'),
  onboardingComplete: z.boolean().optional().describe('Whether onboarding is complete'),
  dashboardLayout: z.any().optional().describe('User dashboard layout configuration'),
});

export type CreateUserProfileRequestInput = z.infer<typeof CreateUserProfileRequestSchema>;

// ── Update UserProfile Request Schema ──

export const UpdateUserProfileRequestSchema = z.object({
  role: z.string().nullable().optional().describe('Professional role or title'),
  industry: z.string().nullable().optional().describe('Industry or sector'),
  decisionFrequency: z.string().nullable().optional().describe('Frequency of major decisions'),
  riskProfile: RiskProfileSchema.optional().describe('Risk tolerance profile'),
  valueHierarchy: z.array(z.string()).optional().describe('Ranked values and priorities'),
  cognitivePatterns: z.array(CognitivePatternSchema).optional().describe('Observed cognitive patterns'),
  decisionHistorySummary: z.string().nullable().optional().describe('Summary of past decision patterns'),
  onboardingComplete: z.boolean().optional().describe('Whether onboarding is complete'),
  dashboardLayout: z.any().optional().describe('User dashboard layout configuration'),
});

export type UpdateUserProfileRequestInput = z.infer<typeof UpdateUserProfileRequestSchema>;