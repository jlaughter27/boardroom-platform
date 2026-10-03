import { z } from 'zod';
import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  KnowledgeGraphQuery,
} from '../types/graph.types';

export const KnowledgeGraphNodeTypeSchema = z.enum([
  'goal',
  'project',
  'task',
  'person',
  'decision',
  'commitment',
  'memory',
]) satisfies z.ZodType<KnowledgeGraphNodeType>;

export const KnowledgeGraphEdgeTypeSchema = z.enum([
  'goal_hierarchy',
  'goal_project',
  'project_task',
  'project_person',
  'decision_project',
  'task_dependency',
  'commitment_person',
  'commitment_project',
  'commitment_entity',
  'memory_entity',
]);

const MetaValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const KnowledgeGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: KnowledgeGraphNodeTypeSchema,
  refId: z.string().min(1),
  label: z.string(),
  domain: z.string().nullable(),
  status: z.string().nullable(),
  importance: z.number().min(0).max(1).nullable(),
  createdAt: z.string(),
  meta: z.record(MetaValueSchema),
}) satisfies z.ZodType<KnowledgeGraphNode>;

export const KnowledgeGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: KnowledgeGraphEdgeTypeSchema,
  label: z.string().nullable(),
}) satisfies z.ZodType<KnowledgeGraphEdge>;

export const KnowledgeGraphSchema = z.object({
  nodes: z.array(KnowledgeGraphNodeSchema),
  edges: z.array(KnowledgeGraphEdgeSchema),
  stats: z.object({
    nodeCounts: z.object({
      goal: z.number().int().nonnegative(),
      project: z.number().int().nonnegative(),
      task: z.number().int().nonnegative(),
      person: z.number().int().nonnegative(),
      decision: z.number().int().nonnegative(),
      commitment: z.number().int().nonnegative(),
      memory: z.number().int().nonnegative(),
    }),
    edgeCount: z.number().int().nonnegative(),
    isolatedNodes: z.number().int().nonnegative(),
    memoryLimitHit: z.boolean(),
  }),
  generatedAt: z.string(),
}) satisfies z.ZodType<KnowledgeGraph>;

/**
 * Query-string schema for GET /graph. Accepts the comma-separated / string
 * forms a URL carries and coerces them into KnowledgeGraphQuery.
 */
export const KnowledgeGraphQuerySchema = z
  .object({
    types: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        const raw = Array.isArray(v) ? v : v.split(',');
        return raw.map((s) => s.trim()).filter(Boolean);
      })
      .pipe(z.array(KnowledgeGraphNodeTypeSchema).min(1).optional()),
    domain: z.string().trim().min(1).max(50).optional(),
    memoryLimit: z.coerce.number().int().min(0).max(500).optional(),
    includeArchived: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v)),
  })
  .strict() satisfies z.ZodType<KnowledgeGraphQuery, z.ZodTypeDef, unknown>;
