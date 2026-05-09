import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { CORTEX_CONFIG, WeeklyMemoLLMResponseSchema } from '@boardroom/shared';
import { logger } from '../lib/logger';
import { loadSystemPrompt } from '../lib/prompt-loader';

const MODEL = 'claude-sonnet-4-6-20250514';

export async function generateWeeklyMemo(userId: string, prisma: PrismaClient): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Gather data
  const [decisions, goals, tasks, commitments, patterns, contradictions] = await Promise.all([
    prisma.decision.findMany({ where: { userId, createdAt: { gte: weekStart } }, orderBy: { createdAt: 'desc' }, take: CORTEX_CONFIG.memoMaxDecisionsToAnalyze }),
    prisma.goal.findMany({ where: { userId, deletedAt: null, status: 'active' } }),
    prisma.task.findMany({ where: { userId, deletedAt: null, status: { not: 'done' } } }),
    prisma.commitment.findMany({ where: { userId, status: 'OPEN' } }),
    prisma.thinkingPattern.findMany({ where: { userId }, orderBy: { confidence: 'desc' }, take: 5 }),
    prisma.contradictionAlert.findMany({ where: { userId, status: 'ACTIVE' } }),
  ]);

  // Check minimum threshold
  const totalSessions = await prisma.decision.count({ where: { userId } });
  if (totalSessions < CORTEX_CONFIG.minSessionsForMemo) {
    return null; // Not enough data
  }

  // Build prompt context
  const context = `
## Decisions This Week (${decisions.length})
${decisions.map(d => `- ${d.title}: ${d.status}${d.chosenPath ? ` → ${d.chosenPath}` : ''}`).join('\n') || 'None'}

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

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: loadSystemPrompt('cortex-memo'),
    messages: [{ role: 'user', content: context }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') throw new Error('Empty memo response');
  const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const memoData = WeeklyMemoLLMResponseSchema.parse(JSON.parse(jsonStr));

  // Calculate score change from last memo
  const lastMemo = await prisma.weeklyMemo.findFirst({ where: { userId }, orderBy: { weekStart: 'desc' } });
  const lastScore = lastMemo ? (lastMemo.thinkingQualityScore > 10 ? lastMemo.thinkingQualityScore / 10 : lastMemo.thinkingQualityScore) : 0;
  const scoreChange = lastMemo ? memoData.thinkingQualityScore - lastScore : 0;

  // Idempotency: check if memo already exists for this week (match on weekStart only)
  const existingMemo = await prisma.weeklyMemo.findFirst({
    where: { userId, weekStart: { gte: weekStart, lte: now } },
  });
  if (existingMemo) {
    logger.info('Weekly memo already exists for this period', { userId, memoId: existingMemo.id });
    return existingMemo;
  }

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
      upcomingPressurePoints: memoData.upcomingPressurePoints ?? [],
      thinkingQualityScore: memoData.thinkingQualityScore ?? 5,
      scoreChange,
      recommendedFocus: memoData.recommendedFocus ?? [],
      fullMemoText: memoData.fullMemoText ?? '',
    },
  });

  logger.info('Weekly memo generated', { userId, memoId: memo.id, score: memo.thinkingQualityScore });
  return memo;
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
