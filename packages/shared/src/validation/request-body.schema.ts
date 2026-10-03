import { z } from 'zod';

export const RegisterBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

export const LoginBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export const CreateSessionBodySchema = z.object({
  question: z.string().min(1).max(5000),
  mode: z.enum(['decide', 'stress-test', 'plan', 'clarify', 'review', 'quick-take', 'premortem']).optional(),
  roomId: z.string().optional(),
  /** Phase 6 — temporal validity: retrieve only what was known at this instant (ISO). */
  asOf: z.string().datetime().optional(),
});

export const UpdateUserProfileBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  decisionFrequency: z.string().optional(),
  onboardingComplete: z.boolean().optional(),
  dashboardLayout: z.unknown().optional(),
}).passthrough();

export const SaveOAuthTokenBodySchema = z.object({
  provider: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  calendarId: z.string().nullable().optional(),
});

export const ContextForPersonaBodySchema = z.object({
  query: z.string().min(1).max(5000),
  persona: z.string().min(1),
  maxItems: z.number().min(1).max(20).optional(),
  // Phase 6 (lane B): 'commitments' / 'tasks' were already sent by the Critic /
  // Technician / Doer context strategy (B-114) but rejected here with 422 —
  // additive enum extension so those personas stop losing their context call.
  includeEntities: z.array(z.enum(['memories', 'people', 'goals', 'projects', 'decisions', 'commitments', 'tasks'])).optional(),
  /** Phase 6 — temporal validity: retrieve what was believed at this instant (ISO 8601). */
  asOf: z.string().datetime({ offset: true }).optional(),
  /** Phase 6 — Critic also reads archived / superseded memories. */
  includeArchived: z.boolean().optional(),
  /** Phase 6 — Critic focuses on DECISION-class memories. */
  memoryClass: z.string().max(40).optional(),
});
