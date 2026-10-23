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

/**
 * A persona id on the wire: a built-in id (`critic`) or a custom persona's slug
 * (`custom_board_advisor`, see omnimind-api custom-personas.routes.ts). Whether the
 * id belongs to the session is checked by the route (400 `unknown_persona`).
 */
export const PersonaIdParamSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'persona ids are lower-case slugs');

/**
 * POST /sessions/:id/dispatch (M1-C2). Empty body = every persona of the
 * session's mode. `personaIds` re-runs only those advisors (Retry on a failed
 * card); a retry never re-runs the debate round. Companion: `DispatchSessionRequest`.
 */
export const DispatchSessionBodySchema = z.object({
  personaIds: z.array(PersonaIdParamSchema).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'personaIds must be unique')
    .optional(),
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

/**
 * POST /memories/links/batch — up to 500 MemoryEntityLinks in one request, so a
 * bulk import (the vault importer's wikilinks) is not paced one link per write
 * under the 20/min limit. Companion interface: `BatchMemoryLinksRequest`.
 */
export const MEMORY_LINKS_BATCH_MAX = 500;
export const BatchMemoryLinkItemSchema = z.object({
  memoryId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  linkType: z.string().min(1).max(64).optional(),
});
export const BatchMemoryLinksBodySchema = z.object({
  links: z.array(BatchMemoryLinkItemSchema).min(1).max(MEMORY_LINKS_BATCH_MAX),
});
