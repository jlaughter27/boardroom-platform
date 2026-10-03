import type { PrismaClient, Prisma, WeeklyMemo } from '@prisma/client';
import { CORTEX_CONFIG, WeeklyMemoLLMResponseSchema, MODEL_IDS } from '@boardroom/shared';
import type { MemoItemState, MemoItemStateRequest } from '@boardroom/shared';
import { logger } from '../lib/logger';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { createMessage, extractText, parseJsonFromText, hasAnthropicKey } from '../lib/anthropic';
import { HttpError } from '../middleware/error-handler';
import { createMemory } from './memory.service';

/** Phase 6: decisions with `reviewAt <= now + 7d` and no outcome yet. */
export const REVIEW_HORIZON_DAYS = 7;

export async function findDecisionsAwaitingReview(userId: string, prisma: PrismaClient, now: Date = new Date()) {
  const horizon = new Date(now.getTime() + REVIEW_HORIZON_DAYS * 86_400_000);
  return prisma.decision.findMany({
    where: { userId, deletedAt: null, outcomeRating: null, reviewAt: { not: null, lte: horizon } },
    select: { id: true, title: true, reviewAt: true, expectedOutcome: true, probabilitySuccess: true },
    orderBy: { reviewAt: 'asc' },
    take: 20,
  });
}

export async function generateWeeklyMemo(userId: string, prisma: PrismaClient): Promise<unknown> {
  if (!hasAnthropicKey()) throw new Error('ANTHROPIC_API_KEY not set');

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Gather data
  const [decisions, goals, tasks, commitments, patterns, contradictions, awaitingReview] = await Promise.all([
    prisma.decision.findMany({ where: { userId, createdAt: { gte: weekStart } }, orderBy: { createdAt: 'desc' }, take: CORTEX_CONFIG.memoMaxDecisionsToAnalyze }),
    prisma.goal.findMany({ where: { userId, deletedAt: null, status: 'active' } }),
    prisma.task.findMany({ where: { userId, deletedAt: null, status: { not: 'done' } } }),
    prisma.commitment.findMany({ where: { userId, status: 'OPEN' } }),
    prisma.thinkingPattern.findMany({ where: { userId }, orderBy: { confidence: 'desc' }, take: 5 }),
    prisma.contradictionAlert.findMany({ where: { userId, status: 'ACTIVE' } }),
    findDecisionsAwaitingReview(userId, prisma, now),
  ]);

  // Check minimum threshold
  const totalSessions = await prisma.decision.count({ where: { userId } });
  if (totalSessions < CORTEX_CONFIG.minSessionsForMemo) {
    return null; // Not enough data
  }

  const decisionsAwaitingReview = awaitingReview.map(d => d.id);

  // R-O-12: idempotency check BEFORE the LLM call — a memo for this week must
  // not cost a Sonnet call to discover. Same return shape as the create path.
  const existingMemo = await prisma.weeklyMemo.findFirst({
    where: { userId, weekStart: { gte: weekStart, lte: now } },
  });
  if (existingMemo) {
    logger.info('Weekly memo already exists for this period', { userId, memoId: existingMemo.id });
    return { ...existingMemo, decisionsAwaitingReview };
  }

  // Build prompt context
  const context = `
## Decisions This Week (${decisions.length})
${decisions.map(d => `- ${d.title}: ${d.status}${d.chosenPath ? ` → ${d.chosenPath}` : ''}`).join('\n') || 'None'}

## Decisions Awaiting Outcome Review (next ${REVIEW_HORIZON_DAYS} days) (${awaitingReview.length})
${awaitingReview.map(d => `- ${d.title} (review ${d.reviewAt?.toISOString().split('T')[0]})${d.expectedOutcome ? ` — expected: ${d.expectedOutcome}` : ''}${d.probabilitySuccess != null ? ` (p=${d.probabilitySuccess})` : ''}`).join('\n') || 'None'}

## Active Goals (${goals.length})
${goals.map(g => `- ${g.title} (${g.status})${g.deadline ? ` due ${g.deadline.toISOString().split('T')[0]}` : ''}`).join('\n') || 'None'}

## Open Tasks (${tasks.length})
${tasks.map(t => `- ${t.title}${t.deadline ? ` due ${t.deadline.toISOString().split('T')[0]}` : ''}`).join('\n').slice(0, 1000) || 'None'}

## Open Commitments (${commitments.length})
${commitments.map(c => `- ${c.description}${c.deadline ? ` due ${c.deadline.toISOString().split('T')[0]}` : ''}`).join('\n') || 'None'}

## Known Thinking Patterns
${patterns.map(p => `- ${p.pattern} (${p.patternType}, confidence: ${p.confidence})`).join('\n') || 'None detected yet'}

## Active Contradictions
${contradictions.map(c => `- ${c.description} (${c.severity})`).join('\n') || 'None'}
`;

  // Phase 6: shared client, MODEL_IDS, explicit effort, usage recorded.
  const response = await createMessage({
    model: MODEL_IDS.sonnet,
    max_tokens: 2000,
    system: [{ type: 'text', text: loadSystemPrompt('cortex-memo'), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: context }],
    output_config: { effort: 'medium' },
  }, { purpose: 'cortex-memo', userId });

  const text = extractText(response);
  if (!text) throw new Error('Empty memo response');
  const memoData = WeeklyMemoLLMResponseSchema.parse(parseJsonFromText(text));

  // Calculate score change from last memo
  const lastMemo = await prisma.weeklyMemo.findFirst({ where: { userId }, orderBy: { weekStart: 'desc' } });
  const lastScore = lastMemo ? (lastMemo.thinkingQualityScore > 10 ? lastMemo.thinkingQualityScore / 10 : lastMemo.thinkingQualityScore) : 0;
  const scoreChange = lastMemo ? memoData.thinkingQualityScore - lastScore : 0;

  // Phase 6: decisions awaiting review → `review:<id>` pressure points + memo section.
  const reviewPoints = decisionsAwaitingReview.map(id => `review:${id}`);
  const upcomingPressurePoints = [...(memoData.upcomingPressurePoints ?? []), ...reviewPoints];
  const reviewSection = awaitingReview.length
    ? `\n\n## Decisions awaiting review\n${awaitingReview.map(d => `- ${d.title} — review by ${d.reviewAt?.toISOString().split('T')[0]} (id: ${d.id})`).join('\n')}\n`
    : '';
  const fullMemoText = `${memoData.fullMemoText ?? ''}${reviewSection}`;

  // Store
  const memo = await prisma.weeklyMemo.create({
    data: {
      userId,
      weekStart,
      weekEnd: now,
      decisionsMade: memoData.decisionsMade ?? decisions.length,
      decisionsByCategory: memoData.decisionsByCategory ?? {},
      patternsNoticed: memoData.patternsNoticed ?? [],
      activeContradictions: memoData.activeContradictions ?? [],
      upcomingPressurePoints,
      thinkingQualityScore: memoData.thinkingQualityScore ?? 5,
      scoreChange,
      recommendedFocus: memoData.recommendedFocus ?? [],
      fullMemoText,
      itemStates: {},
    },
  });

  logger.info('Weekly memo generated', { userId, memoId: memo.id, score: memo.thinkingQualityScore, decisionsAwaitingReview: decisionsAwaitingReview.length });
  return { ...memo, decisionsAwaitingReview };
}

