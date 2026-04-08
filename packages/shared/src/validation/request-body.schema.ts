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
  mode: z.enum(['decide', 'stress-test', 'plan', 'clarify', 'review', 'quick-take']).optional(),
  roomId: z.string().optional(),
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
  includeEntities: z.array(z.enum(['memories', 'people', 'goals', 'projects', 'decisions'])).optional(),
});
