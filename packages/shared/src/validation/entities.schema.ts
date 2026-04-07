// entities Zod schemas — matches packages/shared/src/types/entities.types.ts

import { z } from 'zod';

// ── Person Schemas ──

export const PersonSchema = z.object({
  id: z.string().describe('Unique person identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  name: z.string().describe('Full name of the person'),
  role: z.string().nullable().describe('Professional role or title'),
  domains: z.array(z.string()).describe('Knowledge domains associated with this person'),
  importance: z.number().min(0).max(1).describe('Importance score 0-1'),
  relationshipToUser: z.string().nullable().describe('How this person relates to the user'),
  lastContactAt: z.coerce.date().nullable().describe('Last contact timestamp'),
  notes: z.string().nullable().describe('Free-form notes about this person'),
  interactionFrequency: z.number().describe('How often the user interacts with this person'),
  version: z.number().int().describe('Optimistic concurrency version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type PersonInput = z.infer<typeof PersonSchema>;

export const CreatePersonRequestSchema = z.object({
  name: z.string().min(1).describe('Full name of the person'),
  role: z.string().nullable().optional().describe('Professional role or title'),
  domains: z.array(z.string()).optional().describe('Knowledge domains associated with this person'),
  importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
  relationshipToUser: z.string().nullable().optional().describe('How this person relates to the user'),
  lastContactAt: z.coerce.date().nullable().optional().describe('Last contact timestamp'),
  notes: z.string().nullable().optional().describe('Free-form notes about this person'),
  interactionFrequency: z.number().optional().describe('How often the user interacts with this person'),
});

export type CreatePersonRequestInput = z.infer<typeof CreatePersonRequestSchema>;

export const UpdatePersonRequestSchema = z.object({
  name: z.string().min(1).optional().describe('Full name of the person'),
  role: z.string().nullable().optional().describe('Professional role or title'),
  domains: z.array(z.string()).optional().describe('Knowledge domains associated with this person'),
  importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
  relationshipToUser: z.string().nullable().optional().describe('How this person relates to the user'),
  lastContactAt: z.coerce.date().nullable().optional().describe('Last contact timestamp'),
  notes: z.string().nullable().optional().describe('Free-form notes about this person'),
  interactionFrequency: z.number().optional().describe('How often the user interacts with this person'),
});

export type UpdatePersonRequestInput = z.infer<typeof UpdatePersonRequestSchema>;

// ── Goal Schemas ──

export const GoalSchema = z.object({
  id: z.string().describe('Unique goal identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  title: z.string().describe('Goal title'),
  level: z.number().int().min(0).max(3).describe('Goal hierarchy level (0=vision, 3=task)'),
  parentGoalId: z.string().nullable().describe('Parent goal ID for hierarchy'),
  successMetrics: z.array(z.string()).describe('Measurable success criteria'),
  deadline: z.coerce.date().nullable().describe('Target completion date'),
  status: z.string().describe('Current status of the goal'),
  domain: z.string().describe('Knowledge domain'),
  version: z.number().int().describe('Optimistic concurrency version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type GoalInput = z.infer<typeof GoalSchema>;

export const CreateGoalRequestSchema = z.object({
  title: z.string().min(1).describe('Goal title'),
  level: z.number().int().min(0).max(3).optional().describe('Goal hierarchy level (0=vision, 3=task)'),
  parentGoalId: z.string().nullable().optional().describe('Parent goal ID for hierarchy'),
  successMetrics: z.array(z.string()).optional().describe('Measurable success criteria'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  status: z.string().optional().describe('Current status of the goal'),
  domain: z.string().optional().describe('Knowledge domain'),
});

export type CreateGoalRequestInput = z.infer<typeof CreateGoalRequestSchema>;

export const UpdateGoalRequestSchema = z.object({
  title: z.string().min(1).optional().describe('Goal title'),
  level: z.number().int().min(0).max(3).optional().describe('Goal hierarchy level (0=vision, 3=task)'),
  parentGoalId: z.string().nullable().optional().describe('Parent goal ID for hierarchy'),
  successMetrics: z.array(z.string()).optional().describe('Measurable success criteria'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  status: z.string().optional().describe('Current status of the goal'),
  domain: z.string().optional().describe('Knowledge domain'),
});

export type UpdateGoalRequestInput = z.infer<typeof UpdateGoalRequestSchema>;

// ── Project Schemas ──

export const ProjectSchema = z.object({
  id: z.string().describe('Unique project identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  title: z.string().describe('Project title'),
  status: z.string().describe('Current status of the project'),
  deadline: z.coerce.date().nullable().describe('Target completion date'),
  successMetrics: z.array(z.string()).describe('Measurable success criteria'),
  domain: z.string().describe('Knowledge domain'),
  version: z.number().int().describe('Optimistic concurrency version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type ProjectInput = z.infer<typeof ProjectSchema>;

export const CreateProjectRequestSchema = z.object({
  title: z.string().min(1).describe('Project title'),
  status: z.string().optional().describe('Current status of the project'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  successMetrics: z.array(z.string()).optional().describe('Measurable success criteria'),
  domain: z.string().optional().describe('Knowledge domain'),
});

export type CreateProjectRequestInput = z.infer<typeof CreateProjectRequestSchema>;

export const UpdateProjectRequestSchema = z.object({
  title: z.string().min(1).optional().describe('Project title'),
  status: z.string().optional().describe('Current status of the project'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  successMetrics: z.array(z.string()).optional().describe('Measurable success criteria'),
  domain: z.string().optional().describe('Knowledge domain'),
});

export type UpdateProjectRequestInput = z.infer<typeof UpdateProjectRequestSchema>;

// ── Task Schemas ──

export const TaskSchema = z.object({
  id: z.string().describe('Unique task identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  title: z.string().describe('Task title'),
  owner: z.string().nullable().describe('Assigned owner'),
  status: z.string().describe('Current status of the task'),
  deadline: z.coerce.date().nullable().describe('Target completion date'),
  priority: z.number().describe('Priority level'),
  estimatedEffort: z.number().nullable().describe('Estimated effort in hours'),
  actualEffort: z.number().nullable().describe('Actual effort in hours'),
  version: z.number().int().describe('Optimistic concurrency version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type TaskInput = z.infer<typeof TaskSchema>;

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).describe('Task title'),
  owner: z.string().nullable().optional().describe('Assigned owner'),
  status: z.string().optional().describe('Current status of the task'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  priority: z.number().optional().describe('Priority level'),
  estimatedEffort: z.number().nullable().optional().describe('Estimated effort in hours'),
  actualEffort: z.number().nullable().optional().describe('Actual effort in hours'),
});

export type CreateTaskRequestInput = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).optional().describe('Task title'),
  owner: z.string().nullable().optional().describe('Assigned owner'),
  status: z.string().optional().describe('Current status of the task'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  priority: z.number().optional().describe('Priority level'),
  estimatedEffort: z.number().nullable().optional().describe('Estimated effort in hours'),
  actualEffort: z.number().nullable().optional().describe('Actual effort in hours'),
});

export type UpdateTaskRequestInput = z.infer<typeof UpdateTaskRequestSchema>;
