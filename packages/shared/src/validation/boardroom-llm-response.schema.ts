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

// Schema for onboarding goal extraction.
// level is coerced to an integer because CreateGoalRequestSchema requires int —
// if the LLM emits 1.5 the request to /goals would 422. .transform(Math.round)
// keeps us lenient on LLM output while guaranteeing a valid int downstream.
export const ExtractedGoalsSchema = z.array(z.object({
  title: z.string(),
  level: z.number().min(0).max(3).transform((n) => Math.round(n)),
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

// Schema for onboarding bootstrap extraction — a single LLM call that returns
// ALL onboarding data at once from a document the user pasted, uploaded, or
// dictated. Mirrors the OnboardingData shape in
// packages/boardroom-ai/client/src/hooks/useOnboarding.ts so the result can
// be merged straight into wizard state.
//
// Domain strings are normalized by the bootstrap prompt itself (see
// docs/prompts/onboarding-bootstrap.system.md): "work" → "business",
// "family" → "relationships", "SaaS" → "tech", etc. Enums below are the
// canonical values.
export const BootstrapExtractionSchema = z.object({
  role: z.string().default(''),
  industry: z.string().default(''),
  decisionFrequency: z.string().default(''),
  goals: z.array(z.object({
    title: z.string().min(1),
    // Lenient on LLM output — coerce fractional/float levels to int and clamp.
    level: z.number().min(0).max(3).transform((n) => Math.round(n)),
    domain: z.string().min(1),
  })).default([]),
  projects: z.array(z.object({
    title: z.string().min(1),
    domain: z.string().min(1),
    status: z.enum(['active', 'planning', 'paused']).default('active'),
  })).default([]),
  people: z.array(z.object({
    name: z.string().min(1),
    role: z.string().default(''),
    relationship: z.string().default(''),
  })).default([]),
  biggestDecision: z.string().default(''),
  worries: z.string().default(''),
});

export type BootstrapExtraction = z.infer<typeof BootstrapExtractionSchema>;

// Schema for Gmail email memory proposals
export const EmailMemoryProposalsSchema = z.array(z.object({
  title: z.string().default('Email Extract'),
  content: z.string(),
  domain: z.string().default('business'),
  tags: z.array(z.string()).default([]),
  memoryClass: z.string().default('SEMANTIC'),
  importance: z.number().min(0).max(1).default(0.5),
  linkedPeople: z.array(z.string()).default([]),
}));

// Schema for commitment extraction
export const ExtractedCommitmentsSchema = z.array(z.object({
  description: z.string(),
  stakeholder: z.string().nullable(),
  deadline: z.string().nullable(),
}));

export type ExtractedCommitment = z.infer<typeof ExtractedCommitmentsSchema>[number];
