import { z } from 'zod';

// Schema for raw LLM response from weekly memo generation
export const WeeklyMemoLLMResponseSchema = z.object({
  decisionsMade: z.number().default(0),
  decisionsByCategory: z.record(z.string(), z.number()).default({}),
  patternsNoticed: z.array(z.string()).default([]),
  activeContradictions: z.array(z.string()).default([]),
  upcomingPressurePoints: z.array(z.string()).default([]),
  thinkingQualityScore: z.number().min(0).max(10).default(5),
  recommendedFocus: z.array(z.string()).default([]),
  fullMemoText: z.string().default(''),
});

export type WeeklyMemoLLMResponse = z.infer<typeof WeeklyMemoLLMResponseSchema>;

// Schema for raw LLM response from pattern detection
export const DetectedPatternLLMSchema = z.object({
  pattern: z.string(),
  patternType: z.enum(['BIAS', 'STRENGTH', 'BEHAVIORAL_CYCLE', 'DECISION_STYLE']),
  confidence: z.number().min(0).max(1),
  evidence: z.string().optional(),
});

export const DetectedPatternsLLMSchema = z.array(DetectedPatternLLMSchema);
export type DetectedPatternLLM = z.infer<typeof DetectedPatternLLMSchema>;

// Schema for raw LLM response from contradiction detection
export const ContradictionDetectionLLMSchema = z.object({
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  entityATitle: z.string(),
  entityBTitle: z.string(),
});

export const ContradictionDetectionsLLMSchema = z.array(ContradictionDetectionLLMSchema);

// Schema for raw LLM response from simulation
export const SimulationLLMResponseSchema = z.object({
  resourceImpact: z.object({
    budgetRequired: z.string().default('Unknown'),
    peopleRequired: z.string().default('Unknown'),
    gapAnalysis: z.string().default('Insufficient data'),
    confidence: z.number().min(0).max(1).default(0.5),
  }).nullable().default(null),
  timelineImpact: z.object({
    estimatedDuration: z.string().default('Unknown'),
    milestones: z.array(z.object({ name: z.string(), date: z.string(), risk: z.string() })).default([]),
    historicalComparison: z.string().default('No historical data available'),
    confidence: z.number().min(0).max(1).default(0.5),
  }).nullable().default(null),
  stakeholderImpact: z.object({
    impactedPeople: z.array(z.object({ name: z.string(), impact: z.string(), action: z.string() })).default([]),
    rippleEffects: z.array(z.string()).default([]),
    communicationNeeded: z.array(z.string()).default([]),
  }).nullable().default(null),
  overallRisk: z.enum(['low', 'medium', 'high']).default('medium'),
}).passthrough();

// Schema for raw LLM response from sufficiency check
export const SufficiencyScoreLLMSchema = z.object({
  score: z.number().min(0).max(1).default(0),
  missingDimensions: z.array(z.string()).default([]),
  suggestedQuestions: z.array(z.string()).default([]),
  inferredIntent: z.string().default(''),
  canProceed: z.boolean().default(true),
});
