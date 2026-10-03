import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { LlmUsageCreateRequestSchema, LlmUsageSummaryQuerySchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import { validateBody } from '../middleware/validate';
import { recordLlmUsage, getUsageSummary } from '../services/llm-usage.service';
import { isAdminRequest } from '../middleware/admin-auth';

const router: IRouter = Router();

/**
 * POST /usage/llm — Phase 6 LlmUsage sink (BoardRoom, MCP, OmniMind jobs).
 * Server computes `costUsd`. Callers fire-and-forget; a 201 with the row id
 * and cost is returned when the write succeeds, 500 via the error handler
 * only on an unexpected failure (the service swallows bad rows → null → 502
 * mapped to a clear error so BoardRoom can log it).
 */
router.post('/llm', validateBody(LlmUsageCreateRequestSchema), async (req, res, next) => {
  try {
    const headerUserId = req.headers['x-user-id'] as string | undefined;
    const body = req.body as typeof LlmUsageCreateRequestSchema._output;
    const result = await recordLlmUsage(
      {
        ...body,
        userId: body.userId ?? headerUserId,
        tenantId: body.tenantId ?? req.agentContext?.tenantId,
      },
      prisma,
    );
    if (!result) {
      res.status(502).json({ error: 'usage_write_failed', message: 'LlmUsage row could not be written' });
      return;
    }
    res.status(201).json(result);
  } catch (err) { next(err); }
});

/**
 * R-O-15: `all=1` crosses users, so it follows `requireAdminKey` semantics:
 *   OMNIMIND_ADMIN_KEY set      → `x-admin-key` must match (timing-safe) → else 403
 *   unset, NODE_ENV=production  → 403 (admin surface disabled)
 *   unset, non-production       → allowed (dev convenience, same as /admin/*)
 */
export function mayAggregateAllUsers(req: Parameters<typeof isAdminRequest>[0]): boolean {
  if (!process.env.OMNIMIND_ADMIN_KEY) return process.env.NODE_ENV !== 'production';
  return isAdminRequest(req);
}

/**
 * GET /usage/llm/summary?days=7[&all=1]
 * Default scope is the calling user (x-user-id). `all=1` aggregates every
 * row (admin cost widget). Rows written by jobs without a user are only
 * visible with `all=1`.
 *
 * R-O-15: `all=1` is admin-gated — the caller must send `x-admin-key`
 * matching `OMNIMIND_ADMIN_KEY` (BoardRoom's admin proxy forwards it);
 * otherwise 403 `admin_required`. Without `all=1` the header is ignored.
 */
router.get('/llm/summary', async (req, res, next) => {
  try {
    const parsed = LlmUsageSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (parsed.data.all && !mayAggregateAllUsers(req)) {
      res.status(403).json({
        error: 'admin_required',
        message: 'all=1 aggregates every user and requires a valid x-admin-key (OMNIMIND_ADMIN_KEY)',
      });
      return;
    }
    const userId = req.headers['x-user-id'] as string | undefined;
    const summary = await getUsageSummary(
      { days: parsed.data.days, userId: parsed.data.all ? null : userId ?? null },
      prisma,
    );
    res.json(summary);
  } catch (err) { next(err); }
});

export const usageRouter: IRouter = router;
