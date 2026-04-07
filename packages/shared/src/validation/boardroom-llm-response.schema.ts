import { z } from 'zod';

// Schema for Doer task breakdown (orchestrator.ts runDoer)
export const DoerTaskBreakdownSchema = z.object({
  tasks: z.array(z.object({
    title: z.string(),
    owner: z.string().optional(),
    deadline: z.string().optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
  })),
}).passthrough();

export type DoerTaskBreakdown = z.infer<typeof DoerTaskBreakdownSchema>;

// Schema for onboarding goal extraction
export const ExtractedGoalsSchema = z.array(z.object({
  title: z.string(),
  level: z.number().min(0).max(3),
  domain: z.string(),
}));

export type ExtractedGoal = z.infer<typeof ExtractedGoalsSchema>[number];

// Schema for onboarding project extraction
export const ExtractedProjectsSchema = z.array(z.object({
  title: z.string(),
  domain: z.string(),
  status: z.enum(['active', 'planning', 'paused']),
}));

export type ExtractedProject = z.infer<typeof ExtractedProjectsSchema>[number];

// Schema for Gmail email memory proposals
export const EmailMemoryProposalsSchema = z.array(z.object({
  content: z.string(),
  domain: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough());

// Schema for commitment extraction
export const ExtractedCommitmentsSchema = z.array(z.object({
  description: z.string(),
  stakeholder: z.string().nullable(),
  deadline: z.string().nullable(),
}));

export type ExtractedCommitment = z.infer<typeof ExtractedCommitmentsSchema>[number];