export async function getLatestMemo(userId: string, prisma: PrismaClient) {
  return prisma.weeklyMemo.findFirst({ where: { userId }, orderBy: { weekStart: 'desc' } });
}

export async function getMemoHistory(userId: string, limit: number, offset: number, prisma: PrismaClient) {
  const [items, total] = await Promise.all([
    prisma.weeklyMemo.findMany({ where: { userId }, orderBy: { weekStart: 'desc' }, take: limit, skip: offset }),
    prisma.weeklyMemo.count({ where: { userId } }),
  ]);
  return { items, total, offset, limit };
}

// ── Phase 6 — interactive memo ──

type MemoListField = 'patternsNoticed' | 'activeContradictions' | 'upcomingPressurePoints' | 'recommendedFocus';

/** `recommendedFocus:1` → the memo item text, or null when out of range. Pure. */
export function resolveMemoItem(memo: Pick<WeeklyMemo, MemoListField>, itemKey: string): { field: MemoListField; index: number; text: string } | null {
  const idx = itemKey.indexOf(':');
  if (idx <= 0) return null;
  const field = itemKey.slice(0, idx) as MemoListField;
  const index = Number(itemKey.slice(idx + 1));
  const list = memo[field];
  if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return { field, index, text: list[index] };
}

const MEMO_SOURCE_TYPE = 'AGENT_EXTRACTED'; // SourceType has no CORTEX/SYSTEM member; closest system-generated value.

/**
 * PATCH /cortex/memo/:id/items/:itemKey
 * `accepted` writes the item back as a memory THROUGH the validation pipeline
 * (createMemory → runValidationPipeline), tags `['memo', itemKey]`, and
 * stores the memory id in `itemStates`. Re-accepting an already accepted item
 * is idempotent (no second memory).
 */
export async function updateMemoItem(
  userId: string,
  memoId: string,
  itemKey: string,
  body: MemoItemStateRequest,
  prisma: PrismaClient,
): Promise<WeeklyMemo> {
  const memo = await prisma.weeklyMemo.findFirst({ where: { id: memoId, userId } });
  if (!memo) throw new HttpError(404, { code: 'not_found', message: 'Memo not found' });

  const item = resolveMemoItem(memo, itemKey);
  if (!item) throw new HttpError(404, { code: 'item_not_found', message: `No memo item at ${itemKey}` });

  const states = (memo.itemStates && typeof memo.itemStates === 'object' && !Array.isArray(memo.itemStates)
    ? { ...(memo.itemStates as unknown as Record<string, MemoItemState>) }
    : {}) as Record<string, MemoItemState>;
  const previous = states[itemKey];

  const next: MemoItemState = { state: body.state };
  if (body.state === 'snoozed' && body.until) next.until = body.until;

  if (body.state === 'accepted') {
    if (previous?.memoryId) {
      next.memoryId = previous.memoryId;
    } else {
      const result = await createMemory(
        userId,
        {
          title: `Weekly memo — ${item.field}: ${item.text.slice(0, 80)}`,
          content: item.text,
          domain: 'business',
          sourceType: MEMO_SOURCE_TYPE,
          sourceRef: memo.id,
          tags: ['memo', itemKey],
          memoryClass: 'SEMANTIC',
          importance: 0.6,
          confidence: 'MEDIUM',
          metadata: { memoId: memo.id, memoField: item.field, memoIndex: item.index, weekStart: memo.weekStart.toISOString() },
        },
        prisma,
      );
      if (!result.success) {
        throw new HttpError(422, { code: 'memory_validation_failed', message: result.errors.map(e => e.message ?? String(e)).join('; ') || 'Memory rejected by validation pipeline' });
      }
      next.memoryId = result.data.id;
    }
  }

  states[itemKey] = next;
  return prisma.weeklyMemo.update({
    where: { id: memo.id },
    data: { itemStates: states as unknown as Prisma.InputJsonValue },
  });
}
