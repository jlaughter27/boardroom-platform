// Custom Persona Zod schemas — matches custom-persona.types.ts

import { z } from 'zod';

export const CreateCustomPersonaRequestSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters'),
  systemPrompt: z.string().min(50, 'System prompt must be at least 50 characters').max(5000, 'System prompt must be at most 5000 characters'),
  modelTier: z.enum(['haiku', 'sonnet']).optional().default('haiku'),
  maxOutputTokens: z.number().int().min(500, 'Min 500 tokens').max(3000, 'Max 3000 tokens').optional().default(1500),
  toolPermissions: z.array(z.string()).optional().default([]),
  description: z.string().max(200).optional(),
  icon: z.string().max(10).optional(),
});

export type CreateCustomPersonaRequestInput = z.infer<typeof CreateCustomPersonaRequestSchema>;

export const UpdateCustomPersonaRequestSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters').optional(),
  systemPrompt: z.string().min(50, 'System prompt must be at least 50 characters').max(5000, 'System prompt must be at most 5000 characters').optional(),
  modelTier: z.enum(['haiku', 'sonnet']).optional(),
  maxOutputTokens: z.number().int().min(500, 'Min 500 tokens').max(3000, 'Max 3000 tokens').optional(),
  toolPermissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  description: z.string().max(200).optional(),
  icon: z.string().max(10).optional(),
});

export type UpdateCustomPersonaRequestInput = z.infer<typeof UpdateCustomPersonaRequestSchema>;
