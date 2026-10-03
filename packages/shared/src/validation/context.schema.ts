// Phase 6 context Zod schemas — matches packages/shared/src/types/context.types.ts

import { z } from 'zod';
import type {
  ReflectRequest,
  ReflectionLLMOutput,
  MemoItemStateRequest,
  LlmUsageCreateRequest,
} from '../types/context.types';

const IsoDateString = z.string().datetime({ offset: true });

// ── Core context ──

export const CoreContextResponseSchema = z.object({
  block: z.string(),
  tokensEstimate: z.number().int().nonnegative(),
  hash: z.string().length(64),
  generatedAt: IsoDateString,
});

// ── Reflection / capsules ──

export const ReflectableEntityTypeSchema = z.enum(['goal', 'project', 'person']);

export const ReflectRequestSchema = z.object({
  entityType: ReflectableEntityTypeSchema,
  entityId: z.string().min(1).max(64),
}) satisfies z.ZodType<ReflectRequest>;

/** Strict shape for the Haiku reflection output. Arrays capped to keep capsules small. */
export const ReflectionLLMOutputSchema = z.object({
  summary: z.string().min(1).max(4000),
  openRisks: z.array(z.string().min(1).max(500)).max(10).default([]),
  unresolvedQuestions: z.array(z.string().min(1).max(500)).max(10).default([]),
  recentChanges: z.array(z.string().min(1).max(500)).max(10).default([]),
  activeStakeholders: z.array(z.string().min(1).max(120)).max(15).default([]),
}) satisfies z.ZodType<ReflectionLLMOutput, z.ZodTypeDef, unknown>;

/** `entityIds=goal:x,project:y` — parsed into typed pairs. */
export const EntityRefSchema = z.object({
  entityType: ReflectableEntityTypeSchema,
  entityId: z.string().min(1),
});

export const CapsulesQuerySchema = z.object({
  entityIds: z
    .string()
    .min(1)
    .transform((raw, ctx) => {
      const refs = raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(pair => {
          const idx = pair.indexOf(':');
          return idx > 0 ? { entityType: pair.slice(0, idx), entityId: pair.slice(idx + 1) } : null;
        });
      const parsed: Array<z.infer<typeof EntityRefSchema>> = [];
      for (const ref of refs) {
        const r = ref ? EntityRefSchema.safeParse(ref) : null;
        if (!r || !r.success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'entityIds must be a comma list of <goal|project|person>:<id>' });
          return z.NEVER;
        }
        parsed.push(r.data);
      }
      if (parsed.length === 0 || parsed.length > 20) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'entityIds must contain 1–20 refs' });
        return z.NEVER;
      }
      return parsed;
    }),
});

// ── Changes ──

export const EntityChangesQuerySchema = z.object({
  entityId: z.string().regex(/^(goal|project|person):.+$/, 'entityId must be <goal|project|person>:<id>'),
  since: IsoDateString,
});

// ── Calibration ──

export const CalibrationQuerySchema = z.object({
  successThreshold: z.coerce.number().int().min(1).max(5).default(4),
});

// ── Interactive memo ──

export const MemoItemStateValueSchema = z.enum(['accepted', 'dismissed', 'snoozed']);

export const MemoItemStateRequestSchema = z
  .object({
    state: MemoItemStateValueSchema,
    until: IsoDateString.optional(),
  })
  .refine(v => v.state !== 'snoozed' || !!v.until, { message: 'until is required when state is snoozed', path: ['until'] }) satisfies z.ZodType<MemoItemStateRequest>;

/** `<memoField>:<index>` e.g. `recommendedFocus:1` */
export const MemoItemKeySchema = z
  .string()
  .regex(/^(patternsNoticed|activeContradictions|upcomingPressurePoints|recommendedFocus):\d{1,3}$/, 'itemKey must be <field>:<index>');

// ── LLM usage ──

export const LlmUsageCreateRequestSchema = z.object({
  service: z.string().min(1).max(40),
  purpose: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  sessionId: z.string().max(64).optional(),
  userId: z.string().max(64).optional(),
  tenantId: z.string().max(64).optional(),
}) satisfies z.ZodType<LlmUsageCreateRequest>;

export const LlmUsageSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  /** `1`/`true` → aggregate across all users (admin cost widget). */
  all: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform(v => v === '1' || v === 'true'),
});
