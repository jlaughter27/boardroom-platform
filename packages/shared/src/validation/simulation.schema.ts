// Simulation Zod schemas — matches packages/shared/src/types/simulation.types.ts

import { z } from 'zod';

export const SimulationTypeSchema = z.enum(['resource', 'timeline', 'stakeholder', 'full'])
  .describe('Type of simulation to run');

export const RiskLevelSchema = z.enum(['low', 'medium', 'high'])
  .describe('Risk level assessment');

export const SimulationRequestSchema = z.object({
  sessionId: z.string().describe('Decision session ID'),
  chosenPath: z.string().describe('The decision path to simulate'),
  sessionQuestion: z.string().describe('The original decision question'),
  simulationType: SimulationTypeSchema.describe('Which simulation to run'),
});

export type SimulationRequestInput = z.infer<typeof SimulationRequestSchema>;

export const ResourceSimulationSchema = z.object({
  budgetRequired: z.string().describe('Description of budget/resources needed'),
  peopleRequired: z.string().describe('Who needs to be involved and how much of their time'),
  gapAnalysis: z.string().describe('What is missing vs current resources'),
  confidence: z.number().min(0).max(1).describe('Confidence in the resource assessment'),
});

export type ResourceSimulationInput = z.infer<typeof ResourceSimulationSchema>;

export const TimelineMilestoneSchema = z.object({
  name: z.string().describe('Milestone name'),
  date: z.string().describe('Target date (YYYY-MM-DD)'),
  risk: RiskLevelSchema.describe('Risk level for this milestone'),
});

export type TimelineMilestoneInput = z.infer<typeof TimelineMilestoneSchema>;

export const TimelineSimulationSchema = z.object({
  estimatedDuration: z.string().describe('Realistic timeline estimate'),
  milestones: z.array(TimelineMilestoneSchema).describe('Key milestones'),
  historicalComparison: z.string().describe('Comparison to past similar projects if data available'),
  confidence: z.number().min(0).max(1).describe('Confidence in the timeline assessment'),
});

export type TimelineSimulationInput = z.infer<typeof TimelineSimulationSchema>;

export const ImpactedPersonSchema = z.object({
  name: z.string().describe('Name of the impacted person'),
  impact: z.string().describe('How they are affected'),
  action: z.string().describe('What they need to do'),
});

export type ImpactedPersonInput = z.infer<typeof ImpactedPersonSchema>;

export const StakeholderSimulationSchema = z.object({
  impactedPeople: z.array(ImpactedPersonSchema).describe('People impacted by this decision'),
  rippleEffects: z.array(z.string()).describe('Downstream effects of this decision'),
  communicationNeeded: z.array(z.string()).describe('Who needs to be told what'),
});

export type StakeholderSimulationInput = z.infer<typeof StakeholderSimulationSchema>;

export const SimulationResultSchema = z.object({
  resourceImpact: ResourceSimulationSchema.describe('Resource impact projection'),
  timelineImpact: TimelineSimulationSchema.describe('Timeline impact projection'),
  stakeholderImpact: StakeholderSimulationSchema.describe('Stakeholder impact projection'),
  overallRisk: RiskLevelSchema.describe('Overall risk assessment'),
});

export type SimulationResultInput = z.infer<typeof SimulationResultSchema>;
